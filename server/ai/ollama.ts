import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { config } from '../config.js';
import { log } from '../lib/log.js';
import { scanDir } from '../storage/scans.js';
import type { AggregatedEvidence, AiAnalysis } from '../types/domain.js';
import { createFallbackAnalysis } from './fallback.js';

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
        rules: z.array(z.string().min(5)).max(8)
      })
    )
    .max(30),
  designPrinciples: z.array(z.string().min(5)).min(3).max(12),
  dos: z.array(z.string().min(5)).min(3).max(12),
  donts: z.array(z.string().min(5)).min(3).max(12),
  implementationNotes: z.array(z.string().min(5)).min(2).max(12)
});

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
    'designPrinciples',
    'dos',
    'donts',
    'implementationNotes'
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
        required: ['name', 'purpose', 'rules'],
        properties: {
          name: { type: 'string' },
          purpose: { type: 'string' },
          rules: { type: 'array', items: { type: 'string' }, maxItems: 8 }
        }
      }
    },
    designPrinciples: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 12 },
    dos: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 12 },
    donts: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 12 },
    implementationNotes: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 12 }
  }
} as const;

function compactEvidence(evidence: AggregatedEvidence): unknown {
  return {
    source: evidence.source,
    coverage: evidence.coverage,
    colors: evidence.colors.slice(0, 18).map((item) => ({
      value: item.normalized,
      count: item.count,
      channels: item.channels,
      contexts: item.contexts?.slice(0, 6)
    })),
    typography: evidence.typography.slice(0, 24).map((item) => ({
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
    cssVariables: evidence.cssVariables.slice(0, 80),
    spacing: evidence.spacing.slice(0, 24),
    radii: evidence.radii.slice(0, 16),
    borders: evidence.borders.slice(0, 12),
    shadows: evidence.shadows.slice(0, 12),
    transitions: evidence.transitions.slice(0, 12),
    maxWidths: evidence.maxWidths.slice(0, 16),
    gridColumns: evidence.gridColumns.slice(0, 12),
    breakpoints: evidence.breakpoints.slice(0, 30),
    fontFaces: evidence.fontFaces.slice(0, 30),
    components: evidence.components.slice(0, 24).map((item) => ({
      name: item.name,
      count: item.count,
      pages: item.pages.length,
      signals: item.signals,
      samples: item.samples.slice(0, 4)
    })),
    sections: evidence.sections.slice(0, 60),
    imageRatios: evidence.images.slice(0, 60).map((item) => ({
      ratio: item.ratio,
      width: item.width,
      height: item.height,
      objectFit: item.objectFit,
      alt: item.alt,
      viewport: item.viewport
    })),
    interactions: evidence.interactions.slice(0, 18).map((item) => ({
      label: item.label,
      tag: item.tag,
      hoverDiff: item.hoverDiff,
      focusDiff: item.focusDiff
    })),
    layouts: evidence.layouts.slice(0, 30)
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

The screenshots are sequential top-to-bottom bands of each scanned page, in reading
order, covering the full length of every page -- not just the area above the fold.
Read them as one continuous journey per page and describe the whole composition.

Interpret the evidence into concise semantic guidance for a production DESIGN.md. A deterministic renderer will add every exact token, value and measurement.

Hard rules:
- Never invent facts.
- Do not include exact numbers, units, color codes, breakpoints, durations, percentages or numeric counts in prose. Refer to the measured tokens qualitatively.
- Do not claim a component exists unless it appears in the provided component or section evidence.
- Do not call the website accessible, performant or responsive unless the supplied evidence demonstrates that exact claim.
- Explain visual logic, hierarchy, art direction, composition and reuse rules that raw CSS cannot express.
- Reuse observed component names in componentGuidance.
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
  "componentGuidance": Array<{ "name": string, "purpose": string, "rules": string[] (max 8) }> (max 30),
  "designPrinciples": string[] (3-12),
  "dos": string[] (3-12),
  "donts": string[] (3-12),
  "implementationNotes": string[] (3-12)
}

Every key is required. Use the exact key names above.`;

function containsUnsupportedExactTokens(value: unknown): boolean {
  const strings: string[] = [];
  const visit = (item: unknown): void => {
    if (typeof item === 'string') strings.push(item);
    else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === 'object') Object.values(item).forEach(visit);
  };
  visit(value);
  return strings.some((text) =>
    /#[0-9a-f]{3,8}\b|\b\d+(?:\.\d+)?\s*(?:px|rem|em|vw|vh|svh|dvh|%|ms|seconds?|s)\b/i.test(text)
  );
}

function completeAnalysis(model: AiAnalysis, fallback: AiAnalysis): AiAnalysis {
  const guidance = [...model.componentGuidance];
  const names = new Set(guidance.map((item) => item.name.toLowerCase()));
  for (const item of fallback.componentGuidance) {
    if (guidance.length >= 30) break;
    if (!names.has(item.name.toLowerCase())) {
      guidance.push(item);
      names.add(item.name.toLowerCase());
    }
  }
  return { ...model, componentGuidance: guidance };
}

interface ChatPayload {
  model?: string;
  message?: { content?: string; thinking?: string };
  response?: string;
}

async function callOllama(input: {
  controller: AbortController;
  evidenceText: string;
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
  const parsed = analysisSchema.parse(extractJson(content));
  if (containsUnsupportedExactTokens(parsed)) {
    throw new Error('The model inserted unsupported exact values into semantic prose.');
  }
  return { analysis: parsed, model: payload.model || config.ollamaModel };
}

export interface OllamaAnalysisResult {
  analysis: AiAnalysis;
  used: boolean;
  model?: string;
  fallbackReason?: string;
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
    const evidenceText = JSON.stringify(compactEvidence(evidence));
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
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    throw new Error(errors.join(' | '));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log.warn('Ollama analysis unavailable; using deterministic fallback', reason);
    return { analysis: fallback, used: false, fallbackReason: reason };
  } finally {
    clearTimeout(timeout);
  }
}
