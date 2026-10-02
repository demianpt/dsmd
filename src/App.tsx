import { Route, Routes } from 'react-router-dom';
import { AppHeader } from './components/AppHeader';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ResultPage } from './pages/ResultPage';
import { ScanPage } from './pages/ScanPage';

export default function App() {
  return (
    <div className="app-shell">
      <AppHeader />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/scan/:slug" element={<ScanPage />} />
        <Route path="/s/:slug" element={<ResultPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <footer className="app-footer">
        <span>DSMD · local-first design extraction</span>
        <span>Measured with Playwright · interpreted with Ollama</span>
      </footer>
    </div>
  );
}
