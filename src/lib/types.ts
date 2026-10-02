export type ScanStatus =
  | 'queued'
  | 'discovering'
  | 'scanning'
  | 'analyzing'
  | 'generating'
  | 'complete'
  | 'failed';

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
  options: { multiPage: boolean; maxPages: number; includeMobile: boolean };
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
  viewports: string[];
}

export interface ComponentEvidence {
  name: string;
  count: number;
  pages: string[];
  signals: string[];
  samples: Array<{ page: string; selector?: string; heading?: string; classHint?: string }>;
}

export interface PageScreenshotEvidence {
  page: { url: string };
  viewport: string;
  screenshot: string;
  viewportScreenshot: string;
  bandScreenshots: string[];
}

export interface Evidence {
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
    viewports: string[];
    failures: Array<{ url: string; viewport: string; error: string }>;
  };
  screenshots: {
    primary: string;
    all: Array<{
      url: string;
      viewport: string;
      path: string;
      viewportPath?: string;
      bands?: string[];
    }>;
  };
  colors: ColorEvidence[];
  typography: TypographyEvidence[];
  spacing: CountedValue[];
  radii: CountedValue[];
  shadows: CountedValue[];
  transitions: CountedValue[];
  maxWidths: CountedValue[];
  breakpoints: Array<{ query: string; values: string[]; count: number }>;
  cssVariables: Array<{ name: string; value: string; count: number }>;
  fontFaces: Array<{ family: string; weight?: string; style?: string; source?: string }>;
  components: ComponentEvidence[];
  images: Array<{ ratio: number; objectFit: string; width: number; height: number; alt: string }>;
  pages?: PageScreenshotEvidence[];
}

export interface Analysis {
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
    anatomy?: string[];
    variants?: string[];
    states?: string[];
    responsiveBehavior?: string[];
    avoid?: string[];
    evidence?: string[];
    confidence?: 'high' | 'medium' | 'low';
  }>;
  designPrinciples: string[];
  dos: string[];
  donts: string[];
  implementationNotes: string[];
  principleDetails?: Array<{
    title: string;
    principle: string;
    rationale: string;
    evidence: string[];
    implementation: string;
    confidence: 'high' | 'medium' | 'low';
  }>;
  doDetails?: Array<{
    category: string;
    rule: string;
    rationale: string;
    evidence: string[];
    confidence: 'high' | 'medium' | 'low';
  }>;
  dontDetails?: Array<{
    category: string;
    rule: string;
    rationale: string;
    evidence: string[];
    confidence: 'high' | 'medium' | 'low';
  }>;
  qualityChecklist?: Array<{ category: string; check: string; evidence: string }>;
  coverageAssessment?: {
    confidence: 'high' | 'medium' | 'low';
    strengths: string[];
    gaps: string[];
  };
}

export interface ScanResult {
  meta: ScanMeta;
  evidence: Evidence | null;
  analysis: Analysis | null;
  designMd: string;
  tokensCss: string;
  files: {
    designMd: string;
    evidence: string;
    tokensCss: string;
    bundle: string;
  };
}
