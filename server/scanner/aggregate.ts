import type {
  AggregatedEvidence,
  BreakpointEvidence,
  ColorEvidence,
  ComponentEvidence,
  CountedValue,
  CssVariableEvidence,
  FontFaceEvidence,
  PageEvidence,
  TypographyEvidence,
  ViewportName
} from '../types/domain.js';
import { cleanText, unique } from '../lib/text.js';

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function channelToHex(value: number): string {
  return clampChannel(value).toString(16).padStart(2, '0').toUpperCase();
}

function normalizeHex(value: string): string | null {
  const raw = value.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{3,8}$/i.test(raw)) return null;
  if (raw.length === 3 || raw.length === 4) {
    return `#${raw
      .split('')
      .map((char) => char.repeat(2))
      .join('')}`.toUpperCase();
  }
  if (raw.length === 6 || raw.length === 8) return `#${raw.toUpperCase()}`;
  return null;
}

export function normalizeColor(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith('#')) return normalizeHex(trimmed) || trimmed.toUpperCase();

  const match = trimmed.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i);
  if (match) {
    const r = Number(match[1]);
    const g = Number(match[2]);
    const b = Number(match[3]);
    let alpha = 1;
    if (match[4]) alpha = match[4].endsWith('%') ? Number(match[4].slice(0, -1)) / 100 : Number(match[4]);
    const base = `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`;
    if (Number.isFinite(alpha) && alpha < 0.999) return `${base}${channelToHex(alpha * 255)}`;
    return base;
  }

  return trimmed;
}

function aggregateCounted(
  pages: PageEvidence[],
  getter: (page: PageEvidence) => CountedValue[],
  limit = 100
): CountedValue[] {
  const map = new Map<string, CountedValue>();
  for (const page of pages) {
    for (const item of getter(page)) {
      const key = item.value.trim().toLowerCase();
      if (!key) continue;
      const current = map.get(key) || { value: item.value, count: 0, contexts: [] };
      current.count += item.count;
      current.contexts = unique([...(current.contexts || []), ...(item.contexts || [])]).slice(0, 12);
      map.set(key, current);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

function aggregateColors(pages: PageEvidence[]): ColorEvidence[] {
  const map = new Map<string, ColorEvidence>();
  for (const page of pages) {
    for (const item of page.colors) {
      const normalized = normalizeColor(item.value);
      if (!normalized || normalized.toLowerCase() === 'transparent') continue;
      const key = normalized.toLowerCase();
      const current = map.get(key) || {
        value: item.value,
        normalized,
        count: 0,
        contexts: [],
        channels: [],
        areaScore: 0
      };
      current.count += item.count;
      current.areaScore += item.areaScore;
      current.contexts = unique([...(current.contexts || []), ...(item.contexts || [])]).slice(0, 15);
      current.channels = unique([...current.channels, ...item.channels]);
      map.set(key, current);
    }
  }

  return [...map.values()]
    .sort((a, b) => b.count + b.areaScore * 10 - (a.count + a.areaScore * 10))
    .slice(0, 80);
}

function aggregateTypography(pages: PageEvidence[]): TypographyEvidence[] {
  const map = new Map<string, TypographyEvidence>();
  for (const page of pages) {
    for (const item of page.typography) {
      const key = [
        item.family.toLowerCase(),
        item.size,
        item.weight,
        item.lineHeight,
        item.letterSpacing,
        item.textTransform
      ].join('|');
      const current = map.get(key) || {
        ...item,
        count: 0,
        tags: [],
        samples: [],
        viewports: []
      };
      current.count += item.count;
      current.tags = unique([...current.tags, ...item.tags]).slice(0, 12);
      current.samples = unique([...current.samples, ...item.samples]).slice(0, 8);
      current.viewports = unique([...current.viewports, page.viewport]) as ViewportName[];
      map.set(key, current);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 120);
}

function aggregateVariables(pages: PageEvidence[]): CssVariableEvidence[] {
  const map = new Map<string, CssVariableEvidence>();
  for (const page of pages) {
    for (const item of page.cssVariables) {
      const key = `${item.name}|${item.value}`;
      const current = map.get(key) || { ...item, count: 0, sources: [] };
      current.count += item.count;
      current.sources = unique([...current.sources, ...item.sources]).slice(0, 10);
      map.set(key, current);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 500);
}

function aggregateBreakpoints(pages: PageEvidence[]): BreakpointEvidence[] {
  const map = new Map<string, BreakpointEvidence>();
  for (const page of pages) {
    for (const item of page.cssMediaQueries) {
      const current = map.get(item.query) || { ...item, count: 0, values: [], sources: [] };
      current.count += item.count;
      current.values = unique([...current.values, ...item.values]);
      current.sources = unique([...current.sources, ...item.sources]).slice(0, 10);
      map.set(item.query, current);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 120);
}

function aggregateFontFaces(pages: PageEvidence[]): FontFaceEvidence[] {
  const map = new Map<string, FontFaceEvidence>();
  for (const page of pages) {
    for (const item of page.fontFaces) {
      const family = cleanText(item.family.replace(/^['"]|['"]$/g, ''), 160);
      if (!family) continue;
      const key = `${family.toLowerCase()}|${item.weight || ''}|${item.style || ''}`;
      if (!map.has(key)) map.set(key, { ...item, family });
    }
  }
  return [...map.values()].slice(0, 120);
}

function aggregateComponents(pages: PageEvidence[]): ComponentEvidence[] {
  const map = new Map<string, ComponentEvidence>();
  for (const page of pages) {
    for (const item of page.components) {
      const key = item.name.toLowerCase();
      const current = map.get(key) || {
        name: item.name,
        count: 0,
        pages: [],
        signals: [],
        samples: []
      };
      current.count += item.count;
      current.pages = unique([...current.pages, page.page.url]).slice(0, 20);
      current.signals = unique([...current.signals, ...item.signals]).slice(0, 12);
      for (const sample of item.samples) {
        const signature = `${sample.page}|${sample.selector}|${sample.heading}|${sample.classHint}`;
        if (
          current.samples.length < 10 &&
          !current.samples.some(
            (existing) =>
              `${existing.page}|${existing.selector}|${existing.heading}|${existing.classHint}` === signature
          )
        ) {
          current.samples.push(sample);
        }
      }
      map.set(key, current);
    }
  }
  return [...map.values()].sort(
    (a, b) => b.pages.length * 25 + b.count - (a.pages.length * 25 + a.count)
  );
}

export interface AggregateInput {
  requestedUrl: string;
  rootUrl: URL;
  candidateCount: number;
  selectedUrls: string[];
  pages: PageEvidence[];
  failures: Array<{ url: string; viewport: ViewportName; error: string }>;
  multiPage: boolean;
}

export function aggregateEvidence(input: AggregateInput): AggregatedEvidence {
  const primaryPage =
    input.pages.find((page) => page.viewport === 'desktop' && new URL(page.page.url).pathname === '/') ||
    input.pages.find((page) => page.viewport === 'desktop') ||
    input.pages[0];
  if (!primaryPage) throw new Error('No website pages were successfully scanned.');

  const viewports = unique(input.pages.map((page) => page.viewport)) as ViewportName[];
  const screenshots = input.pages.map((page) => ({
    url: page.page.url,
    viewport: page.viewport,
    path: page.screenshot
  }));

  return {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    source: {
      requestedUrl: input.requestedUrl,
      canonicalUrl: primaryPage.page.canonicalUrl || primaryPage.page.url,
      domain: input.rootUrl.hostname,
      title: primaryPage.page.title || input.rootUrl.hostname,
      description: primaryPage.page.description,
      faviconUrl: primaryPage.page.faviconUrl
    },
    coverage: {
      multiPage: input.multiPage,
      candidateUrls: input.candidateCount,
      selectedUrls: input.selectedUrls,
      scannedPageViews: input.pages.length,
      viewports,
      failures: input.failures
    },
    screenshots: {
      primary: primaryPage.screenshot,
      all: screenshots
    },
    colors: aggregateColors(input.pages),
    typography: aggregateTypography(input.pages),
    cssVariables: aggregateVariables(input.pages),
    spacing: aggregateCounted(input.pages, (page) => page.spacing, 120),
    radii: aggregateCounted(input.pages, (page) => page.radii, 80),
    borders: aggregateCounted(input.pages, (page) => page.borders, 80),
    shadows: aggregateCounted(input.pages, (page) => page.shadows, 80),
    transitions: aggregateCounted(input.pages, (page) => page.transitions, 80),
    maxWidths: aggregateCounted(input.pages, (page) => page.maxWidths, 80),
    gridColumns: aggregateCounted(input.pages, (page) => page.gridColumns, 80),
    breakpoints: aggregateBreakpoints(input.pages),
    fontFaces: aggregateFontFaces(input.pages),
    components: aggregateComponents(input.pages),
    sections: input.pages.flatMap((page) =>
      page.sections.map((section) => ({ ...section, page: page.page.url, viewport: page.viewport }))
    ),
    images: input.pages.flatMap((page) =>
      page.images.map((image) => ({ ...image, page: page.page.url, viewport: page.viewport }))
    ),
    interactions: input.pages.flatMap((page) =>
      page.interactions.map((interaction) => ({
        ...interaction,
        page: page.page.url,
        viewport: page.viewport
      }))
    ),
    layouts: input.pages.map((page) => ({
      page: page.page.url,
      viewport: page.viewport,
      layout: page.layout
    })),
    pages: input.pages
  };
}
