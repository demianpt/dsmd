import path from 'node:path';
import {
  chromium,
  type Browser,
  type ConsoleMessage,
  type Page,
  type Response as PlaywrightResponse
} from 'playwright';
import { config } from '../config.js';
import { ensureDir, safeFileName } from '../lib/fs.js';
import { installSafeRequestGuard } from '../lib/url-safety.js';
import { log } from '../lib/log.js';
import { scanDir } from '../storage/scans.js';
import type { PageEvidence, ViewportName } from '../types/domain.js';
import { parseCapturedCss, type CssTextSource } from './css-parser.js';
import { extractInteractionStates, extractRenderedPage } from './page-extractor.js';

/**
 * WebP cannot encode a dimension above 16383px. Chromium does not raise -- it
 * writes a zero-byte file -- so a taller full-page capture silently becomes a
 * broken image in the UI. Cap below the format limit instead.
 */
const WEBP_MAX_DIMENSION = 16_383;

const viewportSizes: Record<ViewportName, { width: number; height: number }> = {
  desktop: { width: 1440, height: 1000 },
  tablet: { width: 834, height: 1112 },
  mobile: { width: 390, height: 844 }
};

export async function launchScannerBrowser(): Promise<Browser> {
  return chromium.launch({
    headless: config.headless,
    args: [
      '--disable-dev-shm-usage',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding'
    ]
  });
}

async function settlePage(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  await page.waitForLoadState('load', { timeout: 8_000 }).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => undefined);
  await page
    .evaluate(async () => {
      if ('fonts' in document) await document.fonts.ready.catch(() => undefined);
    })
    .catch(() => undefined);
  await page.waitForTimeout(300);
}

async function dismissCommonOverlays(page: Page): Promise<void> {
  const patterns = [
    /accept all/i,
    /accept cookies/i,
    /allow all/i,
    /^accept$/i,
    /^agree$/i,
    /i agree/i,
    /got it/i,
    /continue without/i,
    /aceptar todas/i,
    /^aceptar$/i,
    /tout accepter/i,
    /alle akzeptieren/i
  ];
  for (const pattern of patterns) {
    try {
      const button = page.getByRole('button', { name: pattern }).first();
      if (await button.isVisible()) {
        await button.click({ timeout: 800 });
        await page.waitForTimeout(150);
        break;
      }
    } catch {
      // Try the next common consent label.
    }
  }
}

async function triggerLazyContent(page: Page): Promise<void> {
  await page
    .evaluate(async () => {
      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      const maxScroll = Math.min(
        Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
        30_000
      );
      const step = Math.max(450, Math.floor(window.innerHeight * 0.78));
      let previousHeight = 0;
      for (let y = 0, loops = 0; y <= maxScroll && loops < 35; y += step, loops += 1) {
        window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior });
        await sleep(90);
        const height = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
        if (height > previousHeight && height < 30_000) previousHeight = height;
      }
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
      await sleep(180);
    })
    .catch(() => undefined);
}

function mergeCssExtraction(
  pageEvidence: Awaited<ReturnType<typeof extractRenderedPage>>,
  cssSources: CssTextSource[]
): void {
  const parsed = parseCapturedCss(cssSources);

  const variableKey = (item: { name: string; value: string }) => `${item.name}\u0000${item.value}`;
  const variables = new Map(pageEvidence.cssVariables.map((item) => [variableKey(item), item]));
  for (const item of parsed.variables) {
    const key = variableKey(item);
    const current = variables.get(key);
    if (current) {
      current.count += item.count;
      current.sources = [...new Set([...current.sources, ...item.sources])].slice(0, 8);
    } else {
      variables.set(key, item);
    }
  }
  pageEvidence.cssVariables = [...variables.values()].sort((a, b) => b.count - a.count);

  const breakpoints = new Map(pageEvidence.cssMediaQueries.map((item) => [item.query, item]));
  for (const item of parsed.breakpoints) {
    const current = breakpoints.get(item.query);
    if (current) {
      current.count += item.count;
      current.values = [...new Set([...current.values, ...item.values])];
      current.sources = [...new Set([...current.sources, ...item.sources])].slice(0, 8);
    } else {
      breakpoints.set(item.query, item);
    }
  }
  pageEvidence.cssMediaQueries = [...breakpoints.values()].sort((a, b) => b.count - a.count);

  const fonts = new Map(
    pageEvidence.fontFaces.map((item) => [`${item.family}|${item.weight}|${item.style}`, item])
  );
  for (const item of parsed.fontFaces) {
    const key = `${item.family}|${item.weight}|${item.style}`;
    if (!fonts.has(key)) fonts.set(key, item);
  }
  pageEvidence.fontFaces = [...fonts.values()];
}

export interface ScanRenderedPageInput {
  browser: Browser;
  slug: string;
  url: string;
  viewport: ViewportName;
  index: number;
  collectInteractions: boolean;
}

/**
 * tsx/esbuild transpiles with `keepNames`, which wraps named functions in a
 * `__name(fn, "name")` helper. Playwright serializes evaluate() callbacks and
 * runs the source inside the browser, where that helper does not exist -- so
 * every page.evaluate() throws `ReferenceError: __name is not defined`.
 * Defining the helper in the page (on every navigation) makes the injected
 * source valid. Harmless when the bundler did not add the wrapper.
 */
const keepNamesShim = (): void => {
  const scope = globalThis as Record<string, unknown>;
  if (typeof scope.__name === 'function') return;
  scope.__name = (target: unknown, value: string): unknown => {
    try {
      return Object.defineProperty(target as object, 'name', { value, configurable: true });
    } catch {
      return target;
    }
  };
};

/**
 * A whole-page capture of a long page is downscaled by the vision model until
 * small text is unreadable -- it then invents plausible-looking labels. Slicing
 * the page into near-square bands keeps type legible, so the model reads the
 * page top to bottom instead of guessing below the fold.
 *
 * Bands are sampled evenly across the full height, so a tall page is covered
 * end to end rather than only from the top.
 */
async function captureBands(input: {
  page: Page;
  slug: string;
  stem: string;
  screenshotsDirectory: string;
  documentHeight: number;
  width: number;
}): Promise<string[]> {
  const { page, slug, stem, screenshotsDirectory, documentHeight, width } = input;
  const height = Math.min(documentHeight, WEBP_MAX_DIMENSION);
  const band = config.screenshotBandHeight;
  if (height <= 0 || width <= 0) return [];

  const total = Math.max(1, Math.ceil(height / band));
  const take = Math.min(total, config.maxBandsPerPage);
  // Evenly spaced starts so the whole page is represented, not just the top.
  const offsets =
    take >= total
      ? Array.from({ length: total }, (_, i) => i * band)
      : Array.from({ length: take }, (_, i) =>
          Math.round((i * (height - band)) / (take - 1 || 1))
        );

  const paths: string[] = [];
  for (const [index, rawOffset] of offsets.entries()) {
    const y = Math.max(0, Math.min(rawOffset, Math.max(0, height - 1)));
    const clipHeight = Math.min(band, height - y);
    if (clipHeight < 80) continue;
    const name = `${stem}-band-${String(index + 1).padStart(2, '0')}.webp`;
    try {
      await page.screenshot({
        path: path.join(screenshotsDirectory, name),
        type: 'webp',
        quality: 80,
        fullPage: true,
        clip: { x: 0, y, width, height: clipHeight },
        animations: 'disabled'
      });
      paths.push(`/scans/${slug}/screenshots/${name}`);
    } catch {
      // A band that cannot be captured is not worth failing the page over.
    }
  }
  return paths;
}

export async function scanRenderedPage(input: ScanRenderedPageInput): Promise<PageEvidence> {
  const { browser, slug, url, viewport, index, collectInteractions } = input;
  const dimensions = viewportSizes[viewport];
  const context = await browser.newContext({
    viewport: dimensions,
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'no-preference',
    locale: 'en-US'
  });
  await context.addInitScript(keepNamesShim);
  await installSafeRequestGuard(context);
  const page = await context.newPage();
  const warnings: string[] = [];
  const cssSources: CssTextSource[] = [];
  const cssTasks: Promise<void>[] = [];

  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error' && warnings.length < 10) {
      warnings.push(`Console: ${message.text().slice(0, 220)}`);
    }
  });
  page.on('pageerror', (error: Error) => {
    if (warnings.length < 10) warnings.push(`Page error: ${error.message.slice(0, 220)}`);
  });
  page.on('response', (response: PlaywrightResponse) => {
    const contentType = response.headers()['content-type'] || '';
    if (!contentType.includes('text/css') || cssTasks.length >= 40) return;
    const task = (async () => {
      try {
        const body = await response.body();
        if (body.length > 2_000_000) return;
        cssSources.push({ url: response.url(), text: body.toString('utf8') });
      } catch {
        // Some cached or aborted stylesheet responses have no readable body.
      }
    })();
    cssTasks.push(task);
  });

  const startedAt = Date.now();
  let responseStatus: number | undefined;
  let finalUrl = url;
  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: config.pageTimeoutMs
    });
    responseStatus = response?.status();
    await settlePage(page);
    await dismissCommonOverlays(page);
    await triggerLazyContent(page);
    await settlePage(page);
    finalUrl = page.url();

    const raw = await extractRenderedPage(page, viewport);
    await Promise.allSettled(cssTasks);
    mergeCssExtraction(raw, cssSources);

    const interactions = collectInteractions ? await extractInteractionStates(page) : [];
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);
    await page.waitForTimeout(100);

    const parsed = new URL(finalUrl);
    const stem = `${String(index + 1).padStart(2, '0')}-${safeFileName(
      parsed.pathname === '/' ? 'home' : parsed.pathname.replace(/^\//, '')
    )}-${viewport}`;
    const screenshotsDirectory = path.join(scanDir(slug), 'screenshots');
    await ensureDir(screenshotsDirectory);
    const fullName = `${stem}.webp`;
    const viewportName = `${stem}-viewport.webp`;
    const fullPath = path.join(screenshotsDirectory, fullName);
    const viewportPath = path.join(screenshotsDirectory, viewportName);

    await page.screenshot({
      path: viewportPath,
      type: 'webp',
      quality: 82,
      fullPage: false,
      animations: 'disabled'
    });

    if (raw.layout.documentHeight <= WEBP_MAX_DIMENSION) {
      await page.screenshot({
        path: fullPath,
        type: 'webp',
        quality: 78,
        fullPage: true,
        animations: 'disabled'
      });
    } else {
      await page.screenshot({
        path: fullPath,
        type: 'webp',
        quality: 78,
        fullPage: true,
        clip: {
          x: 0,
          y: 0,
          width: Math.min(raw.layout.documentWidth, dimensions.width),
          height: WEBP_MAX_DIMENSION
        },
        animations: 'disabled'
      });
      warnings.push(`The full-page screenshot was capped at ${WEBP_MAX_DIMENSION}px (WebP maximum).`);
    }

    const bandScreenshots = await captureBands({
      page,
      slug,
      stem,
      screenshotsDirectory,
      documentHeight: raw.layout.documentHeight,
      width: Math.min(raw.layout.documentWidth, dimensions.width)
    });

    return {
      ...raw,
      viewport,
      screenshot: `/scans/${slug}/screenshots/${fullName}`,
      viewportScreenshot: `/scans/${slug}/screenshots/${viewportName}`,
      bandScreenshots,
      scannedAt: new Date().toISOString(),
      interactions,
      load: {
        durationMs: Date.now() - startedAt,
        finalUrl,
        status: responseStatus,
        warnings
      }
    };
  } catch (error) {
    log.warn(`Scan failed for ${url} (${viewport})`, error);
    throw error;
  } finally {
    await context.close().catch(() => undefined);
  }
}
