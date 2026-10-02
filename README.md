# DSMD

A local-first, multi-page website scanner that turns a public website into a detailed `DESIGN.md`, machine-readable evidence, primitive CSS tokens and viewport screenshots.

It recreates the useful workflow of URL-to-design-system products without implementing login, subscriptions or application credits. It is an independent implementation and does not contain DesignMD's private code, prompts, brand assets or services.

## What it does

```text
URL
  ↓
Playwright Chromium
  ↓
Sitemap + internal-link discovery
  ↓
Representative page selection
  ↓
Desktop and mobile browser measurements
  ↓
Computed CSS / CSSOM / font / layout / state evidence
  ↓
Deterministic normalization
  ↓
Ollama semantic analysis
  ↓
DESIGN.md + evidence.json + tokens.css + screenshots
```

### Included functionality

- Dark, responsive React interface
- No user account
- No billing or credit counter
- Local scan history
- Multi-page discovery through rendered links, `robots.txt` and sitemaps
- Representative template selection to avoid scanning hundreds of duplicate URLs
- Real Chromium rendering through Playwright
- Lazy-content scrolling and best-effort consent dismissal
- Desktop scan for every selected page
- Mobile scan for representative pages
- Full-page and viewport screenshots
- Computed color extraction and normalization
- Typography family, size, weight, line-height, tracking and text-transform evidence
- CSS custom-property extraction
- Captured stylesheet parsing, including cross-origin stylesheets loaded by the browser
- `@font-face` and loaded FontFaceSet evidence
- Spacing, radii, borders, shadows and transition frequency analysis
- CSS media-query and breakpoint extraction
- Container, max-width, grid and section measurements
- Image ratio and object-fit analysis
- Component heuristics and recurring-pattern aggregation
- Sample hover and focus-state comparison
- Ollama integration, defaulting to `glm-5.3-flash:cloud`
- Deterministic prose fallback when Ollama is unavailable
- `DESIGN.md`, `evidence.json`, `analysis.json` and `tokens.css` downloads
- Complete per-scan output ZIP
- Private-network / SSRF protection by default
- Local smoke-test fixture

## Requirements

- Node.js 20 or newer
- npm
- Ollama, when AI interpretation is enabled
- Internet access while scanning public websites
- Sufficient disk space for Playwright Chromium and generated screenshots

## Quick setup

```bash
cp .env.example .env
npm install
npm run setup:browser
```

Configure Ollama Cloud through the local daemon:

```bash
ollama signin
ollama pull glm-5.3-flash:cloud
```

Check everything:

```bash
npm run check:env
```

Start the development app:

```bash
npm run dev
```

Open:

```text
http://localhost:5173
```

On macOS, `setup.command` and `start.command` perform the same steps.

## Environment variables

Copy `.env.example` to `.env`.

```dotenv
PORT=8787
HOST=127.0.0.1
DATA_DIR=./data

DEFAULT_MAX_PAGES=8
MAX_ALLOWED_PAGES=20
MAX_MOBILE_PAGES=3
PAGE_TIMEOUT_MS=45000
MAX_CANDIDATE_URLS=250
HEADLESS=true

OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_MODEL=glm-5.3-flash:cloud
OLLAMA_API_KEY=
OLLAMA_TIMEOUT_MS=600000
OLLAMA_THINKING=high
OLLAMA_SEND_SCREENSHOTS=true
AI_ENABLED=true

ALLOW_PRIVATE_NETWORKS=false
```

### Ollama connection modes

#### Recommended: local Ollama daemon routing to an Ollama Cloud model

```dotenv
OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_MODEL=glm-5.3-flash:cloud
OLLAMA_API_KEY=
```

Authenticate once using:

```bash
ollama signin
```

#### Fully local model

Install a model your hardware can run, then change only the model name:

```dotenv
OLLAMA_MODEL=<your-local-model>
```

The scanner, evidence pipeline and UI do not change.

#### No AI

```dotenv
AI_ENABLED=false
```

The app still generates every measured artifact and a complete `DESIGN.md`; only the semantic prose uses the deterministic fallback.

## How multi-page scanning works

1. The first page is opened in Chromium.
2. Rendered internal links are collected.
3. The scanner reads `robots.txt`, common sitemap locations and nested sitemap indexes.
4. Assets, login pages, feeds, carts and other non-design URLs are filtered out.
5. URLs are grouped by structural path pattern.
6. High-value templates such as home, about, services, product, work, case study, blog and contact are prioritized.
7. One representative URL is selected from each template family until the chosen page limit is reached.
8. Every selected page is measured at desktop width; a configured subset is also measured at mobile width.

This gives broader design-system coverage without wasting time on hundreds of near-identical article or product-detail pages.

## Generated files

Each result is saved to:

```text
data/scans/<slug>/
├── DESIGN.md
├── evidence.json
├── analysis.json
├── tokens.css
├── meta.json
└── screenshots/
    ├── 01-home-desktop.webp
    ├── 01-home-desktop-viewport.webp
    └── ...
```

### `DESIGN.md`

Human- and agent-readable design-system specification containing:

- source coverage and provenance
- design overview and principles
- exact color palette
- typography styles
- spacing scale
- layout and grids
- media queries and breakpoints
- radii, borders and shadows
- imagery treatment
- motion and state evidence
- recurring components
- extracted source variables
- do/don't guidance
- implementation workflow
- scan limitations

### `evidence.json`

The source of truth. It contains aggregated tokens plus page-level measurements, frequencies, contexts, screenshots, layouts, components, state differences and failure information.

### `tokens.css`

Portable primitive custom properties generated only from measured values. It deliberately avoids pretending that every primitive has a known semantic role.

## Production build

```bash
npm run build
npm start
```

The Express server serves both the API and the built React application. Open:

```text
http://127.0.0.1:8787
```

## Validation

Type-check and build:

```bash
npm run check
```

Run the browser scanner against the included local multi-page fixture:

```bash
npm run test:scanner
```

The test confirms that Playwright extracts colors, typography, CSS variables, media queries, components, links and screenshots, then generates Markdown and CSS tokens.

## Safety

The API accepts arbitrary public URLs, so it protects against server-side request forgery by default.

It blocks:

- `localhost`
- loopback IPs
- RFC1918 private ranges
- link-local addresses
- cloud metadata-style hostnames
- unsafe redirects
- private subresource hosts loaded by a public page
- non-HTTP protocols

Do not set this in a shared or deployed environment:

```dotenv
ALLOW_PRIVATE_NETWORKS=true
```

That switch exists only for deliberate local testing.

## What websites may not scan perfectly

A browser-measured scanner cannot guarantee access to every public URL. Common limitations include:

- bot challenges and CAPTCHAs
- authentication
- geographic restrictions
- sites that block headless Chromium
- consent overlays with unusual interaction flows
- client-specific or personalized content
- extremely long infinite-scroll pages
- unavailable fonts or assets
- dynamically encrypted or obfuscated CSS

The result records failures and limitations rather than inventing missing evidence.

## Free and unlimited clarification

DSMD itself contains no credits, subscription gate, remote database or paid crawler. You can run the extraction pipeline as often as your computer permits.

The default model name is an Ollama Cloud model. Cloud access is controlled by Ollama, including authentication, availability and any provider-side usage policy. For end-to-end operation that does not depend on a cloud model, use a capable model installed locally in Ollama or set `AI_ENABLED=false`.

## Project structure

```text
dsmd/
├── src/                    React interface
├── server/
│   ├── ai/                 Ollama + fallback analysis
│   ├── lib/                URL safety and utilities
│   ├── output/             DESIGN.md and tokens.css renderer
│   ├── scanner/            Browser, discovery, extraction, aggregation
│   ├── storage/            Local scan persistence
│   └── types/              Domain types
├── scripts/                Environment check and scanner smoke test
├── fixtures/site/          Local test website
├── data/scans/             Generated results
├── .env.example
├── setup.command
└── start.command
```

## License

MIT. Source websites, screenshots, branding and extracted design information remain subject to their owners' rights and applicable terms. Use the scanner for legitimate design analysis and implementation work.
