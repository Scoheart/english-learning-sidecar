#!/usr/bin/env node
'use strict';
// Fail-open UserPromptSubmit adapter. Never writes learning content to the agent's stdout.
// Cursor's schema expects {"continue":true}; Codex/Claude want truly empty stdout.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const source = String(process.argv[2] || 'unknown').toLowerCase();
const cursor = source === 'cursor';
let responded = false;
const done = () => { if (responded) return; responded = true; if (cursor) process.stdout.write('{"continue":true}\n'); };
const dir = process.env.SIDECAR_DATA_DIR || path.join(os.homedir(), '.english-sidecar');
const port = Number(process.env.SIDECAR_PORT || 4317);
let buffer = '';
let tooLarge = false;
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  if (tooLarge) return;
  buffer += chunk;
  if (buffer.length > 128000) { tooLarge = true; buffer = ''; }
});
process.stdin.on('error', () => done());
process.stdin.on('end', async () => {
  try {
    if (tooLarge) return;
    const payload = JSON.parse(buffer);
    const prompt = typeof payload.prompt === 'string' ? payload.prompt
      : typeof payload.text === 'string' ? payload.text : '';
    if (prompt && prompt.length <= 12000) {
      const token = fs.readFileSync(path.join(dir, 'ingest-token'), 'utf8').trim();
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 220);
      try {
        await fetch(`http://127.0.0.1:${port}/api/events`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-sidecar-token': token },
          body: JSON.stringify({
            source, eventType: 'user.prompt.submitted',
            sessionId: String(payload.sessionId || payload.session_id || payload.conversation_id || ''),
            turnId: String(payload.promptId || payload.turnId || payload.turn_id || ''),
            // Native project fields stay local; the collector checks policy then hashes them.
            projectPath: [payload.cwd, payload.project_dir, payload.projectDir,
              payload.project_path, payload.workspace_roots?.[0], payload.workspaceRoots?.[0]]
              .find(value => typeof value === 'string' && path.isAbsolute(value)) || process.cwd(),
            content: prompt,
          }),
          signal: ac.signal,
        });
      } finally { clearTimeout(timer); }
    }
  } catch { /* Collector absence/errors must never interrupt the main Agent */ }
  finally { done(); }
});
