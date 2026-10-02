<p align="center">
  <img src="public/icon-192.png" width="96" height="96" alt="DSMD logo">
</p>

<h1 align="center">DSMD</h1>

<p align="center">
  Turn a public website into a measured, reusable design-system specification.
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#environment-reference">Configuration</a> ·
  <a href="#generated-output">Outputs</a> ·
  <a href="#http-api">HTTP API</a>
</p>

DSMD is a self-hosted website scanner that discovers representative pages, renders them in Chromium, extracts visual-system evidence, and produces a detailed `DESIGN.md` alongside machine-readable data, CSS tokens, and screenshots.

The application and scan library run locally. AI interpretation is optional: the included configuration uses the Ollama hosted API, but DSMD can also use a local Ollama daemon or its built-in deterministic fallback.

## Highlights

- Scans one page or a representative set of pages from a site
- Discovers URLs from rendered links, `robots.txt`, and XML sitemaps
- Measures desktop views and optional mobile views with Playwright Chromium
- Extracts colors, typography, spacing, radii, borders, shadows, motion, grids, breakpoints, CSS variables, fonts, images, and recurring components
- Captures viewport, full-page, and readable top-to-bottom screenshot bands
- Samples hover and focus states on representative pages
- Uses Ollama to turn measured evidence into semantic design guidance
- Falls back to deterministic, evidence-backed prose if AI is disabled or unavailable
- Stores every scan locally and provides a complete ZIP download
- Blocks private and local network targets by default
- Requires no DSMD account, database, subscription, or credit system

## How it works

```text
Public URL
   │
   ├─ URL safety checks
   ├─ rendered-link, robots.txt, and sitemap discovery
   ├─ representative template selection
   │
   ▼
Playwright Chromium
   ├─ desktop measurements for every selected page
   ├─ mobile measurements for a configured subset
   ├─ computed styles, CSSOM, fonts, layout, and UI states
   └─ viewport, full-page, and banded screenshots
   │
   ▼
Deterministic aggregation
   ├─ evidence.json
   └─ primitive tokens.css
   │
   ▼
Ollama interpretation or deterministic fallback
   │
   └─ DESIGN.md + analysis.json + downloadable ZIP
```

## Requirements

- Node.js **20.11 or newer**
- npm
- Internet access for scanning public websites
- Disk space for Playwright Chromium and generated screenshots
- An Ollama API key for the included hosted-AI configuration, or a reachable local Ollama daemon

Ollama is optional. Set `AI_ENABLED=false` to run the complete measurement and output pipeline without it.

## Quick start

1. Install dependencies and Chromium:

   ```bash
   npm install
   npm run setup:browser
   ```

2. Create your local configuration:

   ```bash
   cp .env.example .env
   ```

3. Add your Ollama API key to `.env`:

   ```dotenv
   OLLAMA_API_KEY=your_api_key_here
   ```

   To run without AI instead, set:

   ```dotenv
   AI_ENABLED=false
   ```

4. Verify the environment and start DSMD:

   ```bash
   npm run check:env
   npm run dev
   ```

5. Open [http://localhost:5173](http://localhost:5173), enter a public URL, choose the page and responsive-scan options, and start the scan.

On macOS, `setup.command` installs the project and `start.command` launches the development app.

## AI configuration

### Hosted Ollama API (included configuration)

The checked-in `.env.example` calls Ollama directly over HTTPS:

```dotenv
OLLAMA_HOST=https://ollama.com
OLLAMA_MODEL=gemma4:31b
OLLAMA_API_KEY=your_api_key_here
AI_ENABLED=true
```

DSMD sends requests to `${OLLAMA_HOST}/api/chat` and supplies the API key as a bearer token. When screenshot sending is enabled, the request may include representative screenshot bands as base64-encoded images in addition to compacted measured evidence.

The hosted service is operated by Ollama and is subject to its authentication, availability, model access, and usage policies.

### Local Ollama daemon

To keep AI inference local, run Ollama on your machine, install a model compatible with DSMD's structured analysis request, and configure:

```dotenv
OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_MODEL=your-local-model
OLLAMA_API_KEY=
AI_ENABLED=true
```

For the best result, choose a model that supports structured JSON output. A vision-capable model can also use the supplied screenshot bands; otherwise set `OLLAMA_SEND_SCREENSHOTS=false` and DSMD will send measured textual evidence only.

### No AI

```dotenv
AI_ENABLED=false
```

Scanning, screenshots, evidence aggregation, CSS-token generation, and `DESIGN.md` generation still work. The semantic narrative comes from DSMD's deterministic fallback. A completed fallback result can be reanalyzed from the result page after AI is enabled; the saved browser evidence does not need to be collected again.

## Environment reference

Copy `.env.example` to `.env`; `.env` is intentionally ignored by Git. The values below match the current example configuration.

### Server

| Variable | Example | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Express API and production web-server port. |
| `HOST` | `127.0.0.1` | Address on which the Express server listens. Use a broader bind address only when you intentionally want network access. |
| `DATA_DIR` | `./data` | Local storage root. Relative paths resolve from the project root; scans are written beneath `<DATA_DIR>/scans/`. |

### Scanner

| Variable | Example | Purpose |
| --- | --- | --- |
| `DEFAULT_MAX_PAGES` | `8` | Initial representative-page limit when a request does not specify one. Enforced minimum: `1`. |
| `MAX_ALLOWED_PAGES` | `20` | Server-side cap for a multi-page scan. Enforced minimum: `1`. |
| `MAX_MOBILE_PAGES` | `3` | Number of selected pages rescanned at the mobile viewport when responsive scanning is enabled. Set to `0` to disable mobile captures globally. |
| `PAGE_TIMEOUT_MS` | `45000` | Navigation timeout for each page. Enforced minimum: `10000`. |
| `MAX_CANDIDATE_URLS` | `250` | Maximum discovery pool considered before representative-page selection. Enforced minimum: `20`. |
| `HEADLESS` | `true` | Runs Chromium without a visible browser window. Set to `false` for local debugging. |
| `ALLOW_PRIVATE_NETWORKS` | `false` | Allows localhost, private, and link-local targets when `true`. Keep this disabled outside deliberate local testing. |

### Ollama

| Variable | Example | Purpose |
| --- | --- | --- |
| `AI_ENABLED` | `true` | Enables Ollama interpretation. Failures still fall back to deterministic analysis. |
| `OLLAMA_HOST` | `https://ollama.com` | Bare Ollama origin. Do not append `/api/chat`; DSMD adds it. If this variable is omitted entirely, the code falls back to `http://127.0.0.1:11434`. |
| `OLLAMA_MODEL` | `gemma4:31b` | Model sent in each chat request. |
| `OLLAMA_API_KEY` | empty | Bearer token for a hosted Ollama endpoint. Leave empty for a local daemon that does not require authentication. Never commit a populated `.env`. |
| `OLLAMA_TIMEOUT_MS` | `600000` | Total AI request budget. Enforced minimum: `30000`. |
| `OLLAMA_THINKING` | `high` | Value forwarded to Ollama's `think` request field on the primary attempts. |
| `OLLAMA_SEND_SCREENSHOTS` | `true` | Sends selected screenshot bands to the model. Disable for text-only or non-vision models. |

### Screenshot and vision budget

| Variable | Example | Purpose |
| --- | --- | --- |
| `SCREENSHOT_BAND_HEIGHT` | `1400` | Height in pixels of each readable top-to-bottom screenshot band. Enforced minimum: `600`. |
| `MAX_BANDS_PER_PAGE` | `30` | Safety cap for band files on exceptionally long or infinite pages. Enforced minimum: `1`; pages beyond the cap are sampled from top to bottom. |
| `MAX_AI_IMAGES` | `14` | Maximum screenshot images sent across one AI analysis. Images are selected round-robin across pages, with desktop views first. Enforced minimum: `1`. |

Boolean variables accept `1`, `true`, `yes`, or `on` as true values, case-insensitively. Any other defined value is treated as false.

## Scanning behavior

### Page discovery and selection

For a multi-page scan, DSMD:

1. Opens the requested page and collects rendered internal links.
2. Checks `robots.txt`, common sitemap locations, and nested sitemap indexes.
3. Rejects non-HTTP URLs and low-value paths such as authentication, cart, feed, and asset URLs.
4. Groups remaining URLs by structural path pattern.
5. Prioritizes useful templates such as home, about, services, product, work, case study, blog, and contact pages.
6. Selects one representative from each template family up to the requested and server-enforced page limit.

The root page is measured first. Every selected page receives a desktop scan at `1440 × 1000`; up to `MAX_MOBILE_PAGES` selected pages also receive a mobile scan at `390 × 844` when responsive scanning is enabled.

### Browser measurement

Before extraction, DSMD waits for document, load, network, and font readiness on a best-effort basis. It attempts to dismiss common consent prompts, scrolls through the page to trigger lazy content, captures loaded stylesheets, and then measures the rendered document.

The scanner records:

- computed colors and their visual contexts
- font families, faces, sizes, weights, line heights, tracking, and transforms
- spacing, radii, borders, shadows, and transitions
- CSS custom properties and media queries
- containers, maximum widths, grids, sections, and layout geometry
- image dimensions, aspect ratios, object-fit behavior, and alt text
- recurring component signals across pages and viewports
- sampled hover and focus differences
- load warnings, failed page views, redirect destinations, and coverage limits

### Screenshot coverage

Each page view normally produces:

- a current-viewport WebP capture
- a continuous full-page WebP capture
- contiguous top-to-bottom WebP bands for readable inspection and optional vision analysis

WebP cannot exceed `16383px` in either dimension, so DSMD caps the continuous full-page file at that height and records a warning. The band captures still provide end-to-end coverage within `MAX_BANDS_PER_PAGE`.

## Generated output

Each scan is saved under:

```text
data/scans/<generated-slug>/
├── DESIGN.md
├── evidence.json
├── analysis.json
├── tokens.css
├── meta.json
└── screenshots/
    ├── 01-home-desktop.webp
    ├── 01-home-desktop-viewport.webp
    ├── 01-home-desktop-band-01.webp
    └── ...
```

If `DATA_DIR` is changed, replace `data` above with that configured directory.

| Artifact | Contents |
| --- | --- |
| `DESIGN.md` | Human- and agent-readable specification covering provenance, foundations, layout, responsive behavior, components, implementation guidance, confidence, and limitations. |
| `evidence.json` | Source-of-truth aggregate plus page-level measurements, frequencies, contexts, screenshots, layouts, interactions, and failures. |
| `analysis.json` | Validated semantic analysis from Ollama or the deterministic fallback. |
| `tokens.css` | Portable primitive custom properties generated from measured values. DSMD does not invent semantic roles that the evidence cannot prove. |
| `meta.json` | Scan status, options, timestamps, progress, source metadata, and AI usage details. |
| `screenshots/` | Viewport, full-page, and segmented WebP captures for every successful page view. |

The result page can preview the design system, copy or download `DESIGN.md`, inspect raw evidence, retry AI analysis, and download the entire scan directory as a ZIP.

## Available commands

| Command | Description |
| --- | --- |
| `npm run dev` | Runs the Express API and Vite development server together. |
| `npm run dev:server` | Runs only the API with file watching. |
| `npm run dev:web` | Runs only Vite; `/api` and `/scans` proxy to `127.0.0.1:8787`. |
| `npm run setup:browser` | Installs Playwright Chromium. |
| `npm run check:env` | Checks Node, the project root, `.env`, Chromium, Ollama reachability, and configured model visibility. |
| `npm run typecheck` | Runs TypeScript without emitting files. |
| `npm run build` | Builds the React app and bundles the Express server. |
| `npm run check` | Runs the type-check followed by a production build. |
| `npm run test:scanner` | Scans the included local multi-page fixture with AI disabled. |
| `npm run test:ai-repair` | Tests AI-response normalization and repair against a local mock Ollama server. |
| `npm start` | Serves the already-built frontend and API from `dist/` and `dist-server/`. |
| `npm run preview` | Builds the project, then starts the production server. |
| `npm run clean` | Removes generated build directories. |

## Production build

```bash
npm run check
npm start
```

Open [http://127.0.0.1:8787](http://127.0.0.1:8787). In production mode, Express serves both the API and the built React application.

DSMD has no authentication layer. Keep the default loopback host unless you have added appropriate access controls and intentionally want to expose the service.

## HTTP API

The React interface uses these local endpoints:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Reports service, AI, model, and queue status. |
| `GET` | `/api/scans?limit=40` | Lists local scans; `limit` is clamped from `1` to `100`. |
| `POST` | `/api/scans` | Queues a scan. Accepts `url`, `multiPage`, `maxPages`, and `includeMobile`. |
| `GET` | `/api/scans/:slug` | Returns scan metadata and, when complete, all generated result data. |
| `POST` | `/api/scans/:slug/reanalyze` | Re-runs AI interpretation for a completed scan using saved evidence. |
| `DELETE` | `/api/scans/:slug` | Deletes a completed or failed local scan. Running scans cannot be deleted. |
| `GET` | `/api/scans/:slug/files/:file` | Downloads an allowed generated artifact. |
| `GET` | `/api/scans/:slug/bundle` | Streams the complete finished scan as a ZIP. |

Example scan request:

```bash
curl http://127.0.0.1:8787/api/scans \
  --request POST \
  --header 'content-type: application/json' \
  --data '{
    "url": "https://example.com",
    "multiPage": true,
    "maxPages": 8,
    "includeMobile": true
  }'
```

Scans run one at a time in a local in-memory queue. The create endpoint returns `202 Accepted` immediately; poll the returned `statusUrl` or use the progress page until the status becomes `complete` or `failed`.

## Safety and privacy

### Search indexing

DSMD is configured as a private, non-indexable application at several layers:

- every HTML page declares `noindex`, `nofollow`, `noarchive`, `nosnippet`, and `noimageindex`
- `public/robots.txt` disallows all crawlers from every path
- the development and production servers send the same policy in the `X-Robots-Tag` response header
- the server-level header also covers API responses, generated scan artifacts, screenshots, and ZIP downloads

These directives tell compliant search engines, including Google, not to crawl, index, cache, quote, or index images from DSMD. They are not access control. Keep `HOST=127.0.0.1` for a machine-local installation. If DSMD must be reachable by your team over a network, place it behind authentication, a private VPN, or an authenticated access proxy; do not expose the application directly to the public internet.

If an earlier public deployment was already indexed, deploy these changes first and then request removal through the relevant search engine's webmaster tools. The directives prevent continued indexing, while the removal request accelerates disappearance of existing results.

Because the API accepts arbitrary URLs, DSMD applies server-side request-forgery protections by default. It rejects:

- localhost and loopback addresses
- RFC1918 private ranges
- link-local addresses
- cloud metadata-style hostnames
- non-HTTP protocols
- unsafe redirect destinations
- private subresources requested by an otherwise public page

Do not enable the following setting on a shared or deployed instance:

```dotenv
ALLOW_PRIVATE_NETWORKS=true
```

This escape hatch exists for deliberate local fixture testing. Also note that scan data and screenshots are served by the local application under `/scans`; anyone who can access an exposed DSMD instance may be able to access those artifacts.

When hosted AI is enabled, compacted design evidence and up to `MAX_AI_IMAGES` screenshots are sent to the configured Ollama endpoint. Set `OLLAMA_SEND_SCREENSHOTS=false`, use a local daemon, or disable AI if that is inappropriate for the site being analyzed.

## Known limitations

Some sites cannot be measured completely. Common causes include:

- authentication or personalized content
- bot challenges and CAPTCHAs
- geographic or network restrictions
- sites that block headless Chromium
- unusual consent or modal flows
- extremely long or continuously growing pages
- unavailable fonts, stylesheets, or other assets
- obfuscated CSS and deeply encapsulated components
- interactions that require application-specific workflows

DSMD records failed views and coverage gaps instead of fabricating missing evidence. Component detection is heuristic, and `tokens.css` contains measured primitives rather than guaranteed semantic design-token names.

## Troubleshooting

### Chromium is missing

```bash
npm run setup:browser
```

Then rerun `npm run check:env`.

### Ollama is unreachable or unauthorized

- Confirm `OLLAMA_HOST` is only the origin, with no trailing `/api/chat`.
- For `https://ollama.com`, confirm `OLLAMA_API_KEY` is populated and has access to `OLLAMA_MODEL`.
- For local Ollama, confirm the daemon is running and the configured model is installed.
- Set `AI_ENABLED=false` if you want scanning to continue without AI requests.

An Ollama failure does not discard a successful browser scan; DSMD generates the fallback analysis and records the reason in `meta.json`.

### A local or private test URL is blocked

Set `ALLOW_PRIVATE_NETWORKS=true` only for deliberate local testing, then restart the server. Restore it to `false` before scanning untrusted URLs or exposing DSMD to other users.

### A scan is slow

Reduce the page count in the interface, disable responsive scanning, lower `MAX_MOBILE_PAGES`, or disable screenshot input with `OLLAMA_SEND_SCREENSHOTS=false`. Multi-page scans are intentionally serialized to keep browser and AI resource use predictable.

## Project structure

```text
dsmd/
├── src/                     React interface
├── server/
│   ├── ai/                  Ollama client and fallback analysis
│   ├── lib/                 Filesystem, logging, text, and URL safety
│   ├── output/              DESIGN.md and tokens.css generation
│   ├── scanner/             Discovery, browser extraction, and aggregation
│   ├── storage/             Local scan persistence
│   └── types/               Server domain types
├── scripts/                 Environment and regression checks
├── fixtures/site/           Local multi-page scanner fixture
├── data/scans/              Generated results
├── .env.example             Current configuration template
├── setup.command            macOS setup helper
└── start.command            macOS development launcher
```

## License

[MIT](LICENSE). Source websites, screenshots, branding, and extracted design information remain subject to their owners' rights and applicable terms. Use DSMD only for legitimate design analysis and implementation work.
