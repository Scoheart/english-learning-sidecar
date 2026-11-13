#!/usr/bin/env node
'use strict';
// Shipped with src/lib in the native engine. Fail open and keep agent stdout clean.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const args = process.argv.slice(2);
const source = String(args[0] || 'unknown').toLowerCase();
function option(name, fallback) {
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1]) return args[index + 1];
  const inline = args.find(value => value.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : fallback;
}
const dir = option('--data-dir', process.env.SIDECAR_DATA_DIR || path.join(os.homedir(), '.english-sidecar'));
const port = Number(option('--port', process.env.SIDECAR_PORT || 4317));
let responded = false;
const done = () => { if (responded) return; responded = true; if (source === 'cursor') process.stdout.write('{"continue":true}\n'); };
let buffer = '';
let tooLarge = false;
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  if (tooLarge) return;
  buffer += chunk;
  if (Buffer.byteLength(buffer) > 128000) { tooLarge = true; buffer = ''; }
});
process.stdin.on('error', done);
process.stdin.on('end', async () => {
  try {
    if (tooLarge || !Number.isInteger(port) || port < 1 || port > 65535) return;
    const payload = JSON.parse(buffer);
    const prompt = typeof payload.prompt === 'string' ? payload.prompt : typeof payload.text === 'string' ? payload.text : '';
    if (prompt && prompt.length <= 12000) {
      const token = fs.readFileSync(path.join(dir, 'ingest-token'), 'utf8').trim();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 220);
      try {
        await fetch(`http://127.0.0.1:${port}/api/events`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-sidecar-token': token },
          body: JSON.stringify({
            source, eventType: 'user.prompt.submitted',
            sessionId: String(payload.sessionId || payload.session_id || payload.conversation_id || ''),
            turnId: String(payload.promptId || payload.turnId || payload.turn_id || ''),
            projectPath: [payload.cwd, payload.project_dir, payload.projectDir, payload.project_path, payload.workspace_roots?.[0], payload.workspaceRoots?.[0]]
              .find(value => typeof value === 'string' && path.isAbsolute(value)) || process.cwd(),
            content: prompt,
          }),
          signal: controller.signal,
        });
      } finally { clearTimeout(timer); }
    }
  } catch { /* Collector absence must never interrupt the agent. */ }
  finally { done(); }
});
