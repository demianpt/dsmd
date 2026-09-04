#!/bin/bash
set -e
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "Dependencies are not installed. Running setup first..."
  ./setup.command
fi

if [ ! -f .env ]; then
  cp .env.example .env
fi

if command -v open >/dev/null 2>&1; then
  (sleep 2 && open http://localhost:5173) >/dev/null 2>&1 &
fi

npm run dev
