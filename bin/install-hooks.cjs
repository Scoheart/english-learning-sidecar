#!/usr/bin/env node
'use strict';
// Opt-in safe installer. Never rewrites the main agent prompt or any unrelated hooks.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const agent = args[0];
const scope = args.find(x => x.startsWith('--scope='))?.split('=')[1] || 'project';
const apply = args.includes('--apply');
if (!['codex', 'claude', 'cursor', 'grok'].includes(agent) || !['project', 'user'].includes(scope)) {
  console.error('Usage: node bin/install-hooks.cjs codex|claude|cursor|grok [--scope=project|user] [--apply]');
  process.exitCode = 1;
} else {
  const paths = { codex: '.codex/hooks.json', claude: '.claude/settings.json', cursor: '.cursor/hooks.json', grok: '.grok/hooks/english-sidecar.json' };
  const base = scope === 'user' ? os.homedir() : process.cwd();
  const destination = path.join(base, paths[agent]);
  const hookPath = path.join(root, 'bin/hook.cjs');
  if (!fs.existsSync(hookPath)) throw new Error('Hook script missing');
  // Quote path so paths with spaces work on macOS and Linux; Windows support needs an explicit shell strategy.
  const command = `node "${hookPath.replaceAll('"','\\"')}" ${agent}`;
  const eventName = agent === 'cursor' ? 'beforeSubmitPrompt' : 'UserPromptSubmit';
  const handler = agent === 'cursor' ? { command } : { hooks: [{ type: 'command', command, timeout: 2 }] };
  let config = {};
  if (fs.existsSync(destination)) {
    try { config = JSON.parse(fs.readFileSync(destination, 'utf8')); }
    catch { throw new Error(`Refusing to edit invalid JSON: ${destination}`); }
  }
  if (!config.hooks) config.hooks = {};
  if (agent === 'cursor') config.version ||= 1;
  if (!Array.isArray(config.hooks[eventName])) config.hooks[eventName] = [];
  const current = config.hooks[eventName];
  const exists = current.some(entry => JSON.stringify(entry).includes(hookPath));
  if (!exists) current.push(handler);
  console.log(`Target: ${destination}`);
  console.log(`Mode: ${apply ? 'WRITE' : 'DRY RUN'} · scope=${scope} · agent=${agent}`);
  console.log(`Hook: ${command}`);
  console.log(exists ? 'Hook already present, no duplicate inserted.' : 'Hook will be appended, other keys preserved.');
  if (apply && !exists) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (fs.existsSync(destination)) fs.copyFileSync(destination, `${destination}.backup-${Date.now()}`);
    fs.writeFileSync(destination, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    console.log('Installed. Review/trust the hook in the Agent UI if prompted.');
  } else if (!apply) console.log('Nothing was changed. Add --apply to install.');
}
