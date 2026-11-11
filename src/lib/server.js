import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ensurePrivateData } from './config.js';
import { Storage } from './storage.js';
import { createAnalyzer } from './analyzer.js';
import { normalizeIncomingEvent } from './privacy.js';
import { ModelStore, toSafeModel } from './models.js';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MAX_BODY_BYTES = 128 * 1024;
const MIME = {
  '/': 'text/html; charset=utf-8',
  '/index.html': 'text/html; charset=utf-8',
  '/app.js': 'text/javascript; charset=utf-8',
  '/icons.js': 'text/javascript; charset=utf-8',
  '/styles.css': 'text/css; charset=utf-8',
};

function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    const e = new Error('Content-Type must be application/json');
    e.status = 415;
    throw e;
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const e = new Error('Payload too large');
      e.status = 413;
      throw e;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const e = new Error('Invalid JSON');
    e.status = 400;
    throw e;
  }
}

function sameToken(input, expected) {
  if (!input || typeof input !== 'string') return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sameOrigin(req, port) {
  const origin = req.headers.origin;
  if (!origin) return true; // CLI and local utilities do not send Origin.
  try {
    const url = new URL(origin);
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && Number(url.port || 80) === port;
  } catch {
    return false;
  }
}

export function createSidecar(config, { analyzer, storage, modelStore, requestFetch = fetch } = {}) {
  const token = ensurePrivateData(config);
  const db = storage || new Storage(config.dataDir);
  const models = modelStore || new ModelStore(config.dataDir, config);
  const clients = new Set();
  let running = false;
  let closed = false;
  let idleTimer = null;

  function broadcast(kind = 'update') {
    const data = `event: ${kind}\ndata: ${JSON.stringify({ time: new Date().toISOString() })}\n\n`;
    for (const client of clients) {
      try {
        client.write(data);
      } catch {
        clients.delete(client);
      }
    }
  }

  function schedule() {
    if (closed || running || db.getPaused()) return;
    queueMicrotask(processQueue);
  }

  async function runAnalysis(text) {
    if (analyzer) return analyzer(text);
    const activeText = models.getActiveTextModel();
    const currentConfig = {
      baseUrl: activeText?.baseUrl || config.baseUrl,
      model: activeText?.model || config.model,
      apiKey: activeText?.apiKey || config.apiKey,
      temperature: activeText ? activeText.temperature : null,
      mode: config.mode,
    };
    const dynamicAnalyzer = createAnalyzer(currentConfig, requestFetch);
    return dynamicAnalyzer(text);
  }

  async function processQueue() {
    if (closed || running || db.getPaused()) return;
    running = true;
    try {
      let pending;
      while (!closed && !db.getPaused() && (pending = db.nextPending())) {
        db.setProcessing(pending.id);
        broadcast();
        try {
          const result = await runAnalysis(pending.content);
          if (closed) break;
          db.finish(pending.id, result);
        } catch (err) {
          if (closed) break;
          db.fail(pending.id, err.message || 'Unknown model error');
        }
        broadcast();
      }
    } finally {
      running = false;
    }
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'self' blob: data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    );

    // Reject DNS rebinding: a malicious hostname resolving to loopback must not read local data.
    const actualPort = server.address()?.port || config.port;
    const allowedHosts = new Set([`127.0.0.1:${actualPort}`, `localhost:${actualPort}`, `[::1]:${actualPort}`]);
    if (!allowedHosts.has(req.headers.host)) return json(res, 403, { error: 'Invalid Host header' });
    const url = new URL(req.url || '/', `http://127.0.0.1:${config.port}`);
    const pathname = url.pathname;
    if (!sameOrigin(req, server.address()?.port ?? config.port)) {
      return json(res, 403, { error: 'Cross-origin requests are not allowed' });
    }

    try {
      if (req.method === 'GET' && pathname === '/api/status') {
        const activeText = models.getActiveTextModel();
        const activeSpeech = models.getActiveSpeechModel();
        const currentModelName = activeText?.model || config.model;
        return json(res, 200, {
          mode: config.mode,
          model: config.mode === 'live' ? currentModelName : 'Demo preview',
          paused: db.getPaused(),
          demoEnabled: config.demoEnabled,
          stats: db.stats(),
          host: config.host,
          port: server.address()?.port || config.port,
          activeTextModel: activeText ? toSafeModel(activeText) : null,
          activeSpeechModel: activeSpeech ? toSafeModel(activeSpeech) : null,
        });
      }

      if (req.method === 'GET' && pathname === '/api/events') {
        return json(res, 200, {
          events: db.listEvents({
            status: url.searchParams.get('status') || '',
            source: url.searchParams.get('source') || '',
            limit: url.searchParams.get('limit') || 80,
          }),
        });
      }

      if (req.method === 'GET' && pathname === '/api/knowledge') {
        return json(res, 200, { knowledge: db.listKnowledge() });
      }

      if (req.method === 'GET' && pathname === '/api/models') {
        return json(res, 200, models.list());
      }

      if (req.method === 'POST' && pathname === '/api/models') {
        const body = await readJson(req);
        const created = models.addModel(body);
        broadcast();
        return json(res, 201, { model: created, ...models.list() });
      }

      const modelIdMatch = pathname.match(/^\/api\/models\/([0-9a-f-]+)$/i);
      if ((req.method === 'PATCH' || req.method === 'PUT') && modelIdMatch) {
        const body = await readJson(req);
        const updated = models.updateModel(modelIdMatch[1], body);
        broadcast();
        return json(res, 200, { model: updated, ...models.list() });
      }

      if (req.method === 'DELETE' && modelIdMatch) {
        const removed = models.deleteModel(modelIdMatch[1]);
        if (!removed) return json(res, 404, { error: 'Model not found' });
        broadcast();
        return json(res, 200, { removed: true, ...models.list() });
      }

      const activeMatch = pathname.match(/^\/api\/models\/([0-9a-f-]+)\/active$/i);
      if (req.method === 'POST' && activeMatch) {
        const state = models.setActive(activeMatch[1]);
        broadcast();
        return json(res, 200, state);
      }

      if (req.method === 'GET' && pathname === '/api/settings') {
        return json(res, 200, {
          paused: db.getPaused(),
          ...models.list(),
        });
      }

      if (req.method === 'POST' && pathname === '/api/settings') {
        const body = await readJson(req);
        if (typeof body.paused === 'boolean') {
          db.setPaused(body.paused);
          if (!body.paused) schedule();
        }
        if (body.activeTextId) {
          models.setActive(body.activeTextId, 'text');
        }
        if (body.activeSpeechId) {
          models.setActive(body.activeSpeechId, 'speech');
        }
        broadcast();
        return json(res, 200, {
          paused: db.getPaused(),
          ...models.list(),
        });
      }

      if (req.method === 'POST' && pathname === '/api/tts') {
        const speechModel = models.getActiveSpeechModel();
        if (!speechModel) {
          return json(res, 400, { error: 'No TTS model configured' });
        }
        if (config.mode === 'demo' && !speechModel.apiKey) {
          return json(res, 400, { error: 'TTS disabled in demo mode without API key' });
        }
        if (!speechModel.apiKey) {
          return json(res, 400, { error: 'TTS model has no API key' });
        }
        const body = await readJson(req);
        const input = String(body?.input || '').trim();
        if (!input) {
          return json(res, 400, { error: 'TTS input is required' });
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        try {
          const ttsRes = await requestFetch(`${speechModel.baseUrl}/audio/speech`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${speechModel.apiKey}`,
            },
            body: JSON.stringify({
              model: speechModel.model,
              input: input.slice(0, 4096),
              voice: speechModel.voice || 'marin',
            }),
            signal: controller.signal,
          });
          if (!ttsRes.ok) {
            const errText = await ttsRes.text().catch(() => '');
            return json(res, 502, { error: `TTS upstream error (${ttsRes.status}): ${errText.slice(0, 200)}` });
          }
          const contentType = ttsRes.headers.get('content-type') || 'audio/mpeg';
          res.writeHead(200, {
            'content-type': contentType,
            'cache-control': 'no-store',
          });
          const arrayBuffer = await ttsRes.arrayBuffer();
          res.end(Buffer.from(arrayBuffer));
          return;
        } catch (err) {
          return json(res, 502, { error: `TTS request failed: ${err.message}` });
        } finally {
          clearTimeout(timeout);
        }
      }

      if (req.method === 'GET' && pathname === '/api/stream') {
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        });
        res.write(': connected\n\n');
        clients.add(res);
        const interval = setInterval(() => {
          if (res.destroyed) return clearInterval(interval);
          res.write(': keepalive\n\n');
        }, 20000);
        req.on('close', () => {
          clearInterval(interval);
          clients.delete(res);
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/events') {
        if (!sameToken(req.headers['x-sidecar-token'], token)) return json(res, 401, { error: 'Unauthorized' });
        if (db.getPaused()) return json(res, 202, { ignored: true, reason: 'paused' });
        const event = normalizeIncomingEvent(await readJson(req));
        const result = db.addEvent(event);
        if (!result.deduplicated) {
          broadcast();
          schedule();
        }
        return json(res, 202, result);
      }

      if (req.method === 'POST' && pathname === '/api/demo') {
        if (!config.demoEnabled) return json(res, 404, { error: 'Demo fixture disabled' });
        if (db.getPaused()) return json(res, 409, { error: 'Collection paused' });
        const body = await readJson(req);
        const event = normalizeIncomingEvent({
          source: 'manual',
          sessionId: 'ui-demo',
          turnId: crypto.randomUUID(),
          content: body.prompt,
        });
        const result = db.addEvent(event);
        broadcast();
        schedule();
        return json(res, 202, result);
      }

      const eventRetry = pathname.match(/^\/api\/events\/([0-9a-f-]+)\/retry$/);
      if (req.method === 'POST' && eventRetry) {
        const updated = db.retry(eventRetry[1]);
        if (!updated) return json(res, 409, { error: 'Only failed records may be retried' });
        broadcast();
        schedule();
        return json(res, 202, { ok: true });
      }

      const eventRemove = pathname.match(/^\/api\/events\/([0-9a-f-]+)$/);
      if (req.method === 'DELETE' && eventRemove) {
        const removed = db.delete(eventRemove[1]);
        broadcast();
        return json(res, removed ? 200 : 404, { removed });
      }

      if (req.method === 'GET' && Object.hasOwn(MIME, pathname)) {
        const localFile = path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname.slice(1));
        const body = fs.readFileSync(localFile);
        res.writeHead(200, { 'content-type': MIME[pathname], 'cache-control': 'no-store' });
        res.end(body);
        return;
      }

      return json(res, 404, { error: 'Not found' });
    } catch (error) {
      return json(res, error.status || 400, { error: error.message || 'Unexpected error' });
    }
  });

  return {
    server,
    storage: db,
    models,
    start() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.port, config.host, () => {
          server.off('error', reject);
          schedule();
          resolve(server.address());
        });
      });
    },
    close() {
      closed = true;
      clearTimeout(idleTimer);
      for (const client of clients) client.end();
      clients.clear();
      return new Promise((resolve) =>
        server.close(() => {
          db.close();
          resolve();
        })
      );
    },
  };
}
