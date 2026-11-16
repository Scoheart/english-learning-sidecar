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

test('configured agents distinguish pending disconnect from saved connected state', () => {
  const html = render(ProjectAgentRow, { project: { ...project, agents: ['cursor'] }, info, disabled: false, onChange: noop, onRemove: noop });
  assert.ok(html.includes('保存后停用'));
  assert.ok(html.includes('保存后接入'));
  assert.doesNotMatch(html, />已接入</);
});

test('empty agent selection is a valid stopped project and busy state disables fieldset', () => {
  const html = render(ProjectAgentRow, { project: { ...project, agents: [] }, disabled: true, onChange: noop, onRemove: noop });
  assert.match(html, /fieldset disabled=""/);
  assert.ok(html.includes('未选择 Agent，保存后停用此项目的采集。'));
  for (const name of ['Codex', 'Claude Code', 'Cursor', 'Grok Build']) assert.ok(html.includes(name));
  assert.doesNotMatch(html, /checked=""/);
});

test('agent stopped-state hint reserves identical space for empty and nonempty selections', () => {
  const renderRow = agents => render(ProjectAgentRow, { project: { ...project, agents }, disabled: false, onChange: noop, onRemove: noop });
  const empty = renderRow([]);
  const selected = renderRow(['claude']);
  const hint = '未选择 Agent，保存后停用此项目的采集。';
  assert.ok(empty.includes(`style="visibility:visible">${hint}</p>`));
  assert.ok(selected.includes(`style="visibility:hidden">${hint}</p>`));
  assert.equal((empty.match(/<p\b/g) || []).length, (selected.match(/<p\b/g) || []).length);
});

test('settings keeps modal height and scrollbar space stable while editing', () => {
  const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
  assert.match(app, /sm:max-w-xl h-\[88dvh\] grid-rows-\[auto_minmax\(0,1fr\)_auto\]/);
  assert.match(app, /overflow-y-auto \[scrollbar-gutter:stable\]/);
});

test('capture settings empty state teaches project selection and discloses deferred file writes', () => {
  const html = render(ProjectCaptureSettings, { ...props, projects: [] });
  for (const text of ['项目与 Agent', '添加项目', '还没有添加项目', '无需手动编辑配置文件', '确定', '保留其他配置', '自动备份', '高级采集范围']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /textarea|type="file"/);
});

test('advanced settings retain legacy directories and clearly explain reversible project hooks', () => {
  const html = render(ProjectCaptureSettings, { ...props, policy: { mode: 'all', allowedProjects: [...policy.allowedProjects, '/legacy/work'], excludedProjects: ['/private/work'] } });
  for (const text of ['原有允许目录', '/legacy/work', '/private/work', '所有项目', '排除目录', '取消勾选即停用', '移除项目会清理该项目内 Sidecar 添加的 Hook', '保留其他配置并自动备份', 'aria-label="移除排除目录 /private/work"']) assert.ok(html.includes(text), text);
});

test('directory navigation keeps fixed list and feedback slots mounted during loading', () => {
  const component = fs.readFileSync(path.join(root, 'components/project-capture-settings.tsx'), 'utf8');
  const browse = component.slice(component.indexOf('const browse = async'), component.indexOf('const openBrowser ='));
  assert.doesNotMatch(browse, /setListing\(null\)/);
  assert.match(browse, /focus\(\{ preventScroll: true \}\)/);
  assert.match(browse, /setListingReady\(false\)/);
  assert.match(browse, /setListingReady\(true\)/);
  assert.match(component, /<ul ref=\{directoryListRef\} tabIndex=\{-1\} className="h-44 overflow-y-auto/);
  assert.match(component, /className="h-10 overflow-y-auto text-muted-foreground"/);
  assert.match(component, /if \(!listing \|\| !listingReady \|\| loading/);
  assert.doesNotMatch(component, /\{listing && <>/);
});

test('settings integration submits project draft only on save and prevents stale-path selection', () => {
  const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
  const component = fs.readFileSync(path.join(root, 'components/project-capture-settings.tsx'), 'utf8');
  assert.match(app, /captureProjects: captureProjectsDraft/);
  assert.match(app, /setCaptureProjectsDraft\(structuredClone\(status\?\.captureProjects \|\| \[\]\)\)/);
  assert.doesNotMatch(app, /captureProjectsDraft\.some\(project => project\.agents\.length === 0\)/);
  assert.match(app, /disabled=\{busy \|\| directoryPending \|\| !captureDraft \|\| !status\}/);
  assert.match(component, /setLoading\(true\); setError\(null\); setListingReady\(false\)/);
  assert.match(component, /disabled=\{locked \|\| !listing \|\| !listingReady \|\| pathInput\.trim\(\) !== listing\.path\}/);
  assert.doesNotMatch(component, /localRequest[^\n]*['"]\/api\/settings/);
});
