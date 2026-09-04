import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

process.env.ALLOW_PRIVATE_NETWORKS = 'true';
process.env.AI_ENABLED = 'false';
process.env.HEADLESS = 'true';
process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'myowndesignmd-test-'));

const fixtureRoot = path.join(process.cwd(), 'fixtures', 'site');
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8'
};

const server = http.createServer(async (request: IncomingMessage, response: ServerResponse) => {
  try {
    const requested = new URL(request.url || '/', 'http://localhost').pathname;
    const relative = requested === '/' ? 'index.html' : requested.replace(/^\//, '');
    const resolved = path.resolve(fixtureRoot, relative);
    if (!resolved.startsWith(path.resolve(fixtureRoot))) throw new Error('Forbidden');
    const stat = await fs.stat(resolved).catch(() => null);
    const filePath = stat?.isDirectory() ? path.join(resolved, 'index.html') : resolved;
    const body = await fs.readFile(filePath);
    response.writeHead(200, { 'content-type': mime[path.extname(filePath)] || 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404).end('Not found');
  }
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Could not open fixture server.');
const url = `http://127.0.0.1:${address.port}/`;

const { launchScannerBrowser, scanRenderedPage } = await import('../server/scanner/browser.js');
const { aggregateEvidence } = await import('../server/scanner/aggregate.js');
const { generateDesignMd, generateTokensCss } = await import('../server/output/generate.js');
const { createFallbackAnalysis } = await import('../server/ai/fallback.js');

const browser = await launchScannerBrowser();
try {
  const desktop = await scanRenderedPage({
    browser,
    slug: 'fixture-test',
    url,
    viewport: 'desktop',
    index: 0,
    collectInteractions: true
  });
  const mobile = await scanRenderedPage({
    browser,
    slug: 'fixture-test',
    url,
    viewport: 'mobile',
    index: 0,
    collectInteractions: false
  });
  const evidence = aggregateEvidence({
    requestedUrl: url,
    rootUrl: new URL(url),
    candidateCount: desktop.links.length,
    selectedUrls: [url],
    pages: [desktop, mobile],
    failures: [],
    multiPage: false
  });
  const analysis = createFallbackAnalysis(evidence);
  const markdown = generateDesignMd(evidence, analysis);
  const css = generateTokensCss(evidence);

  const assertions: Array<[boolean, string]> = [
    [evidence.colors.length >= 3, 'colors extracted'],
    [evidence.typography.length >= 3, 'typography extracted'],
    [evidence.cssVariables.some((item) => item.name === '--fixture-accent'), 'CSS variables extracted'],
    [evidence.breakpoints.length >= 1, 'media queries extracted'],
    [evidence.components.some((item) => item.name === 'Header'), 'components extracted'],
    [desktop.links.some((link) => link.includes('/about.html')), 'internal links extracted'],
    [markdown.includes('# DESIGN.md'), 'DESIGN.md generated'],
    [css.includes('--color-01'), 'tokens.css generated']
  ];

  for (const [condition, label] of assertions) {
    if (!condition) throw new Error(`Smoke-test assertion failed: ${label}`);
    console.log(`✓ ${label}`);
  }
  console.log(`\nScanner smoke test passed for ${url}`);
} finally {
  await browser.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(process.env.DATA_DIR!, { recursive: true, force: true });
}
