import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const AGENTS = [
  { id: 'codex', name: 'Codex', config: '.codex/hooks.json' },
  { id: 'claude', name: 'Claude Code', config: '.claude/settings.json' },
  { id: 'cursor', name: 'Cursor', config: '.cursor/hooks.json' },
  { id: 'grok', name: 'Grok', config: '.grok/hooks/english-sidecar.json' },
];
const ADAPTER = fileURLToPath(new URL('./hook-adapter.cjs', import.meta.url));
const LEGACY_ADAPTER = fileURLToPath(new URL('../../bin/hook.cjs', import.meta.url));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new Error(message); };

export function projectDirectory(input) {
  if (typeof input !== 'string' || !input || input.includes('\0') || !path.isAbsolute(input)) {
    fail('Choose an existing absolute directory path');
  }
  try {
    if (fs.lstatSync(input).isSymbolicLink()) fail('Symbolic link directories are not supported');
    const real = fs.realpathSync(input);
    if (!fs.statSync(real).isDirectory()) fail('Choose a directory, not a file');
    return real;
  } catch (error) {
    if (error.code) fail('Directory is unavailable or cannot be accessed');
    throw error;
  }
}

export function listDirectories(input = os.homedir()) {
  const directory = projectDirectory(input);
  let entries;
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); }
  catch { fail('Directory cannot be read; check its permissions'); }
  return {
    path: directory,
    parent: path.dirname(directory) === directory ? null : path.dirname(directory),
    directories: entries.filter(entry => entry.isDirectory() && !entry.isSymbolicLink())
      .map(entry => ({ name: entry.name, path: path.join(directory, entry.name) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

// Never follow a symlink below a selected canonical project root, including dangling links.
function safeDestination(root, relative) {
  let current = root;
  const parts = relative.split('/');
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (stat.isSymbolicLink()) fail('Refusing symbolic link in agent configuration path');
    if (index < parts.length - 1 && !stat.isDirectory()) fail('Agent configuration parent must be a directory');
    if (index === parts.length - 1 && !stat.isFile()) fail('Agent configuration must be a regular JSON file');
  }
  return current;
}

function readConfig(destination, agent) {
  let before = null;
  try { before = fs.readFileSync(destination); }
  catch (error) { if (error.code !== 'ENOENT') fail('Agent configuration cannot be read'); }
  let config = {};
  if (before) {
    try { config = JSON.parse(before.toString('utf8')); }
    catch { fail('Refusing to edit invalid agent configuration JSON'); }
  }
  if (!object(config) || (config.hooks !== undefined && !object(config.hooks))) fail('Agent configuration hooks must be a JSON object');
  const event = agent === 'cursor' ? 'beforeSubmitPrompt' : 'UserPromptSubmit';
  if (config.hooks?.[event] !== undefined && !Array.isArray(config.hooks[event])) fail('Agent prompt hooks must be an array');
  for (const entry of config.hooks?.[event] || []) {
    if (!object(entry)) fail('Agent prompt hook entries must be objects');
    if (agent === 'cursor') {
      if (typeof entry.command !== 'string') fail('Cursor prompt hook entries need a command string');
    } else if (!Array.isArray(entry.hooks) || entry.hooks.some(hook => !object(hook) || typeof hook.type !== 'string' || (hook.type === 'command' && typeof hook.command !== 'string'))) {
      fail('Agent prompt hook groups need a valid hooks array');
    }
  }
  if (agent === 'cursor' && config.version !== undefined && config.version !== 1) fail('Unsupported Cursor hooks version');
  return { config, before, event };
}

function installedCli(id, envPath) {
  return String(envPath || '').split(path.delimiter).filter(Boolean).some(dir => {
    try { fs.accessSync(path.join(dir, id), fs.constants.X_OK); return fs.statSync(path.join(dir, id)).isFile(); }
    catch { return false; }
  });
}

function managedCommand(command) {
  // Recognize this adapter and the existing CLI installer, not unrelated hooks.
  if (typeof command !== 'string') return false;
  return [ADAPTER, LEGACY_ADAPTER].some(adapter => command.includes(shellQuote(adapter)) || command.includes(`"${adapter.replaceAll('"', '\\"')}"`));
}
function managedEntry(entry) {
  return object(entry) && (managedCommand(entry.command) || (Array.isArray(entry.hooks) && entry.hooks.some(hook => managedCommand(hook?.command))));
}

export function inspectProject(input, { homeDir = os.homedir(), envPath = process.env.PATH } = {}) {
  const root = projectDirectory(input);
  return { path: root, agents: AGENTS.map(agent => {
    const configPath = path.join(root, agent.config);
    let configured = false;
    try {
      const { config, event } = readConfig(safeDestination(root, agent.config), agent.id);
      configured = Boolean(config.hooks?.[event]?.some(managedEntry));
    } catch { /* Discovery never edits; a bad config will produce a friendly save error. */ }
    const hasDirectory = base => {
      try { return fs.lstatSync(path.join(base, `.${agent.id}`)).isDirectory(); } catch { return false; }
    };
    const detection = hasDirectory(root) ? 'project' : hasDirectory(homeDir) ? 'home' : installedCli(agent.id, envPath) ? 'cli' : 'none';
    return { id: agent.id, name: agent.name, detected: detection !== 'none', configured, configPath, detection };
  }) };
}

export function normalizeCaptureProjects(input) {
  if (!Array.isArray(input) || input.length > 100) fail('captureProjects must be an array of at most 100 projects');
  const seen = new Set();
  return input.map(project => {
    if (!object(project) || !Array.isArray(project.agents) || project.agents.length === 0) fail('Each capture project needs a path and at least one selected agent');
    const root = projectDirectory(project.path);
    if (seen.has(root)) fail('Capture project paths must be unique');
    seen.add(root);
    const agents = [...new Set(project.agents)];
    if (agents.length !== project.agents.length || agents.some(id => !AGENTS.some(agent => agent.id === id))) fail('Choose unique supported agents: codex, claude, cursor, grok');
    return { path: root, agents };
  });
}

// POSIX single quotes protect spaces, dollar substitutions, backticks, and literal quotes.
export const shellQuote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
export function prepareHookPlans(projects, { dataDir, port }) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail('Invalid collector port');
  if (!fs.existsSync(ADAPTER)) fail('Shipped hook adapter is unavailable');
  const plans = [];
  for (const project of projects) for (const id of project.agents) {
    const agent = AGENTS.find(item => item.id === id);
    const destination = safeDestination(project.path, agent.config);
    const { config, before, event } = readConfig(destination, id);
    const command = [process.execPath, ADAPTER, id, '--data-dir', path.resolve(dataDir), '--port', String(port)].map(shellQuote).join(' ');
    config.hooks ??= {};
    if (id === 'cursor') config.version ??= 1;
    const current = config.hooks[event] ?? [];
    // Remove only our own command within shared groups, preserving every unrelated handler.
    const kept = current.flatMap(entry => {
      if (!managedEntry(entry)) return [entry];
      if (Array.isArray(entry.hooks)) {
        const hooks = entry.hooks.filter(hook => !managedCommand(hook?.command));
        if (hooks.length) return [{ ...entry, hooks }];
      }
      return [];
    });
    const handler = id === 'cursor' ? { command } : { hooks: [{ type: 'command', command, timeout: 2 }] };
    config.hooks[event] = [...kept, handler];
    const after = Buffer.from(`${JSON.stringify(config, null, 2)}\n`);
    // Semantic equality also avoids formatting-only edits and unnecessary backups.
    if (before && JSON.stringify(JSON.parse(before.toString('utf8'))) === JSON.stringify(config)) continue;
    plans.push({ root: project.path, relative: agent.config, destination, before, after, mode: before ? fs.statSync(destination).mode & 0o777 : 0o600 });
  }
  return plans;
}

function atomicWrite(destination, content, mode) {
  const temp = `${destination}.sidecar-${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, content, { mode, flag: 'wx' });
    fs.renameSync(temp, destination);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

export function applyHookPlans(plans) {
  const applied = [];
  const createdDirs = [];
  const rollback = () => {
    const errors = [];
    for (const plan of [...applied].reverse()) {
      try {
        safeDestination(plan.root, plan.relative);
        if (plan.before) atomicWrite(plan.destination, plan.before, plan.mode);
        else fs.unlinkSync(plan.destination);
      } catch (error) { errors.push(error); }
    }
    for (const dir of [...createdDirs].reverse()) { try { fs.rmdirSync(dir); } catch { /* Only remove empty newly-created directories. */ } }
    if (errors.length) throw new Error('Hook rollback failed; restore agent configuration from its backup');
  };
  try {
    // Recheck every plan before even creating backup files.
    for (const plan of plans) {
      safeDestination(plan.root, plan.relative);
      let now = null;
      try { now = fs.readFileSync(plan.destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (now === null ? plan.before !== null : plan.before === null || !now.equals(plan.before)) fail('Agent configuration changed; inspect the project and save again');
    }
    for (const plan of plans) {
      let dir = plan.root;
      for (const part of path.dirname(plan.relative).split('/')) {
        dir = path.join(dir, part);
        if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { mode: 0o700 }); createdDirs.push(dir); }
      }
      safeDestination(plan.root, plan.relative);
      if (plan.before) fs.writeFileSync(`${plan.destination}.backup-${Date.now()}-${crypto.randomUUID()}`, plan.before, { mode: plan.mode, flag: 'wx' });
      atomicWrite(plan.destination, plan.after, plan.mode);
      applied.push(plan);
    }
  } catch (error) { rollback(); throw error; }
  return rollback;
}
