#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const port = process.env.SIDECAR_PORT || 4317;
const folder = process.env.SIDECAR_DATA_DIR || path.join(os.homedir(), '.english-sidecar');
async function main() {
  const token = fs.readFileSync(path.join(folder, 'ingest-token'), 'utf8').trim();
  const response = await fetch(`http://127.0.0.1:${port}/api/events`, {
    method:'POST', headers:{'content-type':'application/json','x-sidecar-token':token},
    body:JSON.stringify({source:'manual',eventType:'user.prompt.submitted',sessionId:'smoke',
      turnId:require('node:crypto').randomUUID(),content:'请解释 MCP 的生命周期，以及工具发现机制。'}),
  });
  console.log(`Collector: HTTP ${response.status}`, await response.json());
  if (response.status !== 202) process.exitCode = 1;
}
main().catch(err => { console.error(err.message); process.exitCode = 1; });
