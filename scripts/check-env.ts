import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';
import { config } from '../server/config.js';

const ok = (label: string, detail = '') => console.log(`✓ ${label}${detail ? ` — ${detail}` : ''}`);
const warn = (label: string, detail = '') => console.warn(`! ${label}${detail ? ` — ${detail}` : ''}`);
const fail = (label: string, detail = '') => console.error(`✗ ${label}${detail ? ` — ${detail}` : ''}`);

let fatal = false;
const major = Number(process.versions.node.split('.')[0]);
if (major >= 20) ok('Node.js', process.version);
else {
  fail('Node.js 20 or newer is required', process.version);
  fatal = true;
}

try {
  await fs.access(path.join(config.projectRoot, 'package.json'));
  ok('Project root', config.projectRoot);
} catch {
  fail('Run this command from the project root.');
  fatal = true;
}

try {
  await fs.access(path.join(config.projectRoot, '.env'));
  ok('.env file found');
} catch {
  warn('.env is missing', 'copy .env.example to .env before running the app');
}

try {
  const executable = chromium.executablePath();
  await fs.access(executable);
  ok('Playwright Chromium', executable);
} catch {
  fail('Playwright Chromium is not installed', 'run npm run setup:browser');
  fatal = true;
}

if (config.aiEnabled) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const headers: Record<string, string> = {};
    if (config.ollamaApiKey) headers.authorization = `Bearer ${config.ollamaApiKey}`;
    const response = await fetch(`${config.ollamaHost}/api/tags`, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as { models?: Array<{ name?: string; model?: string }> };
    const names = (body.models || []).map((item) => item.name || item.model || '');
    ok('Ollama reachable', config.ollamaHost);
    if (names.some((name) => name === config.ollamaModel || name.startsWith(`${config.ollamaModel}:`))) {
      ok('Requested model available', config.ollamaModel);
    } else {
      warn('Requested model is not in the local model list', `run: ollama pull ${config.ollamaModel}`);
    }
  } catch (error) {
    warn('Ollama is not reachable', error instanceof Error ? error.message : String(error));
    warn('Scans will still finish with deterministic prose until Ollama is available.');
  } finally {
    clearTimeout(timer);
  }
} else {
  warn('AI is disabled', 'AI_ENABLED=false; deterministic output remains available');
}

console.log('');
console.log(`Scanner page limit: ${config.defaultMaxPages} default / ${config.maxAllowedPages} maximum`);
console.log(`Responsive page limit: ${config.maxMobilePages}`);
console.log(`Ollama model: ${config.ollamaModel}`);

if (fatal) process.exitCode = 1;
