import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const AGENTS = [
  { id: 'codex', name: 'Codex', config: '.codex/hooks.json' },
  { id: 'claude', name: 'Claude Code', config: '.claude/settings.json' },
  { id: 'cursor', name: 'Cursor', config: '.cursor/hooks.json' },
  { id: 'grok', name: 'Grok Build', config: '.grok/hooks/english-sidecar.json' },
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

// Parse only literal shell arguments. Expansions, redirections and compound shell
// commands are deliberately not recognized as ours, even when they mention us.
function literalArguments(command) {
  if (typeof command !== 'string') return null;
  const args = [];
  let token = '', started = false, quote = null;
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (quote === "'") {
      if (char === "'") quote = null; else token += char;
    } else if (quote === '"') {
      if (char === '"') quote = null;
      else if (char === '$' || char === '`' || char === '\n') return null;
      else if (char === '\\') {
        const next = command[++i];
        if (!next) return null;
        token += ['"', '\\', '$', '`'].includes(next) ? next : `\\${next}`;
      } else token += char;
    } else if (/\s/.test(char)) {
      if (started) { args.push(token); token = ''; started = false; }
    } else if (char === "'" || char === '"') { quote = char; started = true; }
    else if (char === '\\') {
      if (++i >= command.length || command[i] === '\n') return null;
      token += command[i]; started = true;
    } else {
      if (/[|&;<>($`)*?\[\]{}~#]/.test(char)) return null;
      token += char; started = true;
    }
  }
  if (quote) return null;
  if (started) args.push(token);
  return args;
}
function managedCommand(command) {
  const args = literalArguments(command);
  if (!args || !['node', process.execPath].includes(args[0]) || !AGENTS.some(agent => agent.id === args[2])) return false;
  if (args[1] === LEGACY_ADAPTER) return args.length === 3;
  return args[1] === ADAPTER && args.length === 7 && args[3] === '--data-dir'
    && path.isAbsolute(args[4]) && args[5] === '--port' && /^\d+$/.test(args[6])
    && Number(args[6]) >= 1 && Number(args[6]) <= 65535;
}
function managedEntry(entry) {
  return object(entry) && (managedCommand(entry.command) || (Array.isArray(entry.hooks) && entry.hooks.some(hook => hook?.type === 'command' && managedCommand(hook.command))));
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
    if (!object(project) || !Array.isArray(project.agents)) fail('Each capture project needs a path and an agents array');
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
function rootIdentity(root, expected) {
  // Canonical equality also rejects symlinked ancestors of a previously saved root.
  if (projectDirectory(root) !== root) fail('Project directory moved or became a symbolic link; restore it before cleaning hooks');
  const stat = fs.statSync(root);
  const identity = { device: stat.dev, inode: stat.ino };
  if (expected && (identity.device !== expected.device || identity.inode !== expected.inode)) {
    fail('Project directory was replaced or moved; restore the original directory before cleaning hooks');
  }
  return identity;
}

// Backwards-compatible array of plans, with the next ledger attached for the
// settings transaction. No project or registry writes occur while planning.
export function prepareHookPlans(projects, { dataDir, port, previousProjects = [], ownership = {} }) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail('Invalid collector port');
  if (!fs.existsSync(ADAPTER)) fail('Shipped hook adapter is unavailable');
  const plans = [];
  plans.ownership = {};
  const currentProjects = new Map(projects.map(project => [project.path, project]));
  const roots = [...new Set([...previousProjects.map(project => project.path), ...currentProjects.keys()])];
  for (const root of roots) {
    const previous = ownership[root];
    const identity = rootIdentity(root, previous);
    const selected = currentProjects.get(root)?.agents ?? [];
    const record = { ...identity, configs: structuredClone(previous?.configs ?? {}) };
    // Scan all four: older versions saved unchecked metadata without uninstalling.
    for (const agent of AGENTS) {
      const id = agent.id;
      const install = selected.includes(id);
      const destination = safeDestination(root, agent.config);
      const { config, before, event } = readConfig(destination, id);
      const fileStat = before === null ? null : fs.statSync(destination);
      let provenance = record.configs[id];
      // An atomically replaced file is not proven to be the file we created.
      // Keep its scaffolding conservatively, while still removing owned commands.
      if (provenance && (!fileStat || provenance.fileDevice !== fileStat.dev || provenance.fileInode !== fileStat.ino)) {
        delete record.configs[id];
        provenance = undefined;
      }
      if (install) {
        provenance ??= {
          created: before === null,
          hooksCreated: config.hooks === undefined,
          eventCreated: config.hooks?.[event] === undefined,
          versionCreated: id === 'cursor' && config.version === undefined,
          fileDevice: fileStat?.dev, fileInode: fileStat?.ino,
        };
        record.configs[id] = provenance;
      }
      let removed = false;
      const kept = (config.hooks?.[event] ?? []).flatMap(entry => {
        if (id === 'cursor') {
          if (!managedCommand(entry.command)) return [entry];
          removed = true; return [];
        }
        const hooks = entry.hooks.filter(hook => !(hook.type === 'command' && managedCommand(hook.command)));
        if (hooks.length === entry.hooks.length) return [entry];
        removed = true;
        // Matcher and any other group metadata belong to the user, not us.
        return hooks.length || Object.keys(entry).some(key => key !== 'hooks') ? [{ ...entry, hooks }] : [];
      });
      if (install) {
        const command = [process.execPath, ADAPTER, id, '--data-dir', path.resolve(dataDir), '--port', String(port)].map(shellQuote).join(' ');
        config.hooks ??= {};
        if (id === 'cursor') config.version ??= 1;
        const handler = id === 'cursor' ? { command } : { hooks: [{ type: 'command', command, timeout: 2 }] };
        config.hooks[event] = [...kept, handler];
      } else {
        if (removed) config.hooks[event] = kept;
        // Only remove scaffolding for which the registry proves ownership.
        if (provenance?.eventCreated && config.hooks?.[event]?.length === 0) delete config.hooks[event];
        if (provenance?.hooksCreated && config.hooks && Object.keys(config.hooks).length === 0) delete config.hooks;
        // Cursor's version is shared format metadata; user hooks still need it.
        if (provenance?.versionCreated && config.version === 1 && (!config.hooks || Object.keys(config.hooks).length === 0)) delete config.version;
      }
      const deleting = !install && provenance?.created && Object.keys(config).length === 0;
      if (deleting || (before === null && !install)) delete record.configs[id];
      const after = deleting ? null : Buffer.from(`${JSON.stringify(config, null, 2)}\n`);
      if (before === null && !install) continue;
      // Semantic equality avoids formatting-only edits and unnecessary backups.
      if (after !== null && before && JSON.stringify(JSON.parse(before.toString('utf8'))) === JSON.stringify(config)) continue;
      plans.push({ root, identity, provenance: record.configs[id], fileIdentity: fileStat ? { device: fileStat.dev, inode: fileStat.ino } : null, relative: agent.config, destination, before, after, mode: fileStat ? fileStat.mode & 0o7777 : 0o600 });
    }
    if (currentProjects.has(root)) plans.ownership[root] = record;
  }
  return plans;
}

function atomicWrite(destination, content, mode) {
  const temp = `${destination}.sidecar-${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, content, { mode, flag: 'wx' });
    fs.chmodSync(temp, mode);
    fs.renameSync(temp, destination);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

export function applyHookPlans(plans) {
  const applied = [];
  const createdDirs = [];
  const snapshots = new Map();
  const finalize = () => {
    for (const [plan, snapshot] of snapshots) {
      try {
        rootIdentity(plan.root, plan.identity);
        safeDestination(plan.root, path.relative(plan.root, snapshot));
        fs.unlinkSync(snapshot);
      } catch { /* A committed save must not fail because undo cleanup failed. */ }
    }
    snapshots.clear();
  };
  const rollback = () => {
    const errors = [];
    for (const plan of [...applied].reverse()) {
      try {
        rootIdentity(plan.root, plan.identity);
        safeDestination(plan.root, plan.relative);
        if (plan.before !== null) {
          const snapshot = snapshots.get(plan);
          fs.renameSync(snapshot, plan.destination);
          snapshots.delete(plan);
          fs.chmodSync(plan.destination, plan.mode);
        } else fs.unlinkSync(plan.destination);
      } catch (error) { errors.push(error); }
    }
    for (const dir of [...createdDirs].reverse()) { try { fs.rmdirSync(dir); } catch { /* Only remove empty newly-created directories. */ } }
    if (errors.length) throw new Error('Hook rollback failed; restore agent configuration from its backup');
    finalize();
  };
  rollback.finalize = finalize;
  try {
    // Recheck every plan before even creating backup files.
    for (const plan of plans) {
      rootIdentity(plan.root, plan.identity);
      safeDestination(plan.root, plan.relative);
      let now = null;
      try { now = fs.readFileSync(plan.destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const stat = now === null ? null : fs.statSync(plan.destination);
      if (now === null ? plan.before !== null : plan.before === null || !now.equals(plan.before)
        || (stat.mode & 0o7777) !== plan.mode || (plan.fileIdentity && (stat.dev !== plan.fileIdentity.device || stat.ino !== plan.fileIdentity.inode))) {
        fail('Agent configuration changed; inspect the project and save again');
      }
    }
    for (const plan of plans) {
      rootIdentity(plan.root, plan.identity);
      safeDestination(plan.root, plan.relative);
      let dir = plan.root;
      for (const part of path.dirname(plan.relative).split('/')) {
        dir = path.join(dir, part);
        if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { mode: 0o700 }); createdDirs.push(dir); }
      }
      rootIdentity(plan.root, plan.identity);
      safeDestination(plan.root, plan.relative);
      if (plan.before !== null) {
        const backup = `${plan.destination}.backup-${Date.now()}-${crypto.randomUUID()}`;
        fs.writeFileSync(backup, plan.before, { mode: plan.mode, flag: 'wx' });
        fs.chmodSync(backup, plan.mode);
        // Keep the original inode alive until COMMIT so rollback leaves the
        // persisted provenance valid as well as restoring exact bytes/modes.
        const snapshot = `${plan.destination}.sidecar-undo-${crypto.randomUUID()}.tmp`;
        fs.linkSync(plan.destination, snapshot);
        snapshots.set(plan, snapshot);
      }
      if (plan.after === null) fs.unlinkSync(plan.destination);
      else atomicWrite(plan.destination, plan.after, plan.mode);
      applied.push(plan);
      if (plan.provenance && plan.after !== null) {
        const stat = fs.statSync(plan.destination);
        plan.provenance.fileDevice = stat.dev;
        plan.provenance.fileInode = stat.ino;
      }
    }
  } catch (error) { rollback(); throw error; }
  return rollback;
}
