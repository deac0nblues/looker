import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import {
  LookerConfigSchema,
  type LookerConfig,
  DEFAULT_VIEWPORTS,
  DEFAULT_URL,
  DEFAULT_MAX_PAGES,
  DEFAULT_MODEL,
  DEFAULT_TIMEOUT,
} from './types.js';
import * as logger from './logger.js';

const CONFIG_FILENAMES = ['.lookerrc.json', 'looker.config.json'];

export interface CliFlags {
  url?: string;
  sitemap?: string;
  urls?: string;
  maxPages?: number;
  include?: string;
  exclude?: string;
  viewports?: string; // comma-separated widths
  viewportConfig?: string; // path to JSON
  mobileOnly?: boolean;
  desktopOnly?: boolean;
  waitFor?: string;
  delay?: number;
  noAnimations?: boolean;
  hide?: string[]; // selectors
  auth?: string; // path to auth JSON
  darkMode?: boolean;
  scrollReveal?: boolean;
  model?: string;
  apiKey?: string;
  apiUrl?: string;
  prompt?: string; // path to prompt file
  focus?: string;
  goals?: string; // path to goals file
  output?: string;
  outputFile?: string;
  noDiscover?: boolean;
  noCache?: boolean;
  cacheDir?: string;
  reanalyze?: boolean;
  failOn?: string;
  baseline?: string;
  timeout?: number;
  verbose?: boolean;
  quiet?: boolean;
}

function findConfigFile(startDir: string): string | null {
  let dir = resolve(startDir);
  const root = dirname(dir);

  while (true) {
    for (const name of CONFIG_FILENAMES) {
      const candidate = resolve(dir, name);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    const parent = dirname(dir);
    if (parent === dir || dir === root) break;
    dir = parent;
  }

  return null;
}

async function loadConfigFile(filePath: string): Promise<Partial<LookerConfig>> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const raw = JSON.parse(content);
    logger.debug(`Loaded config from ${filePath}`);
    return raw;
  } catch (err) {
    logger.warn(`Failed to load config file ${filePath}: ${err}`);
    return {};
  }
}

function parseViewportWidths(widths: string): LookerConfig['viewports'] {
  return widths.split(',').map((w) => {
    const width = parseInt(w.trim(), 10);
    const match = DEFAULT_VIEWPORTS.find((v) => v.width === width);
    return match ?? { name: `${width}px`, width, height: Math.round(width * 0.75) };
  });
}

function resolveProvider(model?: string): 'claude' | 'openai' {
  if (!model) return 'claude';
  if (model.startsWith('gpt') || model.startsWith('o1') || model.startsWith('o3')) return 'openai';
  return 'claude';
}

export async function resolveConfig(flags: CliFlags): Promise<LookerConfig> {
  // 1. Start with defaults
  const defaults: LookerConfig = {
    url: DEFAULT_URL,
    maxPages: DEFAULT_MAX_PAGES,
    viewports: DEFAULT_VIEWPORTS,
    capture: {
      timeout: DEFAULT_TIMEOUT,
    },
    analysis: {
      model: DEFAULT_MODEL,
      provider: 'claude',
    },
    output: 'console',
    noCache: false,
  };

  // 2. Load config file
  const configPath = findConfigFile(process.cwd());
  const fileConfig = configPath ? await loadConfigFile(configPath) : {};

  // 3. Build CLI config (CLI wins)
  const cliConfig: Partial<LookerConfig> = {};

  // Input — only override defaults if explicitly provided
  if (flags.url) cliConfig.url = flags.url;
  if (flags.sitemap) {
    cliConfig.sitemap = flags.sitemap;
    cliConfig.url = undefined; // sitemap takes precedence
  }
  if (flags.urls) {
    cliConfig.urls = flags.urls;
    cliConfig.url = undefined;
  }
  if (flags.maxPages) cliConfig.maxPages = flags.maxPages;
  if (flags.include) cliConfig.include = flags.include;
  if (flags.exclude) cliConfig.exclude = flags.exclude;

  // Viewports
  if (flags.mobileOnly) {
    cliConfig.viewports = [{ name: 'mobile', width: 375, height: 812 }];
  } else if (flags.desktopOnly) {
    cliConfig.viewports = [{ name: 'desktop', width: 1440, height: 900 }];
  } else if (flags.viewports) {
    cliConfig.viewports = parseViewportWidths(flags.viewports);
  } else if (flags.viewportConfig) {
    const vpContent = await readFile(flags.viewportConfig, 'utf-8');
    cliConfig.viewports = JSON.parse(vpContent);
  }

  // Capture options
  const capture: LookerConfig['capture'] = {};
  if (flags.delay !== undefined) capture.delay = flags.delay;
  if (flags.waitFor) capture.waitFor = flags.waitFor;
  if (flags.noAnimations) capture.noAnimations = true;
  if (flags.darkMode) capture.darkMode = true;
  if (flags.timeout) capture.timeout = flags.timeout;
  if (flags.hide) capture.hideSelectors = flags.hide;
  if (flags.scrollReveal === false) capture.scrollReveal = false;
  if (Object.keys(capture).length > 0) cliConfig.capture = capture;

  if (flags.auth) cliConfig.auth = flags.auth;

  // Goals
  if (flags.goals) cliConfig.goals = flags.goals;

  // Analysis
  const analysis: LookerConfig['analysis'] = {};
  if (flags.model) {
    analysis.model = flags.model;
    analysis.provider = resolveProvider(flags.model);
  }
  if (flags.apiKey) analysis.apiKey = flags.apiKey;
  if (flags.apiUrl) analysis.apiUrl = flags.apiUrl;
  if (flags.focus) cliConfig.focus = flags.focus;
  if (flags.prompt) analysis.prompt = flags.prompt;
  if (Object.keys(analysis).length > 0) cliConfig.analysis = analysis;

  // Output
  if (flags.output) cliConfig.output = flags.output as LookerConfig['output'];
  if (flags.outputFile) cliConfig.outputFile = flags.outputFile;

  // Discovery
  if (flags.noDiscover) cliConfig.noDiscover = true;

  // Cache
  if (flags.noCache) cliConfig.noCache = true;
  if (flags.cacheDir) cliConfig.cacheDir = flags.cacheDir;
  if (flags.reanalyze) cliConfig.reanalyze = true;

  // CI
  if (flags.failOn) cliConfig.failOn = flags.failOn as LookerConfig['failOn'];
  if (flags.baseline) cliConfig.baseline = flags.baseline;

  // Merge: defaults -> file config -> CLI flags
  const merged = deepMerge(deepMerge(defaults, fileConfig), cliConfig);

  // Validate
  const result = LookerConfigSchema.safeParse(merged);
  if (!result.success) {
    logger.error('Invalid configuration:');
    for (const issue of result.error.issues) {
      logger.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    throw new Error('Configuration validation failed');
  }

  return result.data;
}

function deepMerge<T extends Record<string, unknown>>(base: T, override: Partial<T>): T {
  const result = { ...base };
  for (const key of Object.keys(override) as Array<keyof T>) {
    const val = override[key];
    if (val === undefined) continue;
    if (
      val !== null &&
      typeof val === 'object' &&
      !Array.isArray(val) &&
      typeof result[key] === 'object' &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        val as Record<string, unknown>,
      ) as T[keyof T];
    } else {
      result[key] = val as T[keyof T];
    }
  }
  return result;
}
