import type { Page } from 'playwright';
import type {
  InteractionStateEvidence,
  RawPageExtraction,
  ViewportName
} from '../types/domain.js';

export async function extractRenderedPage(
  page: Page,
  viewportName: ViewportName
): Promise<RawPageExtraction> {
  return page.evaluate(({ viewportName }: { viewportName: ViewportName }) => {
    const clean = (value: unknown, maxLength = 220): string =>
      String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);

    const isVisible = (element: Element): boolean => {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (Number(style.opacity) === 0) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0.5 && rect.height > 0.5;
    };

    const alphaVisible = (color: string): boolean => {
      if (!color || color === 'transparent') return false;
      const match = color.match(/rgba?\(([^)]+)\)/i);
      if (!match) return true;
      const parts = match[1].split(',').map((part) => part.trim());
      return parts.length < 4 || Number(parts[3]) > 0.01;
    };

    type CountRecord = { value: string; count: number; contexts: string[] };
    const counted = new Map<string, CountRecord>();
    const addCount = (group: string, value: string, context = ''): void => {
      const normalized = clean(value, 300);
      if (!normalized || normalized === 'none' || normalized === 'normal' || normalized === '0px') {
        return;
      }
      const key = `${group}\u0000${normalized}`;
      const current = counted.get(key) || { value: normalized, count: 0, contexts: [] };
      current.count += 1;
      if (context && current.contexts.length < 8 && !current.contexts.includes(context)) {
        current.contexts.push(context);
      }
      counted.set(key, current);
    };

    const getGroup = (group: string): CountRecord[] =>
      [...counted.entries()]
        .filter(([key]) => key.startsWith(`${group}\u0000`))
        .map(([, value]) => value)
        .sort((a, b) => b.count - a.count);

    type ColorRecord = {
      value: string;
      normalized: string;
      count: number;
      contexts: string[];
      channels: string[];
      areaScore: number;
    };
    const colorMap = new Map<string, ColorRecord>();
    const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
    const addColor = (
      value: string,
      channel: string,
      context: string,
      area = 0
    ): void => {
      const normalized = clean(value, 120);
      if (!alphaVisible(normalized)) return;
      const key = normalized.toLowerCase();
      const current = colorMap.get(key) || {
        value: normalized,
        normalized,
        count: 0,
        contexts: [],
        channels: [],
        areaScore: 0
      };
      current.count += 1;
      current.areaScore += Math.min(Math.max(0, area) / viewportArea, 2);
      if (current.contexts.length < 8 && context && !current.contexts.includes(context)) {
        current.contexts.push(context);
      }
      if (!current.channels.includes(channel)) current.channels.push(channel);
      colorMap.set(key, current);
    };

    type TypographyRecord = {
      family: string;
      size: string;
      weight: string;
      lineHeight: string;
      letterSpacing: string;
      textTransform: string;
      count: number;
      tags: string[];
      samples: string[];
      viewports: Array<'desktop' | 'tablet' | 'mobile'>;
    };
    const typographyMap = new Map<string, TypographyRecord>();

    type ComponentRecord = {
      name: string;
      count: number;
      pages: string[];
      viewports: ViewportName[];
      signals: string[];
      samples: Array<{
        page: string;
        selector?: string;
        heading?: string;
        classHint?: string;
        tag?: string;
        role?: string;
        width?: number;
        height?: number;
        display?: string;
        gridTemplateColumns?: string;
        flexDirection?: string;
        childTags?: string[];
        interactiveDescendants?: number;
        imageCount?: number;
        textLength?: number;
      }>;
    };
    const componentMap = new Map<string, ComponentRecord>();
    const componentRoots = new Map<string, Element[]>();
    const registerComponent = (
      name: string,
      element: Element,
      signal: string,
      selector = ''
    ): void => {
      const rootKey = name.toLowerCase();
      const roots = componentRoots.get(rootKey) || [];
      const current: ComponentRecord = componentMap.get(name) || {
        name,
        count: 0,
        pages: [location.href],
        viewports: [viewportName],
        signals: [],
        samples: []
      };
      if (!current.signals.includes(signal) && current.signals.length < 8) {
        current.signals.push(signal);
      }
      if (!current.viewports.includes(viewportName)) current.viewports.push(viewportName);
      // A semantic class is often repeated on every descendant. Count the
      // outer component boundary once while preserving all signals found on it.
      if (roots.some((root) => root === element || root.contains(element))) {
        componentMap.set(name, current);
        return;
      }
      roots.push(element);
      componentRoots.set(rootKey, roots);
      current.count += 1;
      if (current.samples.length < 5) {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const heading = clean(
          element.querySelector('h1,h2,h3,h4,[role="heading"]')?.textContent || '',
          100
        );
        const classHint = clean(element.getAttribute('class') || '', 120);
        const sample = {
          page: location.href,
          selector,
          heading,
          classHint,
          tag: element.tagName.toLowerCase(),
          role: clean(element.getAttribute('role') || '', 80),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          display: style.display,
          gridTemplateColumns: style.display === 'grid' ? style.gridTemplateColumns : '',
          flexDirection: style.display.includes('flex') ? style.flexDirection : '',
          childTags: [...element.children]
            .slice(0, 12)
            .map((child) => child.tagName.toLowerCase()),
          interactiveDescendants: element.querySelectorAll(
            'a[href],button,input,textarea,select,[role="button"]'
          ).length,
          imageCount: element.querySelectorAll('img,picture,video').length,
          textLength: clean(element.textContent || '', 5000).length
        };
        const signature = `${sample.selector}|${sample.heading}|${sample.classHint}`;
        if (
          !current.samples.some(
            (item) => `${item.selector}|${item.heading}|${item.classHint}` === signature
          )
        ) {
          current.samples.push(sample);
        }
      }
      componentMap.set(name, current);
    };

    const directText = (element: Element): string =>
      clean(
        [...element.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent || '')
          .join(' '),
        180
      );

    const selectorFor = (element: Element): string => {
      const id = element.getAttribute('id');
      if (id) return `#${CSS.escape(id)}`;
      const className = [...element.classList].slice(0, 2).map((name) => `.${CSS.escape(name)}`).join('');
      return `${element.tagName.toLowerCase()}${className}`.slice(0, 140);
    };

    const allElements = [...document.querySelectorAll('body *')].slice(0, 6000);
    let visibleCount = 0;
    for (const element of allElements) {
      if (visibleCount >= 4500 || !isVisible(element)) continue;
      visibleCount += 1;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const tag = element.tagName.toLowerCase();
      const classHint = clean(element.getAttribute('class') || '', 180).toLowerCase();
      const role = clean(element.getAttribute('role') || '', 80).toLowerCase();
      const context = `${tag}${classHint ? `.${classHint.split(' ').slice(0, 2).join('.')}` : ''}`;
      const area = rect.width * rect.height;

      const ownText = directText(element);
      if (ownText || ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'label', 'button', 'a'].includes(tag)) {
        const key = [
          style.fontFamily,
          style.fontSize,
          style.fontWeight,
          style.lineHeight,
          style.letterSpacing,
          style.textTransform
        ].join('\u0000');
        const current: TypographyRecord = typographyMap.get(key) || {
          family: clean(style.fontFamily, 180),
          size: style.fontSize,
          weight: style.fontWeight,
          lineHeight: style.lineHeight,
          letterSpacing: style.letterSpacing,
          textTransform: style.textTransform,
          count: 0,
          tags: [],
          samples: [],
          viewports: [viewportName]
        };
        current.count += 1;
        if (!current.tags.includes(tag) && current.tags.length < 8) current.tags.push(tag);
        const sampleText = clean(ownText || element.textContent || '', 100);
        if (sampleText && current.samples.length < 5 && !current.samples.includes(sampleText)) {
          current.samples.push(sampleText);
        }
        typographyMap.set(key, current);
        addColor(style.color, 'text', context, Math.min(area, viewportArea * 0.25));
      }

      addColor(style.backgroundColor, 'background', context, area);
      const borderSides = [
        [style.borderTopWidth, style.borderTopStyle, style.borderTopColor],
        [style.borderRightWidth, style.borderRightStyle, style.borderRightColor],
        [style.borderBottomWidth, style.borderBottomStyle, style.borderBottomColor],
        [style.borderLeftWidth, style.borderLeftStyle, style.borderLeftColor]
      ];
      for (const [width, borderStyle, borderColor] of borderSides) {
        if (Number.parseFloat(width) > 0 && borderStyle !== 'none') {
          addColor(borderColor, 'border', context, 0);
        }
      }
      const fill = style.getPropertyValue('fill');
      const stroke = style.getPropertyValue('stroke');
      if (fill && fill !== 'none') addColor(fill, 'fill', context, area);
      if (stroke && stroke !== 'none') addColor(stroke, 'stroke', context, 0);

      for (const property of [
        'margin-top',
        'margin-right',
        'margin-bottom',
        'margin-left',
        'padding-top',
        'padding-right',
        'padding-bottom',
        'padding-left',
        'gap',
        'row-gap',
        'column-gap'
      ]) {
        const value = style.getPropertyValue(property);
        const numeric = Number.parseFloat(value);
        if (Number.isFinite(numeric) && numeric > 0 && numeric <= 600) {
          addCount('spacing', value, property);
        }
      }

      const radiusValues = [
        style.borderTopLeftRadius,
        style.borderTopRightRadius,
        style.borderBottomRightRadius,
        style.borderBottomLeftRadius
      ];
      for (const value of radiusValues) {
        const numeric = Number.parseFloat(value);
        if (Number.isFinite(numeric) && numeric > 0) addCount('radii', value, context);
      }

      const borderWidth = Number.parseFloat(style.borderTopWidth);
      if (borderWidth > 0 && style.borderTopStyle !== 'none') {
        addCount(
          'borders',
          `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`,
          context
        );
      }
      if (style.boxShadow && style.boxShadow !== 'none') addCount('shadows', style.boxShadow, context);
      if (style.transition && style.transition !== 'all 0s ease 0s') {
        addCount('transitions', style.transition, context);
      }
      if (style.maxWidth && style.maxWidth !== 'none') {
        const numeric = Number.parseFloat(style.maxWidth);
        if (Number.isFinite(numeric) && numeric > 0 && numeric < 5000) {
          addCount('maxWidths', style.maxWidth, context);
        }
      }
      if (style.display === 'grid' && style.gridTemplateColumns !== 'none') {
        addCount('gridColumns', style.gridTemplateColumns, context);
      }

      if (tag === 'header') registerComponent('Header', element, '<header>', selectorFor(element));
      if (tag === 'nav') registerComponent('Navigation', element, '<nav>', selectorFor(element));
      if (tag === 'footer') registerComponent('Footer', element, '<footer>', selectorFor(element));
      if (tag === 'form') registerComponent('Form', element, '<form>', selectorFor(element));
      if (['input', 'textarea', 'select'].includes(tag)) {
        registerComponent('Form control', element, `<${tag}>`, selectorFor(element));
      }
      if (tag === 'details') registerComponent('Accordion / FAQ', element, '<details>', selectorFor(element));
      if (tag === 'dialog' || role === 'dialog') {
        registerComponent('Modal / drawer', element, 'dialog semantics', selectorFor(element));
      }
      if (tag === 'blockquote') {
        registerComponent('Testimonial', element, '<blockquote>', selectorFor(element));
      }
      if (tag === 'table') registerComponent('Table', element, '<table>', selectorFor(element));
      if (tag === 'video') registerComponent('Video', element, '<video>', selectorFor(element));
      if (
        tag === 'button' ||
        role === 'button' ||
        (tag === 'a' && /(?:^|\s)(?:btn|button|cta)(?:\s|$|-|_)/i.test(classHint))
      ) {
        registerComponent('Button', element, 'interactive button', selectorFor(element));
      }

      const semanticSignals: Array<[RegExp, string]> = [
        [/\bhero\b|masthead|banner/, 'Hero'],
        [/\bcard\b|tile/, 'Card'],
        [/testimonial|quote/, 'Testimonial'],
        [/accordion|faq/, 'Accordion / FAQ'],
        [/\btabs?\b|tablist/, 'Tabs'],
        [/pricing|price-card/, 'Pricing'],
        [/\bcta\b|call-to-action/, 'Call to action'],
        [/breadcrumb/, 'Breadcrumb'],
        [/modal|dialog|drawer/, 'Modal / drawer'],
        [/carousel|slider|swiper|splide/, 'Carousel / slider'],
        [/gallery|masonry/, 'Gallery'],
        [/logo-grid|logo-wall|clients|partners/, 'Logo wall'],
        [/features?|benefits?/, 'Feature section'],
        [/stats?|metrics?|counter/, 'Statistics'],
        [/newsletter|subscribe/, 'Newsletter'],
        [/team|people|authors?/, 'Team / people'],
        [/case-study|portfolio|project/, 'Case study / project'],
        [/product/, 'Product'],
        [/article|post|story/, 'Article / story'],
        [/pagination|pager/, 'Pagination'],
        [/social/, 'Social links'],
        [/search/, 'Search'],
        [/menu|mega-menu/, 'Menu']
      ];
      const semanticHaystack = `${classHint} ${clean(element.getAttribute('id') || '', 100)} ${role}`;
      for (const [pattern, name] of semanticSignals) {
        if (pattern.test(semanticHaystack)) registerComponent(name, element, 'class/id/role signal', selectorFor(element));
      }
    }

    const sectionCandidates = [
      ...document.querySelectorAll('main > section, main section, body > section, [data-section]')
    ];
    const sections = sectionCandidates
      .filter((element, index) => index < 80 && isVisible(element))
      .map((element, index) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const children = [...element.children].filter(isVisible);
        const rows = new Map<number, number>();
        for (const child of children) {
          const childRect = child.getBoundingClientRect();
          if (childRect.width < 60) continue;
          const row = Math.round(childRect.top / 12) * 12;
          rows.set(row, (rows.get(row) || 0) + 1);
        }
        const columns = Math.min(6, Math.max(1, ...rows.values(), 1));
        return {
          index,
          tag: element.tagName.toLowerCase(),
          classHint: clean(element.getAttribute('class') || '', 150),
          heading: clean(element.querySelector('h1,h2,h3,[role="heading"]')?.textContent || '', 130),
          textLength: clean(element.textContent || '', 5000).length,
          imageCount: element.querySelectorAll('img,picture,video').length,
          linkCount: element.querySelectorAll('a[href]').length,
          buttonCount: element.querySelectorAll('button,[role="button"]').length,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          columns,
          backgroundColor: style.backgroundColor
        };
      })
      .filter((section) => section.height >= 80)
      .slice(0, 50);

    const images = [...document.querySelectorAll('img')]
      .filter(isVisible)
      .slice(0, 120)
      .map((image) => {
        const rect = image.getBoundingClientRect();
        const style = getComputedStyle(image);
        return {
          src: clean((image as HTMLImageElement).currentSrc || (image as HTMLImageElement).src, 500),
          alt: clean((image as HTMLImageElement).alt, 180),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          ratio: rect.height > 0 ? Number((rect.width / rect.height).toFixed(3)) : 0,
          objectFit: style.objectFit,
          loading: (image as HTMLImageElement).loading || 'auto'
        };
      });

    const cssVariables = new Map<string, { name: string; value: string; count: number; sources: string[] }>();
    const cssMediaQueries = new Map<
      string,
      { query: string; values: string[]; count: number; sources: string[] }
    >();
    const fontFaces = new Map<string, { family: string; weight?: string; style?: string; source?: string }>();
    const stylesheetUrls: string[] = [];

    const rootStyle = getComputedStyle(document.documentElement);
    for (let index = 0; index < rootStyle.length; index += 1) {
      const name = rootStyle.item(index);
      if (!name.startsWith('--')) continue;
      const value = clean(rootStyle.getPropertyValue(name), 300);
      if (value) cssVariables.set(`${name}\u0000${value}`, { name, value, count: 1, sources: [':root computed'] });
    }

    const visitRules = (rules: CSSRuleList, source: string): void => {
      for (const rule of [...rules]) {
        const cssText = rule.cssText || '';
        const media = rule as CSSMediaRule;
        if ('conditionText' in media && typeof media.conditionText === 'string') {
          const query = clean(media.conditionText, 300);
          const values = [...query.matchAll(/(?:min|max)-(?:width|height)\s*:\s*([^\)]+)/gi)].map(
            (entry) => entry[1].trim()
          );
          const current = cssMediaQueries.get(query) || {
            query,
            values,
            count: 0,
            sources: []
          };
          current.count += 1;
          if (current.sources.length < 5 && !current.sources.includes(source)) current.sources.push(source);
          cssMediaQueries.set(query, current);
        }

        const styleRule = rule as CSSStyleRule;
        if ('style' in styleRule && styleRule.style) {
          for (let index = 0; index < styleRule.style.length; index += 1) {
            const name = styleRule.style.item(index);
            if (!name.startsWith('--')) continue;
            const value = clean(styleRule.style.getPropertyValue(name), 300);
            const key = `${name}\u0000${value}`;
            const current = cssVariables.get(key) || { name, value, count: 0, sources: [] };
            current.count += 1;
            if (current.sources.length < 5 && !current.sources.includes(source)) current.sources.push(source);
            cssVariables.set(key, current);
          }
        }

        if (/^@font-face/i.test(cssText)) {
          const family = clean(cssText.match(/font-family\s*:\s*([^;]+)/i)?.[1] || '', 160).replace(/^['"]|['"]$/g, '');
          const weight = clean(cssText.match(/font-weight\s*:\s*([^;]+)/i)?.[1] || '', 60);
          const fontStyle = clean(cssText.match(/font-style\s*:\s*([^;]+)/i)?.[1] || '', 60);
          const src = clean(cssText.match(/src\s*:\s*([^;]+)/i)?.[1] || '', 300);
          if (family) fontFaces.set(`${family}|${weight}|${fontStyle}`, { family, weight, style: fontStyle, source: src || source });
        }

        const nested = rule as CSSGroupingRule;
        if ('cssRules' in nested && nested.cssRules) {
          try {
            visitRules(nested.cssRules, source);
          } catch {
            // Ignore browser-restricted nested rules.
          }
        }
      }
    };

    for (const sheet of [...document.styleSheets]) {
      const source = sheet.href || '<inline stylesheet>';
      if (sheet.href && !stylesheetUrls.includes(sheet.href)) stylesheetUrls.push(sheet.href);
      try {
        if (sheet.cssRules) visitRules(sheet.cssRules, source);
      } catch {
        // Cross-origin stylesheets are additionally captured from Playwright network responses.
      }
    }

    for (const font of [...document.fonts]) {
      const family = clean(font.family, 160).replace(/^['"]|['"]$/g, '');
      if (family) {
        fontFaces.set(`${family}|${font.weight}|${font.style}`, {
          family,
          weight: font.weight,
          style: font.style,
          source: `FontFaceSet (${font.status})`
        });
      }
    }

    const metaDescription = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
    const canonicalUrl = document.querySelector('link[rel="canonical"]')?.getAttribute('href') || location.href;
    const icon =
      document.querySelector('link[rel="icon"],link[rel="shortcut icon"]')?.getAttribute('href') || '';

    const links = [...document.querySelectorAll('a[href]')]
      .map((link) => (link as HTMLAnchorElement).href)
      .filter(Boolean)
      .slice(0, 1000);

    const bodyStyle = getComputedStyle(document.body);
    const bodyRect = document.body.getBoundingClientRect();
    const maxWidths = getGroup('maxWidths').slice(0, 30);
    const maxContentWidths = maxWidths;
    const horizontalPaddings = getGroup('spacing')
      .filter((item) => item.contexts?.some((context) => context.includes('padding-left') || context.includes('padding-right')))
      .slice(0, 30);
    const sectionHeights = sections
      .map((section) => `${section.height}px`)
      .reduce<Map<string, CountRecord>>((map, value) => {
        const rounded = `${Math.round(Number.parseFloat(value) / 8) * 8}px`;
        const current = map.get(rounded) || { value: rounded, count: 0, contexts: [] };
        current.count += 1;
        map.set(rounded, current);
        return map;
      }, new Map());

    return {
      page: {
        url: location.href,
        title: clean(document.title, 240),
        description: clean(metaDescription, 500),
        canonicalUrl: clean(new URL(canonicalUrl, location.href).href, 600),
        lang: clean(document.documentElement.lang || '', 30),
        faviconUrl: icon ? clean(new URL(icon, location.href).href, 600) : ''
      },
      links,
      cssVariables: [...cssVariables.values()].sort((a, b) => b.count - a.count),
      colors: [...colorMap.values()].sort((a, b) => b.count + b.areaScore * 8 - (a.count + a.areaScore * 8)),
      typography: [...typographyMap.values()].sort((a, b) => b.count - a.count),
      spacing: getGroup('spacing'),
      radii: getGroup('radii'),
      borders: getGroup('borders'),
      shadows: getGroup('shadows'),
      transitions: getGroup('transitions'),
      maxWidths,
      gridColumns: getGroup('gridColumns'),
      components: [...componentMap.values()].sort((a, b) => b.count - a.count),
      sections,
      images,
      layout: {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        documentWidth: Math.round(Math.max(document.documentElement.scrollWidth, bodyRect.width)),
        documentHeight: Math.round(Math.max(document.documentElement.scrollHeight, bodyRect.height)),
        bodyBackground: bodyStyle.backgroundColor,
        bodyColor: bodyStyle.color,
        maxContentWidths,
        horizontalPaddings,
        gridColumns: getGroup('gridColumns').slice(0, 30),
        sectionHeights: [...sectionHeights.values()].sort((a, b) => b.count - a.count)
      },
      stylesheetUrls,
      cssMediaQueries: [...cssMediaQueries.values()].sort((a, b) => b.count - a.count),
      fontFaces: [...fontFaces.values()]
    };
  }, { viewportName });
}

const interactionProperties = [
  'color',
  'background-color',
  'border-color',
  'border-radius',
  'box-shadow',
  'opacity',
  'transform',
  'text-decoration',
  'outline',
  'outline-offset',
  'filter'
];

function diffStyles(
  before: Record<string, string>,
  after: Record<string, string>
): Record<string, { from: string; to: string }> {
  const diff: Record<string, { from: string; to: string }> = {};
  for (const key of interactionProperties) {
    if (before[key] !== after[key]) diff[key] = { from: before[key] || '', to: after[key] || '' };
  }
  return diff;
}

export async function extractInteractionStates(page: Page): Promise<InteractionStateEvidence[]> {
  const locator = page.locator('button, a[href], input, textarea, select, [role="button"], [tabindex="0"]');
  const count = Math.min(await locator.count(), 60);
  const results: InteractionStateEvidence[] = [];

  const readStyle = async (index: number): Promise<Record<string, string>> =>
    locator.nth(index).evaluate((element: Element, properties: string[]) => {
      const style = getComputedStyle(element);
      return Object.fromEntries(
        (properties as string[]).map((property) => [property, style.getPropertyValue(property)])
      );
    }, interactionProperties);

  for (let index = 0; index < count && results.length < 10; index += 1) {
    const item = locator.nth(index);
    try {
      if (!(await item.isVisible({ timeout: 500 }))) continue;
      const box = await item.boundingBox();
      if (!box || box.width < 8 || box.height < 8) continue;
      const descriptor = await item.evaluate((element: Element) => {
        const html = element as HTMLElement;
        const label =
          html.getAttribute('aria-label') ||
          html.getAttribute('title') ||
          (html instanceof HTMLInputElement ? html.placeholder || html.value : html.innerText) ||
          html.tagName;
        const id = html.id ? `#${CSS.escape(html.id)}` : '';
        const classNames = [...html.classList]
          .slice(0, 2)
          .map((name) => `.${CSS.escape(name)}`)
          .join('');
        return {
          label: String(label).replace(/\s+/g, ' ').trim().slice(0, 90),
          selector: `${html.tagName.toLowerCase()}${id || classNames}`.slice(0, 140),
          tag: html.tagName.toLowerCase(),
          states: {
            disabled:
              (html instanceof HTMLButtonElement ||
                html instanceof HTMLInputElement ||
                html instanceof HTMLSelectElement ||
                html instanceof HTMLTextAreaElement) && html.disabled ||
              html.getAttribute('aria-disabled') === 'true',
            expanded: html.hasAttribute('aria-expanded')
              ? html.getAttribute('aria-expanded') === 'true'
              : undefined,
            checked:
              html instanceof HTMLInputElement && ['checkbox', 'radio'].includes(html.type)
                ? html.checked
                : html.hasAttribute('aria-checked')
                  ? html.getAttribute('aria-checked') === 'true'
                  : undefined,
            pressed: html.hasAttribute('aria-pressed')
              ? html.getAttribute('aria-pressed') === 'true'
              : undefined,
            selected: html.hasAttribute('aria-selected')
              ? html.getAttribute('aria-selected') === 'true'
              : undefined,
            invalid: html.getAttribute('aria-invalid') === 'true',
            current: html.getAttribute('aria-current') || undefined
          }
        };
      });
      const base = await readStyle(index);
      let hover: Record<string, string> | undefined;
      let focus: Record<string, string> | undefined;
      try {
        await item.hover({ timeout: 1500, force: true });
        await page.waitForTimeout(120);
        hover = await readStyle(index);
      } catch {
        // Some elements cannot be hovered due to overlays.
      }
      try {
        await item.focus({ timeout: 1500 });
        await page.waitForTimeout(80);
        focus = await readStyle(index);
      } catch {
        // Some custom controls are not focusable.
      }
      const hoverDiff = hover ? diffStyles(base, hover) : undefined;
      const focusDiff = focus ? diffStyles(base, focus) : undefined;
      if (
        !hoverDiff ||
        Object.keys(hoverDiff).length === 0
      ) {
        hover = undefined;
      }
      if (
        !focusDiff ||
        Object.keys(focusDiff).length === 0
      ) {
        focus = undefined;
      }
      results.push({
        ...descriptor,
        base,
        hover,
        focus,
        hoverDiff: hover ? hoverDiff : undefined,
        focusDiff: focus ? focusDiff : undefined
      });
    } catch {
      // Continue with the next interactive element.
    }
  }

  return results;
}
