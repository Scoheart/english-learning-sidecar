import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { validateBaseUrl } from './models.js';

export function loadConfig(env = process.env) {
  const port = Number(env.SIDECAR_PORT ?? 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SIDECAR_PORT must be an integer between 1 and 65535');
  }
  const host = env.SIDECAR_HOST || '127.0.0.1';
  // Loopback is deliberate; model content and prompts must not be exposed on LAN.
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
    throw new Error('SIDECAR_HOST must be a loopback address');
  }
  const dataDir = path.resolve(env.SIDECAR_DATA_DIR || path.join(os.homedir(), '.english-sidecar'));
  const apiKey = env.LEARNING_API_KEY?.trim() || '';
  // Live-only: legacy LEARNING_MODE values no longer enable a synthetic fallback.
  // Stored credentials may also be configured through the UI after startup.
  const mode = apiKey ? 'live' : 'unconfigured';
  const baseUrl = validateBaseUrl(env.LEARNING_BASE_URL || 'https://api.openai.com/v1');
  return {
    port, host, dataDir, mode, apiKey, baseUrl,
    model: env.LEARNING_MODEL || 'gpt-4o-mini',
  };
}

export function ensurePrivateData(config) {
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(config.dataDir, 0o700); } catch { /* Windows may not support POSIX permissions */ }
  const tokenFile = path.join(config.dataDir, 'ingest-token');
  try {
    const token = fs.readFileSync(tokenFile, 'utf8').trim();
    if (token.length >= 32) return token;
    throw new Error('Existing ingest-token is empty or invalid');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const token = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(tokenFile, `${token}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return token;
}
