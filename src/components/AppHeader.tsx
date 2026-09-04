import { Link, useLocation } from 'react-router-dom';
import { DsmdLogo } from './DsmdLogo';

export function AppHeader() {
  const location = useLocation();
  return (
    <header className="app-header">
      <Link className="brand" to="/" aria-label="DSMD home">
        <DsmdLogo size={26} />
      </Link>
      <nav className="header-nav" aria-label="Main navigation">
        {location.pathname !== '/' && <Link to="/">New scan</Link>}
        <a href="https://ollama.com" target="_blank" rel="noreferrer">Ollama</a>
        <a href="https://playwright.dev" target="_blank" rel="noreferrer">Playwright</a>
        <span className="local-pill"><span className="local-dot" /> Local app</span>
      </nav>
    </header>
  );
}
