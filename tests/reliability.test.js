import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSidecar } from '../src/lib/server.js';
import { Storage } from '../src/lib/storage.js';
import { ModelStore, resolveTextConfig, validateBaseUrl } from '../src/lib/models.js';
import { createAnalyzer, validateAnalysis } from '../src/lib/analyzer.js';
import { loadConfig } from '../src/lib/config.js';
import { DatabaseSync } from 'node:sqlite';

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-reliability-'));
  t.after(() => {
    assert.ok(path.resolve(dir).startsWith(path.join(os.tmpdir(), 'sidecar-reliability-')));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
async function fixture(t, overrides = {}, dependencies = {}) {
  const dir = temp(t);
  const app = createSidecar({ host: '127.0.0.1', port: 0, dataDir: dir, mode: 'unconfigured', apiKey: '', baseUrl: 'https://example.invalid/v1', model: 'test', ...overrides }, dependencies);
  await app.start();
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const token = fs.readFileSync(path.join(dir, 'ingest-token'), 'utf8').trim();
  const call = async (route, method = 'GET', body, headers = {}) => {
    const response = await fetch(base + route, { method, headers: { 'content-type': 'application/json', 'x-sidecar-token': token, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { response, body: await response.json() };
  };
  return { app, dir, base, call };
}
async function until(check) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('Expected state was not reached');
}
const input = (turnId, content = 'Explain how this system works') => ({ source: 'codex', sessionId: 'test', turnId, content });
const lesson = { translation: 'Explain this system.', vocabulary: [{ term: 'system', meaning: '系统' }], grammar: [] };

test('mode uses complete active configuration, never another provider key', async t => {
  const s = await fixture(t, { apiKey: 'env-key' });
  const { body: initial } = await s.call('/api/status');
  assert.equal(initial.mode, 'live');
  const { body: added } = await s.call('/api/models', 'POST', { name: 'Other', kind: 'text', baseUrl: 'https://other.invalid/v1', model: 'other', apiKey: '' });
  await s.call(`/api/models/${added.model.id}/active`, 'POST');
  const selected = resolveTextConfig(s.app.models.getActiveTextModel(), { apiKey: 'env-key', model: 'old' }, 'live');
  assert.equal(selected.apiKey, '');
  assert.equal(selected.mode, 'unconfigured');
  await s.call('/api/settings', 'POST', { learningMode: 'live' });
  assert.equal((await s.call('/api/status')).body.mode, 'unconfigured');
  await s.call(`/api/models/${added.model.id}`, 'PATCH', { apiKey: 'new-key' });
  assert.equal((await s.call('/api/status')).body.mode, 'live');
  for (const learningMode of ['demo', 'auto']) {
    assert.equal((await s.call('/api/settings', 'POST', { learningMode })).response.status, 400);
  }
  assert.equal((await s.call('/api/status')).body.mode, 'live');
});

test('missing credentials keep work queued and configuring a model resumes it without Demo fallback', async t => {
  let requests = 0;
  const legacyDb = new Storage(temp(t));
  legacyDb.setSetting('learningMode', 'demo');
  const s = await fixture(t, { mode: 'demo', modeSetting: 'demo' }, { storage: legacyDb, requestFetch: async () => {
    requests++;
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(lesson) } }] }) };
  } });
  assert.equal(legacyDb.getSetting('learningMode'), 'live');
  const status = (await s.call('/api/status')).body;
  assert.equal(status.mode, 'unconfigured');
  assert.match(status.configurationMessage, /请先接入模型/);
  const id = (await s.call('/api/events', 'POST', input('needs-key'))).body.id;
  assert.equal(s.app.storage.getEvent(id).status, 'pending');
  assert.equal(s.app.storage.getEvent(id).analysis, null);
  assert.equal(requests, 0);
  const activeId = (await s.call('/api/models')).body.activeTextId;
  await s.call(`/api/models/${activeId}`, 'PATCH', { apiKey: 'fake-key' });
  await until(() => s.app.storage.getEvent(id)?.status === 'complete');
  assert.equal(requests, 1);
  assert.equal((await s.call('/api/status')).body.mode, 'live');
  await s.call(`/api/models/${activeId}`, 'PATCH', { apiKey: '' });
  const waiting = (await s.call('/api/events', 'POST', input('key-cleared'))).body.id;
  assert.equal(s.app.storage.getEvent(waiting).status, 'pending');
  assert.equal(requests, 1);
  assert.equal(loadConfig({ LEARNING_MODE: 'demo', LEARNING_API_KEY: 'fake-key' }).mode, 'live');
  assert.equal(loadConfig({ LEARNING_MODE: 'auto' }).mode, 'unconfigured');
});

test('provider URL change clears old key; explicit replacement and clearing work', t => {
  const store = new ModelStore(temp(t), { apiKey: 'old-provider-key', baseUrl: 'https://one.invalid/v1', model: 'one' });
  const id = store.list().activeTextId;
  store.updateModel(id, { baseUrl: 'https://two.invalid/v1' });
  assert.equal(store.getActiveTextModel().apiKey, '');
  store.updateModel(id, { baseUrl: 'https://three.invalid/v1', apiKey: 'new-key' });
  assert.equal(store.getActiveTextModel().apiKey, 'new-key');
  store.updateModel(id, { apiKey: '' });
  assert.equal(store.getActiveTextModel().apiKey, '');
  assert.throws(() => validateBaseUrl('https://user:pass@example.invalid/v1'), /credentials/);
  assert.throws(() => validateBaseUrl('https://example.invalid/v1?key=secret'), /query/);
  fs.writeFileSync(store.filePath, 'not json');
  assert.throws(() => store.getActiveTextModel(), /unreadable/);
});

test('project policy rejects before persistence and never exposes raw project path', async t => {
  const s = await fixture(t, {}, { analyzer: async () => lesson });
  await s.call('/api/settings', 'POST', { capturePolicy: { mode: 'allowlist', allowedProjects: ['/work/public'], excludedProjects: ['/work/public/private'] } });
  for (const projectPath of [undefined, '/work/public-other', '/work/public/private']) {
    const result = await s.call('/api/events', 'POST', { ...input(String(projectPath)), projectPath });
    assert.equal(result.body.reason, 'project-policy');
  }
  assert.equal(s.app.storage.stats().total, 0);
  const result = await s.call('/api/events', 'POST', { ...input('allowed'), projectPath: '/work/public/app' });
  assert.equal(result.response.status, 202);
  await until(() => s.app.storage.getEvent(result.body.id)?.status === 'complete');
  const events = (await s.call('/api/events')).body;
  assert.equal(JSON.stringify(events).includes('/work/public'), false);
});

test('purge removes only this lesson contribution and preserves shared knowledge', t => {
  const db = new Storage(temp(t));
  t.after(() => db.close());
  const a = db.addEvent({ ...input('one'), eventType: 'user.prompt.submitted', eligible: true }).id;
  const b = db.addEvent({ ...input('two'), eventType: 'user.prompt.submitted', eligible: true }).id;
  db.finish(a, lesson); db.finish(b, lesson);
  assert.equal(db.listKnowledge()[0].encounters, 2);
  db.delete(a, { purgeKnowledge: true });
  assert.equal(db.listKnowledge()[0].encounters, 1);
  db.delete(b, { purgeKnowledge: true });
  assert.equal(db.listKnowledge().length, 0);
  const c = db.addEvent({ ...input('three'), eventType: 'user.prompt.submitted', eligible: true }).id;
  db.finish(c, lesson); db.delete(c);
  assert.equal(db.listKnowledge()[0].encounters, 1);
});

test('deleted/cancelled records cannot create orphan knowledge', t => {
  const db = new Storage(temp(t)); t.after(() => db.close());
  for (const action of ['delete', 'cancel']) {
    const id = db.addEvent({ ...input(action), eventType: 'user.prompt.submitted', eligible: true }).id;
    db.setProcessing(id); db[action](id);
    assert.equal(db.finish(id, lesson), false);
    assert.equal(db.listKnowledge().length, 0);
    assert.equal(db.db.prepare('SELECT COUNT(*) n FROM event_knowledge').get().n, 0);
    if (action === 'cancel') { db.fail(id, 'late failure'); assert.equal(db.getEvent(id).status, 'cancelled'); assert.equal(db.retry(id), true); }
  }
});

test('cancel releases queue and ignores a late result even if analyzer ignores signal', async t => {
  let release;
  let firstSignal;
  let calls = 0;
  const s = await fixture(t, {}, { analyzer: async (_text, { signal }) => {
    if (++calls === 1) { firstSignal = signal; return new Promise(resolve => { release = resolve; }); }
    return lesson;
  } });
  const first = (await s.call('/api/events', 'POST', input('first'))).body.id;
  await until(() => Boolean(release));
  assert.equal((await s.call(`/api/events/${first}/cancel`, 'POST')).response.status, 200);
  assert.equal(firstSignal.aborted, true);
  const second = (await s.call('/api/events', 'POST', input('second'))).body.id;
  await until(() => s.app.storage.getEvent(second)?.status === 'complete');
  release(lesson);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.app.storage.getEvent(first).status, 'cancelled');
  assert.equal(s.app.storage.listKnowledge()[0].encounters, 1);
});

test('deletion aborts active work and late completion cannot resurrect it', async t => {
  let release, capturedSignal;
  const s = await fixture(t, {}, { analyzer: (_text, { signal }) => { capturedSignal = signal; return new Promise(resolve => { release = resolve; }); } });
  const id = (await s.call('/api/events', 'POST', input('delete'))).body.id;
  await until(() => Boolean(release));
  assert.equal((await s.call(`/api/events/${id}?knowledge=purge`, 'DELETE')).response.status, 200);
  assert.equal(capturedSignal.aborted, true);
  release(lesson);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.app.storage.getEvent(id), null);
  assert.equal(s.app.storage.stats().knowledge, 0);
});

test('legacy queued content is filtered again before analysis', async t => {
  let captured;
  const s = await fixture(t, {}, { analyzer: async text => { captured = text; return lesson; } });
  const id = s.app.storage.addEvent({ ...input('legacy', 'Explain this problem\n```js\nconst password = "private";\n```'), eventType: 'user.prompt.submitted', eligible: true }).id;
  await s.call('/api/settings', 'POST', { paused: false });
  await until(() => s.app.storage.getEvent(id)?.status === 'complete');
  assert.equal(captured, 'Explain this problem');
});

test('static assets are served but traversal, unknown extensions and escaping symlinks are rejected', async t => {
  const root = temp(t);
  fs.mkdirSync(path.join(root, 'assets'));
  fs.writeFileSync(path.join(root, 'assets/chunk.js'), 'export const answer = 42;');
  fs.writeFileSync(path.join(root, 'assets/private.txt'), 'private');
  const outside = temp(t);
  fs.writeFileSync(path.join(outside, 'secret.js'), 'private outside asset');
  fs.symlinkSync(outside, path.join(root, 'assets/out'));
  const s = await fixture(t, {}, { publicDir: root });
  assert.equal((await fetch(s.base + '/assets/chunk.js')).status, 200);
  for (const route of ['/assets/private.txt', '/assets/out/secret.js', '/assets/%2e%2e%2fprivate.txt', '/assets/missing.js']) assert.equal((await fetch(s.base + route)).status, 404);
  assert.equal((await s.call('/api/settings', 'POST', { paused: true }, { origin: 'https://attacker.invalid' })).response.status, 403);
});

test('analyzer preserves cancellation reason and missing fields remain unknown', async () => {
  const controller = new AbortController();
  const analyze = createAnalyzer({ mode: 'live', apiKey: 'fake', model: 'test', baseUrl: 'https://example.invalid' }, async (_url, { signal }) => {
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  });
  const task = analyze('Explain this', { signal: controller.signal });
  controller.abort(new DOMException('User cancelled', 'AbortError'));
  await assert.rejects(task, /User cancelled/);
  const parsed = validateAnalysis({ translation: 'Hello', corrections: [{ before: 'foo', after: 'bar' }] });
  assert.equal(parsed.sentenceAnatomy.pattern, '');
  assert.equal(parsed.discourse.logic, '');
  assert.equal(parsed.corrections[0].kind, 'unknown');
});

test('fabricated corrections and sentence fragments are discarded', async () => {
  const analyze = createAnalyzer({ mode: 'live', apiKey: 'fake', baseUrl: 'https://example.invalid', model: 'test' }, async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ translation: 'Explain this system.', corrections: [{ kind: 'correction', before: 'invented mistake', after: 'fixed' }, { kind: 'style', before: 'Explain', after: 'Describe' }], sentenceAnatomy: { constituents: [{ role: 'Subject', fragment: 'invented' }, { role: 'Verb', fragment: 'Explain' }] } }) } }] }) }));
  const result = await analyze('Explain this');
  assert.equal(result.corrections.length, 1);
  assert.equal(result.corrections[0].kind, 'style');
  assert.equal(result.sentenceAnatomy.constituents.length, 1);
});

test('remote HTTP is rejected regardless of startup mode and legacy stored configurations never call it', async t => {
  for (const mode of ['demo', 'auto', 'live']) {
    assert.throws(() => loadConfig({ LEARNING_MODE: mode, LEARNING_BASE_URL: 'http://remote.invalid/v1' }), /HTTPS/);
  }
  assert.equal(loadConfig({ LEARNING_BASE_URL: 'http://[::1]:8000/v1' }).baseUrl, 'http://[::1]:8000/v1');
  let calls = 0;
  const s = await fixture(t, {}, { requestFetch: async () => { calls++; throw new Error('must not call'); } });
  const stored = s.app.models.load();
  stored.models[0].baseUrl = 'http://remote.invalid/v1';
  stored.models[0].apiKey = 'fake-key';
  s.app.models.save(stored); // Simulate a pre-hardening configuration.
  await s.call('/api/settings', 'POST', { learningMode: 'live' });
  assert.equal((await s.call('/api/status')).body.mode, 'unconfigured');
  const id = (await s.call('/api/events', 'POST', input('unsafe'))).body.id;
  assert.equal(s.app.storage.getEvent(id)?.status, 'pending');
  assert.equal(calls, 0);
  const direct = createAnalyzer({ mode: 'live', apiKey: 'fake', baseUrl: 'http://remote.invalid', model: 'test' }, async () => { calls++; });
  await assert.rejects(() => direct('hello'), /HTTPS/);
  assert.equal(calls, 0);
});

test('invalid compound settings have no partial effects or unexpected model requests', async t => {
  let calls = 0;
  const s = await fixture(t, { apiKey: 'fake-key', modeSetting: 'demo' }, { requestFetch: async () => { calls++; throw new Error('must not call'); } });
  await s.call('/api/settings', 'POST', { paused: true });
  s.app.storage.addEvent({ ...input('waiting'), eventType: 'user.prompt.submitted', eligible: true });
  const original = (await s.call('/api/settings')).body;
  for (const extra of [{ activeTextId: 'unknown' }, { activeSpeechId: original.activeTextId }, { capturePolicy: { mode: 'all', excludedProjects: ['relative/path'] } }]) {
    const result = await s.call('/api/settings', 'POST', { learningMode: 'live', paused: false, ...extra });
    assert.equal(result.response.status, 400);
    const current = (await s.call('/api/settings')).body;
    assert.equal(current.modeSetting, original.modeSetting);
    assert.equal(current.paused, true);
    assert.equal(current.activeTextId, original.activeTextId);
  }
  assert.equal(calls, 0);
});

test('legacy database migration preserves history, settings and retained knowledge', t => {
  const dir = temp(t);
  const old = new DatabaseSync(path.join(dir, 'sidecar.sqlite'));
  old.exec(`CREATE TABLE knowledge (id TEXT PRIMARY KEY, term TEXT NOT NULL, meaning TEXT NOT NULL, category TEXT NOT NULL, encounters INTEGER NOT NULL DEFAULT 0, last_seen TEXT NOT NULL);
    INSERT INTO knowledge VALUES ('retained','system','系统','vocabulary',2,'2026-01-01');
    CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    INSERT INTO settings VALUES ('paused','1');
    CREATE TABLE events (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, source TEXT NOT NULL, event_type TEXT NOT NULL, session_id TEXT NOT NULL, turn_id TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', analysis TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO events VALUES ('legacy','fp','codex','user.prompt.submitted','session','turn','Explain this','processing',NULL,NULL,'2026-01-01','2026-01-01');`);
  old.close();
  const db = new Storage(dir); t.after(() => db.close());
  assert.equal(db.getPaused(), true);
  assert.equal(db.getEvent('legacy').content, 'Explain this');
  assert.equal(db.getEvent('legacy').status, 'pending');
  assert.equal(db.listKnowledge()[0].encounters, 2);
  assert.equal(db.listKnowledge()[0].retained_encounters, 2);
  assert.ok(db.db.prepare('PRAGMA table_info(events)').all().some(c => c.name === 'project_id'));
});

test('upstream text and TTS error streams are cancelled without exposing their bodies', async t => {
  let textCancelled = false;
  const analyze = createAnalyzer({ mode: 'live', apiKey: 'fake', baseUrl: 'https://example.invalid', model: 'test' }, async () => new Response(new ReadableStream({ cancel() { textCancelled = true; } }), { status: 503 }));
  await assert.rejects(() => analyze('Explain this'), /503/);
  assert.equal(textCancelled, true);
  let ttsCancelled = 0;
  let responseKind = 'error';
  const s = await fixture(t, {}, { requestFetch: async () => new Response(new ReadableStream({ cancel() { ttsCancelled++; } }), { status: responseKind === 'error' ? 503 : 200, headers: { 'content-type': 'text/html' } }) });
  await s.call('/api/models', 'POST', { name: 'Speech', kind: 'speech', baseUrl: 'https://example.invalid/v1', model: 'tts', apiKey: 'fake-key' });
  for (const kind of ['error', 'mime']) {
    responseKind = kind;
    const result = await s.call('/api/tts', 'POST', { input: 'Explain this' });
    assert.equal(result.response.status, 502);
  }
  assert.equal(ttsCancelled, 2);
});

test('browser disconnect aborts the upstream TTS signal', async t => {
  let upstreamSignal;
  const s = await fixture(t, {}, { requestFetch: async (_url, { signal }) => {
    upstreamSignal = signal;
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  await s.call('/api/models', 'POST', { name: 'Speech', kind: 'speech', baseUrl: 'https://example.invalid/v1', model: 'tts', apiKey: 'fake-key' });
  const controller = new AbortController();
  const pending = fetch(s.base + '/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: 'Explain this' }), signal: controller.signal }).catch(() => {});
  await until(() => Boolean(upstreamSignal));
  controller.abort();
  await pending;
  await until(() => upstreamSignal.aborted);
});
