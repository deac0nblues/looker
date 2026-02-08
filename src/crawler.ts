import { readFile } from 'node:fs/promises';
import type { LookerConfig } from './types.js';
import * as logger from './logger.js';

export async function discoverUrls(config: LookerConfig): Promise<string[]> {
  let urls: string[] = [];

  if (config.sitemap) {
    urls = await fetchSitemap(config.sitemap);
  } else if (config.urls) {
    urls = await loadUrlFile(config.urls);
  } else if (config.pages && config.url) {
    // Pages from config file, resolved against base URL
    const base = config.url.replace(/\/$/, '');
    urls = config.pages.map((page) => {
      if (page.startsWith('http')) return page;
      return `${base}${page.startsWith('/') ? page : `/${page}`}`;
    });
  } else if (config.url) {
    // Single URL — auto-discover linked pages unless --no-discover
    if (config.noDiscover) {
      urls = [config.url];
    } else {
      urls = await discoverLinksFromPage(config.url);
    }
  }

  if (urls.length === 0) {
    throw new Error('No URLs to analyze. Provide --url, --sitemap, or --urls.');
  }

  // Apply include filter
  if (config.include) {
    const re = new RegExp(config.include);
    urls = urls.filter((u) => re.test(u));
  }

  // Apply exclude filter
  if (config.exclude) {
    const re = new RegExp(config.exclude);
    urls = urls.filter((u) => !re.test(u));
  }

  // Limit pages
  const maxPages = config.maxPages ?? 10;
  if (urls.length > maxPages) {
    logger.warn(`Limiting to ${maxPages} pages (found ${urls.length}). Use --max-pages to adjust.`);
    urls = urls.slice(0, maxPages);
  }

  // Deduplicate
  urls = [...new Set(urls)];

  logger.info(`Discovered ${urls.length} URL(s) to analyze`);
  return urls;
}

async function discoverLinksFromPage(startUrl: string): Promise<string[]> {
  logger.debug(`Discovering links from ${startUrl}`);

  const baseUrl = new URL(startUrl);
  const urls = new Set<string>([startUrl]);

  try {
    const response = await fetch(startUrl);
    if (!response.ok) {
      logger.warn(`Failed to fetch ${startUrl} for link discovery: ${response.status}`);
      return [startUrl];
    }

    const html = await response.text();

    // Extract all href values from <a> tags
    const hrefRegex = /href\s*=\s*["']([^"']+)["']/gi;
    let match: RegExpExecArray | null;

    while ((match = hrefRegex.exec(html)) !== null) {
      const href = match[1].trim();

      // Skip non-page links
      if (
        href.startsWith('#') ||
        href.startsWith('mailto:') ||
        href.startsWith('tel:') ||
        href.startsWith('javascript:') ||
        href.startsWith('data:')
      ) {
        continue;
      }

      try {
        // Resolve relative URLs against the base
        const resolved = new URL(href, startUrl);

        // Only keep same-origin links
        if (resolved.origin !== baseUrl.origin) continue;

        // Strip hash fragments and trailing slashes for dedup
        resolved.hash = '';
        const normalized = resolved.href.replace(/\/$/, '') || resolved.href;

        // Skip asset files
        if (/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|pdf|zip)$/i.test(resolved.pathname)) {
          continue;
        }

        urls.add(normalized);
      } catch {
        // Invalid URL, skip
      }
    }
  } catch (err) {
    logger.warn(`Link discovery failed for ${startUrl}: ${err}`);
    return [startUrl];
  }

  const discovered = [...urls];
  logger.debug(`Discovered ${discovered.length} page(s) from ${startUrl}`);
  return discovered;
}

async function fetchSitemap(sitemapUrl: string): Promise<string[]> {
  logger.debug(`Fetching sitemap: ${sitemapUrl}`);

  const response = await fetch(sitemapUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch sitemap: ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();
  const urls: string[] = [];

  // Parse <loc> tags
  const locMatches = xml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gi);
  for (const match of locMatches) {
    const url = match[1].trim();

    // Check if this is a nested sitemap
    if (url.endsWith('.xml') || url.includes('sitemap')) {
      const nestedUrls = await fetchSitemap(url);
      urls.push(...nestedUrls);
    } else {
      urls.push(url);
    }
  }

  logger.debug(`Sitemap yielded ${urls.length} URLs`);
  return urls;
}

async function loadUrlFile(filePath: string): Promise<string[]> {
  const content = await readFile(filePath, 'utf-8');
  const urls = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  logger.debug(`URL file yielded ${urls.length} URLs`);
  return urls;
}
