import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ModelStore, validateBaseUrl, maskApiKey, toSafeModel } from '../src/lib/models.js';
import { createSidecar } from '../src/lib/server.js';
import { createAnalyzer } from '../src/lib/analyzer.js';

function createTempDir(prefix = 'sidecar-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('validateBaseUrl enforces HTTPS for remote and allows loopback HTTP', () => {
  assert.equal(validateBaseUrl('https://api.openai.com/v1/'), 'https://api.openai.com/v1');
  assert.equal(validateBaseUrl('http://127.0.0.1:8080/v1'), 'http://127.0.0.1:8080/v1');
  assert.equal(validateBaseUrl('http://localhost:5000'), 'http://localhost:5000');
  assert.equal(validateBaseUrl('http://[::1]:9000'), 'http://[::1]:9000');
  assert.throws(() => validateBaseUrl('http://example.com/v1'), /Remote baseUrl must use HTTPS/);
  assert.throws(() => validateBaseUrl('ftp://127.0.0.1/v1'), /baseUrl must use http: or https:/);
});

test('maskApiKey masks correctly and safely', () => {
  assert.equal(maskApiKey(''), '');
  assert.equal(maskApiKey('short'), '****');
  assert.equal(maskApiKey('12345678'), '****');
  assert.equal(maskApiKey('sk-1234567890abcdef'), 'sk-...cdef');
});

test('ModelStore initializes default text model with 0600 permission and no speech model', () => {
  const dir = createTempDir('sidecar-store-');
  try {
    const store = new ModelStore(dir, {
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: 'sk-secret-key-123456',
    });
    const state = store.list();
    assert.equal(state.models.length, 1);
    assert.equal(state.models[0].kind, 'text');
    assert.equal(state.models[0].model, 'gpt-4o-mini');
    assert.equal(state.activeSpeechId, null);
    assert.equal(state.models[0].apiKeySet, true);
    assert.equal(state.models[0].apiKeyMasked, 'sk-...3456');
    assert.equal('apiKey' in state.models[0], false);

    if (process.platform !== 'win32') {
      const mode = fs.statSync(path.join(dir, 'models.json')).mode & 0o777;
      assert.equal(mode, 0o600);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ModelStore supports adding, updating (preserving or clearing apiKey), deleting and fallback', () => {
  const dir = createTempDir('sidecar-crud-');
  try {
    const store = new ModelStore(dir, {
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: 'sk-init-12345',
    });
    const text1 = store.list().models[0];

    // Add Speech model
    const speech = store.addModel({
      name: 'OpenAI TTS',
      kind: 'speech',
      baseUrl: 'https://api.openai.com/v1',
      model: 'tts-1',
      voice: 'marin',
      apiKey: 'sk-tts-secret-9999',
    });
    assert.equal(speech.kind, 'speech');
    assert.equal(speech.voice, 'marin');
    assert.equal(store.getActiveSpeechModel()?.id, speech.id);

    // Add another text model
    const text2 = store.addModel({
      name: 'Custom Luna',
      kind: 'text',
      baseUrl: 'https://custom.example.com/v1',
      model: 'gpt-6-luna',
      temperature: null,
      apiKey: 'sk-luna-secret-8888',
    });
    assert.equal(text2.model, 'gpt-6-luna');

    // Switch active text model
    store.setActive(text2.id, 'text');
    assert.equal(store.getActiveTextModel()?.id, text2.id);

    // Update text2 without apiKey -> preserves key
    store.updateModel(text2.id, { name: 'Luna Renamed' });
    const afterNameUpdate = store.getActiveTextModel();
    assert.equal(afterNameUpdate?.name, 'Luna Renamed');
    assert.equal(afterNameUpdate?.apiKey, 'sk-luna-secret-8888');

    // Update text2 with explicit apiKey: "" -> clears key
    store.updateModel(text2.id, { apiKey: '' });
    assert.equal(store.getActiveTextModel()?.apiKey, '');

    // Delete active text model (text2) -> automatically selects remaining text (text1)
    store.deleteModel(text2.id);
    assert.equal(store.getActiveTextModel()?.id, text1.id);

    // Delete remaining text model (text1) -> activeTextId becomes null (falls back to env)
    store.deleteModel(text1.id);
    assert.equal(store.getActiveTextModel(), null);
    assert.equal(store.list().activeTextId, null);

    // Delete active speech model -> activeSpeechId becomes null
    store.deleteModel(speech.id);
    assert.equal(store.getActiveSpeechModel(), null);
    assert.equal(store.list().activeSpeechId, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('API keys NEVER appear in GET /api/status, GET /api/models, and GET/POST /api/settings', async () => {
  const dir = createTempDir('sidecar-security-');
  const secretKey = 'sk-super-secret-key-do-not-leak';
  const app = createSidecar({
    host: '127.0.0.1',
    port: 0,
    dataDir: dir,
    mode: 'live',
    apiKey: secretKey,
    model: 'gpt-4o-mini',
    baseUrl: 'https://api.openai.com/v1',
    demoEnabled: true,
  });
  const address = await app.start();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    // 1. GET /api/status
    const statusRes = await fetch(`${base}/api/status`);
    const statusBody = await statusRes.json();
    const statusStr = JSON.stringify(statusBody);
    assert.equal(statusStr.includes(secretKey), false);
    assert.equal(statusBody.activeTextModel?.apiKeySet, true);
    assert.equal('apiKey' in (statusBody.activeTextModel || {}), false);

    // 2. GET /api/models
    const modelsRes = await fetch(`${base}/api/models`);
    const modelsBody = await modelsRes.json();
    const modelsStr = JSON.stringify(modelsBody);
    assert.equal(modelsStr.includes(secretKey), false);
    for (const m of modelsBody.models) {
      assert.equal('apiKey' in m, false);
      assert.equal(typeof m.apiKeyMasked, 'string');
    }

    // 3. GET /api/settings
    const settingsRes = await fetch(`${base}/api/settings`);
    const settingsBody = await settingsRes.json();
    const settingsStr = JSON.stringify(settingsBody);
    assert.equal(settingsStr.includes(secretKey), false);

    // 4. POST /api/settings
    const postSettingsRes = await fetch(`${base}/api/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paused: true }),
    });
    const postSettingsBody = await postSettingsRes.json();
    const postSettingsStr = JSON.stringify(postSettingsBody);
    assert.equal(postSettingsStr.includes(secretKey), false);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('temperature omitted when null or missing; included when number', async () => {
  let capturedBody1;
  const fakeFetch1 = async (_url, options) => {
    capturedBody1 = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"translation":"Test"}' } }] }),
    };
  };

  const analyzer1 = createAnalyzer(
    { mode: 'live', model: 'gpt-6-luna', apiKey: 'k', baseUrl: 'https://example.com/v1', temperature: null },
    fakeFetch1
  );
  await analyzer1('test null temperature');
  assert.equal('temperature' in capturedBody1, false);

  let capturedBody2;
  const fakeFetch2 = async (_url, options) => {
    capturedBody2 = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"translation":"Test"}' } }] }),
    };
  };

  const analyzer2 = createAnalyzer(
    { mode: 'live', model: 'gpt-4o-mini', apiKey: 'k', baseUrl: 'https://example.com/v1', temperature: 0.3 },
    fakeFetch2
  );
  await analyzer2('test defined temperature');
  assert.equal(capturedBody2.temperature, 0.3);
});

test('switching text model dynamically changes model, baseUrl, and key for next analysis', async () => {
  const dir = createTempDir('sidecar-switch-');
  const capturedRequests = [];
  const fakeFetch = async (url, options) => {
    capturedRequests.push({ url, options: { ...options, body: JSON.parse(options.body || '{}') } });
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                translation: 'Dynamic switch success',
                vocabulary: [],
                grammar: [],
                examples: [],
              }),
            },
          },
        ],
      }),
    };
  };

  const app = createSidecar(
    {
      host: '127.0.0.1',
      port: 0,
      dataDir: dir,
      mode: 'live',
      apiKey: 'key-initial',
      model: 'model-initial',
      baseUrl: 'https://api-initial.example.com/v1',
      demoEnabled: true,
    },
    { requestFetch: fakeFetch }
  );
  const address = await app.start();
  const base = `http://127.0.0.1:${address.port}`;
  const token = fs.readFileSync(path.join(dir, 'ingest-token'), 'utf8').trim();

  try {
    // 1. Submit prompt using initial model
    await fetch(`${base}/api/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sidecar-token': token },
      body: JSON.stringify({ source: 'codex', sessionId: 's1', turnId: 't1', content: 'Prompt 1' }),
    });

    // Wait for first event to complete
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) {
      const res = await fetch(`${base}/api/events`);
      const body = await res.json();
      if (body.events[0]?.status === 'complete') break;
      await new Promise((r) => setTimeout(r, 40));
    }

    assert.equal(capturedRequests.length, 1);
    assert.equal(capturedRequests[0].url, 'https://api-initial.example.com/v1/chat/completions');
    assert.equal(capturedRequests[0].options.body.model, 'model-initial');
    assert.equal(capturedRequests[0].options.headers.authorization, 'Bearer key-initial');

    // 2. Add second model and switch to it
    const addRes = await fetch(`${base}/api/models`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Model Two',
        kind: 'text',
        baseUrl: 'https://api-two.example.com/v1',
        model: 'model-two-turbo',
        apiKey: 'key-two',
      }),
    });
    const addData = await addRes.json();
    assert.equal(addRes.status, 201);

    // Switch active model to Model Two
    await fetch(`${base}/api/models/${addData.model.id}/active`, { method: 'POST' });

    // 3. Submit second prompt -> should use Model Two immediately!
    await fetch(`${base}/api/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sidecar-token': token },
      body: JSON.stringify({ source: 'codex', sessionId: 's1', turnId: 't2', content: 'Prompt 2' }),
    });

    const deadline2 = Date.now() + 2500;
    while (Date.now() < deadline2) {
      const res = await fetch(`${base}/api/events`);
      const body = await res.json();
      if (body.events.find((e) => e.turnId === 't2')?.status === 'complete') break;
      await new Promise((r) => setTimeout(r, 40));
    }

    assert.equal(capturedRequests.length, 2);
    assert.equal(capturedRequests[1].url, 'https://api-two.example.com/v1/chat/completions');
    assert.equal(capturedRequests[1].options.body.model, 'model-two-turbo');
    assert.equal(capturedRequests[1].options.headers.authorization, 'Bearer key-two');
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/tts proxies to active speech model and returns 400 when unconfigured', async () => {
  const dir = createTempDir('sidecar-tts-');
  let ttsCalled = false;
  let ttsRequestBody = null;
  const fakeFetch = async (url, options) => {
    if (url.endsWith('/audio/speech')) {
      ttsCalled = true;
      ttsRequestBody = JSON.parse(options.body);
      return {
        ok: true,
        headers: new Map([['content-type', 'audio/mpeg']]),
        arrayBuffer: async () => Buffer.from('fake-mp3-bytes'),
      };
    }
    return { ok: false, status: 404 };
  };

  const app = createSidecar(
    {
      host: '127.0.0.1',
      port: 0,
      dataDir: dir,
      mode: 'live',
      apiKey: 'key',
      model: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
      demoEnabled: true,
    },
    { requestFetch: fakeFetch }
  );
  const address = await app.start();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    // 1. With NO speech model configured -> returns 400
    const noTtsRes = await fetch(`${base}/api/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'Hello world' }),
    });
    assert.equal(noTtsRes.status, 400);
    const noTtsData = await noTtsRes.json();
    assert.match(noTtsData.error, /No TTS model configured/);

    // 2. Add and activate a speech model
    const addRes = await fetch(`${base}/api/models`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'OpenAI TTS',
        kind: 'speech',
        baseUrl: 'https://api.openai.com/v1',
        model: 'tts-1',
        voice: 'marin',
        apiKey: 'sk-tts-secret',
      }),
    });
    assert.equal(addRes.status, 201);

    // 3. Request TTS -> proxies to /audio/speech
    const ttsRes = await fetch(`${base}/api/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'This is a test sentence' }),
    });
    assert.equal(ttsRes.status, 200);
    assert.equal(ttsRes.headers.get('content-type'), 'audio/mpeg');
    const bytes = await ttsRes.arrayBuffer();
    assert.equal(Buffer.from(bytes).toString(), 'fake-mp3-bytes');
    assert.equal(ttsCalled, true);
    assert.equal(ttsRequestBody.model, 'tts-1');
    assert.equal(ttsRequestBody.voice, 'marin');
    assert.equal(ttsRequestBody.input, 'This is a test sentence');
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/tts returns 502 when upstream TTS fails', async () => {
  const dir = createTempDir('sidecar-tts-fail-');
  const fakeFetch = async (url) => {
    if (url.endsWith('/audio/speech')) {
      return {
        ok: false,
        status: 401,
        text: async () => 'Invalid API key provided',
        headers: new Map(),
      };
    }
    return { ok: false, status: 404 };
  };

  const app = createSidecar(
    {
      host: '127.0.0.1',
      port: 0,
      dataDir: dir,
      mode: 'live',
      apiKey: 'key',
      model: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
      demoEnabled: true,
    },
    { requestFetch: fakeFetch }
  );
  const address = await app.start();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    await fetch(`${base}/api/models`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'OpenAI TTS',
        kind: 'speech',
        baseUrl: 'https://api.openai.com/v1',
        model: 'tts-1',
        voice: 'marin',
        apiKey: 'bad-key',
      }),
    });

    const res = await fetch(`${base}/api/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'Failed audio test' }),
    });
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.match(body.error, /TTS upstream error/);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
