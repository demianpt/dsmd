import type {
  BreakpointEvidence,
  CssVariableEvidence,
  FontFaceEvidence
} from '../types/domain.js';
import { cleanText } from '../lib/text.js';

export interface CssTextSource {
  url: string;
  text: string;
}

function unquote(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

export function parseCapturedCss(sources: CssTextSource[]): {
  variables: CssVariableEvidence[];
  breakpoints: BreakpointEvidence[];
  fontFaces: FontFaceEvidence[];
} {
  const variableMap = new Map<string, CssVariableEvidence>();
  const breakpointMap = new Map<string, BreakpointEvidence>();
  const fontFaceMap = new Map<string, FontFaceEvidence>();

  for (const source of sources) {
    const css = source.text;
    const variableRegex = /(--[a-zA-Z0-9_-]+)\s*:\s*([^;{}]+);/g;
    for (const match of css.matchAll(variableRegex)) {
      const name = match[1];
      const value = cleanText(match[2], 300);
      if (!name || !value) continue;
      const key = `${name}\u0000${value}`;
      const current = variableMap.get(key) || {
        name,
        value,
        count: 0,
        sources: []
      };
      current.count += 1;
      if (current.sources.length < 5 && !current.sources.includes(source.url)) {
        current.sources.push(source.url);
      }
      variableMap.set(key, current);
    }

    const mediaRegex = /@media\s*([^\{]+)\{/gi;
    for (const match of css.matchAll(mediaRegex)) {
      const query = cleanText(match[1], 300);
      if (!query) continue;
      const values = [...query.matchAll(/(?:min|max)-(?:width|height)\s*:\s*([^\)]+)/gi)].map(
        (entry) => entry[1].trim()
      );
      const current = breakpointMap.get(query) || {
        query,
        values,
        count: 0,
        sources: []
      };
      current.count += 1;
      if (current.sources.length < 5 && !current.sources.includes(source.url)) {
        current.sources.push(source.url);
      }
      breakpointMap.set(query, current);
    }

    const fontFaceRegex = /@font-face\s*\{([\s\S]*?)\}/gi;
    for (const match of css.matchAll(fontFaceRegex)) {
      const block = match[1] || '';
      const family = unquote(block.match(/font-family\s*:\s*([^;]+)/i)?.[1] || '');
      if (!family) continue;
      const weight = cleanText(block.match(/font-weight\s*:\s*([^;]+)/i)?.[1] || '', 60);
      const style = cleanText(block.match(/font-style\s*:\s*([^;]+)/i)?.[1] || '', 60);
      const src = cleanText(block.match(/src\s*:\s*([^;]+)/i)?.[1] || '', 300);
      const key = `${family}\u0000${weight}\u0000${style}`;
      if (!fontFaceMap.has(key)) {
        fontFaceMap.set(key, {
          family,
          weight: weight || undefined,
          style: style || undefined,
          source: src || source.url
        });
      }
    }
  }

  return {
    variables: [...variableMap.values()].sort((a, b) => b.count - a.count),
    breakpoints: [...breakpointMap.values()].sort((a, b) => b.count - a.count),
    fontFaces: [...fontFaceMap.values()]
  };
}
