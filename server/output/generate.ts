import type {
  AggregatedEvidence,
  AiAnalysis,
  ColorEvidence,
  ComponentEvidence,
  CountedValue,
  TypographyEvidence
} from '../types/domain.js';
import { escapeMarkdown, titleCase, unique } from '../lib/text.js';

function numeric(value: string): number {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : Number.POSITIVE_INFINITY;
}

function luminance(hex: string): number | null {
  const match = hex.match(/^#([0-9A-F]{6})/i);
  if (!match) return null;
  const channels = [0, 2, 4].map((offset) => Number.parseInt(match[1].slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function colorRole(color: ColorEvidence, index: number): string {
  const channels = color.channels;
  const lum = luminance(color.normalized);
  if (channels.includes('background') && color.areaScore >= 0.5) {
    if (lum !== null && lum < 0.12) return 'Dark surface';
    if (lum !== null && lum > 0.82) return 'Light surface';
    return 'Surface';
  }
  if (channels.includes('text') && !channels.includes('background')) {
    if (lum !== null && lum < 0.2) return 'Dark text';
    if (lum !== null && lum > 0.8) return 'Light text';
    return 'Text / muted text';
  }
  if (channels.includes('border') && color.count > 2) return 'Border / divider';
  if (channels.includes('fill') || channels.includes('stroke')) return 'Icon / graphic';
  return index < 4 ? 'Core palette' : 'Supporting color';
}

function topPalette(evidence: AggregatedEvidence): ColorEvidence[] {
  const result: ColorEvidence[] = [];
  for (const color of evidence.colors) {
    if (result.some((item) => item.normalized === color.normalized)) continue;
    result.push(color);
    if (result.length >= 14) break;
  }
  return result;
}

function primaryFontFamilies(evidence: AggregatedEvidence): string[] {
  const frequencies = new Map<string, number>();
  for (const style of evidence.typography) {
    const family = style.family.trim();
    if (!family) continue;
    frequencies.set(family, (frequencies.get(family) || 0) + style.count);
  }
  return [...frequencies.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([family]) => family)
    .slice(0, 5);
}

function typographyRole(style: TypographyEvidence, index: number): string {
  const tags = new Set(style.tags);
  if (tags.has('h1')) return 'Primary display / H1';
  if (tags.has('h2')) return 'Section heading / H2';
  if (tags.has('h3')) return 'Subheading / H3';
  if (tags.has('h4') || tags.has('h5') || tags.has('h6')) return 'Minor heading';
  if (tags.has('button')) return 'Button label';
  if (tags.has('label')) return 'Form / utility label';
  if (tags.has('p') || tags.has('li')) return index < 5 ? 'Lead / body' : 'Body / supporting copy';
  if (tags.has('a')) return 'Navigation / link';
  return index === 0 ? 'Display' : 'Supporting text';
}

function selectedTypography(evidence: AggregatedEvidence): TypographyEvidence[] {
  const sorted = [...evidence.typography].sort((a, b) => {
    const sizeDifference = numeric(b.size) - numeric(a.size);
    if (Math.abs(sizeDifference) > 0.1) return sizeDifference;
    return b.count - a.count;
  });
  const selected: TypographyEvidence[] = [];
  const signatures = new Set<string>();
  for (const style of sorted) {
    const signature = `${style.family}|${style.size}|${style.weight}|${style.lineHeight}|${style.letterSpacing}`;
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    selected.push(style);
    if (selected.length >= 16) break;
  }
  return selected;
}

function selectedScale(values: CountedValue[], max = 16): CountedValue[] {
  const uniqueValues = new Map<string, CountedValue>();
  for (const item of values) {
    const key = item.value.trim().toLowerCase();
    if (!key || uniqueValues.has(key)) continue;
    uniqueValues.set(key, item);
  }
  return [...uniqueValues.values()]
    .sort((a, b) => numeric(a.value) - numeric(b.value))
    .slice(0, max);
}

function ratioLabel(ratio: number): string {
  const known: Array<[number, string]> = [
    [1, '1:1'],
    [4 / 3, '4:3'],
    [3 / 2, '3:2'],
    [16 / 9, '16:9'],
    [3 / 4, '3:4'],
    [2 / 3, '2:3'],
    [9 / 16, '9:16'],
    [21 / 9, '21:9']
  ];
  const nearest = known.reduce((best, item) =>
    Math.abs(item[0] - ratio) < Math.abs(best[0] - ratio) ? item : best
  );
  return Math.abs(nearest[0] - ratio) < 0.08 ? nearest[1] : ratio.toFixed(2);
}

function imageRatios(evidence: AggregatedEvidence): Array<{ ratio: string; count: number }> {
  const counts = new Map<string, number>();
  for (const image of evidence.images) {
    if (!image.ratio || image.width < 60 || image.height < 60) continue;
    const label = ratioLabel(image.ratio);
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([ratio, count]) => ({ ratio, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

function componentNarrative(component: ComponentEvidence, analysis: AiAnalysis): string[] {
  const match = analysis.componentGuidance.find(
    (item) => item.name.toLowerCase() === component.name.toLowerCase()
  );
  if (match) return [match.purpose, ...match.rules];
  return [
    `Observed on ${component.pages.length} representative page${component.pages.length === 1 ? '' : 's'}.`,
    'Use the measured tokens and preserve the hierarchy visible in the stored screenshots.'
  ];
}

function lineList(items: string[]): string {
  return items.map((item) => `- ${item}`).join('\n');
}

function renderCoverage(evidence: AggregatedEvidence): string {
  const lines = evidence.coverage.selectedUrls.map((url, index) => `${index + 1}. ${url}`);
  return lines.join('\n');
}

export function generateDesignMd(evidence: AggregatedEvidence, analysis: AiAnalysis): string {
  const colors = topPalette(evidence);
  const typography = selectedTypography(evidence);
  const spacing = selectedScale(evidence.spacing, 18);
  const radii = selectedScale(evidence.radii, 12);
  const ratios = imageRatios(evidence);
  const components = evidence.components.slice(0, 24);
  const families = primaryFontFamilies(evidence);

  const colorRows = colors
    .map((color, index) => {
      const channels = color.channels.join(', ');
      return `| \`color-${String(index + 1).padStart(2, '0')}\` | \`${escapeMarkdown(color.normalized)}\` | ${colorRole(color, index)} | ${escapeMarkdown(channels)} | ${color.count} |`;
    })
    .join('\n');

  const typographyRows = typography
    .map((style, index) =>
      `| ${typographyRole(style, index)} | ${escapeMarkdown(style.family)} | \`${style.size}\` | \`${style.weight}\` | \`${style.lineHeight}\` | \`${style.letterSpacing}\` | ${style.viewports.join(', ')} |`
    )
    .join('\n');

  const spacingRows = spacing
    .map(
      (item, index) =>
        `| \`space-${String(index + 1).padStart(2, '0')}\` | \`${item.value}\` | ${item.count} | ${escapeMarkdown((item.contexts || []).slice(0, 4).join(', ') || 'Measured spacing')} |`
    )
    .join('\n');

  const radiusRows = radii.length
    ? radii
        .map(
          (item, index) =>
            `| \`radius-${String(index + 1).padStart(2, '0')}\` | \`${item.value}\` | ${item.count} | ${escapeMarkdown((item.contexts || []).slice(0, 4).join(', '))} |`
        )
        .join('\n')
    : '| — | No recurring non-zero radius was measured | — | The system may favor square geometry |';

  const breakpointRows = evidence.breakpoints.length
    ? evidence.breakpoints
        .slice(0, 24)
        .map(
          (item) =>
            `| \`${escapeMarkdown(item.query)}\` | ${escapeMarkdown(item.values.join(', ') || 'Conditional rule')} | ${item.count} |`
        )
        .join('\n')
    : '| — | No accessible media-query values were recovered | — |';

  const layoutRows = evidence.layouts
    .slice(0, 30)
    .map(
      ({ page, viewport, layout }) =>
        `| ${viewport} | ${new URL(page).pathname || '/'} | \`${layout.viewportWidth}px\` | \`${layout.documentHeight}px\` | \`${escapeMarkdown(layout.bodyBackground)}\` | ${escapeMarkdown(layout.maxContentWidths.slice(0, 3).map((item) => item.value).join(', ') || 'none detected')} |`
    )
    .join('\n');

  const componentSections = components
    .map((component) => {
      const notes = componentNarrative(component, analysis);
      const samples = component.samples
        .filter((sample) => sample.heading || sample.classHint)
        .slice(0, 3)
        .map((sample) => {
          const detail = sample.heading || sample.classHint || sample.selector || 'Observed instance';
          return `- ${escapeMarkdown(detail)} — ${sample.page}`;
        })
        .join('\n');
      return `### ${component.name}

**Evidence:** ${component.count} matched instance${component.count === 1 ? '' : 's'} across ${component.pages.length} scanned page${component.pages.length === 1 ? '' : 's'}.

${lineList(notes)}
${samples ? `\n**Observed examples**\n\n${samples}` : ''}`;
    })
    .join('\n\n');

  // `titleCase(tag)` alone renders an anchor as "A"; name the role instead.
  const interactionTagLabel: Record<string, string> = {
    a: 'Link',
    button: 'Button',
    select: 'Select',
    input: 'Input',
    textarea: 'Textarea',
    summary: 'Disclosure'
  };
  const seenInteractionSelectors = new Set<string>();
  const interactionSections = evidence.interactions
    .filter((item) => item.hoverDiff || item.focusDiff)
    // The selector is the stable identity here; `label` is the element's own
    // text, which repeats across nav items and yields headings like "### A".
    .filter((item) => {
      if (seenInteractionSelectors.has(item.selector)) return false;
      seenInteractionSelectors.add(item.selector);
      return true;
    })
    .slice(0, 12)
    .map((item) => {
      const hover = item.hoverDiff
        ? Object.entries(item.hoverDiff)
            .map(([key, value]) => `- Hover ${key}: \`${escapeMarkdown(value.from)}\` → \`${escapeMarkdown(value.to)}\``)
            .join('\n')
        : '- No measurable hover change captured.';
      const focus = item.focusDiff
        ? Object.entries(item.focusDiff)
            .map(([key, value]) => `- Focus ${key}: \`${escapeMarkdown(value.from)}\` → \`${escapeMarkdown(value.to)}\``)
            .join('\n')
        : '- No measurable focus change captured.';
      const sample = (item.label || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      return `### ${interactionTagLabel[item.tag] || titleCase(item.tag)} — \`${escapeMarkdown(item.selector)}\`
${sample ? `\nSample content: "${escapeMarkdown(sample)}"\n` : ''}
${hover}
${focus}`;
    })
    .join('\n\n');

  const customVariables = evidence.cssVariables
    .slice(0, 60)
    .map((item) => `| \`${escapeMarkdown(item.name)}\` | \`${escapeMarkdown(item.value)}\` | ${item.count} |`)
    .join('\n');

  const shadowRows = evidence.shadows.length
    ? evidence.shadows
        .slice(0, 12)
        .map((item, index) => `| \`shadow-${String(index + 1).padStart(2, '0')}\` | \`${escapeMarkdown(item.value)}\` | ${item.count} |`)
        .join('\n')
    : '| — | No recurring box shadow was measured | — |';

  const transitionRows = evidence.transitions.length
    ? evidence.transitions
        .slice(0, 12)
        .map((item, index) => `| \`motion-${String(index + 1).padStart(2, '0')}\` | \`${escapeMarkdown(item.value)}\` | ${item.count} |`)
        .join('\n')
    : '| — | No recurring transition shorthand was measured | — |';

  const ratioRows = ratios.length
    ? ratios.map((item) => `| \`${item.ratio}\` | ${item.count} |`).join('\n')
    : '| — | No stable raster-image ratio was detected |';

  const failureNote = evidence.coverage.failures.length
    ? `\n> ${evidence.coverage.failures.length} requested page view${evidence.coverage.failures.length === 1 ? '' : 's'} could not be measured. See **Scan limitations** at the end of this document.\n`
    : '';

  return `# DESIGN.md — ${evidence.source.title}

> Generated from live browser measurements by MyOwnDesignMD on ${new Date(evidence.generatedAt).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' })} UTC. Exact values below come from rendered DOM/CSS evidence, not screenshot guesses.

## 1. Source and coverage

- **Website:** ${evidence.source.canonicalUrl}
- **Domain:** ${evidence.source.domain}
- **Mode:** ${evidence.coverage.multiPage ? 'Multi-page design-system scan' : 'Single-page scan'}
- **Representative URLs selected:** ${evidence.coverage.selectedUrls.length}
- **Rendered page/viewport combinations:** ${evidence.coverage.scannedPageViews}
- **Viewports measured:** ${evidence.coverage.viewports.join(', ')}
- **Candidate URLs discovered:** ${evidence.coverage.candidateUrls}
${failureNote}
### Representative pages

${renderCoverage(evidence)}

## 2. Design overview

${analysis.overview}

### Visual personality

${lineList(analysis.visualPersonality)}

### Core principles

${lineList(analysis.designPrinciples)}

## 3. Color system

${analysis.colorStrategy}

| Token | Measured value | Probable role | Observed channels | Frequency |
|---|---|---|---|---:|
${colorRows}

### Color implementation rules

- Use the values above as primitives; introduce semantic aliases such as \`--color-surface\`, \`--color-text\` and \`--color-action\` only after confirming their observed contexts.
- Frequency indicates repeated use, not brand importance by itself. Area score and channel context are also represented in \`evidence.json\`.
- Alpha-bearing hex values preserve measured transparency.

## 4. Typography

${analysis.typographyStrategy}

**Primary measured font stacks:** ${families.length ? families.map((family) => `\`${escapeMarkdown(family)}\``).join(', ') : 'No stable family could be recovered.'}

| Probable role | Font family / stack | Size | Weight | Line height | Letter spacing | Viewports |
|---|---|---:|---:|---:|---:|---|
${typographyRows}

### Font-face evidence

${evidence.fontFaces.length ? evidence.fontFaces.slice(0, 24).map((font) => `- **${escapeMarkdown(font.family)}** — weight \`${font.weight || 'unspecified'}\`, style \`${font.style || 'unspecified'}\`${font.source ? `; source: \`${escapeMarkdown(font.source)}\`` : ''}`).join('\n') : '- No accessible `@font-face` declarations were recovered. The computed font stacks above remain authoritative.'}

### Typography implementation rules

- Treat family, size, weight, line-height, tracking and transform as a single style token.
- Use element tags and text samples in \`evidence.json\` to resolve ambiguous roles.
- Preserve responsive style changes instead of scaling every text style proportionally.

## 5. Spacing system

${analysis.spacingStrategy}

| Token | Measured value | Frequency | Common source properties |
|---|---:|---:|---|
${spacingRows}

Use frequent smaller values for internal component rhythm and larger recurring values for section separation. Do not promote a rare outlier to the global scale without checking its page context.

## 6. Layout and composition

${analysis.layoutStrategy}

| Viewport | Page path | Viewport width | Document height | Body background | Measured max-widths |
|---|---|---:|---:|---|---|
${layoutRows}

### Grid definitions

${evidence.gridColumns.length ? evidence.gridColumns.slice(0, 14).map((item) => `- \`${escapeMarkdown(item.value)}\` — ${item.count} occurrence${item.count === 1 ? '' : 's'}`).join('\n') : '- No stable CSS Grid template was recovered. Inspect flex and absolute layouts in the screenshots and page evidence.'}

### Responsive strategy

${analysis.responsiveStrategy}

## 7. Breakpoints and conditional CSS

| Media query | Extracted threshold(s) | Frequency |
|---|---|---:|
${breakpointRows}

Media queries are recorded from accessible CSSOM and captured stylesheet responses. A missing rule does not prove that the source website has no breakpoint; cross-origin, dynamically generated or blocked styles may be absent.

## 8. Geometry, borders and elevation

### Border radius

| Token | Value | Frequency | Common contexts |
|---|---:|---:|---|
${radiusRows}

### Borders

${evidence.borders.length ? evidence.borders.slice(0, 14).map((item) => `- \`${escapeMarkdown(item.value)}\` — ${item.count} occurrence${item.count === 1 ? '' : 's'}`).join('\n') : '- No recurring visible border shorthand was measured.'}

### Shadows

| Token | Value | Frequency |
|---|---|---:|
${shadowRows}

## 9. Imagery

${analysis.imageryStrategy}

| Common displayed ratio | Observed images |
|---|---:|
${ratioRows}

- Preserve \`object-fit\` behavior and crop intent from the per-image evidence.
- Treat full-bleed media separately from content thumbnails and icons.
- Screenshots are visual references; measured dimensions and ratios in \`evidence.json\` are the implementation source of truth.

## 10. Motion and interaction

${analysis.motionStrategy}

### Transition tokens

| Token | Measured transition | Frequency |
|---|---|---:|
${transitionRows}

${interactionSections || 'No reliable state difference was captured from the sampled interactive controls. Inspect source CSS before introducing new hover or focus behavior.'}

## 11. Components and recurring patterns

${componentSections || 'No recurring component signals were confidently detected. Use the section evidence and screenshots to identify page-specific modules.'}

## 12. Extracted CSS custom properties

These are source variables recovered from computed root styles, accessible CSSOM and captured stylesheet responses. They are preserved verbatim and may include implementation-only values.

| Variable | Value | Frequency |
|---|---|---:|
${customVariables || '| — | No CSS custom properties were recovered | — |'}

## 13. Do / Don't

### Do

${lineList(analysis.dos)}

### Don't

${lineList(analysis.donts)}

## 14. Implementation workflow

${lineList(analysis.implementationNotes)}

1. Load \`tokens.css\` and map the generated primitive tokens to semantic names.
2. Rebuild the shared shell: body surfaces, typography defaults, header, navigation and footer.
3. Implement the highest-frequency components before page-specific modules.
4. Recreate each representative template at the measured desktop and mobile viewports.
5. Compare against the stored screenshots and resolve differences using \`evidence.json\`.
6. Test focus, hover, reduced-motion and content-resizing behavior independently.

## 15. Scan limitations

${evidence.coverage.failures.length ? evidence.coverage.failures.map((failure) => `- **${failure.viewport}:** ${failure.url} — ${escapeMarkdown(failure.error)}`).join('\n') : '- All selected page views completed successfully.'}
- Content behind authentication, bot challenges, consent walls or geographic restrictions may be absent.
- Cross-origin stylesheets are captured from network responses where the browser makes them available; blocked resources cannot be inferred safely.
- Runtime states that require user-specific data or destructive interaction are intentionally not triggered.
- The document describes the measured implementation, not ownership of the source brand, assets or code.

---

### Machine-readable companions

- \`evidence.json\` — complete measured evidence and provenance
- \`tokens.css\` — generated primitive CSS variables
- \`screenshots/\` — captured visual references by page and viewport
`;
}

function safeCssValue(value: string): string {
  return value.replace(/[\r\n{};]/g, ' ').trim();
}

export function generateTokensCss(evidence: AggregatedEvidence): string {
  const colors = topPalette(evidence);
  const typography = selectedTypography(evidence);
  const spacing = selectedScale(evidence.spacing, 18);
  const radii = selectedScale(evidence.radii, 12);
  const shadows = evidence.shadows.slice(0, 10);
  const maxWidths = selectedScale(evidence.maxWidths, 10);
  const families = primaryFontFamilies(evidence);

  const lines: string[] = [
    '/*',
    ` * Generated by MyOwnDesignMD from ${evidence.source.canonicalUrl}`,
    ` * ${evidence.generatedAt}`,
    ' * Primitive measured tokens. Review evidence.json before assigning semantic aliases.',
    ' */',
    '',
    ':root {'
  ];

  colors.forEach((color, index) => {
    lines.push(`  --color-${String(index + 1).padStart(2, '0')}: ${safeCssValue(color.normalized)};`);
  });
  if (colors.length) lines.push('');
  families.forEach((family, index) => {
    lines.push(`  --font-family-${index + 1}: ${safeCssValue(family)};`);
  });
  if (families.length) lines.push('');
  typography.slice(0, 14).forEach((style, index) => {
    const token = String(index + 1).padStart(2, '0');
    lines.push(`  --type-${token}-size: ${safeCssValue(style.size)};`);
    lines.push(`  --type-${token}-weight: ${safeCssValue(style.weight)};`);
    lines.push(`  --type-${token}-line-height: ${safeCssValue(style.lineHeight)};`);
    lines.push(`  --type-${token}-letter-spacing: ${safeCssValue(style.letterSpacing)};`);
  });
  if (typography.length) lines.push('');
  spacing.forEach((item, index) => {
    lines.push(`  --space-${String(index + 1).padStart(2, '0')}: ${safeCssValue(item.value)};`);
  });
  if (spacing.length) lines.push('');
  radii.forEach((item, index) => {
    lines.push(`  --radius-${String(index + 1).padStart(2, '0')}: ${safeCssValue(item.value)};`);
  });
  if (radii.length) lines.push('');
  shadows.forEach((item, index) => {
    lines.push(`  --shadow-${String(index + 1).padStart(2, '0')}: ${safeCssValue(item.value)};`);
  });
  if (shadows.length) lines.push('');
  maxWidths.forEach((item, index) => {
    lines.push(`  --max-width-${String(index + 1).padStart(2, '0')}: ${safeCssValue(item.value)};`);
  });
  lines.push('}', '');
  return lines.join('\n');
}
