export type ScanStatus =
  | 'queued'
  | 'discovering'
  | 'scanning'
  | 'analyzing'
  | 'generating'
  | 'complete'
  | 'failed';

export type ViewportName = 'desktop' | 'tablet' | 'mobile';

export interface ScanOptions {
  multiPage: boolean;
  maxPages: number;
  includeMobile: boolean;
}

export interface ScanMeta {
  slug: string;
  sourceUrl: string;
  canonicalUrl?: string;
  domain: string;
  title?: string;
  description?: string;
  faviconUrl?: string;
  status: ScanStatus;
  progress: number;
  message: string;
  currentPage?: string;
  pagesDiscovered: number;
  pagesSelected: number;
  pagesCompleted: number;
  options: ScanOptions;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  ai: {
    enabled: boolean;
    requestedModel: string;
    used: boolean;
    model?: string;
    fallbackReason?: string;
  };
}

export interface CountedValue {
  value: string;
  count: number;
  contexts?: string[];
}

export interface ColorEvidence extends CountedValue {
  normalized: string;
  channels: string[];
  areaScore: number;
}

export interface TypographyEvidence {
  family: string;
  size: string;
  weight: string;
  lineHeight: string;
  letterSpacing: string;
  textTransform: string;
  count: number;
  tags: string[];
  samples: string[];
  viewports: ViewportName[];
}

export interface CssVariableEvidence {
  name: string;
  value: string;
  count: number;
  sources: string[];
}

export interface BreakpointEvidence {
  query: string;
  values: string[];
  count: number;
  sources: string[];
}

export interface FontFaceEvidence {
  family: string;
  weight?: string;
  style?: string;
  source?: string;
}

export interface ComponentEvidence {
  name: string;
  count: number;
  pages: string[];
  signals: string[];
  samples: Array<{
    page: string;
    selector?: string;
    heading?: string;
    classHint?: string;
  }>;
}

export interface SectionEvidence {
  index: number;
  tag: string;
  classHint: string;
  heading: string;
  textLength: number;
  imageCount: number;
  linkCount: number;
  buttonCount: number;
  width: number;
  height: number;
  columns: number;
  backgroundColor: string;
}

export interface InteractionStateEvidence {
  label: string;
  selector: string;
  tag: string;
  base: Record<string, string>;
  hover?: Record<string, string>;
  focus?: Record<string, string>;
  hoverDiff?: Record<string, { from: string; to: string }>;
  focusDiff?: Record<string, { from: string; to: string }>;
}

export interface ImageEvidence {
  src: string;
  alt: string;
  width: number;
  height: number;
  ratio: number;
  objectFit: string;
  loading: string;
}

export interface LayoutEvidence {
  viewportWidth: number;
  viewportHeight: number;
  documentWidth: number;
  documentHeight: number;
  bodyBackground: string;
  bodyColor: string;
  maxContentWidths: CountedValue[];
  horizontalPaddings: CountedValue[];
  gridColumns: CountedValue[];
  sectionHeights: CountedValue[];
}

export interface RawPageExtraction {
  page: {
    url: string;
    title: string;
    description: string;
    canonicalUrl: string;
    lang: string;
    faviconUrl: string;
  };
  links: string[];
  cssVariables: CssVariableEvidence[];
  colors: ColorEvidence[];
  typography: TypographyEvidence[];
  spacing: CountedValue[];
  radii: CountedValue[];
  borders: CountedValue[];
  shadows: CountedValue[];
  transitions: CountedValue[];
  maxWidths: CountedValue[];
  gridColumns: CountedValue[];
  components: ComponentEvidence[];
  sections: SectionEvidence[];
  images: ImageEvidence[];
  layout: LayoutEvidence;
  stylesheetUrls: string[];
  cssMediaQueries: BreakpointEvidence[];
  fontFaces: FontFaceEvidence[];
}

export interface PageEvidence extends RawPageExtraction {
  viewport: ViewportName;
  screenshot: string;
  viewportScreenshot: string;
  bandScreenshots: string[];
  scannedAt: string;
  interactions: InteractionStateEvidence[];
  load: {
    durationMs: number;
    finalUrl: string;
    status?: number;
    warnings: string[];
  };
}

export interface AggregatedEvidence {
  schemaVersion: '1.0';
  generatedAt: string;
  source: {
    requestedUrl: string;
    canonicalUrl: string;
    domain: string;
    title: string;
    description: string;
    faviconUrl: string;
  };
  coverage: {
    multiPage: boolean;
    candidateUrls: number;
    selectedUrls: string[];
    scannedPageViews: number;
    viewports: ViewportName[];
    failures: Array<{ url: string; viewport: ViewportName; error: string }>;
  };
  screenshots: {
    primary: string;
    all: Array<{ url: string; viewport: ViewportName; path: string }>;
  };
  colors: ColorEvidence[];
  typography: TypographyEvidence[];
  cssVariables: CssVariableEvidence[];
  spacing: CountedValue[];
  radii: CountedValue[];
  borders: CountedValue[];
  shadows: CountedValue[];
  transitions: CountedValue[];
  maxWidths: CountedValue[];
  gridColumns: CountedValue[];
  breakpoints: BreakpointEvidence[];
  fontFaces: FontFaceEvidence[];
  components: ComponentEvidence[];
  sections: Array<SectionEvidence & { page: string; viewport: ViewportName }>;
  images: Array<ImageEvidence & { page: string; viewport: ViewportName }>;
  interactions: Array<InteractionStateEvidence & { page: string; viewport: ViewportName }>;
  layouts: Array<{ page: string; viewport: ViewportName; layout: LayoutEvidence }>;
  pages: PageEvidence[];
}

export interface AiAnalysis {
  overview: string;
  visualPersonality: string[];
  colorStrategy: string;
  typographyStrategy: string;
  spacingStrategy: string;
  layoutStrategy: string;
  responsiveStrategy: string;
  imageryStrategy: string;
  motionStrategy: string;
  componentGuidance: Array<{
    name: string;
    purpose: string;
    rules: string[];
  }>;
  designPrinciples: string[];
  dos: string[];
  donts: string[];
  implementationNotes: string[];
}

export interface ScanResult {
  meta: ScanMeta;
  evidence: AggregatedEvidence;
  analysis: AiAnalysis;
  designMd: string;
  tokensCss: string;
  files: {
    designMd: string;
    evidence: string;
    tokensCss: string;
    bundle: string;
  };
}
