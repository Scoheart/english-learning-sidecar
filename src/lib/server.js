import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ensurePrivateData } from './config.js';
import { Storage } from './storage.js';
import { createAnalyzer, ModelHTTPError, ModelTimeoutError } from './analyzer.js';
import { normalizeIncomingEvent, normalizeCapturePolicy, isProjectAllowed, extractLearningText, redactSensitive } from './privacy.js';
import { ModelStore, toSafeModel, resolveTextConfig, validateBaseUrl } from './models.js';

import { TEXT_MODEL_PRESETS } from './model-presets.js';

const MODEL_TEST_SAMPLE = '我想把这个问题解释得更清楚。';
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
  // Drain oversized requests without retaining their bodies. Throwing inside a
  // request's async iterator destroys its socket before a 413 can be delivered.
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= MAX_BODY_BYTES) chunks.push(chunk);
  }
  if (size > MAX_BODY_BYTES) {
    const e = new Error('Payload too large');
    e.status = 413;
    throw e;
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

export function createSidecar(config, { analyzer, storage, modelStore, requestFetch = fetch, publicDir = PUBLIC } = {}) {
  const token = ensurePrivateData(config);
  const db = storage || new Storage(config.dataDir);
  const models = modelStore || new ModelStore(config.dataDir, config);
  const clients = new Set();
  let running = false;
  let closed = false;
  let activeJob = null;
  const outboundControllers = new Set();
  // Migrate the obsolete preference; old Auto/Demo values must never enable fake lessons.
  db.setSetting('learningMode', 'live');
  const capturePolicy = () => normalizeCapturePolicy(db.getSetting('capturePolicy', {}));
  const textConfig = () => resolveTextConfig(models.getActiveTextModel(), config);

  function cancelActive(id) {
    if (activeJob && (!id || activeJob.id === id)) activeJob.controller.abort(new DOMException('Analysis cancelled', 'AbortError'));
  }

  // Race the work against cancellation even if a third-party fetch ignores AbortSignal.
  async function cancellable(work, signal) {
    signal.throwIfAborted();
    let onAbort;
    const cancelled = new Promise((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try { return await Promise.race([work(), cancelled]); }
    finally { signal.removeEventListener('abort', onAbort); }
  }

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
    if (closed || running || db.getPaused() || (!analyzer && textConfig().mode !== 'live')) return;
    queueMicrotask(processQueue);
  }

  async function runAnalysis(text, signal) {
    // Also sanitize old queued records created before the privacy migration.
    const safeText = extractLearningText(redactSensitive(text));
    if (!safeText) throw new Error('No natural-language study material remains after privacy filtering');
    if (analyzer) return analyzer(safeText, { signal });
    return createAnalyzer(textConfig(), requestFetch)(safeText, { signal });
  }

  async function processQueue() {
    if (closed || running || db.getPaused() || (!analyzer && textConfig().mode !== 'live')) return;
    running = true;
    try {
      let pending;
      while (!closed && !db.getPaused() && (analyzer || textConfig().mode === 'live') && (pending = db.nextPending())) {
        db.setProcessing(pending.id);
        broadcast();
        const job = { id: pending.id, controller: new AbortController() };
        activeJob = job;
        try {
          const result = await cancellable(() => runAnalysis(pending.content, job.controller.signal), job.controller.signal);
          if (closed) break;
          if (!job.controller.signal.aborted) db.finish(pending.id, result);
        } catch (err) {
          if (closed) break;
          if (!job.controller.signal.aborted) db.fail(pending.id, redactSensitive(err.message || 'Unknown model error'));
        } finally {
          if (activeJob === job) activeJob = null;
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
        const current = textConfig();
        return json(res, 200, {
          mode: current.mode,
          configurationMessage: current.mode === 'live' ? null : '请先接入模型：在设置中填写地址、模型和认证方式。',
          capturePolicy: capturePolicy(),
          model: current.model,
          paused: db.getPaused(),
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

      if (req.method === 'GET' && pathname === '/api/history') {
        return json(res, 200, db.listHistory({
          q: url.searchParams.get('q') ?? '',
          category: url.searchParams.get('category') ?? 'all',
          offset: url.searchParams.get('offset') ?? 0,
          limit: url.searchParams.get('limit') ?? 60,
        }));
      }

      if (req.method === 'GET' && pathname === '/api/favorites') {
        return json(res, 200, { favorites: db.listFavorites() });
      }

      if (req.method === 'POST' && pathname === '/api/favorites') {
        const result = db.addFavorite(await readJson(req));
        if (!result.duplicate) broadcast();
        return json(res, result.duplicate ? 200 : 201, result);
      }

      const favoriteRemove = pathname.match(/^\/api\/favorites\/([0-9a-f-]+)$/i);
      if (req.method === 'DELETE' && favoriteRemove) {
        const removed = db.deleteFavorite(favoriteRemove[1]);
        if (removed) broadcast();
        return json(res, removed ? 200 : 404, { removed });
      }

      if (req.method === 'GET' && pathname === '/api/models') {
        return json(res, 200, { ...models.list(), textPresets: TEXT_MODEL_PRESETS });
      }

      if (req.method === 'POST' && pathname === '/api/models/test') {
        const model = models.prepareTextTest(await readJson(req));
        if (closed || res.destroyed) return;
        const controller = new AbortController();
        const disconnect = () => controller.abort();
        outboundControllers.add(controller);
        res.on('close', disconnect);
        try {
          const lesson = await createAnalyzer(model, requestFetch)(MODEL_TEST_SAMPLE, { signal: controller.signal });
          if (res.destroyed) return;
          if (!/\b[A-Za-z]{2,}\b/.test(lesson.translation) || /\p{Script=Han}/u.test(lesson.translation)) {
            return json(res, 502, { error: '学习卡没有返回这条样例的英文翻译。请换一个模型。' });
          }
          return json(res, 200, { translation: lesson.translation });
        } catch (error) {
          if (res.destroyed) return;
          if (error instanceof ModelHTTPError) {
            return json(res, 502, { error: `模型服务返回 HTTP ${error.upstreamStatus}。请检查地址、模型 ID 和权限。` });
          }
          if (error instanceof ModelTimeoutError) {
            return json(res, 504, { error: `模型在 ${error.seconds} 秒内未返回学习卡。` });
          }
          return json(res, 502, { error: '无法调用模型，或模型未返回有效的学习卡。请检查连接或换一个模型。' });
        } finally {
          outboundControllers.delete(controller);
          res.off('close', disconnect);
        }
        return;
      }

      if (req.method === 'POST' && pathname === '/api/models') {
        const body = await readJson(req);
        const created = models.addModel(body);
        broadcast(); schedule();
        return json(res, 201, { model: created, ...models.list() });
      }

      const modelIdMatch = pathname.match(/^\/api\/models\/([0-9a-f-]+)$/i);
      if ((req.method === 'PATCH' || req.method === 'PUT') && modelIdMatch) {
        const body = await readJson(req);
        const updated = models.updateModel(modelIdMatch[1], body);
        broadcast(); schedule();
        return json(res, 200, { model: updated, ...models.list() });
      }

      if (req.method === 'DELETE' && modelIdMatch) {
        const removed = models.deleteModel(modelIdMatch[1]);
        if (!removed) return json(res, 404, { error: 'Model not found' });
        broadcast(); schedule();
        return json(res, 200, { removed: true, ...models.list() });
      }

      const activeMatch = pathname.match(/^\/api\/models\/([0-9a-f-]+)\/active$/i);
      if (req.method === 'POST' && activeMatch) {
        const state = models.setActive(activeMatch[1]);
        broadcast(); schedule();
        return json(res, 200, state);
      }

      if (req.method === 'GET' && pathname === '/api/settings') {
        return json(res, 200, {
          paused: db.getPaused(), capturePolicy: capturePolicy(),
          ...models.list(),
        });
      }

      if (req.method === 'POST' && pathname === '/api/settings') {
        const body = await readJson(req);
        if (!body || typeof body !== 'object' || Array.isArray(body)) return json(res, 400, { error: 'Expected settings object' });
        if (body.learningMode !== undefined && body.learningMode !== 'live') return json(res, 400, { error: '仅支持 Live，请先接入真实模型。' });
        const nextPolicy = body.capturePolicy !== undefined ? normalizeCapturePolicy(body.capturePolicy, { strict: true }) : null;
        if (body.paused !== undefined && typeof body.paused !== 'boolean') return json(res, 400, { error: 'paused must be boolean' });
        const selectionChanged = Object.hasOwn(body, 'activeTextId') || Object.hasOwn(body, 'activeSpeechId');
        const hasDraft = Object.hasOwn(body, 'modelDraft');
        if (hasDraft && selectionChanged) return json(res, 400, { error: 'modelDraft cannot be combined with top-level active model IDs' });
        const previousModels = hasDraft || selectionChanged ? models.load() : null;
        // Complete all draft validation before opening the SQL transaction or saving any models.
        const nextModels = hasDraft ? models.prepareDraft(body.modelDraft, previousModels) : null;
        db.db.exec('BEGIN');
        let modelSaved = false;
        try {
          if (hasDraft || selectionChanged) {
            modelSaved = true; // Also restore the snapshot if a file write itself fails partway.
            if (hasDraft) models.save(nextModels);
            else models.selectActive(body); // Validates both IDs before saving either.
          }
          if (body.learningMode !== undefined) db.setSetting('learningMode', body.learningMode);
          if (nextPolicy) db.setSetting('capturePolicy', nextPolicy);
          if (typeof body.paused === 'boolean') db.setPaused(body.paused);
          db.db.exec('COMMIT');
        } catch (error) {
          try { db.db.exec('ROLLBACK'); }
          finally { if (modelSaved) models.save(previousModels); }
          throw error;
        }
        broadcast();
        schedule();
        return json(res, 200, {
          paused: db.getPaused(), capturePolicy: capturePolicy(),
          ...models.list(),
        });
      }

      if (req.method === 'POST' && pathname === '/api/tts') {
        const speechModel = models.getActiveSpeechModel();
        if (!speechModel) {
          return json(res, 400, { error: 'No TTS model configured' });
        }
        if (!speechModel.apiKey) {
          return json(res, 400, { error: 'TTS model has no API key' });
        }
        const speechBaseUrl = validateBaseUrl(speechModel.baseUrl);
        const body = await readJson(req);
        const input = extractLearningText(redactSensitive(String(body?.input || ''))).trim();
        if (!input) {
          return json(res, 400, { error: 'TTS input is required' });
        }

        const controller = new AbortController();
        outboundControllers.add(controller);
        const disconnect = () => { if (!res.writableEnded) controller.abort(); };
        res.on('close', disconnect);
        const timeout = setTimeout(() => controller.abort(), 20000);
        let ttsRes;
        try {
          ttsRes = await requestFetch(`${speechBaseUrl}/audio/speech`, {
            method: 'POST',
            redirect: 'error',
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
            // Never reflect upstream bodies: they can contain credentials or submitted text.
            return json(res, 502, { error: `TTS upstream error (${ttsRes.status})` });
          }
          const contentType = ttsRes.headers.get('content-type') || 'audio/mpeg';
          if (!contentType.startsWith('audio/') && contentType !== 'application/octet-stream') throw new Error('Invalid audio response');
          const arrayBuffer = await ttsRes.arrayBuffer();
          if (controller.signal.aborted || res.destroyed) return;
          res.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' });
          res.end(Buffer.from(arrayBuffer));
          return;
        } catch (err) {
          if (!res.destroyed) return json(res, 502, { error: controller.signal.aborted ? 'TTS request cancelled or timed out' : 'TTS request failed' });
        } finally {
          clearTimeout(timeout);
          controller.abort();
          if (ttsRes?.body && !ttsRes.bodyUsed) void ttsRes.body.cancel().catch(() => {});
          res.off('close', disconnect);
          outboundControllers.delete(controller);
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
        const body = await readJson(req);
        if (!isProjectAllowed(body?.projectPath, capturePolicy())) return json(res, 202, { ignored: true, reason: 'project-policy' });
        const event = normalizeIncomingEvent(body);
        if (event.ignoredReason) return json(res, 202, { ignored: true, reason: event.ignoredReason });
        const result = db.addEvent(event);
        if (!result.deduplicated) {
          broadcast();
          schedule();
        }
        return json(res, 202, result);
      }

      const eventCancel = pathname.match(/^\/api\/events\/([0-9a-f-]+)\/cancel$/);
      if (req.method === 'POST' && eventCancel) {
        const updated = db.cancel(eventCancel[1]);
        if (!updated) return json(res, 409, { error: 'Only queued or processing records may be cancelled' });
        cancelActive(eventCancel[1]);
        broadcast(); schedule();
        return json(res, 200, { cancelled: true });
      }
      const eventRetry = pathname.match(/^\/api\/events\/([0-9a-f-]+)\/retry$/);
      if (req.method === 'POST' && eventRetry) {
        const updated = db.retry(eventRetry[1]);
        if (!updated) return json(res, 409, { error: 'Only failed or cancelled records may be retried' });
        broadcast();
        schedule();
        return json(res, 202, { ok: true });
      }

      const eventRemove = pathname.match(/^\/api\/events\/([0-9a-f-]+)$/);
      if (req.method === 'GET' && eventRemove) {
        const event = db.getEvent(eventRemove[1]);
        return json(res, event ? 200 : 404, event ? { event } : { error: 'Event not found' });
      }
      if (req.method === 'DELETE' && eventRemove) {
        const knowledge = url.searchParams.get('knowledge') || 'keep';
        if (!['keep', 'purge'].includes(knowledge)) return json(res, 400, { error: 'knowledge must be keep or purge' });
        const removed = db.delete(eventRemove[1], { purgeKnowledge: knowledge === 'purge' });
        if (removed) cancelActive(eventRemove[1]);
        broadcast();
        return json(res, removed ? 200 : 404, { removed });
      }

      if (req.method === 'GET' && (Object.hasOwn(MIME, pathname) || pathname.startsWith('/assets/'))) {
        const decoded = decodeURIComponent(pathname);
        if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').includes('..')) return json(res, 404, { error: 'Not found' });
        const root = fs.realpathSync(publicDir);
        const candidate = path.resolve(root, decoded === '/' ? 'index.html' : `.${decoded}`);
        if (!candidate.startsWith(root + path.sep) || !fs.existsSync(candidate)) return json(res, 404, { error: 'Not found' });
        const localFile = fs.realpathSync(candidate);
        if (!localFile.startsWith(root + path.sep) || !fs.statSync(localFile).isFile()) return json(res, 404, { error: 'Not found' });
        const types = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json' };
        const type = MIME[pathname] || types[path.extname(localFile)];
        if (!type) return json(res, 404, { error: 'Not found' });
        const body = fs.readFileSync(localFile);
        res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
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
      cancelActive();
      for (const controller of outboundControllers) controller.abort();
      outboundControllers.clear();
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
