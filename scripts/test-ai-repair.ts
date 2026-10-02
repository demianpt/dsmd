import http from 'node:http';
import type { AggregatedEvidence } from '../server/types/domain.js';

const modelResponse = {
  overview: 'A measured interface using #6932e8 with 24px spacing throughout the system.',
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
};

const mockServer = http.createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({
    model: 'dsmd-local-regression',
    message: { content: JSON.stringify(modelResponse) }
  }));
});

await new Promise<void>((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
const address = mockServer.address();
if (!address || typeof address === 'string') throw new Error('Could not start local mock Ollama.');

process.env.AI_ENABLED = 'true';
process.env.OLLAMA_HOST = `http://127.0.0.1:${address.port}`;
process.env.OLLAMA_MODEL = 'dsmd-local-regression';
process.env.OLLAMA_SEND_SCREENSHOTS = 'false';
process.env.OLLAMA_TIMEOUT_MS = '30000';

const evidence: AggregatedEvidence = {
  schemaVersion: '1.0',
  generatedAt: new Date().toISOString(),
  source: {
    requestedUrl: 'https://example.test/', canonicalUrl: 'https://example.test/',
    domain: 'example.test', title: 'Example', description: '', faviconUrl: ''
  },
  coverage: {
    multiPage: false, candidateUrls: 1, selectedUrls: ['https://example.test/'],
    scannedPageViews: 1, viewports: ['desktop'], failures: []
  },
  screenshots: { primary: '', all: [] },
  colors: [{
    value: 'rgb(105, 50, 232)', normalized: '#6932E8', count: 4,
    contexts: ['button'], channels: ['background'], areaScore: 0.1
  }],
  typography: [{
    family: 'Inter', size: '16px', weight: '400', lineHeight: '24px',
    letterSpacing: '0px', textTransform: 'none', count: 8,
    tags: ['p'], samples: ['Example'], viewports: ['desktop']
  }],
  cssVariables: [],
  spacing: [{ value: '24px', count: 6, contexts: ['padding'] }],
  radii: [], borders: [], shadows: [],
  transitions: [{ value: '180ms ease', count: 2 }],
  maxWidths: [], gridColumns: [], breakpoints: [], fontFaces: [],
  components: [{
    name: 'Header', count: 1, pages: ['https://example.test/'], viewports: ['desktop'],
    signals: ['<header>'], samples: [{ page: 'https://example.test/', selector: 'header' }]
  }],
  sections: [], images: [], interactions: [], layouts: [], responsiveComparisons: [], pages: []
};

try {
  const { analyzeDesignWithOllama } = await import('../server/ai/ollama.js');
  const { generateDesignMd } = await import('../server/output/generate.js');
  const result = await analyzeDesignWithOllama('local-regression', evidence);
  const markdown = generateDesignMd(evidence, result.analysis);
  const serialized = JSON.stringify(result.analysis);
  const assertions: Array<[boolean, string]> = [
    [result.used, 'AI result accepted after deterministic repair'],
    [!result.fallbackReason, 'no fallback reason produced'],
    [result.model === 'dsmd-local-regression', 'model identity retained'],
    [!/#6932e8|24px|180ms/i.test(serialized), 'unsupported exact prose removed'],
    [!result.analysis.componentGuidance.some((item) => item.name === 'Invented widget'), 'invented component removed'],
    [result.analysis.componentGuidance.some((item) => item.name === 'Header'), 'observed component retained'],
    [(result.analysis.principleDetails?.length || 0) >= 6, 'principles completed'],
    [(result.analysis.doDetails?.length || 0) >= 7, 'guidance categories completed'],
    [(result.analysis.qualityChecklist?.length || 0) >= 8, 'quality checklist completed'],
    [markdown.includes('## 15. Implementation QA checklist'), 'production DESIGN.md generated']
  ];
  for (const [condition, label] of assertions) {
    if (!condition) throw new Error(`AI repair assertion failed: ${label}`);
    console.log(`✓ ${label}`);
  }
  console.log('\nAI repair integration test passed with local-only traffic.');
} finally {
  await new Promise<void>((resolve) => mockServer.close(() => resolve()));
}
