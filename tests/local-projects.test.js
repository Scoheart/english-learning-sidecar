import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createSidecar } from '../src/lib/server.js';
import { listDirectories, inspectProject, normalizeCaptureProjects, prepareHookPlans, applyHookPlans } from '../src/lib/local-projects.js';

function temp(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-local-')));
  t.after(() => { assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir())); fs.rmSync(root, { recursive: true, force: true }); });
  return root;
}
function write(file, content) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }
async function fixture(t) {
  const root = temp(t);
  const homeDir = path.join(root, 'home'); fs.mkdirSync(homeDir);
  const project = path.join(root, "project '$() `quoted`"); fs.mkdirSync(project);
  const dataDir = path.join(root, "data ' $HOME `literal`");
  const app = createSidecar({ host: '127.0.0.1', port: 0, dataDir, baseUrl: 'https://provider.example/v1', model: 'fixture', apiKey: '' }, { localOptions: { homeDir, envPath: '' } });
  const address = await app.start();
  t.after(() => app.close());
  const base = `http://127.0.0.1:${address.port}`;
  const request = async (route, body, headers = {}) => {
    const response = await fetch(base + route, body === undefined ? { headers } : { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  return { root, homeDir, project, dataDir, app, request, port: address.port };
}

test('local directory API defaults to fixture home and lists canonical directories only', async t => {
  const s = await fixture(t);
  fs.mkdirSync(path.join(s.homeDir, 'a'));
  write(path.join(s.homeDir, 'file'), 'not directory');
  fs.symlinkSync(s.project, path.join(s.homeDir, 'link'));
  const response = await s.request('/api/local/directories');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { path: s.homeDir, parent: s.root, directories: [{ name: 'a', path: path.join(s.homeDir, 'a') }] });
  assert.equal(listDirectories(path.parse(s.root).root).parent, null);
  for (const value of ['', 'relative', '/missing-directory-fixture', path.join(s.homeDir, 'file'), path.join(s.homeDir, 'link'), '\0']) {
    const result = await s.request(`/api/local/directories?path=${encodeURIComponent(value)}`);
    assert.equal(result.status, 400, value); assert.ok(result.body.error);
  }
  assert.equal((await s.request('/api/local/directories', undefined, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await s.request('/api/local/project', { path: s.project }, { Origin: 'https://evil.example' })).status, 403);
});

test('project discovery reports exactly supported agents with distinct project/home/CLI detection and no writes', async t => {
  const s = await fixture(t);
  fs.mkdirSync(path.join(s.project, '.codex'));
  fs.mkdirSync(path.join(s.homeDir, '.claude'));
  const bin = path.join(s.root, 'bin'); fs.mkdirSync(bin);
  write(path.join(bin, 'cursor'), '#!/bin/sh\n'); fs.chmodSync(path.join(bin, 'cursor'), 0o700);
  const discovered = inspectProject(s.project, { homeDir: s.homeDir, envPath: bin });
  assert.deepEqual(discovered.agents.map(a => [a.id, a.detected, a.detection]), [['codex', true, 'project'], ['claude', true, 'home'], ['cursor', true, 'cli'], ['grok', false, 'none']]);
  const result = await s.request('/api/local/project', { path: s.project });
  assert.equal(result.status, 200);
  assert.ok(result.body.agents.every(a => !a.configured && path.isAbsolute(a.configPath)));
  assert.equal(fs.existsSync(path.join(s.project, '.codex/hooks.json')), false);
  for (const value of [null, [], {}, { path: 'relative' }, { path: 42 }]) assert.equal((await s.request('/api/local/project', value)).status, 400);
});

test('settings save installs all four hooks, preserves unrelated JSON, backs up and is idempotent', async t => {
  const s = await fixture(t);
  const file = path.join(s.project, '.claude/settings.json');
  const original = '{"permissions":{"allow":["Read"]},"hooks":{"Other":[{"command":"other"}],"UserPromptSubmit":[{"hooks":[{"type":"command","command":"my-own-hook"}]}]}}';
  write(file, original);
  assert.deepEqual((await s.request('/api/status')).body.captureProjects, []);
  assert.deepEqual((await s.request('/api/settings')).body.captureProjects, []);
  const body = { captureProjects: [{ path: s.project, agents: ['codex', 'claude', 'cursor', 'grok'] }], capturePolicy: { mode: 'allowlist', allowedProjects: [s.project] }, paused: true };
  const result = await s.request('/api/settings', body);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(result.body.captureProjects, body.captureProjects);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(saved.permissions, { allow: ['Read'] });
  assert.deepEqual(saved.hooks.Other, [{ command: 'other' }]);
  assert.equal(saved.hooks.UserPromptSubmit[0].hooks[0].command, 'my-own-hook');
  const command = saved.hooks.UserPromptSubmit[1].hooks[0].command;
  assert.ok(command.includes("'" + process.execPath + "'"));
  assert.ok(command.includes(`'--port' '${s.port}'`));
  assert.ok(command.includes('src/lib/hook-adapter.cjs'));
  assert.equal(command.includes(fs.readFileSync(path.join(s.dataDir, 'ingest-token'), 'utf8').trim()), false);
  const backups = () => fs.readdirSync(path.dirname(file)).filter(n => n.includes('.backup-'));
  assert.equal(backups().length, 1);
  assert.equal(fs.readFileSync(path.join(path.dirname(file), backups()[0]), 'utf8'), original);
  const before = fs.readFileSync(file, 'utf8');
  assert.equal((await s.request('/api/settings', body)).status, 200);
  assert.equal(fs.readFileSync(file, 'utf8'), before); assert.equal(backups().length, 1);
  assert.ok((await s.request('/api/local/project', { path: s.project })).body.agents.every(a => a.configured));
  assert.equal((await s.request('/api/settings', { captureProjects: [] })).status, 200);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal((await s.request('/api/settings')).body.capturePolicy.mode, 'allowlist');
});

test('legacy managed command migration preserves other handlers within shared groups', async t => {
  const s = await fixture(t);
  const file = path.join(s.project, '.claude/settings.json');
  const oldScript = fileURLToPath(new URL('../bin/hook.cjs', import.meta.url));
  const unrelated = { type: 'command', command: "node '/another-product/hook-adapter.cjs'" };
  write(file, JSON.stringify({ hooks: { UserPromptSubmit: [{ matcher: '*', hooks: [{ type: 'command', command: `node "${oldScript}" claude` }, unrelated] }] } }));
  assert.equal((await s.request('/api/local/project', { path: s.project })).body.agents.find(a => a.id === 'claude').configured, true);
  assert.equal((await s.request('/api/settings', { captureProjects: [{ path: s.project, agents: ['claude'] }] })).status, 200);
  const entries = JSON.parse(fs.readFileSync(file, 'utf8')).hooks.UserPromptSubmit;
  assert.deepEqual(entries[0], { matcher: '*', hooks: [unrelated] });
  assert.equal(entries.length, 2);
});

test('invalid JSON/shapes and malicious selections reject every plan before edits or backups', async t => {
  const s = await fixture(t);
  const good = path.join(s.project, '.codex/hooks.json'); write(good, '{"keep":true}');
  const bad = path.join(s.project, '.claude/settings.json');
  for (const content of ['{broken', 'null', '[]', '{"hooks":[]}', '{"hooks":{"UserPromptSubmit":{}}}', '{"hooks":{"UserPromptSubmit":[null]}}', '{"hooks":{"UserPromptSubmit":[{"hooks":"bad"}]}}']) {
    write(bad, content);
    const result = await s.request('/api/settings', { captureProjects: [{ path: s.project, agents: ['codex', 'claude'] }], paused: true });
    assert.equal(result.status, 400, content);
    assert.equal(fs.readFileSync(good, 'utf8'), '{"keep":true}');
    assert.deepEqual(fs.readdirSync(path.dirname(good)), ['hooks.json']);
    assert.equal((await s.request('/api/settings')).body.paused, false);
  }
  for (const captureProjects of [null, {}, [{ path: s.project, agents: [] }], [{ path: s.project, agents: ['unsupported'] }], [{ path: s.project, agents: ['codex', 'codex'] }], [{ path: s.project, agents: ['../escape'] }], [{ path: s.project, agents: ['codex'] }, { path: s.project, agents: ['claude'] }]]) {
    assert.equal((await s.request('/api/settings', { captureProjects })).status, 400);
  }
});

test('symlink config directories/files including dangling links cannot escape a project', async t => {
  const s = await fixture(t);
  const outside = path.join(s.root, 'outside'); fs.mkdirSync(outside);
  const link = path.join(s.project, '.claude'); fs.symlinkSync(outside, link);
  assert.equal((await s.request('/api/settings', { captureProjects: [{ path: s.project, agents: ['claude'] }] })).status, 400);
  assert.deepEqual(fs.readdirSync(outside), []);
  fs.unlinkSync(link); fs.mkdirSync(link);
  fs.symlinkSync(path.join(outside, 'missing.json'), path.join(link, 'settings.json'));
  assert.equal((await s.request('/api/settings', { captureProjects: [{ path: s.project, agents: ['claude'] }] })).status, 400);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('SQL/model failure restores existing and newly-created hook files and settings', async t => {
  const s = await fixture(t);
  const file = path.join(s.project, '.claude/settings.json'); write(file, '{ "keep": 1 }');
  const initial = (await s.request('/api/settings')).body;
  const modelBytes = fs.readFileSync(s.app.models.filePath, 'utf8');
  const body = { captureProjects: [{ path: s.project, agents: ['claude', 'codex'] }], activeTextId: null, paused: true };
  const setPaused = s.app.storage.setPaused.bind(s.app.storage);
  s.app.storage.setPaused = () => { throw new Error('fixture SQL failure'); };
  assert.equal((await s.request('/api/settings', body)).status, 400);
  s.app.storage.setPaused = setPaused;
  assert.equal(fs.readFileSync(file, 'utf8'), '{ "keep": 1 }');
  assert.equal(fs.existsSync(path.join(s.project, '.codex/hooks.json')), false);
  assert.equal(fs.readFileSync(s.app.models.filePath, 'utf8'), modelBytes);
  assert.deepEqual((await s.request('/api/settings')).body, initial);
  const save = s.app.models.save.bind(s.app.models);
  let writes = 0;
  s.app.models.save = state => { if (++writes === 1) throw new Error('fixture model failure'); save(state); };
  assert.equal((await s.request('/api/settings', body)).status, 400);
  s.app.models.save = save;
  assert.equal(fs.readFileSync(file, 'utf8'), '{ "keep": 1 }');
  assert.equal(fs.existsSync(path.join(s.project, '.codex/hooks.json')), false);
  assert.deepEqual((await s.request('/api/settings')).body, initial);
});

test('later hook write failure rolls back earlier hooks, and stale plans refuse overwrite', t => {
  const root = temp(t);
  const file = path.join(root, '.claude/settings.json'); write(file, '{"keep":1}');
  const projects = normalizeCaptureProjects([{ path: root, agents: ['claude', 'codex'] }]);
  const plans = prepareHookPlans(projects, { dataDir: root, port: 4317 });
  const original = fs.writeFileSync;
  fs.writeFileSync = (filePath, ...args) => {
    if (String(filePath).includes('.codex/hooks.json.sidecar-')) throw new Error('fixture hook failure');
    return original(filePath, ...args);
  };
  try { assert.throws(() => applyHookPlans(plans), /fixture hook failure/); }
  finally { fs.writeFileSync = original; }
  assert.equal(fs.readFileSync(file, 'utf8'), '{"keep":1}');
  assert.equal(fs.existsSync(path.join(root, '.codex/hooks.json')), false);
  write(file, '{"external":true}');
  assert.throws(() => applyHookPlans(plans), /changed/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"external":true}');
});

test('quoted adapter command executes safely with custom data dir and actual port; flags override hostile env', async t => {
  const s = await fixture(t);
  await s.request('/api/settings', { captureProjects: [{ path: s.project, agents: ['cursor'] }] });
  const command = JSON.parse(fs.readFileSync(path.join(s.project, '.cursor/hooks.json'), 'utf8')).hooks.beforeSubmitPrompt[0].command;
  const child = spawn('/bin/sh', ['-c', command], { cwd: s.project, env: { ...process.env, SIDECAR_DATA_DIR: '/missing-fixture', SIDECAR_PORT: '1' } });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
  child.stdin.end(JSON.stringify({ prompt: '我想学习清楚地解释这个问题。', cwd: s.project, session_id: 'fixture' }));
  const code = await new Promise(resolve => child.on('close', resolve));
  assert.equal(code, 0, stderr); assert.equal(stdout, '{"continue":true}\n');
  assert.equal((await s.request('/api/events')).body.events.length, 1);
  assert.equal(fs.existsSync(path.join(s.project, 'literal')), false);
});
