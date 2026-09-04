# Start here

## 1. Unzip the project

Open Terminal inside the extracted `myowndesignmd` folder.

## 2. Configure it

```bash
cp .env.example .env
```

The defaults already point to:

```dotenv
OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_MODEL=glm-5.3-flash:cloud
```

For Ollama Cloud through your local Ollama app:

```bash
ollama signin
ollama pull glm-5.3-flash:cloud
```

No application login, subscription or credit system exists in this project.

## 3. Install and run

### macOS shortcut

Double-click `setup.command`, then `start.command`.

### Terminal

```bash
npm install
npm run setup:browser
npm run check:env
npm run dev
```

Open **http://localhost:5173**.

## 4. Generate a design system

Paste a public website URL, keep **Multi-page** enabled, choose the maximum representative page count, and start the scan.

Every completed scan is stored under:

```text
data/scans/<generated-slug>/
```

It contains:

- `DESIGN.md`
- `evidence.json`
- `analysis.json`
- `tokens.css`
- desktop/mobile screenshots
- scan metadata

The result page also provides one ZIP containing the complete generated design-system bundle.

## Important

The app itself is local, has no quotas, and works without AI through its deterministic fallback. `glm-5.3-flash:cloud` is an Ollama-hosted model, so Ollama controls cloud availability and any account-side usage policy. To make the AI step fully local as well, install a capable local Ollama model and replace `OLLAMA_MODEL` in `.env`.
