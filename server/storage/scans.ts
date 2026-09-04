import fs from 'node:fs/promises';
import path from 'node:path';
import { scansDir } from '../config.js';
import type { AggregatedEvidence, AiAnalysis, ScanMeta, ScanResult } from '../types/domain.js';
import { ensureDir, pathExists, readJson, writeJson } from '../lib/fs.js';

export function scanDir(slug: string): string {
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/i.test(slug)) {
    throw new Error('Invalid scan identifier.');
  }
  return path.join(scansDir, slug);
}

export function scanFile(slug: string, fileName: string): string {
  return path.join(scanDir(slug), fileName);
}

export async function initializeStorage(): Promise<void> {
  await ensureDir(scansDir);
}

export async function createScan(meta: ScanMeta): Promise<void> {
  await ensureDir(path.join(scanDir(meta.slug), 'screenshots'));
  await writeJson(scanFile(meta.slug, 'meta.json'), meta);
}

export async function getScanMeta(slug: string): Promise<ScanMeta | null> {
  const filePath = scanFile(slug, 'meta.json');
  if (!(await pathExists(filePath))) return null;
  return readJson<ScanMeta>(filePath);
}

export async function saveScanMeta(meta: ScanMeta): Promise<void> {
  meta.updatedAt = new Date().toISOString();
  await writeJson(scanFile(meta.slug, 'meta.json'), meta);
}

export async function patchScanMeta(
  slug: string,
  patch: Partial<ScanMeta>
): Promise<ScanMeta> {
  const current = await getScanMeta(slug);
  if (!current) throw new Error(`Unknown scan: ${slug}`);
  const next: ScanMeta = {
    ...current,
    ...patch,
    ai: patch.ai ? { ...current.ai, ...patch.ai } : current.ai,
    updatedAt: new Date().toISOString()
  };
  await saveScanMeta(next);
  return next;
}

export async function saveEvidence(slug: string, evidence: AggregatedEvidence): Promise<void> {
  await writeJson(scanFile(slug, 'evidence.json'), evidence);
}

export async function saveAnalysis(slug: string, analysis: AiAnalysis): Promise<void> {
  await writeJson(scanFile(slug, 'analysis.json'), analysis);
}

export async function saveTextFile(slug: string, fileName: string, content: string): Promise<void> {
  const filePath = scanFile(slug, fileName);
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content, 'utf8');
}

export async function getScanResult(slug: string): Promise<ScanResult | null> {
  const meta = await getScanMeta(slug);
  if (!meta) return null;
  if (meta.status !== 'complete') {
    return {
      meta,
      evidence: null as unknown as AggregatedEvidence,
      analysis: null as unknown as AiAnalysis,
      designMd: '',
      tokensCss: '',
      files: {
        designMd: `/api/scans/${slug}/files/DESIGN.md`,
        evidence: `/api/scans/${slug}/files/evidence.json`,
        tokensCss: `/api/scans/${slug}/files/tokens.css`,
        bundle: `/api/scans/${slug}/bundle`
      }
    };
  }

  const [evidence, analysis, designMd, tokensCss] = await Promise.all([
    readJson<AggregatedEvidence>(scanFile(slug, 'evidence.json')),
    readJson<AiAnalysis>(scanFile(slug, 'analysis.json')),
    fs.readFile(scanFile(slug, 'DESIGN.md'), 'utf8'),
    fs.readFile(scanFile(slug, 'tokens.css'), 'utf8')
  ]);

  return {
    meta,
    evidence,
    analysis,
    designMd,
    tokensCss,
    files: {
      designMd: `/api/scans/${slug}/files/DESIGN.md`,
      evidence: `/api/scans/${slug}/files/evidence.json`,
      tokensCss: `/api/scans/${slug}/files/tokens.css`,
      bundle: `/api/scans/${slug}/bundle`
    }
  };
}

export async function listScans(limit = 40): Promise<ScanMeta[]> {
  await ensureDir(scansDir);
  const entries = await fs.readdir(scansDir, { withFileTypes: true });
  const metas: ScanMeta[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const meta = await getScanMeta(entry.name).catch(() => null);
    if (meta) metas.push(meta);
  }
  return metas
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export async function deleteScan(slug: string): Promise<boolean> {
  const dir = scanDir(slug);
  if (!(await pathExists(dir))) return false;
  await fs.rm(dir, { recursive: true, force: true });
  return true;
}
