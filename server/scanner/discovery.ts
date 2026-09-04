import { gunzipSync } from 'node:zlib';
import { XMLParser } from 'fast-xml-parser';
import { config } from '../config.js';
import { canonicalizeUrl, safeFetch, sameSite } from '../lib/url-safety.js';
import { log } from '../lib/log.js';
import { unique } from '../lib/text.js';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
  parseTagValue: true
});

const blockedExtensions = /\.(?:jpg|jpeg|png|gif|webp|avif|svg|ico|pdf|zip|rar|7z|gz|mp4|webm|mov|mp3|wav|woff2?|ttf|otf|eot|css|js|json|xml)(?:$|\?)/i;
const blockedPathParts = [
  '/wp-admin',
  '/wp-login',
  '/cdn-cgi',
  '/api/',
  '/feed',
  '/rss',
  '/cart',
  '/checkout',
  '/account',
  '/login',
  '/logout',
  '/signin',
  '/signup'
];

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function isPageCandidate(url: URL, root: URL): boolean {
  if (!sameSite(url, root)) return false;
  if (blockedExtensions.test(url.pathname)) return false;
  const pathname = url.pathname.toLowerCase();
  if (blockedPathParts.some((part) => pathname.includes(part))) return false;
  if (url.username || url.password) return false;
  return true;
}

async function fetchBuffer(url: string): Promise<Buffer | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await safeFetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 15 * 1024 * 1024) return null;
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) return gunzipSync(bytes);
    return bytes;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function discoverRobotsSitemaps(root: URL): Promise<string[]> {
  try {
    const response = await safeFetch(new URL('/robots.txt', root));
    if (!response.ok) return [];
    const text = await response.text();
    return unique(
      text
        .split(/\r?\n/)
        .map((line) => line.match(/^\s*sitemap\s*:\s*(.+)\s*$/i)?.[1]?.trim())
        .filter((value): value is string => Boolean(value))
        .map((value) => {
          try {
            return new URL(value, root).href;
          } catch {
            return '';
          }
        })
        .filter(Boolean)
    );
  } catch {
    return [];
  }
}

interface SitemapResult {
  pages: string[];
  nested: string[];
}

function parseSitemapXml(xml: string, sitemapUrl: string, root: URL): SitemapResult {
  try {
    const parsed = xmlParser.parse(xml) as Record<string, unknown>;
    const urlset = parsed.urlset as { url?: Array<{ loc?: string }> | { loc?: string } } | undefined;
    const index = parsed.sitemapindex as
      | { sitemap?: Array<{ loc?: string }> | { loc?: string } }
      | undefined;

    const pages = asArray(urlset?.url)
      .map((entry) => entry?.loc)
      .filter((value): value is string => typeof value === 'string')
      .map((value) => canonicalizeUrl(value, new URL(sitemapUrl)))
      .filter((value): value is string => Boolean(value))
      .filter((value) => {
        try {
          return isPageCandidate(new URL(value), root);
        } catch {
          return false;
        }
      });

    const nested = asArray(index?.sitemap)
      .map((entry) => entry?.loc)
      .filter((value): value is string => typeof value === 'string')
      .map((value) => canonicalizeUrl(value, new URL(sitemapUrl)))
      .filter((value): value is string => Boolean(value));

    return { pages, nested };
  } catch {
    return { pages: [], nested: [] };
  }
}

export async function discoverSitemapUrls(root: URL): Promise<string[]> {
  const fromRobots = await discoverRobotsSitemaps(root);
  const queue = unique([
    ...fromRobots,
    new URL('/sitemap.xml', root).href,
    new URL('/sitemap_index.xml', root).href,
    new URL('/sitemap-index.xml', root).href
  ]);
  const visited = new Set<string>();
  const pages = new Set<string>();

  while (
    queue.length > 0 &&
    visited.size < 30 &&
    pages.size < config.maxCandidateUrls
  ) {
    const sitemapUrl = queue.shift();
    if (!sitemapUrl || visited.has(sitemapUrl)) continue;
    visited.add(sitemapUrl);
    const buffer = await fetchBuffer(sitemapUrl);
    if (!buffer) continue;
    const result = parseSitemapXml(buffer.toString('utf8'), sitemapUrl, root);
    for (const page of result.pages) {
      pages.add(page);
      if (pages.size >= config.maxCandidateUrls) break;
    }
    for (const nested of result.nested) {
      if (!visited.has(nested) && queue.length < 50) queue.push(nested);
    }
  }

  return [...pages];
}

function normalizedTemplateKey(url: URL): string {
  const segments = url.pathname.split('/').filter(Boolean);
  if (!segments.length) return '/';
  const normalized = segments.map((segment, index) => {
    const decoded = decodeURIComponent(segment).toLowerCase();
    if (/^\d{2,}$/.test(decoded)) return ':id';
    if (/^[a-f0-9]{8,}$/i.test(decoded)) return ':id';
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(decoded)) return ':date';
    if (/^\d{4}$/.test(decoded)) return ':year';
    if (/^\d{1,2}$/.test(decoded) && index > 0) return ':number';
    if (decoded.length > 24 && decoded.includes('-')) return ':slug';
    return decoded;
  });

  if (normalized.length >= 2) {
    const last = normalized.at(-1)!;
    const genericParents = new Set([
      'blog',
      'news',
      'article',
      'articles',
      'stories',
      'work',
      'projects',
      'case-studies',
      'products',
      'services',
      'team',
      'authors',
      'category',
      'tag'
    ]);
    if (!last.startsWith(':') && (genericParents.has(normalized.at(-2)!) || normalized.length >= 3)) {
      normalized[normalized.length - 1] = ':slug';
    }
  }

  return `/${normalized.join('/')}`;
}

const priorityTerms = [
  ['/', 100],
  ['about', 40],
  ['services', 39],
  ['service', 38],
  ['products', 37],
  ['product', 36],
  ['work', 35],
  ['case-studies', 34],
  ['case-study', 33],
  ['portfolio', 32],
  ['pricing', 31],
  ['blog', 30],
  ['news', 29],
  ['contact', 28],
  ['team', 27],
  ['careers', 26],
  ['faq', 25]
] as const;

function pagePriority(url: URL, root: URL): number {
  if (url.pathname === '/' || url.href === root.href) return 1000;
  const path = url.pathname.toLowerCase();
  let score = Math.max(0, 30 - path.split('/').filter(Boolean).length * 4);
  for (const [term, points] of priorityTerms) {
    if (term !== '/' && path.includes(term)) score += points;
  }
  if (url.search) score -= 10;
  return score;
}

export function selectRepresentativePages(
  root: URL,
  candidateUrls: string[],
  maxPages: number
): string[] {
  const valid = unique(
    [root.href, ...candidateUrls]
      .map((value) => canonicalizeUrl(value, root))
      .filter((value): value is string => Boolean(value))
  ).filter((value) => {
    try {
      return isPageCandidate(new URL(value), root);
    } catch {
      return false;
    }
  });

  const sorted = valid.sort(
    (a, b) => pagePriority(new URL(b), root) - pagePriority(new URL(a), root)
  );
  const selected: string[] = [];
  const usedTemplates = new Set<string>();

  for (const value of sorted) {
    if (selected.length >= maxPages) break;
    const parsed = new URL(value);
    const key = normalizedTemplateKey(parsed);
    if (usedTemplates.has(key)) continue;
    selected.push(value);
    usedTemplates.add(key);
  }

  if (selected.length < maxPages) {
    for (const value of sorted) {
      if (selected.length >= maxPages) break;
      if (!selected.includes(value)) selected.push(value);
    }
  }

  return selected;
}

export async function discoverCandidateUrls(
  root: URL,
  renderedLinks: string[]
): Promise<string[]> {
  const sitemapUrls = await discoverSitemapUrls(root).catch((error) => {
    log.warn('Sitemap discovery failed', error);
    return [];
  });

  return unique([...renderedLinks, ...sitemapUrls])
    .map((value) => canonicalizeUrl(value, root))
    .filter((value): value is string => Boolean(value))
    .filter((value) => {
      try {
        return isPageCandidate(new URL(value), root);
      } catch {
        return false;
      }
    })
    .slice(0, config.maxCandidateUrls);
}
