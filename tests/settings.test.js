import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSidecar } from '../src/lib/server.js';

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-settings-'));
  const app = createSidecar({
    host: '127.0.0.1', port: 0, dataDir: dir,
    baseUrl: 'https://provider.example/v1', model: 'text-original', apiKey: 'original-secret-key',
  }, {
    analyzer: async () => { throw new Error('No analysis expected'); },
    requestFetch: async () => { throw new Error('No upstream requests allowed'); },
  });
  const address = await app.start();
  t.after(async () => {
    await app.close();
    assert.equal(path.dirname(dir), os.tmpdir());
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${address.port}`;
  const get = async (route = '/api/settings') => (await fetch(base + route)).json();
  const post = async body => {
    const response = await fetch(base + '/api/settings', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  return { app, dir, get, post };
}

function draft(settings, models = settings.models) {
  return { models, activeTextId: settings.activeTextId, activeSpeechId: settings.activeSpeechId };
}

function newModel(id = 'draft-speech', kind = 'speech') {
  return { id, name: 'New model', kind, baseUrl: 'https://new.example/v1', model: 'new-model', ...(kind === 'speech' ? { voice: 'marin' } : { temperature: null }) };
}

test('settings submits complete model draft, capture policy and paused state with one model write', async t => {
  const s = await fixture(t);
  const original = await s.get();
  const removed = s.app.models.addModel({ ...newModel('unused', 'text'), apiKey: 'delete-me' });
  let writes = 0;
  const save = s.app.models.save.bind(s.app.models);
  s.app.models.save = state => { writes++; save(state); };
  const modelDraft = draft(original, [
    { ...original.models[0], name: 'Renamed text', temperature: 0.3 },
    { ...newModel(), apiKey: 'speech-secret' },
  ]);
  modelDraft.activeSpeechId = 'draft-speech';
  const result = await s.post({
    modelDraft, paused: true,
    capturePolicy: { mode: 'allowlist', allowedProjects: ['/workspace/project'], excludedProjects: ['/workspace/project/private'] },
  });
  assert.equal(result.status, 200);
  assert.equal(writes, 1);
  assert.equal(result.body.paused, true);
  assert.equal(result.body.capturePolicy.mode, 'allowlist');
  assert.equal(result.body.models.length, 2);
  assert.equal(result.body.models[0].name, 'Renamed text');
  assert.equal(result.body.models[0].temperature, 0.3);
  assert.equal(result.body.activeTextId, original.activeTextId);
  assert.match(result.body.activeSpeechId, /^[0-9a-f]{8}-[0-9a-f-]{27}$/);
  assert.notEqual(result.body.activeSpeechId, 'draft-speech');
  assert.equal(result.body.models[1].id, result.body.activeSpeechId);
  assert.equal(s.app.models.load().models.some(model => model.id === removed.id), false);
  assert.equal(s.app.models.getActiveSpeechModel().apiKey, 'speech-secret');
  const safe = await s.get('/api/models');
  assert.ok(safe.models.every(model => !Object.hasOwn(model, 'apiKey')));
  assert.equal(JSON.stringify(safe).includes('speech-secret'), false);
});

test('invalid draft models, IDs, kinds and selections leave all storage unchanged', async t => {
  const s = await fixture(t);
  const original = await s.get();
  const good = original.models[0];
  const variants = [
    { ...draft(original), models: [{ ...good, name: 'Must not persist' }, { ...newModel(), baseUrl: 'http://remote.example/v1' }] },
    { ...draft(original), activeTextId: 'missing-model' },
    { ...draft(original), models: [good, newModel()], activeTextId: 'draft-speech' },
    { ...draft(original), models: [good, { ...good }] },
    { ...draft(original), models: [{ ...good, id: 'unknown-existing-id' }] },
    { ...draft(original), models: [{ ...good, id: undefined }] },
    { ...draft(original), models: [{ ...good, kind: 'invalid' }] },
    { ...draft(original), models: [{ ...good, kind: 'speech' }] },
    { ...draft(original), models: [{ ...good, name: '' }] },
    { ...draft(original), models: [{ ...good, model: '' }] },
    { ...draft(original), models: [{ ...good, apiKey: null }] },
    { ...draft(original), models: [{ ...good, temperature: 'hot' }] },
    { models: [good], activeTextId: original.activeTextId },
    null,
  ];
  const snapshot = fs.readFileSync(s.app.models.filePath, 'utf8');
  let writes = 0;
  const save = s.app.models.save.bind(s.app.models);
  s.app.models.save = state => { writes++; save(state); };
  for (const modelDraft of variants) {
    const result = await s.post({ modelDraft, paused: true, capturePolicy: { mode: 'allowlist', allowedProjects: ['/changed'] } });
    assert.equal(result.status, 400, JSON.stringify(modelDraft));
    assert.deepEqual(await s.get(), original);
    assert.equal(fs.readFileSync(s.app.models.filePath, 'utf8'), snapshot);
  }
  assert.equal(writes, 0);
});

test('draft credentials preserve omissions, clear explicitly and never reuse masked keys across providers', async t => {
  const s = await fixture(t);
  let settings = await s.get();
  let result = await s.post({ modelDraft: draft(settings, [{ ...settings.models[0], name: 'Preserve', apiKeyMasked: 'attacker-controlled' }]) });
  assert.equal(result.status, 200);
  assert.equal(s.app.models.getActiveTextModel().apiKey, 'original-secret-key');
  settings = result.body;
  result = await s.post({ modelDraft: draft(settings, [{ ...settings.models[0], apiKey: '' }]) });
  assert.equal(result.status, 200);
  assert.equal(s.app.models.getActiveTextModel().apiKey, '');
  settings = result.body;
  result = await s.post({ modelDraft: draft(settings, [{ ...settings.models[0], apiKey: 'replacement-secret' }]) });
  assert.equal(result.status, 200);
  assert.equal(s.app.models.getActiveTextModel().apiKey, 'replacement-secret');
  settings = result.body;
  result = await s.post({ modelDraft: draft(settings, [{ ...settings.models[0], baseUrl: 'https://other.example/v1' }]) });
  assert.equal(result.status, 200);
  assert.equal(s.app.models.getActiveTextModel().apiKey, '');
  settings = result.body;
  result = await s.post({ modelDraft: draft(settings, [{ ...settings.models[0], baseUrl: 'https://third.example/v1', apiKey: 'third-secret' }]) });
  assert.equal(result.status, 200);
  assert.equal(s.app.models.getActiveTextModel().apiKey, 'third-secret');
});

test('new draft text ID maps to active UUID and masked-only new model has empty credentials', async t => {
  const s = await fixture(t);
  const settings = await s.get();
  const result = await s.post({ modelDraft: {
    models: [...settings.models, { ...newModel('draft-text', 'text'), apiKeyMasked: 'not-a-real-key', apiKeySet: true }],
    activeTextId: 'draft-text', activeSpeechId: null,
  } });
  assert.equal(result.status, 200);
  assert.notEqual(result.body.activeTextId, 'draft-text');
  assert.equal(result.body.activeTextId, result.body.models[1].id);
  assert.equal(result.body.models[1].apiKeySet, false);
  assert.equal(s.app.models.getActiveTextModel().apiKey, '');
});

test('draft preparation is isolated and deleting all models respects explicit null selections', async t => {
  const s = await fixture(t);
  const settings = await s.get();
  const snapshot = s.app.models.load();
  const next = s.app.models.prepareDraft({ models: [newModel('draft-text', 'text')], activeTextId: 'draft-text', activeSpeechId: null });
  assert.notEqual(next.activeTextId, 'draft-text');
  assert.deepEqual(s.app.models.load(), snapshot);
  assert.equal((await s.post({ modelDraft: { models: [], activeTextId: null, activeSpeechId: null } })).status, 200);
  assert.deepEqual(s.app.models.load(), { models: [], activeTextId: null, activeSpeechId: null });
  assert.equal(settings.models.length, 1);
});

test('legacy selection and policy updates remain supported, but cannot mix with modelDraft', async t => {
  const s = await fixture(t);
  const original = await s.get();
  for (const field of ['activeTextId', 'activeSpeechId']) {
    const result = await s.post({ modelDraft: draft(original), [field]: null, paused: true });
    assert.equal(result.status, 400);
    assert.deepEqual(await s.get(), original);
  }
  assert.equal((await s.post({ activeTextId: null, paused: true, capturePolicy: { mode: 'allowlist', allowedProjects: ['/legacy'] } })).status, 200);
  assert.equal(s.app.models.load().activeTextId, null);
  const policyOnly = await s.post({ paused: false, capturePolicy: { mode: 'all' } });
  assert.equal(policyOnly.status, 200);
  assert.equal(policyOnly.body.paused, false);
  assert.equal(policyOnly.body.capturePolicy.mode, 'all');
  assert.equal((await s.post({ activeTextId: original.activeTextId })).status, 200);
  const beforeInvalid = await s.get();
  assert.equal((await s.post({ activeTextId: null, activeSpeechId: original.activeTextId, paused: true })).status, 400);
  assert.deepEqual(await s.get(), beforeInvalid);
});

test('SQL setting or commit failure restores model snapshot and rolls back settings', async t => {
  const s = await fixture(t);
  const original = await s.get();
  const snapshot = fs.readFileSync(s.app.models.filePath, 'utf8');
  const setPaused = s.app.storage.setPaused.bind(s.app.storage);
  s.app.storage.setPaused = () => { throw new Error('Injected setting failure'); };
  const payload = {
    paused: true, capturePolicy: { mode: 'allowlist', allowedProjects: ['/must-not-persist'] },
    modelDraft: draft(original, [{ ...original.models[0], name: 'Must roll back', apiKey: 'must-not-persist' }]),
  };
  assert.equal((await s.post(payload)).status, 400);
  assert.deepEqual(await s.get(), original);
  assert.equal(fs.readFileSync(s.app.models.filePath, 'utf8'), snapshot);
  s.app.storage.setPaused = setPaused;
  const exec = s.app.storage.db.exec.bind(s.app.storage.db);
  s.app.storage.db.exec = sql => { if (sql === 'COMMIT') throw new Error('Injected commit failure'); return exec(sql); };
  assert.equal((await s.post(payload)).status, 400);
  assert.deepEqual(await s.get(), original);
  assert.equal(fs.readFileSync(s.app.models.filePath, 'utf8'), snapshot);
});
