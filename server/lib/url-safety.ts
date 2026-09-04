import dns from 'node:dns/promises';
import net from 'node:net';
import type { BrowserContext, Route } from 'playwright';
import { config } from '../config.js';

const forbiddenHostnames = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'metadata.google.internal',
  'metadata',
  'host.docker.internal',
  'gateway.docker.internal'
]);

function parseIpv4(ip: string): number[] | null {
  if (net.isIP(ip) !== 4) return null;
  const parts = ip.split('.').map(Number);
  return parts.length === 4 && parts.every((part) => part >= 0 && part <= 255) ? parts : null;
}

function isPrivateIpv4(ip: string): boolean {
  const p = parseIpv4(ip);
  if (!p) return false;
  const [a, b] = p;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6(ip: string): boolean {
  if (net.isIP(ip) !== 6) return false;
  const value = ip.toLowerCase();
  if (value === '::' || value === '::1') return true;
  if (value.startsWith('fc') || value.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(value)) return true;
  if (value.startsWith('ff')) return true;
  const mapped = value.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mapped ? isPrivateIpv4(mapped) : false;
}

export function isPrivateIp(ip: string): boolean {
  return isPrivateIpv4(ip) || isPrivateIpv6(ip);
}

export function normalizeInputUrl(input: string): URL {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Enter a website URL.');
  let candidate = trimmed;
  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('The website URL is not valid.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only HTTP and HTTPS websites can be scanned.');
  }
  parsed.hash = '';
  return parsed;
}

export async function assertSafeUrl(value: string | URL): Promise<URL> {
  const parsed = value instanceof URL ? new URL(value.href) : normalizeInputUrl(value);
  if (config.allowPrivateNetworks) return parsed;

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname || forbiddenHostnames.has(hostname) || hostname.endsWith('.localhost')) {
    throw new Error('Local and private network addresses are blocked.');
  }

  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error('Private IP addresses are blocked.');
    return parsed;
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new Error(`Could not resolve ${hostname}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!addresses.length) throw new Error(`Could not resolve ${hostname}.`);
  if (addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error('The hostname resolves to a private network address and cannot be scanned.');
  }
  return parsed;
}

export async function safeFetch(
  input: string | URL,
  init: RequestInit = {},
  maxRedirects = 5
): Promise<Response> {
  let current = await assertSafeUrl(input);
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const response = await fetch(current, {
      ...init,
      redirect: 'manual',
      headers: {
        'user-agent': 'MyOwnDesignMD/1.0 (+local design-system scanner)',
        accept: '*/*',
        ...init.headers
      }
    });

    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    if (redirectCount === maxRedirects) throw new Error('Too many redirects.');
    current = await assertSafeUrl(new URL(location, current));
  }
  throw new Error('Too many redirects.');
}

export async function installSafeRequestGuard(context: BrowserContext): Promise<void> {
  if (config.allowPrivateNetworks) return;
  const cache = new Map<string, boolean>();
  const check = async (route: Route): Promise<void> => {
    const requestUrl = route.request().url();
    let parsed: URL;
    try {
      parsed = new URL(requestUrl);
    } catch {
      await route.abort('blockedbyclient');
      return;
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      if (['data:', 'blob:', 'about:'].includes(parsed.protocol)) await route.continue();
      else await route.abort('blockedbyclient');
      return;
    }

    const key = parsed.hostname.toLowerCase();
    let safe = cache.get(key);
    if (safe === undefined) {
      try {
        await assertSafeUrl(parsed);
        safe = true;
      } catch {
        safe = false;
      }
      cache.set(key, safe);
    }
    if (safe) await route.continue();
    else await route.abort('blockedbyclient');
  };
  await context.route('**/*', check);
}

export function sameSite(candidate: URL, root: URL): boolean {
  const a = candidate.hostname.toLowerCase().replace(/^www\./, '');
  const b = root.hostname.toLowerCase().replace(/^www\./, '');
  return a === b;
}

export function canonicalizeUrl(value: string | URL, root?: URL): string | null {
  let parsed: URL;
  try {
    parsed = value instanceof URL ? new URL(value.href) : new URL(value, root);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  parsed.hash = '';
  const tracking = [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    'gclid',
    'fbclid'
  ];
  for (const name of tracking) parsed.searchParams.delete(name);
  if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.href;
}
