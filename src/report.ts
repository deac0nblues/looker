import { writeFile } from 'node:fs/promises';
import chalk from 'chalk';
import { marked } from 'marked';
import hljs from 'highlight.js';
import type { RunResult, PageResult, PageAnalysis, CrossViewportAnalysis, GoalAssessment } from './types.js';
import * as logger from './logger.js';

// --- Console Report ---

function renderConsoleReport(result: RunResult): string {
  const lines: string[] = [];

  lines.push(chalk.bold.cyan('\n═══════════════════════════════════════'));
  lines.push(chalk.bold.cyan('  Site Review Report'));
  lines.push(chalk.bold.cyan('═══════════════════════════════════════\n'));

  // Summary
  lines.push(chalk.bold('Summary'));
  lines.push(`  Pages analyzed: ${result.summary.pagesAnalyzed}`);
  lines.push(`  Viewports: ${result.summary.viewports.join(', ')}`);
  lines.push(
    `  Issues: ${chalk.red(`${result.summary.totalIssues.critical} critical`)}, ${chalk.yellow(`${result.summary.totalIssues.warning} warning`)}, ${chalk.blue(`${result.summary.totalIssues.info} info`)}`,
  );
  if (result.summary.averageGoalAlignment !== null) {
    lines.push(`  Average goal alignment: ${formatAlignmentScore(result.summary.averageGoalAlignment)}`);
  }
  lines.push('');

  // Per page
  for (const page of result.pages) {
    lines.push(chalk.bold.underline(`\nPage: ${page.url}`));

    // Per viewport analysis
    for (const [vpName, analysis] of page.analyses) {
      lines.push(chalk.bold(`\n  ${vpName}`));

      if (analysis.feedback.layoutAndHierarchy) {
        lines.push(chalk.gray('  Layout & Hierarchy:'));
        lines.push(`    ${analysis.feedback.layoutAndHierarchy}`);
      }
      if (analysis.feedback.typography) {
        lines.push(chalk.gray('  Typography:'));
        lines.push(`    ${analysis.feedback.typography}`);
      }
      if (analysis.feedback.colorAndContrast) {
        lines.push(chalk.gray('  Color & Contrast:'));
        lines.push(`    ${analysis.feedback.colorAndContrast}`);
      }
      if (analysis.feedback.responsiveness) {
        lines.push(chalk.gray('  Responsiveness:'));
        lines.push(`    ${analysis.feedback.responsiveness}`);
      }
      if (analysis.feedback.visualPolish) {
        lines.push(chalk.gray('  Visual Polish:'));
        lines.push(`    ${analysis.feedback.visualPolish}`);
      }

      // Goal assessments
      if (analysis.goalAssessments.length > 0) {
        lines.push(chalk.bold.gray('  Goal Alignment:'));
        for (const ga of analysis.goalAssessments) {
          lines.push(`    ${formatGoalAlignment(ga)}`);
          if (ga.observation) lines.push(chalk.gray(`      Observation: ${ga.observation}`));
          if (ga.gap) lines.push(chalk.yellow(`      Gap: ${ga.gap}`));
          if (ga.suggestion) lines.push(chalk.green(`      Suggestion: ${ga.suggestion}`));
        }
        if (analysis.overallGoalAlignment !== null) {
          lines.push(`    Overall: ${formatAlignmentScore(analysis.overallGoalAlignment)}`);
        }
      }

      // Issues
      if (analysis.issues.length > 0) {
        lines.push(chalk.bold.gray('  Issues:'));
        for (const issue of analysis.issues) {
          const color = issue.severity === 'critical' ? chalk.red : issue.severity === 'warning' ? chalk.yellow : chalk.blue;
          lines.push(`    ${color(`[${issue.severity}]`)} ${issue.description}${issue.element ? chalk.gray(` (${issue.element})`) : ''}`);
        }
      }

      // Top recommendations
      if (analysis.topRecommendations.length > 0) {
        lines.push(chalk.bold.gray('  Top Recommendations:'));
        for (let i = 0; i < analysis.topRecommendations.length; i++) {
          lines.push(`    ${i + 1}. ${analysis.topRecommendations[i]}`);
        }
      }
    }

    // Cross-viewport
    if (page.crossViewportAnalysis) {
      lines.push(chalk.bold('\n  Cross-Viewport Analysis'));
      const cva = page.crossViewportAnalysis;
      if (cva.breakpointQuality) lines.push(`    Breakpoints: ${cva.breakpointQuality}`);
      if (cva.contentParity) lines.push(`    Content Parity: ${cva.contentParity}`);
      if (cva.navigationAdaptation) lines.push(`    Navigation: ${cva.navigationAdaptation}`);
      if (cva.consistencyAcrossSizes) lines.push(`    Consistency: ${cva.consistencyAcrossSizes}`);
      if (cva.goalConsistency) lines.push(`    Goal Consistency: ${cva.goalConsistency}`);
    }

    // Errors
    if (page.errors.length > 0) {
      lines.push(chalk.red('\n  Errors:'));
      for (const e of page.errors) {
        lines.push(chalk.red(`    ${e.viewport}: ${e.error}`));
      }
    }
  }

  lines.push('');
  return lines.join('\n');
}

function formatGoalAlignment(ga: GoalAssessment): string {
  const icon = ga.alignment === 'strong' ? chalk.green('●') : ga.alignment === 'partial' ? chalk.yellow('◐') : chalk.red('○');
  return `${icon} ${ga.goal} [${ga.alignment}]`;
}

function formatAlignmentScore(score: number): string {
  if (score >= 80) return chalk.green(`${score}/100`);
  if (score >= 50) return chalk.yellow(`${score}/100`);
  return chalk.red(`${score}/100`);
}

// --- Markdown Report ---

function renderMarkdownReport(result: RunResult): string {
  const lines: string[] = [];
  const timestamp = new Date().toISOString();

  lines.push(`# Site Review Report`);
  lines.push(`Generated: ${timestamp}\n`);

  // Summary
  lines.push(`## Summary`);
  lines.push(`- **Pages analyzed:** ${result.summary.pagesAnalyzed}`);
  lines.push(`- **Viewports:** ${result.summary.viewports.join(', ')}`);
  lines.push(`- **Critical issues:** ${result.summary.totalIssues.critical}`);
  lines.push(`- **Warnings:** ${result.summary.totalIssues.warning}`);
  lines.push(`- **Info:** ${result.summary.totalIssues.info}`);
  if (result.summary.averageGoalAlignment !== null) {
    lines.push(`- **Average goal alignment:** ${result.summary.averageGoalAlignment}/100`);
  }
  lines.push('');

  // Per page
  for (const page of result.pages) {
    lines.push(`## Page: ${page.url}\n`);

    for (const [vpName, analysis] of page.analyses) {
      lines.push(`### ${vpName}\n`);

      // Screenshot reference
      const entry = page.screenshots.get(vpName);
      if (entry) {
        lines.push(`![${vpName} screenshot](${entry.filePath})\n`);
      }

      if (analysis.feedback.layoutAndHierarchy) {
        lines.push(`**Layout & Hierarchy:** ${analysis.feedback.layoutAndHierarchy}\n`);
      }
      if (analysis.feedback.typography) {
        lines.push(`**Typography:** ${analysis.feedback.typography}\n`);
      }
      if (analysis.feedback.colorAndContrast) {
        lines.push(`**Color & Contrast:** ${analysis.feedback.colorAndContrast}\n`);
      }
      if (analysis.feedback.responsiveness) {
        lines.push(`**Responsiveness:** ${analysis.feedback.responsiveness}\n`);
      }
      if (analysis.feedback.visualPolish) {
        lines.push(`**Visual Polish:** ${analysis.feedback.visualPolish}\n`);
      }

      // Goal assessments
      if (analysis.goalAssessments.length > 0) {
        lines.push(`#### Goal Alignment\n`);
        lines.push(`| Goal | Alignment | Observation | Gap | Suggestion |`);
        lines.push(`|------|-----------|-------------|-----|------------|`);
        for (const ga of analysis.goalAssessments) {
          const alignIcon = ga.alignment === 'strong' ? '🟢' : ga.alignment === 'partial' ? '🟡' : '🔴';
          lines.push(
            `| ${ga.goal} | ${alignIcon} ${ga.alignment} | ${ga.observation || '-'} | ${ga.gap || '-'} | ${ga.suggestion || '-'} |`,
          );
        }
        if (analysis.overallGoalAlignment !== null) {
          lines.push(`\n**Overall Goal Alignment: ${analysis.overallGoalAlignment}/100**\n`);
        }
      }

      // Issues
      if (analysis.issues.length > 0) {
        lines.push(`#### Issues\n`);
        for (const issue of analysis.issues) {
          const badge = issue.severity === 'critical' ? '🔴' : issue.severity === 'warning' ? '🟡' : '🔵';
          lines.push(`- ${badge} **[${issue.severity}]** ${issue.description}${issue.element ? ` (\`${issue.element}\`)` : ''}`);
        }
        lines.push('');
      }

      // Top recommendations
      if (analysis.topRecommendations.length > 0) {
        lines.push(`#### Top Recommendations\n`);
        for (let i = 0; i < analysis.topRecommendations.length; i++) {
          lines.push(`${i + 1}. ${analysis.topRecommendations[i]}`);
        }
        lines.push('');
      }
    }

    // Cross-viewport
    if (page.crossViewportAnalysis) {
      lines.push(`### Cross-Viewport Analysis\n`);
      const cva = page.crossViewportAnalysis;
      if (cva.breakpointQuality) lines.push(`**Breakpoint Quality:** ${cva.breakpointQuality}\n`);
      if (cva.contentParity) lines.push(`**Content Parity:** ${cva.contentParity}\n`);
      if (cva.navigationAdaptation) lines.push(`**Navigation Adaptation:** ${cva.navigationAdaptation}\n`);
      if (cva.consistencyAcrossSizes) lines.push(`**Consistency:** ${cva.consistencyAcrossSizes}\n`);
      if (cva.goalConsistency) lines.push(`**Goal Consistency:** ${cva.goalConsistency}\n`);

      if (cva.issues.length > 0) {
        lines.push(`**Cross-Viewport Issues:**\n`);
        for (const issue of cva.issues) {
          const badge = issue.severity === 'critical' ? '🔴' : issue.severity === 'warning' ? '🟡' : '🔵';
          lines.push(`- ${badge} **[${issue.severity}]** ${issue.description}`);
        }
        lines.push('');
      }
    }

    // Errors
    if (page.errors.length > 0) {
      lines.push(`### Errors\n`);
      for (const e of page.errors) {
        lines.push(`- ⚠️ ${e.viewport}: ${e.error}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// --- HTML Report ---

const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Site Review Report</title>
<style>
  :root {
    --bg: #0d1117;
    --surface: #161b22;
    --border: #30363d;
    --text: #e6edf3;
    --text-muted: #8b949e;
    --accent: #58a6ff;
    --green: #3fb950;
    --yellow: #d29922;
    --red: #f85149;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.6;
    padding: 2rem;
    max-width: 1200px;
    margin: 0 auto;
  }
  h1 { color: var(--accent); margin-bottom: 0.5rem; }
  h2 { color: var(--text); margin: 2rem 0 1rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; }
  h3 { color: var(--text-muted); margin: 1.5rem 0 0.75rem; }
  h4 { color: var(--text-muted); margin: 1rem 0 0.5rem; }
  p { margin-bottom: 0.75rem; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 1rem 0;
    font-size: 0.9rem;
  }
  th, td {
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border);
    text-align: left;
  }
  th { background: var(--surface); color: var(--text-muted); }
  td { background: var(--bg); }
  code {
    background: var(--surface);
    padding: 0.15rem 0.4rem;
    border-radius: 3px;
    font-size: 0.85em;
  }
  ul { margin: 0.5rem 0 1rem 1.5rem; }
  li { margin-bottom: 0.25rem; }
  img {
    max-width: 100%;
    border: 1px solid var(--border);
    border-radius: 6px;
    margin: 0.5rem 0;
  }
  strong { color: var(--text); }
  .summary-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
    margin: 1rem 0;
  }
  .summary-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem;
  }
  .summary-card .label { color: var(--text-muted); font-size: 0.85rem; }
  .summary-card .value { font-size: 1.5rem; font-weight: bold; margin-top: 0.25rem; }
</style>
</head>
<body>
{{content}}
</body>
</html>`;

function renderHtmlReport(result: RunResult): string {
  const markdown = renderMarkdownReport(result);
  const htmlContent = marked(markdown) as string;
  return HTML_TEMPLATE.replace('{{content}}', htmlContent);
}

// --- JSON Report ---

function renderJsonReport(result: RunResult): string {
  // Convert Maps to plain objects for JSON serialization
  const serializable = {
    ...result,
    pages: result.pages.map((page) => ({
      url: page.url,
      screenshots: Object.fromEntries(page.screenshots),
      analyses: Object.fromEntries(page.analyses),
      crossViewportAnalysis: page.crossViewportAnalysis,
      errors: page.errors,
    })),
  };

  return JSON.stringify(serializable, null, 2);
}

// --- Cursor-Friendly Markdown Report ---

function renderCursorMarkdownReport(result: RunResult): string {
  const lines: string[] = [];
  const timestamp = new Date().toISOString();

  lines.push(`# UI Review — Action Items`);
  lines.push(`Generated: ${timestamp}\n`);

  // Summary
  lines.push(`## Summary`);
  lines.push(`- Pages: ${result.summary.pagesAnalyzed}`);
  lines.push(`- Critical: ${result.summary.totalIssues.critical}`);
  lines.push(`- Warnings: ${result.summary.totalIssues.warning}`);
  lines.push(`- Info: ${result.summary.totalIssues.info}`);
  if (result.summary.averageGoalAlignment !== null) {
    lines.push(`- Goal alignment: ${result.summary.averageGoalAlignment}/100`);
  }
  lines.push('');

  for (const page of result.pages) {
    lines.push(`## ${page.url}\n`);

    // Collect all issues across viewports, deduplicating
    const allIssues: Array<{
      severity: string;
      category: string;
      description: string;
      element: string | null;
      viewport: string;
    }> = [];

    for (const [vpName, analysis] of page.analyses) {
      for (const issue of analysis.issues) {
        allIssues.push({ ...issue, viewport: vpName });
      }
    }

    // Sort: critical first, then warning, then info
    const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
    allIssues.sort(
      (a, b) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3),
    );

    if (allIssues.length > 0) {
      lines.push(`### Issues\n`);
      for (const issue of allIssues) {
        const sev =
          issue.severity === 'critical'
            ? '**CRITICAL**'
            : issue.severity === 'warning'
              ? '**WARNING**'
              : 'info';
        const elem = issue.element ? ` \`${issue.element}\`` : '';
        lines.push(`- [ ] ${sev} [${issue.viewport}]: ${issue.description}${elem}`);
      }
      lines.push('');
    }

    // Deduplicated recommendations as numbered action list
    const allRecs: string[] = [];
    for (const [, analysis] of page.analyses) {
      for (const rec of analysis.topRecommendations) {
        if (!allRecs.includes(rec)) allRecs.push(rec);
      }
    }
    if (allRecs.length > 0) {
      lines.push(`### Recommendations\n`);
      for (let i = 0; i < allRecs.length; i++) {
        lines.push(`${i + 1}. ${allRecs[i]}`);
      }
      lines.push('');
    }

    // Goal gaps as actionable items
    const goalGaps: Array<{ goal: string; gap: string; suggestion: string }> = [];
    for (const [, analysis] of page.analyses) {
      for (const ga of analysis.goalAssessments) {
        if (ga.alignment !== 'strong' && ga.gap) {
          if (!goalGaps.find((g) => g.goal === ga.goal)) {
            goalGaps.push({
              goal: ga.goal,
              gap: ga.gap,
              suggestion: ga.suggestion ?? '',
            });
          }
        }
      }
    }
    if (goalGaps.length > 0) {
      lines.push(`### Goal Gaps\n`);
      for (const gg of goalGaps) {
        lines.push(`- [ ] **${gg.goal}**: ${gg.gap}`);
        if (gg.suggestion) {
          lines.push(`  - Suggested fix: ${gg.suggestion}`);
        }
      }
      lines.push('');
    }

    // Cross-viewport issues
    if (page.crossViewportAnalysis?.issues.length) {
      lines.push(`### Cross-Viewport Issues\n`);
      for (const issue of page.crossViewportAnalysis.issues) {
        const sev =
          issue.severity === 'critical'
            ? '**CRITICAL**'
            : issue.severity === 'warning'
              ? '**WARNING**'
              : 'info';
        lines.push(`- [ ] ${sev}: ${issue.description}`);
      }
      lines.push('');
    }

    // Errors
    if (page.errors.length > 0) {
      lines.push(`### Errors\n`);
      for (const e of page.errors) {
        lines.push(`- ⚠️ ${e.viewport}: ${e.error}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// --- Auto-Save ---

export async function autoSaveReport(result: RunResult): Promise<string> {
  const { mkdir } = await import('node:fs/promises');
  const { existsSync } = await import('node:fs');
  const { resolve } = await import('node:path');

  const reportsDir = resolve('./reports');
  if (!existsSync(reportsDir)) {
    await mkdir(reportsDir, { recursive: true });
  }

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const filename = `review-${timestamp}.md`;
  const filePath = resolve(reportsDir, filename);

  const content = renderCursorMarkdownReport(result);
  await writeFile(filePath, content);

  return filePath;
}

// --- Public API ---

export async function generateReport(
  result: RunResult,
  format: string,
  outputFile?: string,
): Promise<void> {
  let content: string;

  switch (format) {
    case 'markdown':
      content = renderMarkdownReport(result);
      break;
    case 'html':
      content = renderHtmlReport(result);
      break;
    case 'json':
      content = renderJsonReport(result);
      break;
    case 'console':
    default:
      content = renderConsoleReport(result);
      break;
  }

  if (outputFile) {
    await writeFile(outputFile, content);
    logger.success(`Report written to ${outputFile}`);
  } else {
    // For console format, just print. For others, also print to stdout.
    process.stdout.write(content);
    if (format !== 'console') {
      process.stdout.write('\n');
    }
  }
}
