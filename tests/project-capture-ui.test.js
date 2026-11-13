import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../src/web/', import.meta.url));
const server = await createServer({
  configFile: false, root,
  resolve: { alias: { '@': path.resolve(root) } },
  server: { middlewareMode: true, hmr: false, watch: null, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom',
});
after(() => server.close());
const { ProjectAgentRow, ProjectCaptureSettings } = await server.ssrLoadModule('/components/project-capture-settings.tsx');
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const policy = { mode: 'allowlist', allowedProjects: ['/work/project'], excludedProjects: [] };
const project = { path: '/work/project', agents: ['claude', 'cursor'] };
const info = { path: project.path, agents: [
  { id: 'claude', name: 'Claude Code', detected: true, detection: 'project', configured: true, configPath: '/work/project/.claude/settings.json' },
  { id: 'cursor', name: 'Cursor', detected: true, detection: 'cli', configured: false, configPath: '/work/project/.cursor/hooks.json' },
  { id: 'codex', name: 'Codex', detected: false, detection: 'none', configured: false, configPath: '/work/project/.codex/hooks.json' },
] };
const noop = () => {};
const props = { projects: [project], policy, disabled: false, onProjectsChange: noop, onPolicyChange: noop, onPendingChange: noop };

test('project agent controls are labelled native checkboxes with restored selection and config targets', () => {
  const html = render(ProjectAgentRow, { project, info, disabled: false, onChange: noop, onRemove: noop });
  assert.equal((html.match(/type="checkbox"/g) || []).length, 3);
  assert.equal((html.match(/checked=""/g) || []).length, 2);
  for (const text of ['aria-label="/work/project 的 Claude Code"', 'aria-label="移除项目 /work/project"', '已接入', '本机已发现', '未检测到，可手动选择', '.claude/settings.json']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /type="file"|webkitdirectory|textarea/);
});

test('empty agent selection gives a visible corrective message and busy state disables fieldset', () => {
  const html = render(ProjectAgentRow, { project: { ...project, agents: [] }, disabled: true, onChange: noop, onRemove: noop });
  assert.match(html, /fieldset disabled=""/);
  assert.ok(html.includes('请至少选择一个 Agent，或移除此项目。'));
  for (const name of ['Codex', 'Claude Code', 'Cursor', 'Grok Build']) assert.ok(html.includes(name));
  assert.doesNotMatch(html, /checked=""/);
});

test('capture settings empty state teaches project selection and discloses deferred file writes', () => {
  const html = render(ProjectCaptureSettings, { ...props, projects: [] });
  for (const text of ['项目与 Agent', '添加项目', '还没有添加项目', '无需手动编辑配置文件', '确定', '已有设置会保留', '自动备份', '高级采集范围']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /textarea|type="file"/);
});

test('advanced capture settings retain legacy allowed directories and exclusions without hiding uninstall limitation', () => {
  const html = render(ProjectCaptureSettings, { ...props, policy: { mode: 'all', allowedProjects: [...policy.allowedProjects, '/legacy/work'], excludedProjects: ['/private/work'] } });
  for (const text of ['原有允许目录', '/legacy/work', '/private/work', '所有项目', '排除目录', '取消勾选或移除项目不会卸载已安装的 Hook', 'aria-label="移除排除目录 /private/work"']) assert.ok(html.includes(text), text);
});

test('settings integration submits project draft only on save and prevents stale-path selection', () => {
  const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
  const component = fs.readFileSync(path.join(root, 'components/project-capture-settings.tsx'), 'utf8');
  assert.match(app, /captureProjects: captureProjectsDraft/);
  assert.match(app, /setCaptureProjectsDraft\(structuredClone\(status\?\.captureProjects \|\| \[\]\)\)/);
  assert.match(app, /captureProjectsDraft\.some\(project => project\.agents\.length === 0\)/);
  assert.match(app, /disabled=\{busy \|\| directoryPending \|\| !captureDraft \|\| !status\}/);
  assert.match(component, /setLoading\(true\); setError\(null\); setListing\(null\)/);
  assert.match(component, /disabled=\{locked \|\| !listing \|\| pathInput\.trim\(\) !== listing\.path\}/);
  assert.doesNotMatch(component, /localRequest[^\n]*['"]\/api\/settings/);
});
