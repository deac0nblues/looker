import 'dotenv/config';
import { Command } from 'commander';
import { resolveConfig } from './config.js';
import { run } from './index.js';
import { setVerbose, setQuiet } from './logger.js';
import * as logger from './logger.js';

const program = new Command();

program
  .name('looker')
  .description('Automated visual design feedback for websites')
  .version('0.1.0');

// Input
program
  .option('--url <url>', 'URL to analyze (default: https://websiteqsltemp.vercel.app/)')
  .option('--sitemap <url>', 'Sitemap URL to discover pages')
  .option('--urls <file>', 'Text file with URLs (one per line)')
  .option('--no-discover', 'Only analyze the provided URL, don\'t discover linked pages');

// Filtering
program
  .option('--max-pages <n>', 'Maximum pages to analyze', parseInt)
  .option('--include <pattern>', 'Include URLs matching regex pattern')
  .option('--exclude <pattern>', 'Exclude URLs matching regex pattern');

// Viewports
program
  .option('--viewports <widths>', 'Comma-separated viewport widths (e.g., 375,768,1440)')
  .option('--viewport-config <file>', 'JSON file with viewport definitions')
  .option('--mobile-only', 'Analyze only at mobile viewport (375px)')
  .option('--desktop-only', 'Analyze only at desktop viewport (1440px)');

// Capture
program
  .option('--wait-for <selector>', 'Wait for selector before capturing')
  .option('--delay <ms>', 'Delay before capture in milliseconds', parseInt)
  .option('--no-animations', 'Disable CSS animations before capture')
  .option('--hide <selectors...>', 'CSS selectors of elements to hide')
  .option('--auth <file>', 'JSON file with auth credentials/cookies')
  .option('--dark-mode', 'Emulate dark mode preference')
  .option('--timeout <ms>', 'Page load timeout in milliseconds', parseInt)
  .option('--no-scroll-reveal', 'Skip scroll-through for lazy content triggering');

// Analysis
program
  .option('--model <model>', 'Vision model to use (default: claude-sonnet-4-20250514)')
  .option('--api-key <key>', 'API key for the vision model')
  .option('--api-url <url>', 'Custom API endpoint URL')
  .option('--prompt <file>', 'Custom prompt template file')
  .option('--focus <area>', 'Focus analysis on specific area (e.g., typography, mobile)');

// Goals
program
  .option('--goals <file>', 'Goals file path (default: auto-detect goals.md)');

// Output
program
  .option('--output <format>', 'Output format: console, markdown, html, json')
  .option('--output-file <path>', 'Write report to file');

// Cache
program
  .option('--no-cache', 'Disable screenshot caching')
  .option('--cache-dir <path>', 'Custom cache directory')
  .option('--reanalyze', 'Use cached screenshots but re-run analysis');

// CI
program
  .option('--fail-on <severity>', 'Exit with code 1 if issues found at severity (critical, warning, info)')
  .option('--baseline <file>', 'Compare against previous JSON report');

// Logging
program
  .option('--verbose', 'Verbose output')
  .option('--quiet', 'Minimal output');

program.action(async (opts) => {
  try {
    if (opts.verbose) setVerbose(true);
    if (opts.quiet) setQuiet(true);

    const config = await resolveConfig({
      url: opts.url,
      sitemap: opts.sitemap,
      urls: opts.urls,
      maxPages: opts.maxPages,
      include: opts.include,
      exclude: opts.exclude,
      viewports: opts.viewports,
      viewportConfig: opts.viewportConfig,
      mobileOnly: opts.mobileOnly,
      desktopOnly: opts.desktopOnly,
      waitFor: opts.waitFor,
      delay: opts.delay,
      noAnimations: opts.animations === false, // commander's --no-animations sets animations to false
      hide: opts.hide,
      auth: opts.auth,
      darkMode: opts.darkMode,
      scrollReveal: opts.scrollReveal,
      model: opts.model,
      apiKey: opts.apiKey,
      apiUrl: opts.apiUrl,
      prompt: opts.prompt,
      focus: opts.focus,
      goals: opts.goals,
      output: opts.output,
      outputFile: opts.outputFile,
      noDiscover: opts.discover === false, // commander's --no-discover sets discover to false
      noCache: opts.cache === false, // commander's --no-cache sets cache to false
      cacheDir: opts.cacheDir,
      reanalyze: opts.reanalyze,
      failOn: opts.failOn,
      baseline: opts.baseline,
      timeout: opts.timeout,
      verbose: opts.verbose,
      quiet: opts.quiet,
    });

    const result = await run(config);
    process.exit(result.exitCode);
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
});

program.parse();
