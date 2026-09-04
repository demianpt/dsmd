import { config } from '../config.js';
import { log } from '../lib/log.js';
import { assertSafeUrl, canonicalizeUrl } from '../lib/url-safety.js';
import { patchScanMeta, saveAnalysis, saveEvidence, saveTextFile } from '../storage/scans.js';
import type { PageEvidence, ScanMeta, ViewportName } from '../types/domain.js';
import { analyzeDesignWithOllama } from '../ai/ollama.js';
import { generateDesignMd, generateTokensCss } from '../output/generate.js';
import { aggregateEvidence } from './aggregate.js';
import { launchScannerBrowser, scanRenderedPage } from './browser.js';
import {
  discoverCandidateUrls,
  selectRepresentativePages
} from './discovery.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function urlEquals(a: string, b: string): boolean {
  try {
    const left = canonicalizeUrl(a);
    const right = canonicalizeUrl(b);
    return Boolean(left && right && left === right);
  } catch {
    return a === b;
  }
}

export async function runScan(meta: ScanMeta): Promise<void> {
  const browser = await launchScannerBrowser();
  const pages: PageEvidence[] = [];
  const failures: Array<{ url: string; viewport: ViewportName; error: string }> = [];

  try {
    const requested = await assertSafeUrl(meta.sourceUrl);
    await patchScanMeta(meta.slug, {
      status: 'discovering',
      progress: 4,
      message: 'Opening the source website and collecting its first design evidence…',
      currentPage: requested.href
    });

    const rootPage = await scanRenderedPage({
      browser,
      slug: meta.slug,
      url: requested.href,
      viewport: 'desktop',
      index: 0,
      collectInteractions: true
    });
    pages.push(rootPage);
    const rootUrl = await assertSafeUrl(rootPage.load.finalUrl || requested.href);

    await patchScanMeta(meta.slug, {
      canonicalUrl: rootPage.page.canonicalUrl || rootPage.page.url,
      title: rootPage.page.title || rootUrl.hostname,
      description: rootPage.page.description,
      faviconUrl: rootPage.page.faviconUrl,
      pagesCompleted: 1,
      progress: 12,
      message: meta.options.multiPage
        ? 'Discovering sitemaps, internal links and representative page templates…'
        : 'Single-page mode selected. Preparing responsive measurements…'
    });

    const candidates = meta.options.multiPage
      ? await discoverCandidateUrls(rootUrl, rootPage.links)
      : [rootPage.page.url];
    const selectedUrls = meta.options.multiPage
      ? selectRepresentativePages(rootUrl, candidates, meta.options.maxPages)
      : [rootPage.page.url];

    if (!selectedUrls.some((url) => urlEquals(url, rootPage.page.url))) {
      selectedUrls.unshift(rootPage.page.url);
    }
    const finalSelected = selectedUrls.slice(0, meta.options.maxPages);
    const mobileUrls = meta.options.includeMobile
      ? finalSelected.slice(0, Math.min(config.maxMobilePages, finalSelected.length))
      : [];
    const totalViews = finalSelected.length + mobileUrls.length;

    await patchScanMeta(meta.slug, {
      pagesDiscovered: candidates.length,
      pagesSelected: finalSelected.length,
      status: 'scanning',
      progress: 18,
      message: `Scanning ${finalSelected.length} representative page${finalSelected.length === 1 ? '' : 's'} across desktop${mobileUrls.length ? ' and mobile' : ''}…`
    });

    let completedViews = 1;
    const updateProgress = async (message: string, currentPage: string): Promise<void> => {
      const fraction = Math.min(1, completedViews / Math.max(1, totalViews));
      await patchScanMeta(meta.slug, {
        pagesCompleted: completedViews,
        progress: Math.round(18 + fraction * 55),
        message,
        currentPage
      });
    };

    for (let index = 0; index < finalSelected.length; index += 1) {
      const url = finalSelected[index];
      if (urlEquals(url, rootPage.page.url) || urlEquals(url, rootPage.load.finalUrl)) continue;
      await updateProgress(`Measuring desktop styles on page ${index + 1} of ${finalSelected.length}…`, url);
      try {
        const page = await scanRenderedPage({
          browser,
          slug: meta.slug,
          url,
          viewport: 'desktop',
          index,
          collectInteractions: index < 4
        });
        pages.push(page);
      } catch (error) {
        failures.push({ url, viewport: 'desktop', error: errorMessage(error) });
      }
      completedViews += 1;
      await updateProgress(`Desktop page ${index + 1} processed.`, url);
    }

    for (let index = 0; index < mobileUrls.length; index += 1) {
      const url = mobileUrls[index];
      await updateProgress(`Measuring mobile behavior on page ${index + 1} of ${mobileUrls.length}…`, url);
      try {
        const page = await scanRenderedPage({
          browser,
          slug: meta.slug,
          url,
          viewport: 'mobile',
          index,
          collectInteractions: index === 0
        });
        pages.push(page);
      } catch (error) {
        failures.push({ url, viewport: 'mobile', error: errorMessage(error) });
      }
      completedViews += 1;
      await updateProgress(`Mobile page ${index + 1} processed.`, url);
    }

    await patchScanMeta(meta.slug, {
      status: 'analyzing',
      progress: 76,
      message: 'Normalizing colors, typography, spacing, components and responsive rules…',
      currentPage: undefined
    });

    const evidence = aggregateEvidence({
      requestedUrl: meta.sourceUrl,
      rootUrl,
      candidateCount: candidates.length,
      selectedUrls: finalSelected,
      pages,
      failures,
      multiPage: meta.options.multiPage
    });
    await saveEvidence(meta.slug, evidence);

    await patchScanMeta(meta.slug, {
      status: 'generating',
      progress: 84,
      message: config.aiEnabled
        ? `Asking ${config.ollamaModel} to interpret the measured design language…`
        : 'Building the deterministic design-system narrative…'
    });

    const ai = await analyzeDesignWithOllama(meta.slug, evidence);
    const designMd = generateDesignMd(evidence, ai.analysis);
    const tokensCss = generateTokensCss(evidence);
    await Promise.all([
      saveAnalysis(meta.slug, ai.analysis),
      saveTextFile(meta.slug, 'DESIGN.md', designMd),
      saveTextFile(meta.slug, 'tokens.css', tokensCss)
    ]);

    await patchScanMeta(meta.slug, {
      status: 'complete',
      progress: 100,
      message: 'DESIGN.md is ready.',
      pagesCompleted: pages.length,
      completedAt: new Date().toISOString(),
      ai: {
        enabled: config.aiEnabled,
        requestedModel: config.ollamaModel,
        used: ai.used,
        model: ai.model,
        fallbackReason: ai.fallbackReason
      }
    });
    log.info(`Completed scan ${meta.slug}`, {
      pages: pages.length,
      candidates: candidates.length,
      ai: ai.used ? ai.model : 'fallback'
    });
  } catch (error) {
    const message = errorMessage(error);
    log.error(`Scan ${meta.slug} failed`, error);
    await patchScanMeta(meta.slug, {
      status: 'failed',
      progress: 100,
      message: 'The scan failed.',
      error: message,
      completedAt: new Date().toISOString()
    }).catch(() => undefined);
  } finally {
    await browser.close().catch(() => undefined);
  }
}
