import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createScan, deleteScan, listScans } from '../lib/api';
import type { ScanMeta } from '../lib/types';
import {
  ArrowRightIcon,
  FileIcon,
  GlobeIcon,
  LayersIcon,
  LinkIcon,
  TrashIcon
} from '../components/Icons';
import { Toggle } from '../components/Toggle';

function relativeDate(value: string): string {
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function statusLabel(status: ScanMeta['status']): string {
  if (status === 'complete') return 'Ready';
  if (status === 'failed') return 'Failed';
  if (status === 'queued') return 'Queued';
  return 'Scanning';
}

export function HomePage() {
  const navigate = useNavigate();
  const [url, setUrl] = useState('');
  const [multiPage, setMultiPage] = useState(true);
  const [includeMobile, setIncludeMobile] = useState(true);
  const [maxPages, setMaxPages] = useState(8);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [history, setHistory] = useState<ScanMeta[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const loadHistory = async () => {
    try {
      setHistory(await listScans());
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    void loadHistory();
  }, []);

  const completeCount = useMemo(
    () => history.filter((scan) => scan.status === 'complete').length,
    [history]
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!url.trim()) {
      setError('Enter a website URL to scan.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const created = await createScan({
        url: url.trim(),
        multiPage,
        maxPages: multiPage ? maxPages : 1,
        includeMobile
      });
      navigate(`/scan/${created.scan.slug}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not start the scan.');
      setSubmitting(false);
    }
  }

  async function removeScan(scan: ScanMeta) {
    if (!window.confirm(`Delete the local scan for ${scan.title || scan.domain}?`)) return;
    try {
      await deleteScan(scan.slug);
      setHistory((items) => items.filter((item) => item.slug !== scan.slug));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete the scan.');
    }
  }

  return (
    <main>
      <section className="hero-section">
        <div className="hero-glow hero-glow-one" />
        <div className="hero-glow hero-glow-two" />
        <div className="hero-content">
          <h1>Turn any website into a precise design system.</h1>
          <p className="hero-lead">
            Paste a URL. MyOwnDesignMD discovers representative pages, measures the rendered CSS,
            and writes a production-ready <strong>DESIGN.md</strong> with exact tokens, component
            patterns and responsive evidence.
          </p>

          <form className="scanner-card" onSubmit={submit}>
            <div className="scanner-input-row">
              <LinkIcon size={21} />
              <input
                type="text"
                value={url}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setUrl(event.target.value)}
                placeholder="linear.app"
                autoComplete="url"
                spellCheck={false}
                aria-label="Website URL"
              />
              <button className="scan-submit" type="submit" disabled={submitting} aria-label="Start scan">
                {submitting ? <span className="button-spinner" /> : <ArrowRightIcon size={20} />}
              </button>
            </div>
            <div className="scanner-options">
              <div className="option-group">
                <Toggle checked={multiPage} onChange={setMultiPage} label="Multi-page" />
                {multiPage && (
                  <label className="page-limit">
                    <span>Pages</span>
                    <select value={maxPages} onChange={(event: ChangeEvent<HTMLSelectElement>) => setMaxPages(Number(event.target.value))}>
                      {[4, 6, 8, 10, 12, 16, 20].map((value) => (
                        <option key={value} value={value}>{value}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              <Toggle checked={includeMobile} onChange={setIncludeMobile} label="Responsive scan" />
            </div>
          </form>

          {error && <div className="form-error" role="alert">{error}</div>}
        </div>
      </section>

      <section className="feature-strip" aria-label="How it works">
        <article>
          <span className="feature-icon"><GlobeIcon /></span>
          <div><strong>Discover</strong><p>Sitemaps and internal links become representative page templates.</p></div>
        </article>
        <article>
          <span className="feature-icon"><LayersIcon /></span>
          <div><strong>Measure</strong><p>Playwright reads computed styles, CSSOM, fonts, states and layout geometry.</p></div>
        </article>
        <article>
          <span className="feature-icon"><FileIcon /></span>
          <div><strong>Document</strong><p>Ollama interprets the evidence while exact values remain deterministic.</p></div>
        </article>
      </section>

      <section className="history-section">
        <div className="section-heading-row">
          <div>
            <span className="section-kicker">LOCAL LIBRARY</span>
            <h2>Your design systems</h2>
          </div>
          {history.length > 0 && <span className="history-count">{completeCount} ready · {history.length} total</span>}
        </div>

        {historyLoading ? (
          <div className="history-empty"><span className="button-spinner" /> Loading local scans…</div>
        ) : history.length === 0 ? (
          <div className="history-empty">
            <span className="empty-icon"><FileIcon size={24} /></span>
            <h3>No scans yet</h3>
            <p>Your first generated design system will be stored here on this computer.</p>
          </div>
        ) : (
          <div className="history-grid">
            {history.map((scan) => {
              const destination = scan.status === 'complete' ? `/s/${scan.slug}` : `/scan/${scan.slug}`;
              return (
                <article className="history-card" key={scan.slug}>
                  <Link to={destination} className="history-card-main">
                    <div className="history-favicon">
                      {scan.faviconUrl ? <img src={scan.faviconUrl} alt="" /> : <GlobeIcon size={18} />}
                    </div>
                    <div className="history-card-copy">
                      <h3>{scan.title || scan.domain}</h3>
                      <p>{scan.domain}</p>
                    </div>
                    <span className={`status-badge status-${scan.status}`}>{statusLabel(scan.status)}</span>
                  </Link>
                  <div className="history-card-footer">
                    <span>{scan.options.multiPage ? `${scan.pagesSelected || scan.options.maxPages} pages` : 'Single page'}</span>
                    <span>{relativeDate(scan.createdAt)}</span>
                    {['complete', 'failed'].includes(scan.status) && (
                      <button type="button" onClick={() => void removeScan(scan)} aria-label={`Delete ${scan.title || scan.domain}`}>
                        <TrashIcon size={15} />
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
