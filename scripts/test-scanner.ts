import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

process.env.ALLOW_PRIVATE_NETWORKS = 'true';
process.env.AI_ENABLED = 'false';
process.env.HEADLESS = 'true';
process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'dsmd-test-'));

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
const { config } = await import('../server/config.js');
const { generateDesignMd, generateTokensCss } = await import('../server/output/generate.js');
const { createFallbackAnalysis } = await import('../server/ai/fallback.js');
const {
  normalizeAndRepairModelAnalysis,
  normalizeModelCategory,
  sanitizeModelProse
} = await import('../server/ai/ollama.js');

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
  const normalizedCategories = [
    'Color & Tokens',
    'Typography Fidelity',
    'Spacing Rhythm',
    'Layout Composition',
    'Responsive Integrity',
    'Imagery Treatment',
    'Motion & Interaction',
    'Component Consistency'
  ].map(normalizeModelCategory);
  const sanitizedModelProse = sanitizeModelProse(
    'Use #6932e8 with 24px spacing, a 75% width and a 180ms transition.'
  );
  const repairedModel = normalizeAndRepairModelAnalysis(
    {
      overview: 'A measured interface using #6932e8 and 24px spacing throughout the system.',
      visualPersonality: ['Measured and systematic', 'Visually consistent'],
      colorStrategy: 'Use the #6932e8 accent only in supported action contexts.',
      typographyStrategy: 'Preserve the measured typographic hierarchy and role relationships.',
      spacingStrategy: 'Build component rhythm from the recurring 24px spacing value.',
      layoutStrategy: 'Preserve the measured container hierarchy and section composition.',
      responsiveStrategy: 'Use the supplied viewport evidence for responsive implementation.',
      imageryStrategy: 'Preserve the observed image roles, cropping and content hierarchy.',
      motionStrategy: 'Use the measured 180ms transition as the interaction vocabulary.',
      componentGuidance: [
        {
          name: 'Header',
          purpose: 'Provides the primary page identity and navigation.',
          rules: [], anatomy: [], variants: [], states: [], responsiveBehavior: [], avoid: [],
          evidence: ['invented-99'], confidence: 'High'
        },
        {
          name: 'Invented widget',
          purpose: 'This component was not present in measured evidence.',
          rules: [], anatomy: [], variants: [], states: [], responsiveBehavior: [], avoid: [],
          evidence: ['invented-99'], confidence: 'low'
        }
      ],
      principles: [{
        title: 'Measured decisions',
        principle: 'Use 24px spacing only where the recurring rhythm supports it.',
        rationale: 'This keeps implementation aligned with measured evidence.',
        evidence: ['invented-99'],
        implementation: 'Map the decision to the corresponding measured token.',
        confidence: 'High'
      }],
      guidancePairs: [{
        category: 'Color & Tokens',
        do: 'Use #6932e8 only in its measured contexts.',
        dont: 'Do not invent a second 24px token for the same role.',
        rationale: 'Measured tokens keep the system internally consistent.',
        evidence: ['color-01 plus commentary'],
        confidence: 'strong'
      }],
      implementationNotes: ['Verify every 24px value against evidence.'],
      qualityChecklist: [{
        category: 'Color fidelity',
        check: 'Confirm #6932e8 maps to the measured color role.',
        evidence: 'invented-99'
      }],
      coverageAssessment: { confidence: 'Medium', strengths: [], gaps: [] }
    },
    ['coverage-01', 'color-01', 'component-01'],
    ['Header']
  );
  const expectedDesktopBands = Math.ceil(
    desktop.layout.documentHeight / config.screenshotBandHeight
  );
  const expectedMobileBands = Math.ceil(
    mobile.layout.documentHeight / config.screenshotBandHeight
  );

  const assertions: Array<[boolean, string]> = [
    [evidence.colors.length >= 3, 'colors extracted'],
    [evidence.typography.length >= 3, 'typography extracted'],
    [evidence.cssVariables.some((item) => item.name === '--fixture-accent'), 'CSS variables extracted'],
    [evidence.breakpoints.length >= 1, 'media queries extracted'],
    [evidence.components.some((item) => item.name === 'Header'), 'components extracted'],
    [desktop.links.some((link) => link.includes('/about.html')), 'internal links extracted'],
    [
      desktop.bandScreenshots.length === expectedDesktopBands &&
        mobile.bandScreenshots.length === expectedMobileBands,
      'complete top-to-bottom screenshot bands captured'
    ],
    [
      evidence.screenshots.all.every((screenshot) => screenshot.bands.length > 0),
      'screenshot bands exposed in aggregated evidence'
    ],
    [markdown.includes('# DESIGN.md'), 'DESIGN.md generated'],
    [css.includes('--color-01'), 'tokens.css generated'],
    [markdown.includes('by DSMD'), 'DSMD attribution generated'],
    [css.includes('Generated by DSMD'), 'DSMD token header generated'],
    [
      normalizedCategories.join(',') ===
        'color,typography,spacing,layout,responsive,imagery,motion,components',
      'AI category labels normalized'
    ],
    [
      !/#6932e8|24px|75%|180ms/.test(sanitizedModelProse) &&
        sanitizedModelProse.includes('measured color token') &&
        sanitizedModelProse.includes('measured size token') &&
        sanitizedModelProse.includes('measured motion token'),
      'AI exact prose values repaired'
    ],
    [
      repairedModel.componentGuidance.length === 1 &&
        repairedModel.componentGuidance[0].name === 'Header' &&
        repairedModel.componentGuidance[0].evidence?.[0] === 'component-01',
      'unknown AI components removed and evidence repaired'
    ],
    [
      repairedModel.doDetails?.[0].category === 'color' &&
        repairedModel.doDetails[0].evidence[0] === 'color-01' &&
        !/#6932e8|24px|180ms/.test(JSON.stringify(repairedModel)),
      'complete AI response repaired without fallback'
    ]
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
