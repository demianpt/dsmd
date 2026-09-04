import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';

const projectRoot = process.cwd();
dotenv.config({ path: path.join(projectRoot, '.env') });

const numberFromEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

const booleanFromEnv = (name: string, fallback: boolean): boolean => {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
};

export const config = {
  projectRoot,
  port: numberFromEnv('PORT', 8787),
  host: process.env.HOST || '127.0.0.1',
  dataDir: path.resolve(projectRoot, process.env.DATA_DIR || './data'),
  defaultMaxPages: Math.max(1, numberFromEnv('DEFAULT_MAX_PAGES', 8)),
  maxAllowedPages: Math.max(1, numberFromEnv('MAX_ALLOWED_PAGES', 20)),
  maxMobilePages: Math.max(0, numberFromEnv('MAX_MOBILE_PAGES', 3)),
  pageTimeoutMs: Math.max(10_000, numberFromEnv('PAGE_TIMEOUT_MS', 45_000)),
  maxCandidateUrls: Math.max(20, numberFromEnv('MAX_CANDIDATE_URLS', 250)),
  headless: booleanFromEnv('HEADLESS', true),
  allowPrivateNetworks: booleanFromEnv('ALLOW_PRIVATE_NETWORKS', false),
  aiEnabled: booleanFromEnv('AI_ENABLED', true),
  ollamaHost: (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, ''),
  ollamaModel: process.env.OLLAMA_MODEL || 'gemma4:31b',
  ollamaApiKey: process.env.OLLAMA_API_KEY || '',
  ollamaTimeoutMs: Math.max(30_000, numberFromEnv('OLLAMA_TIMEOUT_MS', 600_000)),
  ollamaThinking: process.env.OLLAMA_THINKING || 'high',
  ollamaSendScreenshots: booleanFromEnv('OLLAMA_SEND_SCREENSHOTS', true),
  // Vision models downscale a whole-page capture until small text is unreadable,
  // so each page is also sliced into legible top-to-bottom bands.
  screenshotBandHeight: Math.max(600, numberFromEnv('SCREENSHOT_BAND_HEIGHT', 1400)),
  maxBandsPerPage: Math.max(1, numberFromEnv('MAX_BANDS_PER_PAGE', 6)),
  maxAiImages: Math.max(1, numberFromEnv('MAX_AI_IMAGES', 14))
};

export const scansDir = path.join(config.dataDir, 'scans');
