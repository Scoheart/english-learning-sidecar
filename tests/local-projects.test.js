import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createSidecar } from '../src/lib/server.js';
import { AGENTS, listDirectories, inspectProject, normalizeCaptureProjects, prepareHookPlans, applyHookPlans, shellQuote } from '../src/lib/local-projects.js';

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
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), JSON.parse(original));
  for (const relative of ['.codex/hooks.json', '.cursor/hooks.json', '.grok/hooks/english-sidecar.json']) {
    assert.equal(fs.existsSync(path.join(s.project, relative)), false);
  }
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
  for (const captureProjects of [null, {}, [{ path: s.project, agents: ['unsupported'] }], [{ path: s.project, agents: ['codex', 'codex'] }], [{ path: s.project, agents: ['../escape'] }], [{ path: s.project, agents: ['codex'] }, { path: s.project, agents: ['claude'] }]]) {
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
    if (String(filePath).includes('.claude/settings.json.sidecar-')) throw new Error('fixture hook failure');
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

test('all four agents uncheck, persist disabled projects, recheck, and remove with provenance', async t => {
  const s = await fixture(t);
  const projects = agents => [{ path: s.project, agents }];
  const save = agents => s.request('/api/settings', { captureProjects: projects(agents) });
  const ids = AGENTS.map(agent => agent.id);
  assert.equal((await save(ids)).status, 200);
  for (const agent of AGENTS) assert.equal(fs.existsSync(path.join(s.project, agent.config)), true);
  // Disable one at a time, including the very last checkbox.
  for (let i = 0; i < ids.length; i++) {
    const selected = ids.slice(i + 1);
    const response = await save(selected);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(response.body.captureProjects, projects(selected));
    for (const agent of AGENTS) assert.equal(fs.existsSync(path.join(s.project, agent.config)), selected.includes(agent.id), agent.id);
  }
  const ledger = s.app.storage.getSetting('captureHookOwnership', {});
  assert.deepEqual(ledger[s.project].configs, {});
  const directorySnapshot = AGENTS.map(agent => fs.readdirSync(path.dirname(path.join(s.project, agent.config))));
  assert.equal((await save([])).status, 200);
  assert.deepEqual(AGENTS.map(agent => fs.readdirSync(path.dirname(path.join(s.project, agent.config)))), directorySnapshot);
  assert.equal((await save(ids)).status, 200);
  assert.ok((await s.request('/api/local/project', { path: s.project })).body.agents.every(agent => agent.configured));
  assert.equal((await s.request('/api/settings', { captureProjects: [] })).status, 200);
  for (const agent of AGENTS) assert.equal(fs.existsSync(path.join(s.project, agent.config)), false);
  assert.deepEqual(s.app.storage.getSetting('captureHookOwnership', {}), {});
});

test('existing empty files survive, generated files with user config survive, and scaffold provenance supports re-enable', async t => {
  const s = await fixture(t);
  const codex = path.join(s.project, '.codex/hooks.json');
  const claude = path.join(s.project, '.claude/settings.json');
  const cursor = path.join(s.project, '.cursor/hooks.json');
  const grok = path.join(s.project, '.grok/hooks/english-sidecar.json');
  write(codex, '{}');
  write(claude, '{"hooks":{"UserPromptSubmit":[]},"keep":true}');
  const save = agents => s.request('/api/settings', { captureProjects: [{ path: s.project, agents }] });
  assert.equal((await save(AGENTS.map(agent => agent.id))).status, 200);
  const cursorConfig = JSON.parse(fs.readFileSync(cursor));
  cursorConfig.userSetting = { enabled: true };
  write(cursor, JSON.stringify(cursorConfig));
  const grokConfig = JSON.parse(fs.readFileSync(grok));
  grokConfig.hooks.OtherEvent = [{ hooks: [{ type: 'command', command: 'foreign' }] }];
  write(grok, JSON.stringify(grokConfig));
  assert.equal((await save([])).status, 200);
  assert.deepEqual(JSON.parse(fs.readFileSync(codex)), {});
  assert.deepEqual(JSON.parse(fs.readFileSync(claude)), { hooks: { UserPromptSubmit: [] }, keep: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(cursor)), { userSetting: { enabled: true } });
  assert.deepEqual(JSON.parse(fs.readFileSync(grok)), { hooks: { OtherEvent: [{ hooks: [{ type: 'command', command: 'foreign' }] }] } });
  assert.equal((await save(['cursor'])).status, 200);
  assert.equal((await save([])).status, 200);
  assert.deepEqual(JSON.parse(fs.readFileSync(cursor)), { userSetting: { enabled: true } });
  assert.equal((await s.request('/api/settings', { captureProjects: [] })).status, 200);
  assert.ok(AGENTS.every(agent => fs.existsSync(path.join(s.project, agent.config))));
});

test('Cursor shared version survives while unrelated user hooks need it', async t => {
  const s = await fixture(t);
  const file = path.join(s.project, '.cursor/hooks.json');
  const save = agents => s.request('/api/settings', { captureProjects: [{ path: s.project, agents }] });
  assert.equal((await save(['cursor'])).status, 200);
  const config = JSON.parse(fs.readFileSync(file));
  config.hooks.OtherEvent = [{ command: 'foreign-other' }];
  config.hooks.beforeSubmitPrompt.push({ command: 'foreign-prompt' });
  write(file, JSON.stringify(config));
  assert.equal((await save([])).status, 200);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { version: 1, hooks: {
    OtherEvent: [{ command: 'foreign-other' }], beforeSubmitPrompt: [{ command: 'foreign-prompt' }],
  } });
  assert.equal((await save(['cursor'])).status, 200);
  assert.equal((await save([])).status, 200);
  assert.equal(JSON.parse(fs.readFileSync(file)).version, 1);
});

test('foreign replacement files are never deleted or stripped using stale provenance', async t => {
  const s = await fixture(t);
  const save = agents => s.request('/api/settings', { captureProjects: [{ path: s.project, agents }] });
  assert.equal((await save(['codex', 'cursor', 'grok'])).status, 200);
  const codex = path.join(s.project, '.codex/hooks.json');
  const cursor = path.join(s.project, '.cursor/hooks.json');
  const grok = path.join(s.project, '.grok/hooks/english-sidecar.json');
  // Rename a separately-created file over the managed file, like an editor
  // atomic-save. The new empty file must not inherit the old file's ownership.
  const replacement = path.join(s.project, 'replacement.json');
  write(replacement, '{}'); fs.renameSync(replacement, codex);
  const cursorBytes = fs.readFileSync(cursor);
  write(replacement, cursorBytes); fs.renameSync(replacement, cursor);
  fs.unlinkSync(grok);
  assert.equal((await save([])).status, 200);
  assert.equal(fs.readFileSync(codex, 'utf8'), '{}');
  assert.deepEqual(JSON.parse(fs.readFileSync(cursor)), { version: 1, hooks: { beforeSubmitPrompt: [] } });
  assert.equal(fs.existsSync(grok), false);
  // A newly recreated absent config is again proven generated and deletable.
  assert.equal((await save(['grok'])).status, 200);
  assert.equal((await save([])).status, 200);
  assert.equal(fs.existsSync(grok), false);
  assert.equal(fs.readFileSync(codex, 'utf8'), '{}');
});

test('legacy unselected handlers are cleaned across all four configs but ambiguous scaffolding stays', async t => {
  const s = await fixture(t);
  const oldScript = fileURLToPath(new URL('../bin/hook.cjs', import.meta.url));
  for (const agent of AGENTS) {
    const command = `node "${oldScript}" ${agent.id}`;
    const event = agent.id === 'cursor' ? 'beforeSubmitPrompt' : 'UserPromptSubmit';
    const entry = agent.id === 'cursor' ? { command } : { hooks: [{ type: 'command', command }] };
    write(path.join(s.project, agent.config), JSON.stringify({ ...(agent.id === 'cursor' ? { version: 1 } : {}), hooks: { [event]: [entry] } }));
  }
  // Simulate legacy metadata which already forgot three checked agents.
  s.app.storage.setSetting('captureProjects', [{ path: s.project, agents: ['codex'] }]);
  assert.equal((await s.request('/api/settings', { captureProjects: [{ path: s.project, agents: [] }] })).status, 200);
  for (const agent of AGENTS) {
    const event = agent.id === 'cursor' ? 'beforeSubmitPrompt' : 'UserPromptSubmit';
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(s.project, agent.config))), { ...(agent.id === 'cursor' ? { version: 1 } : {}), hooks: { [event]: [] } });
  }
});

test('only exact known invocation is removed, preserving misleading commands, shared matchers, and other events', async t => {
  const s = await fixture(t);
  const adapter = fileURLToPath(new URL('../src/lib/hook-adapter.cjs', import.meta.url));
  const oldScript = fileURLToPath(new URL('../bin/hook.cjs', import.meta.url));
  const real = [process.execPath, adapter, 'claude', '--data-dir', s.dataDir, '--port', String(s.port)].map(shellQuote).join(' ');
  const commands = [
    `echo ${shellQuote(adapter)}`,
    `node '/foreign.cjs' ${shellQuote(adapter)} claude`,
    `echo node "${oldScript}" claude`,
    `${real}; echo user`,
    `node "${oldScript}" claude --foreign`,
    `node ${shellQuote(adapter)} claude`,
    `node ${shellQuote(adapter)} claude --data-dir /tmp --port 0`,
  ];
  const file = path.join(s.project, '.claude/settings.json');
  const foreignHooks = commands.map(command => ({ type: 'command', command }));
  const other = { UserPromptSubmit: [1], arbitrary: true };
  write(file, JSON.stringify({ permissions: { allow: ['Read'] }, hooks: {
    Other: other,
    UserPromptSubmit: [
      { matcher: 'specific', custom: true, hooks: [{ type: 'command', command: real }, ...foreignHooks] },
      { matcher: 'empty-matcher', hooks: [{ type: 'command', command: `node "${oldScript}" claude` }] },
    ],
  } }));
  assert.equal((await s.request('/api/settings', { captureProjects: [{ path: s.project, agents: [] }] })).status, 200);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { permissions: { allow: ['Read'] }, hooks: {
    Other: other,
    UserPromptSubmit: [{ matcher: 'specific', custom: true, hooks: foreignHooks }, { matcher: 'empty-matcher', hooks: [] }],
  } });
  assert.equal((await s.request('/api/local/project', { path: s.project })).body.agents.find(agent => agent.id === 'claude').configured, false);
});

test('deletion rollback restores actual bytes, modes, registry and models on SQL/model failure', async t => {
  const s = await fixture(t);
  assert.equal((await s.request('/api/settings', { captureProjects: [{ path: s.project, agents: AGENTS.map(agent => agent.id) }] })).status, 200);
  const snapshots = AGENTS.map((agent, index) => {
    const file = path.join(s.project, agent.config);
    const content = JSON.stringify(JSON.parse(fs.readFileSync(file)), null, index + 1) + '\n\n';
    write(file, content); fs.chmodSync(file, 0o640 + index);
    return { file, bytes: fs.readFileSync(file), mode: fs.statSync(file).mode & 0o7777 };
  });
  const settings = (await s.request('/api/settings')).body;
  const ledger = s.app.storage.getSetting('captureHookOwnership', {});
  const modelBytes = fs.readFileSync(s.app.models.filePath);
  const body = { captureProjects: [], activeTextId: null, paused: true };
  const verify = async () => {
    for (const snapshot of snapshots) {
      assert.deepEqual(fs.readFileSync(snapshot.file), snapshot.bytes);
      assert.equal(fs.statSync(snapshot.file).mode & 0o7777, snapshot.mode);
    }
    assert.deepEqual((await s.request('/api/settings')).body, settings);
    assert.deepEqual(s.app.storage.getSetting('captureHookOwnership', {}), ledger);
    assert.deepEqual(fs.readFileSync(s.app.models.filePath), modelBytes);
  };
  const setPaused = s.app.storage.setPaused.bind(s.app.storage);
  s.app.storage.setPaused = () => { throw new Error('fixture SQL delete failure'); };
  try { assert.equal((await s.request('/api/settings', body)).status, 400); }
  finally { s.app.storage.setPaused = setPaused; }
  await verify();
  const save = s.app.models.save.bind(s.app.models);
  let calls = 0;
  s.app.models.save = state => { if (++calls === 1) throw new Error('fixture model delete failure'); save(state); };
  try { assert.equal((await s.request('/api/settings', body)).status, 400); }
  finally { s.app.models.save = save; }
  await verify();
  // Original inode identities survive rollback, so a retry can still delete
  // proven generated files instead of treating them as foreign replacements.
  assert.equal((await s.request('/api/settings', { captureProjects: [] })).status, 200);
  for (const snapshot of snapshots) assert.equal(fs.existsSync(snapshot.file), false);
});

test('later hook deletion failure restores earlier deletions and registry atomically', async t => {
  const s = await fixture(t);
  assert.equal((await s.request('/api/settings', { captureProjects: [{ path: s.project, agents: AGENTS.map(agent => agent.id) }] })).status, 200);
  const snapshots = AGENTS.map(agent => fs.readFileSync(path.join(s.project, agent.config)));
  const ledger = s.app.storage.getSetting('captureHookOwnership', {});
  const unlink = fs.unlinkSync;
  fs.unlinkSync = file => {
    if (file === path.join(s.project, '.claude/settings.json')) throw new Error('fixture later deletion failure');
    return unlink(file);
  };
  try { assert.equal((await s.request('/api/settings', { captureProjects: [] })).status, 400); }
  finally { fs.unlinkSync = unlink; }
  for (const [index, agent] of AGENTS.entries()) assert.deepEqual(fs.readFileSync(path.join(s.project, agent.config)), snapshots[index]);
  assert.deepEqual(s.app.storage.getSetting('captureHookOwnership', {}), ledger);
  assert.equal((await s.request('/api/settings')).body.captureProjects.length, 1);
});

test('uninstall preflight rejects malformed files, symlinks, missing/moved roots and replaced directories without partial writes', async t => {
  const s = await fixture(t);
  const saved = [{ path: s.project, agents: AGENTS.map(agent => agent.id) }];
  assert.equal((await s.request('/api/settings', { captureProjects: saved })).status, 200);
  const codex = path.join(s.project, '.codex/hooks.json');
  const claude = path.join(s.project, '.claude/settings.json');
  const originalCodex = fs.readFileSync(codex);
  const originalClaude = fs.readFileSync(claude);
  const remove = () => s.request('/api/settings', { captureProjects: [], paused: true });
  write(claude, '{broken');
  assert.equal((await remove()).status, 400);
  assert.deepEqual(fs.readFileSync(codex), originalCodex);
  write(claude, originalClaude);
  const outside = path.join(s.root, 'foreign.json'); write(outside, 'foreign');
  fs.unlinkSync(claude); fs.symlinkSync(outside, claude);
  assert.equal((await remove()).status, 400);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'foreign');
  assert.deepEqual(fs.readFileSync(codex), originalCodex);
  fs.unlinkSync(claude); write(claude, originalClaude);
  const moved = path.join(s.root, 'moved');
  fs.renameSync(s.project, moved);
  const missing = await remove();
  assert.equal(missing.status, 400); assert.match(missing.body.error, /unavailable|moved/i);
  fs.symlinkSync(moved, s.project);
  assert.equal((await remove()).status, 400);
  fs.unlinkSync(s.project); fs.mkdirSync(s.project);
  assert.equal((await remove()).status, 400);
  assert.deepEqual(fs.readdirSync(s.project), []);
  fs.rmdirSync(s.project); fs.renameSync(moved, s.project);
  assert.deepEqual(fs.readFileSync(codex), originalCodex);
  assert.deepEqual((await s.request('/api/settings')).body.captureProjects, saved);
  assert.equal((await s.request('/api/settings')).body.paused, false);
  assert.equal((await remove()).status, 200);
});

test('stale deletion plans reject content and mode changes without backups', t => {
  const root = temp(t);
  const projects = normalizeCaptureProjects([{ path: root, agents: ['codex'] }]);
  const installs = prepareHookPlans(projects, { dataDir: root, port: 4317 });
  applyHookPlans(installs);
  const plans = prepareHookPlans([], { dataDir: root, port: 4317, previousProjects: projects, ownership: installs.ownership });
  const file = path.join(root, '.codex/hooks.json');
  fs.chmodSync(file, 0o640);
  assert.throws(() => applyHookPlans(plans), /changed/);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['hooks.json']);
  fs.chmodSync(file, 0o600);
  write(file, '{"foreign":true}');
  assert.throws(() => applyHookPlans(plans), /changed/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"foreign":true}');
});

test('a root replaced by a symlink after planning cannot write or delete outside', t => {
  const fixtureRoot = temp(t);
  const root = path.join(fixtureRoot, 'project'); fs.mkdirSync(root);
  const projects = normalizeCaptureProjects([{ path: root, agents: ['codex'] }]);
  const installs = prepareHookPlans(projects, { dataDir: fixtureRoot, port: 4317 });
  applyHookPlans(installs).finalize();
  const plans = prepareHookPlans([], { dataDir: fixtureRoot, port: 4317, previousProjects: projects, ownership: installs.ownership });
  const file = path.join(root, '.codex/hooks.json');
  const bytes = fs.readFileSync(file);
  const moved = path.join(fixtureRoot, 'moved');
  fs.renameSync(root, moved); fs.symlinkSync(moved, root);
  assert.throws(() => applyHookPlans(plans), /[Ss]ymbolic link|moved/);
  assert.deepEqual(fs.readFileSync(path.join(moved, '.codex/hooks.json')), bytes);
  assert.deepEqual(fs.readdirSync(path.join(moved, '.codex')), ['hooks.json']);
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
