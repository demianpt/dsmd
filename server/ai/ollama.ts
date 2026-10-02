import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { config } from '../config.js';
import { log } from '../lib/log.js';
import { scanDir } from '../storage/scans.js';
import type { AggregatedEvidence, AiAnalysis } from '../types/domain.js';
import { createFallbackAnalysis } from './fallback.js';

const confidenceSchema = z.enum(['high', 'medium', 'low']);
const categorySchema = z.enum([
  'color',
  'typography',
  'spacing',
  'layout',
  'responsive',
  'imagery',
  'motion',
  'components',
  'content',
  'accessibility'
]);
type GuidanceCategoryValue = z.infer<typeof categorySchema>;
const evidenceReferencesSchema = z.array(z.string().min(1)).max(8).default([]);

export function normalizeModelCategory(value: unknown): GuidanceCategoryValue {
  const label = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const exact = categorySchema.safeParse(label);
  if (exact.success) return exact.data;
  if (/access|keyboard|focus|semantic|inclusive/.test(label)) return 'accessibility';
  if (/responsive|mobile|viewport|breakpoint|adaptive/.test(label)) return 'responsive';
  if (/typograph|type|font|text style|readability/.test(label)) return 'typography';
  if (/space|rhythm|density|gutter/.test(label)) return 'spacing';
  if (/image|imagery|media|photo|illustration|asset/.test(label)) return 'imagery';
  if (/motion|animation|transition|interaction|hover|state/.test(label)) return 'motion';
  if (/color|palette|contrast|surface|token/.test(label)) return 'color';
  if (/content|copy|voice|language|label/.test(label)) return 'content';
  if (/component|pattern|control|element|consistency/.test(label)) return 'components';
  return 'layout';
}

function normalizeConfidence(value: unknown): 'high' | 'medium' | 'low' {
  const label = String(value || '').toLowerCase();
  if (label.includes('high') || label.includes('strong')) return 'high';
  if (label.includes('low') || label.includes('weak') || label.includes('limited')) return 'low';
  return 'medium';
}

function normalizeModelPayload(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>;
  const normalizeItems = (
    key: string,
    transform: (item: Record<string, unknown>) => Record<string, unknown>
  ): unknown => Array.isArray(source[key])
    ? (source[key] as unknown[]).map((item) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? transform(item as Record<string, unknown>)
          : item
      )
    : source[key];

  return {
    ...source,
    componentGuidance: normalizeItems('componentGuidance', (item) => ({
      ...item,
      confidence: normalizeConfidence(item.confidence)
    })),
    principles: normalizeItems('principles', (item) => ({
      ...item,
      confidence: normalizeConfidence(item.confidence)
    })),
    guidancePairs: normalizeItems('guidancePairs', (item) => ({
      ...item,
      category: normalizeModelCategory(item.category),
      confidence: normalizeConfidence(item.confidence)
    })),
    qualityChecklist: normalizeItems('qualityChecklist', (item) => ({
      ...item,
      category: normalizeModelCategory(item.category)
    })),
    coverageAssessment:
      source.coverageAssessment && typeof source.coverageAssessment === 'object' && !Array.isArray(source.coverageAssessment)
        ? {
            ...(source.coverageAssessment as Record<string, unknown>),
            confidence: normalizeConfidence(
              (source.coverageAssessment as Record<string, unknown>).confidence
            )
          }
        : source.coverageAssessment
  };
}

const analysisSchema = z.object({
  overview: z.string().min(20),
  visualPersonality: z.array(z.string().min(3)).min(2).max(8),
  colorStrategy: z.string().min(10),
  typographyStrategy: z.string().min(10),
  spacingStrategy: z.string().min(10),
  layoutStrategy: z.string().min(10),
  responsiveStrategy: z.string().min(10),
  imageryStrategy: z.string().min(10),
  motionStrategy: z.string().min(10),
  componentGuidance: z
    .array(
      z.object({
        name: z.string().min(2),
        purpose: z.string().min(8),
        rules: z.array(z.string().min(5)).max(8).default([]),
        anatomy: z.array(z.string().min(3)).max(8).default([]),
        variants: z.array(z.string().min(3)).max(8).default([]),
        states: z.array(z.string().min(3)).max(8).default([]),
        responsiveBehavior: z.array(z.string().min(3)).max(8).default([]),
        avoid: z.array(z.string().min(3)).max(6).default([]),
        evidence: evidenceReferencesSchema,
        confidence: confidenceSchema
      })
    )
    .max(30)
    .default([]),
  principles: z.array(z.object({
    title: z.string().min(3),
    principle: z.string().min(8),
    rationale: z.string().min(8),
    evidence: evidenceReferencesSchema,
    implementation: z.string().min(8),
    confidence: confidenceSchema
  })).max(12).default([]),
  guidancePairs: z.array(z.object({
    category: categorySchema,
    do: z.string().min(8),
    dont: z.string().min(8),
    rationale: z.string().min(8),
    evidence: evidenceReferencesSchema,
    confidence: confidenceSchema
  })).max(16).default([]),
  implementationNotes: z.array(z.string().min(5)).max(16).default([]),
  qualityChecklist: z.array(z.object({
    category: categorySchema,
    check: z.string().min(8),
    evidence: z.string().default('')
  })).max(20).default([]),
  coverageAssessment: z.object({
    confidence: confidenceSchema,
    strengths: z.array(z.string().min(5)).max(6).default([]),
    gaps: z.array(z.string().min(5)).max(6).default([])
  })
});

type ModelAnalysis = z.infer<typeof analysisSchema>;

const ollamaJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'overview',
    'visualPersonality',
    'colorStrategy',
    'typographyStrategy',
    'spacingStrategy',
    'layoutStrategy',
    'responsiveStrategy',
    'imageryStrategy',
    'motionStrategy',
    'componentGuidance',
    'principles',
    'guidancePairs',
    'implementationNotes',
    'qualityChecklist',
    'coverageAssessment'
  ],
  properties: {
    overview: { type: 'string' },
    visualPersonality: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 8 },
    colorStrategy: { type: 'string' },
    typographyStrategy: { type: 'string' },
    spacingStrategy: { type: 'string' },
    layoutStrategy: { type: 'string' },
    responsiveStrategy: { type: 'string' },
    imageryStrategy: { type: 'string' },
    motionStrategy: { type: 'string' },
    componentGuidance: {
      type: 'array',
      maxItems: 30,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'purpose', 'rules', 'anatomy', 'variants', 'states', 'responsiveBehavior', 'avoid', 'evidence', 'confidence'],
        properties: {
          name: { type: 'string' },
          purpose: { type: 'string' },
          rules: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 8 },
          anatomy: { type: 'array', items: { type: 'string' }, maxItems: 8 },
          variants: { type: 'array', items: { type: 'string' }, maxItems: 8 },
          states: { type: 'array', items: { type: 'string' }, maxItems: 8 },
          responsiveBehavior: { type: 'array', items: { type: 'string' }, maxItems: 8 },
          avoid: { type: 'array', items: { type: 'string' }, maxItems: 6 },
          evidence: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4 },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] }
        }
      }
    },
    principles: {
      type: 'array', minItems: 6, maxItems: 10,
      items: {
        type: 'object', additionalProperties: false,
        required: ['title', 'principle', 'rationale', 'evidence', 'implementation', 'confidence'],
        properties: {
          title: { type: 'string' }, principle: { type: 'string' }, rationale: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4 },
          implementation: { type: 'string' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] }
        }
      }
    },
    guidancePairs: {
      type: 'array', minItems: 7, maxItems: 12,
      items: {
        type: 'object', additionalProperties: false,
        required: ['category', 'do', 'dont', 'rationale', 'evidence', 'confidence'],
        properties: {
          category: { type: 'string', enum: ['color', 'typography', 'spacing', 'layout', 'responsive', 'imagery', 'motion', 'components', 'content', 'accessibility'] },
          do: { type: 'string' }, dont: { type: 'string' }, rationale: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4 },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] }
        }
      }
    },
    implementationNotes: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 12 },
    qualityChecklist: {
      type: 'array', minItems: 8, maxItems: 16,
      items: {
        type: 'object', additionalProperties: false, required: ['category', 'check', 'evidence'],
        properties: {
          category: { type: 'string', enum: ['color', 'typography', 'spacing', 'layout', 'responsive', 'imagery', 'motion', 'components', 'content', 'accessibility'] },
          check: { type: 'string' }, evidence: { type: 'string' }
        }
      }
    },
    coverageAssessment: {
      type: 'object', additionalProperties: false, required: ['confidence', 'strengths', 'gaps'],
      properties: {
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        strengths: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 6 },
        gaps: { type: 'array', items: { type: 'string' }, maxItems: 6 }
      }
    }
  }
} as const;

function compactEvidence(evidence: AggregatedEvidence): unknown {
  return {
    source: { id: 'source-01', ...evidence.source },
    coverage: { id: 'coverage-01', ...evidence.coverage },
    colors: evidence.colors.slice(0, 18).map((item, index) => ({
      id: `color-${String(index + 1).padStart(2, '0')}`,
      value: item.normalized,
      count: item.count,
      channels: item.channels,
      contexts: item.contexts?.slice(0, 6)
    })),
    typography: evidence.typography.slice(0, 24).map((item, index) => ({
      id: `type-${String(index + 1).padStart(2, '0')}`,
      family: item.family,
      size: item.size,
      weight: item.weight,
      lineHeight: item.lineHeight,
      letterSpacing: item.letterSpacing,
      textTransform: item.textTransform,
      count: item.count,
      tags: item.tags,
      samples: item.samples.slice(0, 3),
      viewports: item.viewports
    })),
    cssVariables: evidence.cssVariables.slice(0, 80).map((item, index) => ({ id: `variable-${String(index + 1).padStart(2, '0')}`, ...item })),
    spacing: evidence.spacing.slice(0, 24).map((item, index) => ({ id: `spacing-${String(index + 1).padStart(2, '0')}`, ...item })),
    radii: evidence.radii.slice(0, 16).map((item, index) => ({ id: `radius-${String(index + 1).padStart(2, '0')}`, ...item })),
    borders: evidence.borders.slice(0, 12).map((item, index) => ({ id: `border-${String(index + 1).padStart(2, '0')}`, ...item })),
    shadows: evidence.shadows.slice(0, 12).map((item, index) => ({ id: `shadow-${String(index + 1).padStart(2, '0')}`, ...item })),
    transitions: evidence.transitions.slice(0, 12).map((item, index) => ({ id: `motion-${String(index + 1).padStart(2, '0')}`, ...item })),
    maxWidths: evidence.maxWidths.slice(0, 16).map((item, index) => ({ id: `width-${String(index + 1).padStart(2, '0')}`, ...item })),
    gridColumns: evidence.gridColumns.slice(0, 12).map((item, index) => ({ id: `grid-${String(index + 1).padStart(2, '0')}`, ...item })),
    breakpoints: evidence.breakpoints.slice(0, 30).map((item, index) => ({ id: `breakpoint-${String(index + 1).padStart(2, '0')}`, ...item })),
    fontFaces: evidence.fontFaces.slice(0, 30).map((item, index) => ({ id: `font-${String(index + 1).padStart(2, '0')}`, ...item })),
    components: evidence.components.slice(0, 24).map((item, index) => ({
      id: `component-${String(index + 1).padStart(2, '0')}`,
      name: item.name,
      count: item.count,
      pages: item.pages.length,
      viewports: item.viewports,
      signals: item.signals,
      samples: item.samples.slice(0, 4)
    })),
    sections: evidence.sections.slice(0, 60).map((item, index) => ({ id: `section-${String(index + 1).padStart(2, '0')}`, ...item })),
    imageRatios: evidence.images.slice(0, 60).map((item, index) => ({
      id: `image-${String(index + 1).padStart(2, '0')}`,
      ratio: item.ratio,
      width: item.width,
      height: item.height,
      objectFit: item.objectFit,
      alt: item.alt,
      viewport: item.viewport
    })),
    interactions: evidence.interactions.slice(0, 18).map((item, index) => ({
      id: `interaction-${String(index + 1).padStart(2, '0')}`,
      label: item.label,
      tag: item.tag,
      hoverDiff: item.hoverDiff,
      focusDiff: item.focusDiff,
      states: item.states
    })),
    layouts: evidence.layouts.slice(0, 30).map((item, index) => ({ id: `layout-${String(index + 1).padStart(2, '0')}`, ...item })),
    responsiveComparisons: (evidence.responsiveComparisons || []).slice(0, 18).map((item, index) => ({ id: `responsive-${String(index + 1).padStart(2, '0')}`, ...item }))
  };
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) {
      try {
        return JSON.parse(fenced.trim());
      } catch {
        // Continue to the outermost-object extraction.
      }
    }
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first >= 0 && last > first) return JSON.parse(trimmed.slice(first, last + 1));
    throw new Error('The model response did not contain valid JSON.');
  }
}

async function screenshotImages(slug: string, evidence: AggregatedEvidence): Promise<string[]> {
  if (!config.ollamaSendScreenshots) return [];

  // Every scanned page contributes its bands, so a multi-page scan is read in
  // full rather than judged from one above-the-fold crop of the landing page.
  // Desktop first, then mobile, so the budget favours the primary viewport.
  const ordered = [
    ...evidence.pages.filter((page) => page.viewport === 'desktop'),
    ...evidence.pages.filter((page) => page.viewport !== 'desktop')
  ];

  // Round-robin across pages so a single long page cannot consume the budget
  // and starve the later pages of a multi-page scan.
  const queues = ordered.map((page) =>
    page.bandScreenshots?.length ? [...page.bandScreenshots] : [page.viewportScreenshot]
  );
  const selected: string[] = [];
  while (selected.length < config.maxAiImages && queues.some((queue) => queue.length)) {
    for (const queue of queues) {
      if (selected.length >= config.maxAiImages) break;
      const next = queue.shift();
      if (next) selected.push(next);
    }
  }

  const images: string[] = [];
  for (const publicPath of selected) {
    const relative = publicPath.split(`/scans/${slug}/`)[1];
    if (!relative) continue;
    try {
      const buffer = await fs.readFile(path.join(scanDir(slug), relative));
      if (buffer.length <= 7_000_000) images.push(buffer.toString('base64'));
    } catch {
      // Screenshot context is optional; measured evidence is sufficient.
    }
  }
  return images;
}

const systemPrompt = `You are a senior design-system analyst. You receive browser-measured evidence from a real, multi-page website and may receive representative screenshots.

The screenshots are sequential top-to-bottom bands sampled across scanned pages. Read them
in page order, but never assume an omitted band or state was visually inspected.

Interpret the evidence into concise semantic guidance for a production DESIGN.md. A deterministic renderer will add every exact token, value and measurement.

Hard rules:
- Never invent facts.
- Do not include exact numbers, units, color codes, breakpoints, durations, percentages or numeric counts in prose. Refer to the measured tokens qualitatively.
- Do not claim a component exists unless it appears in the provided component or section evidence.
- Do not call the website accessible, performant or responsive unless the supplied evidence demonstrates that exact claim.
- Explain visual logic, hierarchy, art direction, composition and reuse rules that raw CSS cannot express.
- Reuse observed component names in componentGuidance.
- Cite one to four supplied evidence IDs for every principle, guidance pair and component contract. Never invent an evidence ID.
- Pair every recommendation with a concrete anti-pattern and rationale. Cover at least six distinct categories.
- Keep component anatomy, variants, states and responsive behavior empty when evidence is insufficient; never guess.
- Confidence means evidence strength: high for repeated measured patterns, medium for consistent but limited evidence, low for tentative interpretation.
- Return only the JSON object required by the response schema.

Ollama Cloud does not enforce the \`format\` schema, so the required shape is restated here.
Return exactly one JSON object with these keys and nothing else -- no prose, no markdown fence,
no wrapper object, and never echo the input evidence back:

{
  "overview": string,
  "visualPersonality": string[] (2-8),
  "colorStrategy": string,
  "typographyStrategy": string,
  "spacingStrategy": string,
  "layoutStrategy": string,
  "responsiveStrategy": string,
  "imageryStrategy": string,
  "motionStrategy": string,
  "componentGuidance": Array<{ "name": string, "purpose": string, "rules": string[], "anatomy": string[], "variants": string[], "states": string[], "responsiveBehavior": string[], "avoid": string[], "evidence": string[], "confidence": "high"|"medium"|"low" }> (max 30),
  "principles": Array<{ "title": string, "principle": string, "rationale": string, "evidence": string[], "implementation": string, "confidence": "high"|"medium"|"low" }> (6-10),
  "guidancePairs": Array<{ "category": "color"|"typography"|"spacing"|"layout"|"responsive"|"imagery"|"motion"|"components"|"content"|"accessibility", "do": string, "dont": string, "rationale": string, "evidence": string[], "confidence": "high"|"medium"|"low" }> (7-12),
  "implementationNotes": string[] (3-12),
  "qualityChecklist": Array<{ "category": "color"|"typography"|"spacing"|"layout"|"responsive"|"imagery"|"motion"|"components"|"content"|"accessibility", "check": string, "evidence": string }> (8-16),
  "coverageAssessment": { "confidence": "high"|"medium"|"low", "strengths": string[], "gaps": string[] }
}

Every key is required. Use the exact key names above.`;

export function sanitizeModelProse(value: string): string {
  return value
    .replace(/#[0-9a-f]{3,8}\b/gi, 'the measured color token')
    .replace(
      /\b\d+(?:\.\d+)?\s*(px|rem|em|pt|vw|vh|svh|dvh|%)(?![a-z0-9])/gi,
      (_match, unit: string) => unit === '%' ? 'the measured proportional token' : 'the measured size token'
    )
    .replace(
      /\b\d+(?:\.\d+)?\s*(ms|seconds?|s)(?![a-z0-9])/gi,
      'the measured motion token'
    )
    .replace(/\b(?:a|an)\s+the measured/gi, 'the measured')
    .replace(/\s+/g, ' ')
    .trim();
}

const categoryEvidencePrefixes: Record<GuidanceCategoryValue, string[]> = {
  color: ['color-', 'variable-'],
  typography: ['type-', 'font-'],
  spacing: ['spacing-'],
  layout: ['layout-', 'grid-', 'width-', 'section-'],
  responsive: ['responsive-', 'breakpoint-', 'layout-'],
  imagery: ['image-', 'section-'],
  motion: ['interaction-', 'motion-'],
  components: ['component-', 'section-'],
  content: ['section-', 'type-'],
  accessibility: ['interaction-', 'coverage-']
};

function reconcileEvidenceReferences(
  references: string[],
  evidenceIds: Set<string>,
  preferredPrefixes: string[] = []
): string[] {
  const recovered = references.flatMap((reference) =>
    String(reference).match(/[a-z]+-\d{2,3}/gi) || []
  );
  const valid = [...new Set(recovered.filter((reference) => evidenceIds.has(reference)))].slice(0, 4);
  if (valid.length) return valid;
  const available = [...evidenceIds];
  const preferred = available.find((id) => preferredPrefixes.some((prefix) => id.startsWith(prefix)));
  return [preferred || (evidenceIds.has('coverage-01') ? 'coverage-01' : available[0])].filter(Boolean);
}

function resolveComponentName(name: string, componentNames: Map<string, string>): string | null {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (componentNames.has(normalized)) return componentNames.get(normalized) || name;
  const compact = normalized.replace(/\s+/g, '');
  const matches = [...componentNames.entries()].filter(([key]) => {
    const candidate = key.replace(/[^a-z0-9]+/g, '');
    return candidate.length >= 4 && (candidate.includes(compact) || compact.includes(candidate));
  });
  return matches.length === 1 ? matches[0][1] : null;
}

function repairModelAnalysis(
  model: ModelAnalysis,
  evidenceIds: Set<string>,
  componentNames: Map<string, string>
): ModelAnalysis {
  const proseList = (items: string[]): string[] => items.map(sanitizeModelProse).filter(Boolean);
  const components = model.componentGuidance.flatMap((item) => {
    const name = resolveComponentName(item.name, componentNames);
    if (!name) return [];
    return [{
      ...item,
      name,
      purpose: sanitizeModelProse(item.purpose),
      rules: proseList(item.rules),
      anatomy: proseList(item.anatomy),
      variants: proseList(item.variants),
      states: proseList(item.states),
      responsiveBehavior: proseList(item.responsiveBehavior),
      avoid: proseList(item.avoid),
      evidence: reconcileEvidenceReferences(item.evidence, evidenceIds, ['component-', 'section-'])
    }];
  });

  return {
    ...model,
    overview: sanitizeModelProse(model.overview),
    visualPersonality: proseList(model.visualPersonality),
    colorStrategy: sanitizeModelProse(model.colorStrategy),
    typographyStrategy: sanitizeModelProse(model.typographyStrategy),
    spacingStrategy: sanitizeModelProse(model.spacingStrategy),
    layoutStrategy: sanitizeModelProse(model.layoutStrategy),
    responsiveStrategy: sanitizeModelProse(model.responsiveStrategy),
    imageryStrategy: sanitizeModelProse(model.imageryStrategy),
    motionStrategy: sanitizeModelProse(model.motionStrategy),
    componentGuidance: components,
    principles: model.principles.map((item) => ({
      ...item,
      title: sanitizeModelProse(item.title),
      principle: sanitizeModelProse(item.principle),
      rationale: sanitizeModelProse(item.rationale),
      implementation: sanitizeModelProse(item.implementation),
      evidence: reconcileEvidenceReferences(item.evidence, evidenceIds, ['coverage-', 'layout-', 'section-'])
    })),
    guidancePairs: model.guidancePairs.map((item) => ({
      ...item,
      do: sanitizeModelProse(item.do),
      dont: sanitizeModelProse(item.dont),
      rationale: sanitizeModelProse(item.rationale),
      evidence: reconcileEvidenceReferences(
        item.evidence,
        evidenceIds,
        categoryEvidencePrefixes[item.category]
      )
    })),
    implementationNotes: proseList(model.implementationNotes),
    qualityChecklist: model.qualityChecklist.map((item) => ({
      ...item,
      check: sanitizeModelProse(item.check),
      evidence: reconcileEvidenceReferences(
        [item.evidence],
        evidenceIds,
        categoryEvidencePrefixes[item.category]
      )[0]
    })),
    coverageAssessment: {
      ...model.coverageAssessment,
      strengths: proseList(model.coverageAssessment.strengths),
      gaps: proseList(model.coverageAssessment.gaps)
    }
  };
}

export function normalizeAndRepairModelAnalysis(
  value: unknown,
  evidenceIdsInput: Iterable<string>,
  componentNamesInput: Iterable<string>
): AiAnalysis {
  const evidenceIds = new Set(evidenceIdsInput);
  const componentNames = new Map(
    [...componentNamesInput].map((name) => [
      name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
      name
    ])
  );
  const parsed = analysisSchema.parse(normalizeModelPayload(value));
  return toAiAnalysis(repairModelAnalysis(parsed, evidenceIds, componentNames));
}

function toAiAnalysis(model: ModelAnalysis): AiAnalysis {
  return {
    overview: model.overview,
    visualPersonality: model.visualPersonality,
    colorStrategy: model.colorStrategy,
    typographyStrategy: model.typographyStrategy,
    spacingStrategy: model.spacingStrategy,
    layoutStrategy: model.layoutStrategy,
    responsiveStrategy: model.responsiveStrategy,
    imageryStrategy: model.imageryStrategy,
    motionStrategy: model.motionStrategy,
    componentGuidance: model.componentGuidance,
    designPrinciples: model.principles.map((item) => item.principle),
    dos: model.guidancePairs.map((item) => item.do),
    donts: model.guidancePairs.map((item) => item.dont),
    implementationNotes: model.implementationNotes,
    principleDetails: model.principles,
    doDetails: model.guidancePairs.map((item) => ({
      category: item.category,
      rule: item.do,
      rationale: item.rationale,
      evidence: item.evidence,
      confidence: item.confidence
    })),
    dontDetails: model.guidancePairs.map((item) => ({
      category: item.category,
      rule: item.dont,
      rationale: item.rationale,
      evidence: item.evidence,
      confidence: item.confidence
    })),
    qualityChecklist: model.qualityChecklist,
    coverageAssessment: model.coverageAssessment
  };
}

function collectEvidenceIds(value: unknown): Set<string> {
  const ids = new Set<string>();
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === 'object') {
      for (const [key, child] of Object.entries(item)) {
        if (key === 'id' && typeof child === 'string') ids.add(child);
        else visit(child);
      }
    }
  };
  visit(value);
  return ids;
}

function similarity(first: string, second: string): number {
  const tokens = (value: string) => new Set(
    value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((token) => token.length > 2)
  );
  const left = tokens(first);
  const right = tokens(second);
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return intersection / union;
}

function completeAnalysis(model: AiAnalysis, fallback: AiAnalysis): AiAnalysis {
  const guidance = model.componentGuidance.map((item) => {
    const backup = fallback.componentGuidance.find(
      (candidate) => candidate.name.toLowerCase() === item.name.toLowerCase()
    );
    if (!backup) return item;
    return {
      ...backup,
      ...item,
      rules: item.rules.length ? item.rules : backup.rules,
      anatomy: item.anatomy?.length ? item.anatomy : backup.anatomy,
      variants: item.variants?.length ? item.variants : backup.variants,
      states: item.states?.length ? item.states : backup.states,
      responsiveBehavior: item.responsiveBehavior?.length
        ? item.responsiveBehavior
        : backup.responsiveBehavior,
      avoid: item.avoid?.length ? item.avoid : backup.avoid,
      evidence: item.evidence?.length ? item.evidence : backup.evidence
    };
  });
  const names = new Set(guidance.map((item) => item.name.toLowerCase()));
  for (const item of fallback.componentGuidance) {
    if (guidance.length >= 30) break;
    if (!names.has(item.name.toLowerCase())) {
      guidance.push(item);
      names.add(item.name.toLowerCase());
    }
  }

  const principles: NonNullable<AiAnalysis['principleDetails']> = [];
  for (const item of [...(model.principleDetails || []), ...(fallback.principleDetails || [])]) {
    if (principles.length >= 10) break;
    if (principles.some((existing) => similarity(existing.principle, item.principle) >= 0.84)) continue;
    principles.push(item);
  }

  const pairs: Array<{
    positive: NonNullable<AiAnalysis['doDetails']>[number];
    negative: NonNullable<AiAnalysis['dontDetails']>[number];
  }> = [];
  const appendPairs = (source: AiAnalysis): void => {
    for (let index = 0; index < (source.doDetails || []).length; index += 1) {
      if (pairs.length >= 12) break;
      const positive = source.doDetails?.[index];
      const negative = source.dontDetails?.[index];
      if (!positive || !negative) continue;
      if (pairs.some((item) => similarity(item.positive.rule, positive.rule) >= 0.84)) continue;
      if (
        source === fallback &&
        pairs.some((item) => item.positive.category === positive.category)
      ) continue;
      pairs.push({ positive, negative });
    }
  };
  appendPairs(model);
  appendPairs(fallback);

  const checklist = [...(model.qualityChecklist || [])];
  for (const item of fallback.qualityChecklist || []) {
    if (checklist.length >= 16) break;
    if (!checklist.some((existing) => existing.category === item.category)) checklist.push(item);
  }

  const implementationNotes = [...new Set([
    ...model.implementationNotes,
    ...fallback.implementationNotes
  ])].slice(0, 12);
  const doDetails = pairs.map((item) => item.positive);
  const dontDetails = pairs.map((item) => item.negative);

  return {
    ...model,
    visualPersonality: model.visualPersonality.length
      ? model.visualPersonality
      : fallback.visualPersonality,
    componentGuidance: guidance,
    principleDetails: principles,
    designPrinciples: principles.map((item) => item.principle),
    doDetails,
    dontDetails,
    dos: doDetails.map((item) => item.rule),
    donts: dontDetails.map((item) => item.rule),
    implementationNotes,
    qualityChecklist: checklist,
    coverageAssessment: {
      confidence: model.coverageAssessment?.confidence || fallback.coverageAssessment?.confidence || 'medium',
      strengths: model.coverageAssessment?.strengths.length
        ? model.coverageAssessment.strengths
        : fallback.coverageAssessment?.strengths || [],
      gaps: model.coverageAssessment?.gaps.length
        ? model.coverageAssessment.gaps
        : fallback.coverageAssessment?.gaps || []
    }
  };
}

interface ChatPayload {
  model?: string;
  message?: { content?: string; thinking?: string };
  response?: string;
}

async function callOllama(input: {
  controller: AbortController;
  evidenceText: string;
  evidenceIds: Set<string>;
  componentNames: Map<string, string>;
  images: string[];
  useSchema: boolean;
  thinking: string | boolean;
}): Promise<{ analysis: AiAnalysis; model: string }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (config.ollamaApiKey) headers.authorization = `Bearer ${config.ollamaApiKey}`;
  const userMessage = {
    role: 'user',
    content: `Analyze the following measured evidence and populate every required response field.\n\n${input.evidenceText}`,
    ...(input.images.length ? { images: input.images } : {})
  };

  const response = await fetch(`${config.ollamaHost}/api/chat`, {
    method: 'POST',
    headers,
    signal: input.controller.signal,
    body: JSON.stringify({
      model: config.ollamaModel,
      stream: false,
      format: input.useSchema ? ollamaJsonSchema : 'json',
      think: input.thinking,
      messages: [
        { role: 'system', content: systemPrompt },
        userMessage
      ],
      options: { temperature: 0.15 }
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Ollama returned ${response.status}: ${body.slice(0, 500)}`);
  }
  const payload = (await response.json()) as ChatPayload;
  const content = payload.message?.content || payload.response || '';
  if (!content) throw new Error('Ollama returned an empty response.');
  const analysis = normalizeAndRepairModelAnalysis(
    extractJson(content),
    input.evidenceIds,
    input.componentNames.values()
  );
  return { analysis, model: payload.model || config.ollamaModel };
}

export interface OllamaAnalysisResult {
  analysis: AiAnalysis;
  used: boolean;
  model?: string;
  fallbackReason?: string;
}

function conciseAnalysisError(error: unknown): string {
  if (error instanceof z.ZodError) {
    const paths = [...new Set(error.issues.map((issue) => issue.path.join('.')).filter(Boolean))];
    const summary = paths.slice(0, 4).join(', ');
    return `AI response validation failed${summary ? ` at ${summary}` : ''}.`;
  }
  if (error instanceof Error) {
    if (error.name === 'AbortError') return 'AI interpretation timed out.';
    return error.message.replace(/\s+/g, ' ').trim().slice(0, 500);
  }
  return String(error).replace(/\s+/g, ' ').trim().slice(0, 500);
}

export async function analyzeDesignWithOllama(
  slug: string,
  evidence: AggregatedEvidence
): Promise<OllamaAnalysisResult> {
  const fallback = createFallbackAnalysis(evidence);
  if (!config.aiEnabled) {
    return { analysis: fallback, used: false, fallbackReason: 'AI_ENABLED=false' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.ollamaTimeoutMs);
  const errors: string[] = [];
  try {
    const images = await screenshotImages(slug, evidence);
    const compact = compactEvidence(evidence);
    const evidenceText = JSON.stringify(compact);
    const evidenceIds = collectEvidenceIds(compact);
    const componentNames = new Map(
      evidence.components.map((item) => [
        item.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
        item.name
      ])
    );
    const attempts = [
      { images, useSchema: true, thinking: config.ollamaThinking },
      ...(images.length
        ? [{ images: [] as string[], useSchema: true, thinking: config.ollamaThinking }]
        : []),
      { images: [] as string[], useSchema: false, thinking: false }
    ];

    for (const attempt of attempts) {
      try {
        const result = await callOllama({
          controller,
          evidenceText,
          evidenceIds,
          componentNames,
          images: attempt.images,
          useSchema: attempt.useSchema,
          thinking: attempt.thinking
        });
        return {
          analysis: completeAnalysis(result.analysis, fallback),
          used: true,
          model: result.model
        };
      } catch (error) {
        if (controller.signal.aborted) throw error;
        errors.push(conciseAnalysisError(error));
      }
    }
    throw new Error([...new Set(errors)].join(' | '));
  } catch (error) {
    const reason = conciseAnalysisError(error);
    log.warn('AI analysis could not be completed; using deterministic fallback', reason);
    return { analysis: fallback, used: false, fallbackReason: reason };
  } finally {
    clearTimeout(timeout);
  }
}
