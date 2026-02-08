# Looker

Automated visual design feedback for websites. Captures full-page screenshots at multiple viewports, sends them to a vision-capable LLM, and generates opinionated design feedback reports.

## Quick Start

```bash
npm install
npx playwright install chromium
npm run build

# Set your API key
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env

# Run against the default site
node dist/cli.js

# Run against any URL
node dist/cli.js --url https://example.com
```

## What It Does

1. Discovers pages from the starting URL (follows same-origin links by default)
2. Captures full-page screenshots at 4 viewport sizes (mobile, tablet, desktop, wide)
3. Sends each screenshot to Claude's vision API for design analysis
4. Compares all viewports together for responsive consistency
5. Benchmarks against your visual goals (if provided)
6. Auto-saves a Cursor-friendly markdown report with actionable checkboxes

## Goals

Define visual goals in a `goals.md` file and the analysis will benchmark every page against them.

```markdown
# Visual Goals

## Site-Wide Goals
- Brand should feel modern, trustworthy, and approachable
- Primary action on every page should be immediately obvious
- Typography should emphasize clarity — clean sans-serif, generous spacing

## Page: /
- Hero should immediately communicate what the company does
- Social proof visible without scrolling on desktop
- CTA hierarchy clear and focused

## Page: /pricing
- Pricing tiers instantly scannable (identify plan in 5 seconds)
- Recommended tier visually distinct but not pushy
- Feature comparison readable without horizontal scrolling on tablet+
```

Drop this file in your project root and Looker picks it up automatically. Or point to it with `--goals path/to/goals.md`.

See `goals.example.md` for a full example.

## CLI Options

### Input

| Flag | Description | Default |
|------|-------------|---------|
| `--url <url>` | URL to analyze | `https://websiteqsltemp.vercel.app/` |
| `--sitemap <url>` | Discover pages from sitemap XML | |
| `--urls <file>` | Text file with URLs, one per line | |
| `--no-discover` | Don't auto-discover linked pages | `false` |
| `--max-pages <n>` | Maximum pages to analyze | `10` |
| `--include <pattern>` | Include URLs matching regex | |
| `--exclude <pattern>` | Exclude URLs matching regex | |

### Viewports

| Flag | Description |
|------|-------------|
| `--viewports <widths>` | Comma-separated widths (e.g. `375,768,1440`) |
| `--viewport-config <file>` | JSON file with viewport definitions |
| `--mobile-only` | Only mobile (375px) |
| `--desktop-only` | Only desktop (1440px) |

Default viewports: mobile (375x812), tablet (768x1024), desktop (1440x900), wide (1920x1080).

### Capture

| Flag | Description |
|------|-------------|
| `--wait-for <selector>` | Wait for CSS selector before capturing |
| `--delay <ms>` | Additional delay before capture |
| `--no-animations` | Disable CSS animations |
| `--no-scroll-reveal` | Skip scroll-through for lazy content |
| `--hide <selectors...>` | CSS selectors to hide |
| `--auth <file>` | JSON file with cookies/localStorage |
| `--dark-mode` | Emulate dark mode |
| `--timeout <ms>` | Page load timeout (default: 30000) |

### Analysis

| Flag | Description |
|------|-------------|
| `--model <model>` | Vision model (default: `claude-sonnet-4-20250514`) |
| `--api-key <key>` | API key (or set `ANTHROPIC_API_KEY` env var) |
| `--api-url <url>` | Custom API endpoint |
| `--prompt <file>` | Custom prompt template file |
| `--focus <area>` | Focus on specific area (e.g. `typography`, `mobile`) |
| `--goals <file>` | Goals markdown file (default: auto-detect `goals.md`) |

### Output

| Flag | Description |
|------|-------------|
| `--output <format>` | `console`, `markdown`, `html`, or `json` |
| `--output-file <path>` | Write report to specific file |

A Cursor-friendly markdown report is always auto-saved to `./reports/review-YYYY-MM-DD-HHmmss.md`.

### Cache & Reanalysis

| Flag | Description |
|------|-------------|
| `--no-cache` | Disable screenshot caching |
| `--cache-dir <path>` | Custom cache directory |
| `--reanalyze` | Re-run analysis on cached screenshots |

### CI/CD

| Flag | Description |
|------|-------------|
| `--fail-on <severity>` | Exit code 1 if issues at level: `critical`, `warning`, or `info` |
| `--baseline <file>` | Compare against a previous JSON report |

## Config File

Create `.lookerrc.json` or `looker.config.json` in your project root. CLI flags override config values.

```json
{
  "url": "https://example.com",
  "maxPages": 5,
  "viewports": [
    { "name": "mobile", "width": 375, "height": 812 },
    { "name": "desktop", "width": 1440, "height": 900 }
  ],
  "capture": {
    "delay": 1000,
    "noAnimations": true,
    "scrollReveal": true
  },
  "goals": "./goals.md",
  "analysis": {
    "model": "claude-sonnet-4-20250514",
    "focus": "typography"
  },
  "output": "html",
  "failOn": "warning"
}
```

## Output Formats

**Console** — Colored terminal output with severity-coded issues and goal alignment indicators.

**Markdown** — Full report with goal alignment tables, issue severity badges, and cross-viewport analysis.

**HTML** — Self-contained dark-themed HTML page generated from the markdown report.

**JSON** — Machine-readable structured data for CI/CD pipelines.

**Cursor Report** (auto-saved) — Every run saves a `./reports/review-*.md` file with `- [ ]` checkboxes for each issue, sorted by severity, deduplicated across viewports, with goal gaps as actionable items. Drop it into Cursor and start fixing.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude API key (required for default provider) |
| `OPENAI_API_KEY` | OpenAI API key (if using `--model gpt-4o`) |

Set via `.env` file in the project root or your shell profile.

## Examples

```bash
# Quick single-page desktop check
node dist/cli.js --url https://example.com --desktop-only --no-discover

# Full site review with goals
node dist/cli.js --url https://example.com --goals goals.md

# Re-run analysis without re-capturing screenshots
node dist/cli.js --reanalyze

# HTML report for sharing
node dist/cli.js --output html --output-file report.html

# CI: fail on warnings
node dist/cli.js --fail-on warning --output json --output-file results.json
```

## Project Structure

```
src/
  cli.ts         CLI entry point
  index.ts       Main pipeline orchestration
  types.ts       Shared types and Zod schemas
  crawler.ts     URL discovery (sitemap, link extraction)
  capture.ts     Playwright screenshot capture
  analyze.ts     Vision model analysis (Claude/OpenAI)
  compare.ts     Cross-viewport comparison
  goals.ts       Goals file parsing
  report.ts      Report generation (console, md, html, json)
  cache.ts       SHA-256 screenshot cache
  config.ts      Config file loading and merging
  retry.ts       Exponential backoff retry utility
  logger.ts      Colored terminal output (ora + chalk)
```
