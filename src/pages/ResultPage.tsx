import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getScan, reanalyzeScan } from '../lib/api';
import type { ColorEvidence, Evidence, ScanResult, TypographyEvidence } from '../lib/types';
import {
  CheckIcon,
  ChevronLeftIcon,
  CopyIcon,
  DownloadIcon,
  ExternalIcon,
  FileIcon,
  GlobeIcon,
  LayersIcon,
  RefreshIcon,
  SparkIcon
} from '../components/Icons';
import { SiteFavicon } from '../components/SiteFavicon';

type TabName = 'overview' | 'design' | 'evidence';

interface PageCapture {
  url: string;
  viewport: string;
  fullPath: string;
  segments: string[];
  hasCompleteSegments: boolean;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function primaryTypography(items: TypographyEvidence[]): TypographyEvidence[] {
  const seen = new Set<string>();
  return [...items]
    .sort((a, b) => Number.parseFloat(b.size) - Number.parseFloat(a.size) || b.count - a.count)
    .filter((item) => {
      const key = `${item.family}|${item.size}|${item.weight}|${item.lineHeight}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

function colorText(color: ColorEvidence): string {
  const hex = color.normalized.match(/^#([0-9a-f]{6})/i)?.[1];
  if (!hex) return '#fff';
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return r * 299 + g * 587 + b * 114 > 155000 ? '#111' : '#fff';
}

function getPath(url: string): string {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return url;
  }
}

function pageCaptures(evidence?: Evidence | null): PageCapture[] {
  if (!evidence) return [];

  return evidence.screenshots.all.map((screenshot) => {
    const page = evidence.pages?.find(
      (candidate) =>
        candidate.page.url === screenshot.url && candidate.viewport === screenshot.viewport
    );
    const bands = screenshot.bands?.length
      ? screenshot.bands
      : page?.bandScreenshots || [];

    return {
      url: screenshot.url,
      viewport: screenshot.viewport,
      fullPath: screenshot.path,
      segments: bands.length ? bands : [screenshot.path],
      hasCompleteSegments: bands.length > 0
    };
  });
}

function fallbackMessage(reason: string): string {
  if (reason === 'AI_ENABLED=false' || /AI interpretation is disabled/i.test(reason)) {
    return 'AI interpretation is disabled in the local configuration.';
  }
  if (/invalid_value|expected one of|validation failed/i.test(reason)) {
    return 'The AI response could not be validated, so the evidence-backed deterministic analysis was used.';
  }
  if (/unsupported exact values/i.test(reason)) {
    return 'This result was created before DSMD could repair literal values in AI prose. Retry AI analysis to upgrade it using the saved evidence.';
  }
  if (/timed out|abort/i.test(reason)) {
    return 'AI interpretation timed out, so the evidence-backed deterministic analysis was used.';
  }
  const concise = reason.replace(/\s+/g, ' ').trim().slice(0, 220);
  return concise
    ? `The evidence-backed deterministic analysis was used because AI interpretation did not complete: ${concise}`
    : 'The evidence-backed deterministic analysis was used because AI interpretation did not complete.';
}

export function ResultPage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<TabName>('overview');
  const [copied, setCopied] = useState(false);
  const [activeCapture, setActiveCapture] = useState(0);
  const [activeSegment, setActiveSegment] = useState(0);
  const [retryingAi, setRetryingAi] = useState(false);
  const [retryAiError, setRetryAiError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const next = await getScan(slug);
        if (cancelled) return;
        if (next.meta.status !== 'complete') {
          navigate(`/scan/${slug}`, { replace: true });
          return;
        }
        setResult(next);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load scan.');
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [navigate, slug]);

  const typography = useMemo(
    () => primaryTypography(result?.evidence?.typography || []),
    [result]
  );
  const captures = useMemo(() => pageCaptures(result?.evidence), [result]);

  async function copyDesignMd() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.designMd);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Clipboard access was blocked. Use the download button instead.');
    }
  }

  async function retryAiAnalysis() {
    setRetryingAi(true);
    setRetryAiError('');
    try {
      setResult(await reanalyzeScan(slug));
    } catch (retryError) {
      setRetryAiError(
        retryError instanceof Error ? retryError.message : 'AI analysis could not be retried.'
      );
    } finally {
      setRetryingAi(false);
    }
  }

  if (error) {
    return (
      <main className="center-page error-page">
        <div className="error-symbol">!</div>
        <h1>Result unavailable</h1>
        <p>{error}</p>
        <Link className="primary-button" to="/">Back home</Link>
      </main>
    );
  }

  if (!result || !result.evidence || !result.analysis) {
    return <main className="center-page"><span className="large-spinner" /><p>Loading design system…</p></main>;
  }

  const { meta, evidence, analysis } = result;
  const currentCapture = captures[activeCapture] || captures[0];
  const showingFullPage = activeSegment === -1;
  const currentSegment = showingFullPage
    ? currentCapture?.fullPath
    : currentCapture?.segments[activeSegment] || currentCapture?.segments[0];
  const topColors = evidence.colors.slice(0, 12);
  const components = evidence.components.slice(0, 22);

  return (
    <main className="result-page">
      <section className="result-topbar">
        <Link className="back-link" to="/"><ChevronLeftIcon size={16} /> All scans</Link>
        <div className="result-actions">
          <button className="ghost-button" type="button" onClick={() => window.location.reload()}>
            <RefreshIcon size={16} /> Refresh
          </button>
          <button className="ghost-button" type="button" onClick={() => void copyDesignMd()}>
            {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}{copied ? 'Copied' : 'Copy DESIGN.md'}
          </button>
          <a className="primary-button compact" href={result.files.bundle}>
            <DownloadIcon size={16} /> Download bundle
          </a>
        </div>
      </section>

      <section className="result-hero">
        <div className="result-identity">
          <div className="site-mark">
            <SiteFavicon src={meta.faviconUrl} size={25} />
          </div>
          <div>
            <span className="section-kicker">DESIGN SYSTEM READY</span>
            <h1>{evidence.source.title}</h1>
            <a href={evidence.source.canonicalUrl} target="_blank" rel="noreferrer">
              {evidence.source.domain} <ExternalIcon size={14} />
            </a>
          </div>
        </div>
        <div className="result-summary-pills">
          <span><i /> {evidence.colors.length} measured colors</span>
          <span><i /> {components.length} component patterns</span>
          <span><i /> {evidence.coverage.selectedUrls.length} representative pages</span>
          <span><i /> {evidence.coverage.viewports.join(' + ')}</span>
        </div>
        <p className="result-overview">{analysis.overview}</p>
        <div className="result-meta-line">
          <span>Generated {formatDate(evidence.generatedAt)}</span>
          <span>•</span>
          <span>{meta.ai.used ? `Interpreted by ${meta.ai.model || meta.ai.requestedModel}` : 'Deterministic fallback used'}</span>
        </div>
      </section>

      <nav className="result-tabs" aria-label="Result sections">
        {(['overview', 'design', 'evidence'] as TabName[]).map((name) => (
          <button key={name} type="button" className={tab === name ? 'is-active' : ''} onClick={() => setTab(name)}>
            {name === 'overview' ? 'Visual system' : name === 'design' ? 'DESIGN.md' : 'Raw evidence'}
          </button>
        ))}
      </nav>

      {tab === 'overview' && (
        <div className="result-content">
          <section className="preview-section panel">
            <div className="panel-heading">
              <div>
                <span className="section-kicker">FULL-PAGE EVIDENCE</span>
                <h2>Every captured page section</h2>
              </div>
              <span>
                Page {activeCapture + 1} / {captures.length}
                {currentCapture && (showingFullPage
                  ? ' · Full page'
                  : ` · Segment ${activeSegment + 1} / ${currentCapture.segments.length}`)}
              </span>
            </div>
            <div className="browser-preview">
              <div className="browser-bar">
                <span className="traffic-dots"><i /><i /><i /></span>
                <span className="browser-address"><GlobeIcon size={13} /> {currentCapture?.url}</span>
                <span className="viewport-badge">{currentCapture?.viewport}</span>
              </div>
              {currentCapture && currentSegment && (
                <div className={showingFullPage || !currentCapture.hasCompleteSegments ? 'browser-capture is-full-page' : 'browser-capture'}>
                  <img
                    src={currentSegment}
                    alt={showingFullPage
                      ? `Full-page ${currentCapture.viewport} screenshot of ${getPath(currentCapture.url)}`
                      : `${currentCapture.viewport} segment ${activeSegment + 1} of ${currentCapture.segments.length} for ${getPath(currentCapture.url)}`}
                  />
                </div>
              )}
            </div>
            {captures.length > 1 && (
              <div className="capture-selector">
                <div className="capture-selector-heading">
                  <strong>Pages and viewports</strong>
                  <span>Select a captured page view</span>
                </div>
                <div className="screenshot-strip">
                  {captures.map((capture, index) => (
                    <button
                      key={`${capture.fullPath}-${index}`}
                      type="button"
                      className={activeCapture === index ? 'is-active' : ''}
                      onClick={() => {
                        setActiveCapture(index);
                        setActiveSegment(0);
                      }}
                      aria-label={`Show ${capture.viewport} capture of ${getPath(capture.url)}`}
                    >
                      <img src={capture.segments[0]} alt="" />
                      <span>{getPath(capture.url)} · {capture.viewport}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {currentCapture && (
              <div className="capture-selector">
                <div className="capture-selector-heading">
                  <strong>Top-to-bottom page evidence</strong>
                  <span>
                    {currentCapture.hasCompleteSegments
                      ? `${currentCapture.segments.length} readable segments captured after lazy content loaded`
                      : 'Legacy full-page capture — scroll the preview to inspect it'}
                  </span>
                </div>
                {currentCapture.hasCompleteSegments && (
                  <div className="screenshot-strip segment-strip">
                    <button
                      type="button"
                      className={showingFullPage ? 'is-active' : ''}
                      onClick={() => setActiveSegment(-1)}
                      aria-label="Show the continuous full-page screenshot"
                    >
                      <img src={currentCapture.fullPath} alt="" />
                      <span>Full page · scroll</span>
                    </button>
                    {currentCapture.segments.map((segment, index) => (
                      <button
                        key={`${segment}-${index}`}
                        type="button"
                        className={activeSegment === index ? 'is-active' : ''}
                        onClick={() => setActiveSegment(index)}
                        aria-label={`Show page segment ${index + 1} of ${currentCapture.segments.length}`}
                      >
                        <img src={segment} alt="" />
                        <span>Segment {index + 1} of {currentCapture.segments.length}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          <div className="two-column-panels">
            <section className="panel colors-panel">
              <div className="panel-heading"><div><span className="section-kicker">FOUNDATION</span><h2>Colors</h2></div><span>{evidence.colors.length} total</span></div>
              <p className="panel-intro">{analysis.colorStrategy}</p>
              <div className="color-grid">
                {topColors.map((color, index) => (
                  <article key={`${color.normalized}-${index}`} style={{ background: color.value, color: colorText(color) }}>
                    <span>COLOR {String(index + 1).padStart(2, '0')}</span>
                    <strong>{color.normalized}</strong>
                    <small>{color.channels.join(' · ')}</small>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel typography-panel">
              <div className="panel-heading"><div><span className="section-kicker">FOUNDATION</span><h2>Typography</h2></div><span>{evidence.fontFaces.length} font faces</span></div>
              <p className="panel-intro">{analysis.typographyStrategy}</p>
              <div className="type-list">
                {typography.map((style, index) => (
                  <article key={`${style.family}-${style.size}-${style.weight}-${index}`}>
                    <div className="type-sample" style={{ fontFamily: style.family, fontWeight: Number(style.weight) || undefined }}>
                      {index < 3 ? 'Ag' : 'Aa'}
                    </div>
                    <div className="type-details">
                      <strong>{style.family.split(',')[0].replace(/["']/g, '')}</strong>
                      <span>{style.tags.join(', ') || 'text style'}</span>
                    </div>
                    <div className="type-values"><code>{style.size}</code><code>{style.weight}</code><code>{style.lineHeight}</code></div>
                  </article>
                ))}
              </div>
            </section>
          </div>

          <section className="panel token-panel">
            <div className="panel-heading"><div><span className="section-kicker">SYSTEM TOKENS</span><h2>Spacing, geometry and layout</h2></div></div>
            <div className="token-columns">
              <div>
                <h3>Spacing scale</h3>
                <div className="token-cloud">{evidence.spacing.slice(0, 18).map((item) => <span key={item.value}><i style={{ width: `${Math.min(80, Math.max(4, Number.parseFloat(item.value)))}px` }} />{item.value}</span>)}</div>
              </div>
              <div>
                <h3>Border radius</h3>
                <div className="radius-grid">{evidence.radii.slice(0, 10).map((item) => <span key={item.value} style={{ borderRadius: item.value }}><b>{item.value}</b><small>{item.count}×</small></span>)}</div>
              </div>
              <div>
                <h3>Breakpoints</h3>
                <div className="breakpoint-list">{evidence.breakpoints.slice(0, 8).map((item) => <code key={item.query}>{item.query}</code>)}</div>
              </div>
            </div>
          </section>

          <section className="panel components-panel">
            <div className="panel-heading"><div><span className="section-kicker">RECURRING UI</span><h2>Components and patterns</h2></div><span>{evidence.components.length} detected</span></div>
            <div className="component-grid">
              {components.map((component) => {
                const guide = analysis.componentGuidance.find((item) => item.name.toLowerCase() === component.name.toLowerCase());
                return (
                  <article key={component.name}>
                    <div><h3>{component.name}</h3><p>{guide?.purpose || `Observed across ${component.pages.length} page templates.`}</p>{guide?.confidence && <small className={`confidence confidence-${guide.confidence}`}>{guide.confidence} confidence</small>}</div>
                    <span className="component-count">{component.count}×</span>
                  </article>
                );
              })}
            </div>
          </section>

          <div className="two-column-panels principles-panels">
            <section className="panel">
              <div className="panel-heading"><div><span className="section-kicker">GUIDANCE</span><h2>Design principles</h2></div></div>
              <ol className="principle-list">
                {(analysis.principleDetails || analysis.designPrinciples.map((principle) => ({ title: '', principle, confidence: undefined }))).map((item) => (
                  <li key={`${item.title}-${item.principle}`}>
                    <span>{item.title && <strong>{item.title}</strong>}{item.principle}<small>{item.confidence ? `${item.confidence} confidence` : ''}</small></span>
                  </li>
                ))}
              </ol>
            </section>
            <section className="panel do-dont-panel">
              <div><h3><span className="do-icon">✓</span> Do</h3><ul>{(analysis.doDetails || analysis.dos.map((rule) => ({ rule, category: '' }))).slice(0, 9).map((item) => <li key={item.rule}>{item.category && <small>{item.category}</small>}{item.rule}</li>)}</ul></div>
              <div><h3><span className="dont-icon">×</span> Don't</h3><ul>{(analysis.dontDetails || analysis.donts.map((rule) => ({ rule, category: '' }))).slice(0, 9).map((item) => <li key={item.rule}>{item.category && <small>{item.category}</small>}{item.rule}</li>)}</ul></div>
            </section>
          </div>
        </div>
      )}

      {tab === 'design' && (
        <section className="document-panel panel">
          <div className="document-toolbar">
            <div><FileIcon size={18} /><span>DESIGN.md</span><small>{result.designMd.split(/\s+/).length.toLocaleString()} words</small></div>
            <div>
              <button className="ghost-button" type="button" onClick={() => void copyDesignMd()}>{copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}{copied ? 'Copied' : 'Copy'}</button>
              <a className="ghost-button" href={result.files.designMd}><DownloadIcon size={15} /> Download</a>
            </div>
          </div>
          <pre className="markdown-document"><code>{result.designMd}</code></pre>
        </section>
      )}

      {tab === 'evidence' && (
        <div className="result-content evidence-view">
          <section className="panel evidence-downloads">
            <div className="panel-heading"><div><span className="section-kicker">SOURCE OF TRUTH</span><h2>Machine-readable outputs</h2></div></div>
            <p>Use the JSON when a coding agent needs provenance, frequencies, page coverage or individual rendered measurements.</p>
            <div className="download-grid">
              <a href={result.files.evidence}><span><LayersIcon /><strong>evidence.json</strong></span><DownloadIcon /></a>
              <a href={result.files.tokensCss}><span><FileIcon /><strong>tokens.css</strong></span><DownloadIcon /></a>
              <a href={result.files.designMd}><span><FileIcon /><strong>DESIGN.md</strong></span><DownloadIcon /></a>
              <a href={result.files.bundle}><span><DownloadIcon /><strong>Complete ZIP</strong></span><DownloadIcon /></a>
            </div>
          </section>
          <section className="panel raw-panel">
            <div className="panel-heading"><div><span className="section-kicker">PREVIEW</span><h2>evidence.json</h2></div></div>
            <pre><code>{JSON.stringify(evidence, null, 2)}</code></pre>
          </section>
        </div>
      )}

      {!meta.ai.used && meta.ai.fallbackReason && (
        <aside className="ai-warning">
          <SparkIcon size={17} />
          <div><strong>Deterministic analysis used</strong><p>{fallbackMessage(meta.ai.fallbackReason)}</p></div>
          <button className="ghost-button" type="button" disabled={retryingAi} onClick={() => void retryAiAnalysis()}>
            <RefreshIcon size={15} /> {retryingAi ? 'Retrying…' : 'Retry AI analysis'}
          </button>
          {retryAiError && <p className="ai-retry-error">{fallbackMessage(retryAiError)}</p>}
        </aside>
      )}
    </main>
  );
}
