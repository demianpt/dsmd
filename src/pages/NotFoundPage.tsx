import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <main className="center-page error-page">
      <span className="section-kicker">404</span>
      <h1>This local page does not exist.</h1>
      <p>Return to your scan library and generate a new design system.</p>
      <Link className="primary-button" to="/">Back home</Link>
    </main>
  );
}
