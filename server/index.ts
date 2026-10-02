import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import archiver from 'archiver';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { config, scansDir } from './config.js';
import { log } from './lib/log.js';
import { clamp, createScanSlug } from './lib/text.js';
import { assertSafeUrl, normalizeInputUrl } from './lib/url-safety.js';
import { scanQueue } from './scanner/queue.js';
import { analyzeDesignWithOllama } from './ai/ollama.js';
import { generateDesignMd } from './output/generate.js';
import {
  createScan,
  deleteScan,
  getScanMeta,
  getScanResult,
  initializeStorage,
  listScans,
  patchScanMeta,
  saveAnalysis,
  saveTextFile,
  scanDir,
  scanFile
} from './storage/scans.js';
import type { ScanMeta } from './types/domain.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

const createSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  multiPage: z.boolean().optional().default(true),
  maxPages: z.number().int().min(1).max(100).optional(),
  includeMobile: z.boolean().optional().default(true)
});

function asyncRoute(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<void>
) {
  return (request: Request, response: Response, next: NextFunction): void => {
    handler(request, response, next).catch(next);
  };
}

app.get('/api/health', (_request: Request, response: Response) => {
  response.json({
    ok: true,
    app: 'DSMD',
    version: '1.0.0',
    aiEnabled: config.aiEnabled,
    model: config.ollamaModel,
    queueSize: scanQueue.size()
  });
});

app.get(
  '/api/scans',
  asyncRoute(async (request, response) => {
    const limit = clamp(Number(request.query.limit) || 40, 1, 100);
    response.json({ scans: await listScans(limit) });
  })
);

app.post(
  '/api/scans',
  asyncRoute(async (request, response) => {
    const input = createSchema.parse(request.body);
    const normalized = normalizeInputUrl(input.url);
    const safe = await assertSafeUrl(normalized);
    const maxPages = clamp(
      input.maxPages || config.defaultMaxPages,
      1,
      config.maxAllowedPages
    );
    const slug = createScanSlug(safe.hostname);
    const now = new Date().toISOString();
    const meta: ScanMeta = {
      slug,
      sourceUrl: safe.href,
      domain: safe.hostname,
      status: 'queued',
      progress: 0,
      message: scanQueue.size() ? 'Queued behind another local scan…' : 'Preparing the scanner…',
      pagesDiscovered: 0,
      pagesSelected: 0,
      pagesCompleted: 0,
      options: {
        multiPage: input.multiPage,
        maxPages: input.multiPage ? maxPages : 1,
        includeMobile: input.includeMobile
      },
      createdAt: now,
      updatedAt: now,
      ai: {
        enabled: config.aiEnabled,
        requestedModel: config.ollamaModel,
        used: false
      }
    };
    await createScan(meta);
    scanQueue.enqueue(meta);
    response.status(202).json({
      scan: meta,
      statusUrl: `/api/scans/${slug}`,
      resultUrl: `/s/${slug}`
    });
  })
);

app.get(
  '/api/scans/:slug',
  asyncRoute(async (request, response) => {
    const result = await getScanResult(String(request.params.slug));
    if (!result) {
      response.status(404).json({ error: 'Scan not found.' });
      return;
    }
    response.json(result);
  })
);

app.post(
  '/api/scans/:slug/reanalyze',
  asyncRoute(async (request, response) => {
    const slug = String(request.params.slug);
    const result = await getScanResult(slug);
    if (!result) {
      response.status(404).json({ error: 'Scan not found.' });
      return;
    }
    if (result.meta.status !== 'complete' || !result.evidence) {
      response.status(409).json({ error: 'Only completed scans can be reanalyzed.' });
      return;
    }
    if (!config.aiEnabled) {
      response.status(409).json({ error: 'AI interpretation is disabled in the local configuration.' });
      return;
    }

    const ai = await analyzeDesignWithOllama(slug, result.evidence);
    if (!ai.used) {
      response.status(422).json({
        error: ai.fallbackReason || 'AI interpretation could not be validated. The existing result was preserved.'
      });
      return;
    }

    const designMd = generateDesignMd(result.evidence, ai.analysis);
    await Promise.all([
      saveAnalysis(slug, ai.analysis),
      saveTextFile(slug, 'DESIGN.md', designMd),
      patchScanMeta(slug, {
        ai: {
          enabled: true,
          requestedModel: config.ollamaModel,
          used: true,
          model: ai.model,
          fallbackReason: undefined
        }
      })
    ]);

    response.json(await getScanResult(slug));
  })
);

app.delete(
  '/api/scans/:slug',
  asyncRoute(async (request, response) => {
    const meta = await getScanMeta(String(request.params.slug));
    if (!meta) {
      response.status(404).json({ error: 'Scan not found.' });
      return;
    }
    if (!['complete', 'failed'].includes(meta.status)) {
      response.status(409).json({ error: 'A running scan cannot be deleted.' });
      return;
    }
    await deleteScan(String(request.params.slug));
    response.status(204).end();
  })
);

const downloadableFiles = new Set(['DESIGN.md', 'evidence.json', 'analysis.json', 'tokens.css', 'meta.json']);
app.get(
  '/api/scans/:slug/files/:file',
  asyncRoute(async (request, response) => {
    const slug = String(request.params.slug);
    const file = String(request.params.file);
    if (!downloadableFiles.has(file)) {
      response.status(404).json({ error: 'File not found.' });
      return;
    }
    const meta = await getScanMeta(slug);
    if (!meta) {
      response.status(404).json({ error: 'Scan not found.' });
      return;
    }
    const filePath = scanFile(slug, file);
    try {
      await fs.access(filePath);
    } catch {
      response.status(404).json({ error: 'This output is not ready yet.' });
      return;
    }
    response.download(filePath, file);
  })
);

app.get(
  '/api/scans/:slug/bundle',
  asyncRoute(async (request, response) => {
    const slug = String(request.params.slug);
    const meta = await getScanMeta(slug);
    if (!meta) {
      response.status(404).json({ error: 'Scan not found.' });
      return;
    }
    if (meta.status !== 'complete') {
      response.status(409).json({ error: 'The scan bundle is not ready yet.' });
      return;
    }
    response.attachment(`design-system-${slug}.zip`);
    response.type('application/zip');
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (error: Error) => response.destroy(error));
    archive.pipe(response);
    archive.directory(scanDir(slug), false);
    await archive.finalize();
  })
);

app.use(
  '/scans',
  express.static(scansDir, {
    dotfiles: 'deny',
    fallthrough: false,
    index: false,
    maxAge: '1h'
  })
);

const clientDist = path.join(config.projectRoot, 'dist');
try {
  await fs.access(clientDist);
  app.use(express.static(clientDist, { index: false }));
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (request.method !== 'GET' || request.path.startsWith('/api/') || request.path.startsWith('/scans/')) {
      next();
      return;
    }
    response.sendFile(path.join(clientDist, 'index.html'));
  });
} catch {
  app.get('/', (_request: Request, response: Response) => {
    response
      .status(503)
      .type('text/plain')
      .send('The frontend has not been built. Run `npm run dev` or `npm run build`.');
  });
}

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError) {
    response.status(400).json({
      error: 'Invalid request.',
      details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
    });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  const status =
    typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
      ? error.status
      : 500;
  log.error('Request failed', error);
  response.status(status).json({ error: message || 'Unexpected server error.' });
});

await initializeStorage();
const server = app.listen(config.port, config.host, () => {
  log.info(`DSMD server listening at http://${config.host}:${config.port}`);
  log.info(`Ollama model: ${config.ollamaModel} (${config.aiEnabled ? 'enabled' : 'disabled'})`);
});

const shutdown = (): void => {
  server.close(() => process.exit(0));
  const forceExit = setTimeout(() => process.exit(1), 5_000);
  (forceExit as unknown as { unref?: () => void }).unref?.();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
