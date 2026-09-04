import type { ScanMeta, ScanResult } from './types';

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.error === 'string' ? body.error : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return body as T;
}

export async function createScan(input: {
  url: string;
  multiPage: boolean;
  maxPages: number;
  includeMobile: boolean;
}): Promise<{ scan: ScanMeta; statusUrl: string; resultUrl: string }> {
  const response = await fetch('/api/scans', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input)
  });
  return parseResponse(response);
}

export async function getScan(slug: string): Promise<ScanResult> {
  const response = await fetch(`/api/scans/${encodeURIComponent(slug)}`, { cache: 'no-store' });
  return parseResponse(response);
}

export async function listScans(): Promise<ScanMeta[]> {
  const response = await fetch('/api/scans?limit=24', { cache: 'no-store' });
  const body = await parseResponse<{ scans: ScanMeta[] }>(response);
  return body.scans;
}

export async function deleteScan(slug: string): Promise<void> {
  const response = await fetch(`/api/scans/${encodeURIComponent(slug)}`, { method: 'DELETE' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'Could not delete scan.');
  }
}
