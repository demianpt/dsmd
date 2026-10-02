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
  const hasMobile = evidence.coverage.viewports.includes('mobile');
  const hasInteractions = evidence.interactions.some((item) => item.hoverDiff || item.focusDiff);
  const hasResponsiveComparisons = Boolean(evidence.responsiveComparisons?.length);
  const componentGuidance = evidence.components.slice(0, 18).map((component, index) => {
    const anatomy = [
      component.samples.some((item) => item.heading) ? 'Heading or labelled content region' : '',
      component.samples.some((item) => (item.imageCount || 0) > 0) ? 'Media region' : '',
      component.samples.some((item) => (item.interactiveDescendants || 0) > 0) ? 'Interactive action region' : ''
    ].filter(Boolean);
    const confidence = component.pages.length > 1 || component.count > 2 ? 'high' : 'medium';
    return {
      name: component.name,
      purpose: `Reusable ${component.name.toLowerCase()} pattern observed across ${component.pages.length} scanned page${component.pages.length === 1 ? '' : 's'}.`,
      rules: [
        'Recreate the measured typography, spacing, color and geometry rather than approximating them.',
        'Keep behavior consistent across every page template where this pattern appears.',
        component.samples.some((item) => item.heading)
          ? 'Preserve the observed hierarchy between heading, supporting copy and actions.'
          : 'Preserve the observed content density and alignment.'
      ],
      anatomy,
      variants: component.pages.length > 1 ? ['Compare page examples before treating visual differences as variants.'] : [],
      states: /button|form|navigation|accordion|tabs|modal/i.test(component.name) && hasInteractions
        ? ['Implement the measured hover and focus treatments for interactive descendants.']
        : [],
      responsiveBehavior: hasResponsiveComparisons && component.viewports?.includes('mobile')
        ? ['Use the paired desktop/mobile evidence to reproduce reflow and visibility changes.']
        : [],
      avoid: ['Do not generalize a one-off descendant style into the component contract.'],
      evidence: [`component-${String(index + 1).padStart(2, '0')}`],
      confidence: confidence as 'high' | 'medium'
    };
  });

  const principleDetails: NonNullable<AiAnalysis['principleDetails']> = [
    {
      title: 'Measured decisions first',
      principle: 'Treat rendered evidence as the authority for implementation decisions.',
      rationale: 'Computed styles and layout measurements are more reliable than visual estimation.',
      evidence: ['coverage-01', evidence.layouts.length ? 'layout-01' : 'source-01'],
      implementation: 'Resolve uncertain values in evidence.json before introducing a new token.',
      confidence: 'high'
    },
    {
      title: 'Hierarchy before decoration',
      principle: 'Preserve the measured information hierarchy before adding expressive detail.',
      rationale: 'Type roles, spacing and composition establish the page structure that decoration supports.',
      evidence: [evidence.typography.length ? 'type-01' : 'source-01', evidence.sections.length ? 'section-01' : 'coverage-01'],
      implementation: 'Build headings, reading order and section rhythm before surface polish.',
      confidence: evidence.typography.length && evidence.sections.length ? 'high' : 'medium'
    },
    {
      title: 'Reuse recurring tokens',
      principle: 'Promote recurring values into shared primitives and keep rare values contextual.',
      rationale: 'Frequency separates system decisions from page-specific exceptions.',
      evidence: [evidence.spacing.length ? 'spacing-01' : 'coverage-01', evidence.colors.length ? 'color-01' : 'source-01'],
      implementation: 'Create semantic aliases only after confirming repeated contexts.',
      confidence: 'high'
    },
    {
      title: 'Composition has intent',
      principle: 'Keep constrained reading areas distinct from full-width and media-led regions.',
      rationale: 'Collapsing every region into one container erases the source composition.',
      evidence: [evidence.layouts.length ? 'layout-01' : 'coverage-01', evidence.maxWidths.length ? 'width-01' : 'source-01'],
      implementation: 'Model page shells and section containers as separate layout contracts.',
      confidence: evidence.layouts.length ? 'high' : 'medium'
    },
    {
      title: 'Components follow evidence',
      principle: 'Define component boundaries from recurring structure rather than visual resemblance alone.',
      rationale: 'Measured anatomy and repeated contexts reduce false component abstractions.',
      evidence: [evidence.components.length ? 'component-01' : 'coverage-01'],
      implementation: 'Document anatomy, variants and states only when their evidence is present.',
      confidence: evidence.components.length ? 'high' : 'low'
    },
    {
      title: 'Responsive behavior is comparative',
      principle: 'Derive responsive rules from paired viewport changes, not desktop scaling assumptions.',
      rationale: 'Real interfaces reflow, hide and regroup content at different widths.',
      evidence: [hasResponsiveComparisons ? 'responsive-01' : 'coverage-01'],
      implementation: 'Test the same route at each measured viewport and reproduce structural changes.',
      confidence: hasResponsiveComparisons ? 'high' : 'low'
    },
    {
      title: 'States belong to the system',
      principle: 'Treat interaction and semantic states as part of each component contract.',
      rationale: 'A static visual match is incomplete when controls change on hover, focus or selection.',
      evidence: [evidence.interactions.length ? 'interaction-01' : 'coverage-01'],
      implementation: 'Verify every captured state independently, including keyboard focus.',
      confidence: hasInteractions ? 'high' : 'low'
    }
  ];

  const guidancePairs: Array<{
    category: NonNullable<AiAnalysis['doDetails']>[number]['category'];
    do: string;
    dont: string;
    rationale: string;
    evidence: string[];
    confidence: 'high' | 'medium' | 'low';
  }> = [
    { category: 'color', do: 'Use recurring colors according to their measured channels and contexts.', dont: 'Do not assign brand meaning from frequency alone.', rationale: 'Area, channel and context reveal how a color actually functions.', evidence: [evidence.colors.length ? 'color-01' : 'coverage-01'], confidence: evidence.colors.length ? 'high' : 'low' },
    { category: 'typography', do: 'Implement each type role as a complete style token.', dont: 'Do not copy font size while ignoring weight, leading, tracking or transform.', rationale: 'The typography system is the combination of all measured properties.', evidence: [evidence.typography.length ? 'type-01' : 'coverage-01'], confidence: evidence.typography.length ? 'high' : 'low' },
    { category: 'spacing', do: 'Use frequent small values inside components and recurring larger values between sections.', dont: 'Do not promote isolated spacing outliers into the global scale.', rationale: 'Frequency and context distinguish rhythm from exceptions.', evidence: [evidence.spacing.length ? 'spacing-01' : 'coverage-01'], confidence: evidence.spacing.length ? 'high' : 'low' },
    { category: 'layout', do: 'Recreate container, gutter and grid behavior before styling modules.', dont: 'Do not flatten full-width, constrained and media-led regions into one layout.', rationale: 'Page composition depends on relationships between distinct layout modes.', evidence: [evidence.layouts.length ? 'layout-01' : 'coverage-01'], confidence: evidence.layouts.length ? 'high' : 'low' },
    { category: 'responsive', do: 'Use paired viewport evidence to reproduce reflow and visibility changes.', dont: 'Do not infer mobile behavior by proportionally shrinking desktop.', rationale: 'Responsive structure is demonstrated by cross-viewport differences.', evidence: [hasResponsiveComparisons ? 'responsive-01' : 'coverage-01'], confidence: hasResponsiveComparisons ? 'high' : 'low' },
    { category: 'imagery', do: 'Preserve observed crop ratios and object-fit behavior by image role.', dont: 'Do not replace deliberate full-bleed media with generic thumbnails.', rationale: 'Image proportion and cropping contribute to the visual hierarchy.', evidence: [evidence.images.length ? 'image-01' : 'coverage-01'], confidence: evidence.images.length ? 'high' : 'low' },
    { category: 'motion', do: 'Reuse measured hover, focus and transition behavior.', dont: 'Do not add unrelated movement or remove visible focus treatment.', rationale: 'Interaction evidence defines the motion vocabulary without guesswork.', evidence: [evidence.interactions.length ? 'interaction-01' : evidence.transitions.length ? 'motion-01' : 'coverage-01'], confidence: hasInteractions ? 'high' : evidence.transitions.length ? 'medium' : 'low' },
    { category: 'components', do: 'Build shared patterns from repeated anatomy and page contexts.', dont: 'Do not convert every visually similar region into one generic card.', rationale: 'Component boundaries should reflect structure and repeated use.', evidence: [evidence.components.length ? 'component-01' : 'coverage-01'], confidence: evidence.components.length ? 'high' : 'low' },
    { category: 'accessibility', do: 'Preserve semantic control states and verify keyboard focus independently.', dont: 'Do not claim accessibility from visual evidence or remove state cues.', rationale: 'The scan captures some states but cannot certify the complete experience.', evidence: [evidence.interactions.length ? 'interaction-01' : 'coverage-01'], confidence: evidence.interactions.length ? 'medium' : 'low' }
  ];

  const qualityChecklist: NonNullable<AiAnalysis['qualityChecklist']> = guidancePairs.map((item) => ({
    category: item.category,
    check: `Verify that the implementation follows this ${item.category} contract: ${item.do}`,
    evidence: item.evidence[0]
  }));

  const coverageConfidence = evidence.coverage.failures.length
    ? 'medium'
    : hasMobile && evidence.coverage.selectedUrls.length > 1
      ? 'high'
      : 'medium';

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
    designPrinciples: principleDetails.map((item) => item.principle),
    dos: guidancePairs.map((item) => item.do),
    donts: guidancePairs.map((item) => item.dont),
    implementationNotes: [
      'Start with the generated tokens.css file, then map semantic aliases to the measured primitives.',
      'Build shared shell components before page-specific modules.',
      'Use evidence.json when an implementation decision requires provenance or frequency.',
      'Validate final pages against the stored desktop and mobile screenshots.'
    ],
    principleDetails,
    doDetails: guidancePairs.map((item) => ({ category: item.category, rule: item.do, rationale: item.rationale, evidence: item.evidence, confidence: item.confidence })),
    dontDetails: guidancePairs.map((item) => ({ category: item.category, rule: item.dont, rationale: item.rationale, evidence: item.evidence, confidence: item.confidence })),
    qualityChecklist,
    coverageAssessment: {
      confidence: coverageConfidence,
      strengths: [
        'Rendered DOM and computed-style evidence were captured for every successful page view.',
        ...(hasMobile ? ['Desktop and mobile evidence can be compared directly.'] : []),
        ...(hasInteractions ? ['Representative hover and focus differences were measured.'] : [])
      ],
      gaps: [
        ...(evidence.coverage.failures.length ? ['Some requested page views did not complete.'] : []),
        ...(!hasMobile ? ['No paired mobile render was available.'] : []),
        ...(!hasInteractions ? ['Interaction-state evidence was limited.'] : []),
        'Authenticated, destructive and user-specific runtime states were not triggered.'
      ]
    }
  };
}
