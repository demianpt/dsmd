#!/bin/bash
set -e
cd "$(dirname "$0")"

printf '\nMyOwnDesignMD setup\n===================\n\n'

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install Node 20 or newer, then run this file again."
  exit 1
fi

NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node.js 20 or newer is required. Current version: $(node --version)"
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

echo "Installing Node packages..."
npm install

echo "Installing Playwright Chromium..."
npm run setup:browser

if command -v ollama >/dev/null 2>&1; then
  echo "Ollama found: $(ollama --version 2>/dev/null || echo installed)"
  echo "The default model is glm-5.3-flash:cloud. Run these if needed:"
  echo "  ollama signin"
  echo "  ollama pull glm-5.3-flash:cloud"
else
  echo "Ollama was not found. Install it from ollama.com, or set AI_ENABLED=false in .env."
fi

npm run check:env || true

printf '\nSetup complete. Start with:\n  ./start.command\n\nor:\n  npm run dev\n\n'
