import type { AggregatedEvidence, AiAnalysis } from '../types/domain.js';

function px(value: string): number {
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function brightness(hex: string): number | null {
  const match = hex.match(/^#([0-9A-F]{6})/i);
  if (!match) return null;
  const value = match[1];
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000;
}

export function createFallbackAnalysis(evidence: AggregatedEvidence): AiAnalysis {
  const topColors = evidence.colors.slice(0, 8);
  const brightnesses = topColors
    .map((color) => brightness(color.normalized))
    .filter((value): value is number => value !== null);
  const averageBrightness = brightnesses.length
    ? brightnesses.reduce((sum, value) => sum + value, 0) / brightnesses.length
    : 128;
  const typeSizes = evidence.typography.map((item) => px(item.size)).filter(Boolean);
  const typeRange = typeSizes.length ? Math.max(...typeSizes) - Math.min(...typeSizes) : 0;
  const spacingValues = evidence.spacing.map((item) => px(item.value)).filter(Boolean);
  const generousSpacing = spacingValues.some((value) => value >= 64);
  const personality = [
    averageBrightness < 105 ? 'Dark, contrast-led surface system' : averageBrightness > 185 ? 'Light, open surface system' : 'Balanced neutral surface system',
    typeRange >= 40 ? 'Expressive typographic hierarchy' : 'Controlled typographic hierarchy',
    generousSpacing ? 'Generous section rhythm' : 'Compact, systematic spacing',
    evidence.radii.some((item) => px(item.value) >= 20) ? 'Soft, rounded interface geometry' : 'Restrained interface geometry'
  ];

  const topFamilies = [...new Set(evidence.typography.map((item) => item.family))].slice(0, 3);
  const componentGuidance = evidence.components.slice(0, 18).map((component) => ({
    name: component.name,
    purpose: `Reusable ${component.name.toLowerCase()} pattern observed across ${component.pages.length} scanned page${component.pages.length === 1 ? '' : 's'}.`,
    rules: [
      'Recreate the measured typography, spacing, color and geometry rather than approximating them.',
      'Keep behavior consistent across every page template where this pattern appears.',
      component.samples.some((sample) => sample.heading)
        ? 'Preserve the observed hierarchy between heading, supporting copy and actions.'
        : 'Preserve the observed content density and alignment.'
    ]
  }));

  return {
    overview: `${evidence.source.title} uses a repeatable visual system measured across ${evidence.coverage.selectedUrls.length} representative page${evidence.coverage.selectedUrls.length === 1 ? '' : 's'} and ${evidence.coverage.scannedPageViews} rendered viewport${evidence.coverage.scannedPageViews === 1 ? '' : 's'}. The system is defined by its recurring color hierarchy, ${topFamilies.length ? `the ${topFamilies.join(', ')} type stack,` : 'typographic hierarchy,'} consistent spacing rhythm and reusable page components.`,
    visualPersonality: personality,
    colorStrategy: 'Use the dominant surfaces as the page foundation, reserve high-contrast colors for text and actions, and apply less frequent colors only in the contexts where they were measured.',
    typographyStrategy: 'Map the most frequent text styles to body and utility roles, then use the largest measured styles for display and section hierarchy. Keep family, weight, line-height and tracking together as one token.',
    spacingStrategy: 'Build spacing from the recurring measured values. Use smaller tokens inside components and larger recurring values to separate sections and major content groups.',
    layoutStrategy: 'Recreate the measured container widths, horizontal gutters and grid definitions before styling individual modules. Full-width media and constrained reading columns should remain distinct.',
    responsiveStrategy: 'Treat the extracted media queries and cross-viewport differences as the source of truth. Reflow components only where the scan demonstrates a breakpoint or a clear layout change.',
    imageryStrategy: 'Match the observed crop ratios, object-fit behavior, scale and relationship between images and adjacent copy. Do not replace deliberate full-bleed imagery with generic card thumbnails.',
    motionStrategy: evidence.interactions.length
      ? 'Use the measured hover and focus differences as the interaction vocabulary. Keep transitions purposeful and avoid introducing unrelated effects.'
      : 'Motion evidence was limited, so keep transitions restrained and preserve only explicitly measured behavior.',
    componentGuidance,
    designPrinciples: [
      'Measured evidence outranks visual guesswork.',
      'Preserve hierarchy before adding decoration.',
      'Reuse recurring tokens instead of creating near-duplicates.',
      'Keep page templates visually related while preserving their content-specific composition.',
      'Maintain the observed relationship between full-width and constrained content.'
    ],
    dos: [
      'Use the extracted CSS variables when they correspond to repeated visual decisions.',
      'Implement typography as complete style tokens, not font size alone.',
      'Test representative templates at every scanned viewport.',
      'Reuse the documented components and interaction states consistently.',
      'Keep image ratios and cropping behavior aligned with the source system.'
    ],
    donts: [
      'Do not invent colors, breakpoints, spacing values or font styles that were not observed.',
      'Do not flatten every section into the same generic card layout.',
      'Do not infer responsive behavior from desktop screenshots alone.',
      'Do not replace the measured focus treatment with an inaccessible default or remove it.',
      'Do not treat one exceptional value as a global token without supporting frequency.'
    ],
    implementationNotes: [
      'Start with the generated tokens.css file, then map semantic aliases to the measured primitives.',
      'Build shared shell components before page-specific modules.',
      'Use evidence.json when an implementation decision requires provenance or frequency.',
      'Validate final pages against the stored desktop and mobile screenshots.'
    ]
  };
}
