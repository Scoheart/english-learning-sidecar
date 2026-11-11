import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaybackSession, modelPayload, requireOk, selectMatchingEvent, stageSettingsModel, removeSettingsModel } from '../src/web/lib/reliability.js';

const form = { id: 'model-1', name: 'Text', kind: 'text', baseUrl: 'https://example.com/v1', model: 'test', apiKey: '', temperature: '' };

test('model edit preserves key for blank/whitespace, explicitly clears, or replaces', () => {
  assert.equal(Object.hasOwn(modelPayload(form), 'apiKey'), false);
  assert.equal(Object.hasOwn(modelPayload({ ...form, apiKey: '   ' }), 'apiKey'), false);
  assert.equal(modelPayload({ ...form, clearApiKey: true }).apiKey, '');
  assert.equal(modelPayload({ ...form, apiKey: ' new-key ' }).apiKey, 'new-key');
  assert.equal(modelPayload({ ...form, id: undefined }).apiKey, '');
});

test('provider change requires re-entered key or explicit clear; trailing slash is equivalent', () => {
  const original = { baseUrl: 'https://old.example/v1' };
  assert.throws(() => modelPayload(form, original), /重新输入密钥/);
  assert.equal(modelPayload({ ...form, apiKey: 'new-key' }, original).apiKey, 'new-key');
  assert.equal(modelPayload({ ...form, clearApiKey: true }, original).apiKey, '');
  assert.doesNotThrow(() => modelPayload({ ...form, baseUrl: original.baseUrl + '/' }, original));
});

test('invalid model input never becomes a misleading payload', () => {
  for (const temperature of ['NaN', '-1', '3']) assert.throws(() => modelPayload({ ...form, temperature }), /Temperature/);
  assert.throws(() => modelPayload({ ...form, name: ' ' }), /填写/);
  assert.equal(modelPayload({ ...form, temperature: '0' }).temperature, 0);
});

test('settings edits and removals only alter a draft; original saved settings survive cancellation', () => {
  const saved = { models: [{ ...form, apiKeySet: true, apiKeyMasked: 'old-mask' }], activeTextId: form.id, activeSpeechId: null };
  const snapshot = structuredClone(saved);
  const edited = stageSettingsModel(saved, { ...form, name: 'New name', apiKey: 'pending-key' });
  assert.equal(edited.models[0].apiKey, 'pending-key');
  assert.equal(edited.models[0].name, 'New name');
  const removed = removeSettingsModel(edited, form.id);
  assert.deepEqual(removed.models, []);
  assert.equal(removed.activeTextId, null);
  assert.deepEqual(saved, snapshot);
});

test('model draft retains pending key on repeated blank edits and clears only explicitly', () => {
  const saved = { models: [{ ...form, apiKeySet: true, apiKeyMasked: 'old-mask' }], activeTextId: form.id, activeSpeechId: null };
  const first = stageSettingsModel(saved, { ...form, apiKey: 'pending-key' });
  const second = stageSettingsModel(first, { ...form, apiKey: '' });
  assert.equal(second.models[0].apiKey, 'pending-key');
  assert.equal(second.models[0].apiKeySet, true);
  const clear = stageSettingsModel(second, { ...form, clearApiKey: true });
  assert.equal(clear.models[0].apiKey, '');
  assert.equal(clear.models[0].apiKeySet, false);
});

test('new model drafts get local IDs and selection without changing saved models', () => {
  const saved = { models: [], activeTextId: null, activeSpeechId: null };
  const draft = stageSettingsModel(saved, { ...form, id: undefined, apiKey: 'fake-key' }, () => 'local-id');
  assert.equal(draft.models[0].id, 'draft-local-id');
  assert.equal(draft.activeTextId, 'draft-local-id');
  assert.deepEqual(saved.models, []);
});

test('detail always selects inside filtered search matches', () => {
  const matches = [{ id: 'b' }, { id: 'c' }];
  assert.equal(selectMatchingEvent(matches, 'a').id, 'b');
  assert.equal(selectMatchingEvent(matches, 'c').id, 'c');
  assert.equal(selectMatchingEvent([], 'a'), null);
});

test('rapid playback changes abort fetch and invalidate stale completions, including after stop/unmount', () => {
  const session = createPlaybackSession({ cancelSpeech() {}, onStop() {} });
  const old = session.begin('first');
  const current = session.begin('second');
  assert.equal(old.signal.aborted, true);
  assert.equal(old.current(), false);
  assert.equal(current.current(), true);
  assert.equal(session.text, 'second');
  session.stop();
  assert.equal(current.signal.aborted, true);
  assert.equal(current.current(), false);
  assert.equal(session.text, null);
});

test('stop revokes Blob URL once, pauses/unloads audio, and detaches handlers', () => {
  const calls = [];
  const session = createPlaybackSession({ cancelSpeech() {}, onStop() {} });
  const ticket = session.begin('test');
  const audio = { onended() {}, onerror() {}, pause() { calls.push('pause'); }, removeAttribute(value) { calls.push(value); }, load() { calls.push('load'); } };
  assert.equal(session.attach(ticket, audio, 'blob:test', (url) => calls.push(url)), true);
  session.stop(); session.stop();
  assert.deepEqual(calls, ['pause', 'src', 'load', 'blob:test']);
  assert.equal(audio.onended, null);
  assert.equal(audio.onerror, null);
});

test('late audio attachment cannot own a new playback generation or leak its URL', () => {
  const revoked = [];
  const session = createPlaybackSession({ cancelSpeech() {}, onStop() {} });
  const old = session.begin('old');
  session.begin('new');
  assert.equal(session.attach(old, {}, 'blob:old', (url) => revoked.push(url)), false);
  assert.deepEqual(revoked, ['blob:old']);
  assert.equal(session.text, 'new');
});

test('mutation response failures retain actionable server error or HTTP fallback', async () => {
  await assert.rejects(requireOk(new Response(JSON.stringify({ error: '请重新输入密钥' }), { status: 400 })), /请重新输入密钥/);
  await assert.rejects(requireOk(new Response('invalid JSON', { status: 503 })), /HTTP 503/);
  assert.equal((await requireOk(new Response('{}'))).ok, true);
});
