import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import sharp from 'sharp';
import pLimit from 'p-limit';
import type {
  LookerConfig,
  ViewportConfig,
  ScreenshotEntry,
  AuthConfig,
} from './types.js';
import { DEFAULT_TIMEOUT, DEFAULT_CONCURRENCY } from './types.js';
import { ScreenshotCache } from './cache.js';
import { retryWithBackoff } from './retry.js';
import * as logger from './logger.js';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB for API limits
const MAX_IMAGE_DIMENSION = 7800; // Claude API rejects >8000px on any axis; 200px safety buffer
const SCREENSHOT_DIR = './screenshots';

async function scrollToRevealContent(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const scrollHeight = document.body.scrollHeight;
    const viewportHeight = window.innerHeight;
    let currentPosition = 0;

    // Scroll down in viewport-height increments to trigger IntersectionObservers
    while (currentPosition < scrollHeight) {
      currentPosition += viewportHeight;
      window.scrollTo(0, currentPosition);
      await delay(250);
    }

    // Ensure we hit the absolute bottom
    window.scrollTo(0, document.body.scrollHeight);
    await delay(300);

    // Scroll back to top and let everything settle
    window.scrollTo(0, 0);
    await delay(500);
  });
}

function slugify(url: string): string {
  const u = new URL(url);
  const path = u.pathname.replace(/\/$/, '') || 'index';
  return path.replace(/^\//, '').replace(/\//g, '-') || 'index';
}

async function loadAuth(authPath: string): Promise<AuthConfig> {
  const content = await readFile(authPath, 'utf-8');
  return JSON.parse(content);
}

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

async function resizeIfNeeded(buffer: Buffer): Promise<Buffer> {
  // --- Phase 1: Enforce pixel dimension limits ---
  const metadata = await sharp(buffer).metadata();
  const origWidth = metadata.width ?? 0;
  const origHeight = metadata.height ?? 0;

  let current = buffer;

  if (origWidth > MAX_IMAGE_DIMENSION || origHeight > MAX_IMAGE_DIMENSION) {
    const scale = Math.min(
      MAX_IMAGE_DIMENSION / origWidth,
      MAX_IMAGE_DIMENSION / origHeight,
    );
    const newWidth = Math.round(origWidth * scale);
    const newHeight = Math.round(origHeight * scale);

    logger.debug(
      `Screenshot dimensions ${origWidth}x${origHeight} exceed ${MAX_IMAGE_DIMENSION}px limit, resizing to ${newWidth}x${newHeight}`,
    );

    current = await sharp(buffer)
      .resize({ width: newWidth, height: newHeight })
      .png()
      .toBuffer();
  }

  // --- Phase 2: Enforce file size limits ---
  if (current.length <= MAX_IMAGE_BYTES) return current;

  logger.debug(`Screenshot ${(current.length / 1024 / 1024).toFixed(1)}MB, reducing file size...`);

  let result = current;
  let quality = 80;

  while (result.length > MAX_IMAGE_BYTES && quality > 20) {
    result = await sharp(current).png({ quality }).toBuffer();
    quality -= 10;
  }

  // If still too large, reduce dimensions further
  if (result.length > MAX_IMAGE_BYTES) {
    const meta = await sharp(current).metadata();
    const width = meta.width ?? 1440;
    result = await sharp(current)
      .resize({ width: Math.round(width * 0.7) })
      .png({ quality: 60 })
      .toBuffer();
  }

  logger.debug(`Resized to ${(result.length / 1024 / 1024).toFixed(1)}MB`);
  return result;
}

export interface CaptureResult {
  entries: Map<string, Map<string, ScreenshotEntry>>; // url -> viewport name -> entry
}

export async function captureScreenshots(
  urls: string[],
  config: LookerConfig,
  cache: ScreenshotCache,
): Promise<CaptureResult> {
  const viewports = config.viewports!;
  const timeout = config.capture?.timeout ?? DEFAULT_TIMEOUT;
  const concurrency = DEFAULT_CONCURRENCY;
  const limit = pLimit(concurrency);

  const result: CaptureResult = { entries: new Map() };
  const spinner = logger.progress(`Capturing screenshots (0/${urls.length * viewports.length})`);
  let completed = 0;
  const total = urls.length * viewports.length;

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });

    // Load auth if provided
    let authConfig: AuthConfig | undefined;
    if (config.auth) {
      authConfig = await loadAuth(config.auth);
    }

    const tasks = urls.flatMap((url) =>
      viewports.map((viewport) => {
        return limit(async () => {
          const slug = slugify(url);
          const cacheKey = cache.generateKey(url, viewport, config.capture);

          // Check cache first
          if (!config.noCache && !config.reanalyze) {
            const cached = await cache.getCached(cacheKey);
            if (cached) {
              const dir = resolve(SCREENSHOT_DIR, slug);
              await ensureDir(dir);
              const filePath = join(dir, `${viewport.name}.png`);

              // Ensure the screenshot file exists on disk for downstream consumers
              if (!existsSync(filePath)) {
                await writeFile(filePath, cached);
                logger.debug(`Restored cached screenshot to ${filePath}`);
              }

              // Ensure entries map exists for this URL
              if (!result.entries.has(url)) result.entries.set(url, new Map());
              result.entries.get(url)!.set(viewport.name, {
                url,
                viewport,
                filePath,
                timestamp: Date.now(),
                cached: true,
              });

              completed++;
              spinner.text = `Capturing screenshots (${completed}/${total})`;
              return;
            }
          }

          // Capture screenshot
          const screenshot = await retryWithBackoff(
            async () => {
              const context = await browser!.newContext({
                viewport: { width: viewport.width, height: viewport.height },
                colorScheme: config.capture?.darkMode ? 'dark' : 'light',
              });

              // Apply auth cookies
              if (authConfig?.cookies) {
                await context.addCookies(authConfig.cookies as any);
              }

              const page = await context.newPage();

              try {
                // Navigate
                await page.goto(url, {
                  waitUntil: 'networkidle',
                  timeout,
                });

                // Wait for specific selector
                if (config.capture?.waitFor) {
                  await page.waitForSelector(config.capture.waitFor, { timeout });
                }

                // Additional delay
                if (config.capture?.delay) {
                  await new Promise((r) => setTimeout(r, config.capture!.delay));
                }

                // Disable animations
                if (config.capture?.noAnimations) {
                  await page.addStyleTag({
                    content: `
                      *, *::before, *::after {
                        animation-duration: 0s !important;
                        animation-delay: 0s !important;
                        transition-duration: 0s !important;
                        transition-delay: 0s !important;
                      }
                    `,
                  });
                }

                // Hide elements
                const hideSelectors = [
                  ...(config.capture?.hideSelectors ?? []),
                  ...(config.hide ?? []),
                ];
                if (hideSelectors.length > 0) {
                  await page.addStyleTag({
                    content: hideSelectors
                      .map((s) => `${s} { display: none !important; }`)
                      .join('\n'),
                  });
                }

                // Apply localStorage auth
                if (authConfig?.localStorage) {
                  for (const [key, value] of Object.entries(authConfig.localStorage)) {
                    await page.evaluate(
                      ([k, v]) => localStorage.setItem(k, v),
                      [key, value],
                    );
                  }
                  // Reload to apply
                  await page.goto(url, { waitUntil: 'networkidle', timeout });
                }

                // Scroll through page to trigger lazy-loaded content and scroll animations
                if (config.capture?.scrollReveal !== false) {
                  await scrollToRevealContent(page);
                }

                // Take screenshot
                const buffer = await page.screenshot({ fullPage: true, type: 'png' });
                return Buffer.from(buffer);
              } finally {
                await page.close();
                await context.close();
              }
            },
            {
              attempts: 3,
              onRetry: (err, attempt) => {
                logger.debug(`Retry ${attempt} for ${url} @ ${viewport.name}: ${err}`);
              },
            },
          );

          // Resize if needed
          const finalScreenshot = await resizeIfNeeded(screenshot);

          // Save to disk
          const dir = resolve(SCREENSHOT_DIR, slug);
          await ensureDir(dir);
          const filePath = join(dir, `${viewport.name}.png`);
          await writeFile(filePath, finalScreenshot);

          // Cache it
          await cache.setCached(cacheKey, finalScreenshot, url, viewport);

          // Store entry
          if (!result.entries.has(url)) result.entries.set(url, new Map());
          result.entries.get(url)!.set(viewport.name, {
            url,
            viewport,
            filePath,
            timestamp: Date.now(),
            cached: false,
          });

          completed++;
          spinner.text = `Capturing screenshots (${completed}/${total})`;
        });
      }),
    );

    await Promise.all(tasks);
    spinner.succeed(`Captured ${total} screenshot(s)`);
  } catch (err) {
    spinner.fail('Screenshot capture failed');
    throw err;
  } finally {
    if (browser) await browser.close();
  }

  return result;
}
