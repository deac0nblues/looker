import { existsSync } from 'node:fs';
import pLimit from 'p-limit';
import type { LookerConfig, PageResult, RunResult } from './types.js';
import { ScreenshotCache } from './cache.js';
import { discoverUrls } from './crawler.js';
import { captureScreenshots } from './capture.js';
import { analyzeScreenshot } from './analyze.js';
import { compareViewports } from './compare.js';
import { loadGoals, getGoalsForPage } from './goals.js';
import { generateReport, autoSaveReport } from './report.js';
import * as logger from './logger.js';

const ANALYSIS_CONCURRENCY = 5;

export async function run(config: LookerConfig): Promise<RunResult> {
  const startTime = Date.now();

  // 1. Load goals
  const allGoals = await loadGoals(config.goals);
  const hasGoals = allGoals.length > 0;
  if (hasGoals) {
    const totalGoalCount = allGoals.reduce((sum, g) => sum + g.goals.length, 0);
    logger.info(`Loaded ${totalGoalCount} goal(s) across ${allGoals.length} section(s)`);
  }

  // 2. Discover URLs
  const urls = await discoverUrls(config);

  // 3. Initialize cache
  const cache = new ScreenshotCache(config.cacheDir, config.noCache);
  await cache.init();

  // 4. Capture screenshots (unless reanalyze mode with cached data)
  let captureResult;
  if (config.reanalyze) {
    logger.info('Reanalyze mode: using cached screenshots');
    // In reanalyze mode, we still need to capture to get the entries
    // but the cache will return hits for existing screenshots
    captureResult = await captureScreenshots(urls, config, cache);
  } else {
    captureResult = await captureScreenshots(urls, config, cache);
  }

  // 5. Analyze each page/viewport — PARALLEL

  // Pre-build PageResult structures so parallel tasks can write into them
  const pages: PageResult[] = [];
  const pageMap = new Map<string, PageResult>();

  for (const [url, viewportEntries] of captureResult.entries) {
    const pageResult: PageResult = {
      url,
      screenshots: viewportEntries,
      analyses: new Map(),
      crossViewportAnalysis: null,
      errors: [],
    };
    pages.push(pageResult);
    pageMap.set(url, pageResult);
  }

  // --- Phase A: Per-viewport analyses (all in parallel, bounded) ---
  const analysisLimit = pLimit(ANALYSIS_CONCURRENCY);
  const totalAnalyses = [...captureResult.entries.values()].reduce((sum, m) => sum + m.size, 0);
  let analyzeCount = 0;
  const analyzeSpinner = logger.progress(`Analyzing screenshots (0/${totalAnalyses})...`);

  const analysisTasks: Promise<void>[] = [];

  for (const [url, viewportEntries] of captureResult.entries) {
    const pageGoals = getGoalsForPage(url, allGoals);
    const pageResult = pageMap.get(url)!;

    for (const [vpName, entry] of viewportEntries) {
      // Pre-flight: verify screenshot file exists before queuing analysis
      if (!existsSync(entry.filePath)) {
        logger.warn(`Screenshot missing for ${url} @ ${vpName} — skipping analysis`);
        pageResult.errors.push({ viewport: vpName, error: `Screenshot file not found: ${entry.filePath}` });
        analyzeCount++;
        continue;
      }

      analysisTasks.push(
        analysisLimit(async () => {
          try {
            const analysis = await analyzeScreenshot(
              entry.filePath,
              url,
              entry.viewport,
              pageGoals,
              config,
            );
            pageResult.analyses.set(vpName, analysis);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.debug(`Analysis failed for ${url} @ ${vpName}: ${message}`);
            pageResult.errors.push({ viewport: vpName, error: message });
          } finally {
            analyzeCount++;
            analyzeSpinner.text = `Analyzing screenshots (${analyzeCount}/${totalAnalyses})`;
          }
        }),
      );
    }
  }

  await Promise.all(analysisTasks);
  analyzeSpinner.succeed(`Analyzed ${totalAnalyses} screenshot(s)`);

  // --- Phase B: Cross-viewport comparisons (all in parallel, bounded) ---
  const pagesNeedingComparison = pages.filter((p) => p.screenshots.size > 1);

  if (pagesNeedingComparison.length > 0) {
    let compareCount = 0;
    const totalComparisons = pagesNeedingComparison.length;
    const compareSpinner = logger.progress(`Comparing viewports (0/${totalComparisons})...`);

    const comparisonTasks = pagesNeedingComparison.map((pageResult) =>
      analysisLimit(async () => {
        try {
          const pageGoals = getGoalsForPage(pageResult.url, allGoals);
          pageResult.crossViewportAnalysis = await compareViewports(
            pageResult.url,
            pageResult.screenshots,
            pageGoals,
            config,
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.debug(`Cross-viewport comparison failed for ${pageResult.url}: ${message}`);
          pageResult.errors.push({ viewport: 'cross-viewport', error: message });
        } finally {
          compareCount++;
          compareSpinner.text = `Comparing viewports (${compareCount}/${totalComparisons})`;
        }
      }),
    );

    await Promise.all(comparisonTasks);
    compareSpinner.succeed(`Compared viewports for ${totalComparisons} page(s)`);
  }

  // 6. Build summary
  const totalIssues = { critical: 0, warning: 0, info: 0 };
  let goalAlignmentSum = 0;
  let goalAlignmentCount = 0;

  for (const page of pages) {
    for (const analysis of page.analyses.values()) {
      for (const issue of analysis.issues) {
        totalIssues[issue.severity]++;
      }
      if (analysis.overallGoalAlignment !== null) {
        goalAlignmentSum += analysis.overallGoalAlignment;
        goalAlignmentCount++;
      }
    }
    if (page.crossViewportAnalysis) {
      for (const issue of page.crossViewportAnalysis.issues) {
        totalIssues[issue.severity]++;
      }
    }
  }

  const averageGoalAlignment =
    goalAlignmentCount > 0 ? Math.round(goalAlignmentSum / goalAlignmentCount) : null;

  // 7. Determine exit code
  let exitCode: 0 | 1 | 2 = 0;

  if (config.failOn) {
    const threshold = config.failOn;
    if (threshold === 'critical' && totalIssues.critical > 0) exitCode = 1;
    if (threshold === 'warning' && (totalIssues.critical > 0 || totalIssues.warning > 0)) exitCode = 1;
    if (threshold === 'info' && (totalIssues.critical > 0 || totalIssues.warning > 0 || totalIssues.info > 0)) exitCode = 1;
  }

  const result: RunResult = {
    pages,
    summary: {
      pagesAnalyzed: pages.length,
      viewports: config.viewports?.map((v) => `${v.name} (${v.width}px)`) ?? [],
      totalIssues,
      averageGoalAlignment,
    },
    exitCode,
  };

  // 8. Generate report (user-requested format)
  await generateReport(result, config.output ?? 'console', config.outputFile);

  // 9. Auto-save Cursor-friendly markdown report
  const savedPath = await autoSaveReport(result);
  logger.info(`Review saved to ${savedPath}`);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  logger.success(`Review complete in ${elapsed}s`);

  return result;
}
