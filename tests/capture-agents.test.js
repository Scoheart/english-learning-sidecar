import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSidecar } from '../src/lib/server.js';
import { isAgentAllowed, reconcileAgentPolicy } from '../src/lib/capture-agents.js';

async function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-agent-controls-')));
  const project = path.join(root, 'project'); fs.mkdirSync(project);
  const config = { host: '127.0.0.1', port: 0, dataDir: path.join(root, 'data'), apiKey: '', baseUrl: 'https://fixture.example/v1', model: 'fixture' };
  const app = createSidecar(config, { localOptions: { homeDir: root, envPath: '' } });
  const address = await app.start();
  t.after(async () => {
    if (app.server.listening) await app.close();
    assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${address.port}`;
  const token = fs.readFileSync(path.join(config.dataDir, 'ingest-token'), 'utf8').trim();
  const request = async (route, body, ingest = false) => {
    const response = await fetch(base + route, body === undefined ? {} : {
      method: 'POST', headers: { 'content-type': 'application/json', ...(ingest ? { 'x-sidecar-token': token } : {}) }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const event = (source, projectPath = project) => request('/api/events', { source, projectPath, content: '请帮我把这个问题解释得更清楚。' }, true);
  const save = projects => request('/api/settings', { captureProjects: projects });
  return { root, project, config, app, request, event, save, token };
}

const selected = (path, agents) => ({ path, agents });

test('agent policy keeps legacy and manual capture unchanged; explicit longest child rule wins', () => {
  const rules = [{ path: '/work/app', agents: ['cursor'] }, { path: '/work/app/private', agents: [] }, { path: '/work/app/private/demo', agents: ['codex'] }];
  assert.equal(isAgentAllowed('/unmanaged', 'codex', rules), true);
  assert.equal(isAgentAllowed('/work/app-other', 'codex', rules), true);
  assert.equal(isAgentAllowed('/work/app', 'CURSOR', rules), true);
  assert.equal(isAgentAllowed('/work/app', 'claude', rules), false);
  assert.equal(isAgentAllowed('/work/app/private', 'cursor', rules), false);
  assert.equal(isAgentAllowed('/work/app/private/demo/subdir', 'codex', rules), true);
  assert.equal(isAgentAllowed('/work/app/private/demo/subdir', 'cursor', rules), false);
  assert.equal(isAgentAllowed('/work/app/private', 'manual', rules), true);
  assert.equal(isAgentAllowed('/work/app/private', 'pi', rules), true);
  assert.equal(isAgentAllowed('/work/app/private', 'codex', []), true);
});

test('reconciliation keeps off-rules for removed projects and re-add restores requested agents', () => {
  const previous = [selected('/work/app', ['cursor']), selected('/work/other', ['codex'])];
  const rules = reconcileAgentPolicy([], previous, [selected('/work/app', [])]);
  assert.equal(isAgentAllowed('/work/other/subdir', 'codex', rules), false);
  assert.equal(isAgentAllowed('/work/app', 'cursor', rules), false);
  const next = reconcileAgentPolicy(rules, [selected('/work/app', [])], [selected('/work/other', ['claude'])]);
  assert.equal(isAgentAllowed('/work/app', 'cursor', next), false);
  assert.equal(isAgentAllowed('/work/other', 'claude', next), true);
  assert.equal(isAgentAllowed('/work/other', 'codex', next), false);
  assert.deepEqual(previous, [selected('/work/app', ['cursor']), selected('/work/other', ['codex'])]);
});

test('saving unchecked agents immediately rejects cached/global events and removal stays off in all mode', async t => {
  const s = await fixture(t);
  assert.equal((await s.event('codex')).body.ignored, undefined, 'legacy capture remains enabled before project management');
  assert.equal((await s.save([selected(s.project, ['cursor'])])).status, 200);
  assert.equal((await s.event('cursor')).body.ignored, undefined);
  assert.deepEqual((await s.event('codex')).body, { ignored: true, reason: 'agent-policy' });
  assert.equal((await s.event('manual')).body.ignored, undefined);
  const count = () => s.request('/api/events').then(result => result.body.events.length);
  const before = await count();
  assert.equal((await s.save([selected(s.project, [])])).status, 200);
  assert.deepEqual((await s.event('cursor')).body, { ignored: true, reason: 'agent-policy' });
  assert.equal(await count(), before, 'disabled data never enters history or analysis queue');
  assert.equal((await s.save([])).status, 200);
  assert.equal((await s.request('/api/settings', { capturePolicy: { mode: 'all' } })).status, 200);
  assert.deepEqual((await s.event('cursor')).body, { ignored: true, reason: 'agent-policy' });
  assert.equal(await count(), before);
  assert.equal((await s.save([selected(s.project, ['cursor'])])).status, 200);
  assert.equal((await s.event('cursor')).body.ignored, undefined, 'explicit re-enable accepts new events again');
});

test('more-specific managed child overrides removed parent but not ordinary project exclusions', async t => {
  const s = await fixture(t);
  const child = path.join(s.project, 'child'); fs.mkdirSync(child);
  assert.equal((await s.save([selected(s.project, ['cursor']), selected(child, ['codex'])])).status, 200);
  assert.equal((await s.event('codex', child)).body.ignored, undefined);
  assert.deepEqual((await s.event('cursor', child)).body, { ignored: true, reason: 'agent-policy' });
  assert.equal((await s.save([selected(child, ['codex'])])).status, 200);
  assert.equal((await s.event('codex', child)).body.ignored, undefined);
  assert.deepEqual((await s.event('cursor', s.project)).body, { ignored: true, reason: 'agent-policy' });
  await s.request('/api/settings', { capturePolicy: { mode: 'all', excludedProjects: [child] } });
  assert.deepEqual((await s.event('codex', child)).body, { ignored: true, reason: 'project-policy' });
});

test('failed disable rolls back event policy along with settings and hook file bytes', async t => {
  const s = await fixture(t);
  await s.save([selected(s.project, ['cursor'])]);
  const file = path.join(s.project, '.cursor/hooks.json');
  const bytes = fs.readFileSync(file);
  const setPaused = s.app.storage.setPaused.bind(s.app.storage);
  s.app.storage.setPaused = () => { throw new Error('fixture transaction failure'); };
  try {
    assert.equal((await s.request('/api/settings', { captureProjects: [], paused: true })).status, 400);
  } finally { s.app.storage.setPaused = setPaused; }
  assert.deepEqual(fs.readFileSync(file), bytes);
  assert.equal((await s.event('cursor')).body.ignored, undefined);
  assert.deepEqual((await s.request('/api/settings')).body.captureProjects, [selected(s.project, ['cursor'])]);
});

test('removed-project off-rules persist through service restart', async t => {
  const s = await fixture(t);
  await s.save([selected(s.project, ['cursor'])]); await s.save([]);
  await s.app.close();
  const second = createSidecar(s.config, { localOptions: { homeDir: s.root, envPath: '' } });
  const address = await second.start();
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/events`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-sidecar-token': s.token }, body: JSON.stringify({ source: 'cursor', projectPath: s.project, content: '请解释清楚这个问题。' }) });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { ignored: true, reason: 'agent-policy' });
  } finally { await second.close(); }
});
