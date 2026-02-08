import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { ViewportConfig, CaptureOptions } from './types.js';
import * as logger from './logger.js';

const DEFAULT_CACHE_DIR = './looker-cache';
const MANIFEST_FILE = 'manifest.json';

interface CacheManifestEntry {
  url: string;
  viewport: ViewportConfig;
  timestamp: number;
  filePath: string;
}

interface CacheManifest {
  entries: Record<string, CacheManifestEntry>;
}

export class ScreenshotCache {
  private cacheDir: string;
  private manifest: CacheManifest = { entries: {} };
  private disabled: boolean;

  constructor(cacheDir?: string, disabled = false) {
    this.cacheDir = resolve(cacheDir ?? DEFAULT_CACHE_DIR);
    this.disabled = disabled;
  }

  async init(): Promise<void> {
    if (this.disabled) return;

    if (!existsSync(this.cacheDir)) {
      await mkdir(this.cacheDir, { recursive: true });
    }

    const manifestPath = join(this.cacheDir, MANIFEST_FILE);
    if (existsSync(manifestPath)) {
      try {
        const content = await readFile(manifestPath, 'utf-8');
        this.manifest = JSON.parse(content);
        logger.debug(`Cache loaded: ${Object.keys(this.manifest.entries).length} entries`);
      } catch {
        logger.debug('Cache manifest corrupted, starting fresh');
        this.manifest = { entries: {} };
      }
    }
  }

  generateKey(url: string, viewport: ViewportConfig, captureOpts?: CaptureOptions): string {
    const data = JSON.stringify(
      { url, viewport, captureOpts },
      Object.keys({ url, viewport, captureOpts }).sort(),
    );
    return createHash('sha256').update(data).digest('hex').slice(0, 16);
  }

  async getCached(key: string): Promise<Buffer | null> {
    if (this.disabled) return null;

    const entry = this.manifest.entries[key];
    if (!entry) return null;

    const filePath = resolve(this.cacheDir, entry.filePath);
    if (!existsSync(filePath)) {
      delete this.manifest.entries[key];
      return null;
    }

    try {
      const buffer = await readFile(filePath);
      logger.debug(`Cache hit: ${entry.url} @ ${entry.viewport.name}`);
      return buffer;
    } catch {
      return null;
    }
  }

  async setCached(
    key: string,
    screenshot: Buffer,
    url: string,
    viewport: ViewportConfig,
  ): Promise<string> {
    const fileName = `${key}.png`;
    const filePath = join(this.cacheDir, fileName);

    await writeFile(filePath, screenshot);

    this.manifest.entries[key] = {
      url,
      viewport,
      timestamp: Date.now(),
      filePath: fileName,
    };

    await this.saveManifest();

    logger.debug(`Cached: ${url} @ ${viewport.name}`);
    return filePath;
  }

  async clearCache(): Promise<void> {
    this.manifest = { entries: {} };
    await this.saveManifest();
    logger.info('Cache cleared');
  }

  private async saveManifest(): Promise<void> {
    const manifestPath = join(this.cacheDir, MANIFEST_FILE);
    await writeFile(manifestPath, JSON.stringify(this.manifest, null, 2));
  }
}
