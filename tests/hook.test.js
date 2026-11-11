import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('Codex and Claude adapters are completely silent when collector is offline',()=>{
  for(const source of ['codex','claude']) {
    const proc=spawnSync(process.execPath,[path.join(root,'bin/hook.cjs'),source],{input:JSON.stringify({prompt:'Hello',session_id:'s'}),encoding:'utf8',timeout:4000});
    assert.equal(proc.status,0);assert.equal(proc.stdout,'');assert.equal(proc.stderr,'');
  }
});

test('Cursor adapter always tells main Agent to continue',()=>{
  const proc=spawnSync(process.execPath,[path.join(root,'bin/hook.cjs'),'cursor'],{input:JSON.stringify({prompt:'Hello'}),encoding:'utf8',timeout:4000});
  assert.equal(proc.status,0);assert.deepEqual(JSON.parse(proc.stdout),{continue:true});
});
