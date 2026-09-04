import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getScan } from '../lib/api';
import type { ScanMeta, ScanResult, ScanStatus } from '../lib/types';
import { CheckIcon, ChevronLeftIcon, GlobeIcon, LayersIcon, SparkIcon } from '../components/Icons';

const stages: Array<{ status: ScanStatus; label: string; description: string }> = [
  { status: 'discovering', label: 'Discover website', description: 'Open the site, inspect links and read sitemaps.' },
  { status: 'scanning', label: 'Measure pages', description: 'Render representative templates at desktop and mobile sizes.' },
  { status: 'analyzing', label: 'Normalize evidence', description: 'Resolve colors, type, spacing, components and CSS rules.' },
  { status: 'generating', label: 'Write DESIGN.md', description: 'Interpret the measured system through Ollama and verify output.' }
];

const stageOrder: ScanStatus[] = ['queued', 'discovering', 'scanning', 'analyzing', 'generating', 'complete'];

function stageState(stage: ScanStatus, current: ScanStatus): 'pending' | 'active' | 'complete' | 'failed' {
  if (current === 'failed') return 'failed';
  const currentIndex = stageOrder.indexOf(current);
  const stageIndex = stageOrder.indexOf(stage);
  if (current === 'complete' || currentIndex > stageIndex) return 'complete';
  if (current === stage) return 'active';
  return 'pending';
}

export function ScanPage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const [result, setResult] = useState<ScanResult | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let timeout: number | undefined;

    const poll = async () => {
      try {
        const next = await getScan(slug);
        if (cancelled) return;
        setResult(next);
        setLoadError('');
        if (next.meta.status === 'complete') {
          timeout = window.setTimeout(() => navigate(`/s/${slug}`, { replace: true }), 650);
          return;
        }
        if (next.meta.status !== 'failed') timeout = window.setTimeout(poll, 1200);
      } catch (error) {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : 'Could not load scan status.');
        timeout = window.setTimeout(poll, 2500);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timeout) window.clearTimeout(timeout);
    };
  }, [navigate, slug]);

  const meta = result?.meta;
  const hostname = useMemo(() => {
    try {
      return meta ? new URL(meta.sourceUrl).hostname : '';
    } catch {
      return meta?.domain || '';
    }
  }, [meta]);

  if (!meta) {
    return (
      <main className="center-page">
        <span className="large-spinner" />
        <p>{loadError || 'Loading scan…'}</p>
      </main>
    );
  }

  if (meta.status === 'failed') {
    return (
      <main className="center-page error-page">
        <div className="error-symbol">!</div>
        <span className="section-kicker">SCAN FAILED</span>
        <h1>We could not complete this website.</h1>
        <p>{meta.error || 'The browser scanner stopped unexpectedly.'}</p>
        <div className="button-row">
          <Link className="secondary-button" to="/"><ChevronLeftIcon size={17} /> Back home</Link>
          <Link className="primary-button" to="/">Start another scan</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="scan-progress-page">
      <div className="scan-orb scan-orb-one" />
      <div className="scan-orb scan-orb-two" />
      <section className="scan-progress-card">
        <div className="scan-site-row">
          <div className="scan-site-icon">
            {meta.faviconUrl ? <img src={meta.faviconUrl} alt="" /> : <GlobeIcon size={21} />}
          </div>
          <div>
            <span>GENERATING DESIGN SYSTEM</span>
            <h1>{meta.title || hostname}</h1>
            <p>{hostname}</p>
          </div>
        </div>

        <div className="progress-visual">
          <div className="progress-ring" style={{ '--progress': `${meta.progress * 3.6}deg` } as CSSProperties}>
            <div><strong>{meta.progress}%</strong><span>complete</span></div>
          </div>
          <div className="progress-message">
            <span className="pulse-dot" />
            <p>{meta.message}</p>
            {meta.currentPage && <code>{meta.currentPage}</code>}
          </div>
        </div>

        <div className="stage-list">
          {stages.map((stage) => {
            const state = stageState(stage.status, meta.status);
            return (
              <div className={`stage stage-${state}`} key={stage.status}>
                <span className="stage-marker">
                  {state === 'complete' ? <CheckIcon size={15} /> : state === 'active' ? <span className="stage-spinner" /> : null}
                </span>
                <div><strong>{stage.label}</strong><p>{stage.description}</p></div>
              </div>
            );
          })}
        </div>

        <div className="scan-stats">
          <div><span>Discovered</span><strong>{meta.pagesDiscovered || '—'}</strong></div>
          <div><span>Selected</span><strong>{meta.pagesSelected || '—'}</strong></div>
          <div><span>Processed views</span><strong>{meta.pagesCompleted || '—'}</strong></div>
          <div><span>Model</span><strong>{meta.ai.requestedModel}</strong></div>
        </div>

        <div className="scan-note"><SparkIcon size={15} /> Keep this tab open. The local Playwright worker is measuring the live site.</div>
      </section>
    </main>
  );
}
