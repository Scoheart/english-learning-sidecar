import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const installer=path.join(root,'bin/install-hooks.cjs');
function run(cwd,agent,...args){return spawnSync(process.execPath,[installer,agent,...args],{cwd,encoding:'utf8'});}

test('installer preserves unrelated Codex hooks and inserts only once',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sidecar-hooks-'));
  try {
    fs.mkdirSync(path.join(dir,'.codex'));
    const file=path.join(dir,'.codex','hooks.json');
    fs.writeFileSync(file,JSON.stringify({hooks:{Stop:[{hooks:[{type:'command',command:'echo no-change'}]}]}}));
    assert.equal(run(dir,'codex').status,0);
    assert.equal(JSON.parse(fs.readFileSync(file)).hooks.UserPromptSubmit,undefined);
    assert.equal(run(dir,'codex','--apply').status,0);
    assert.equal(run(dir,'codex','--apply').status,0);
    const obj=JSON.parse(fs.readFileSync(file));
    assert.equal(obj.hooks.Stop.length,1);
    assert.equal(obj.hooks.UserPromptSubmit.length,1);
    assert.match(obj.hooks.UserPromptSubmit[0].hooks[0].command,/hook\.cjs\" codex/);
    assert.ok(fs.readdirSync(path.dirname(file)).some(f=>f.includes('.backup-')));
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('Cursor installer adds the required beforeSubmitPrompt handler',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sidecar-cursor-'));
  try {
    assert.equal(run(dir,'cursor','--apply').status,0);
    const cfg=JSON.parse(fs.readFileSync(path.join(dir,'.cursor','hooks.json')));
    assert.equal(cfg.version,1);
    assert.match(cfg.hooks.beforeSubmitPrompt[0].command,/cursor$/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('Grok Build project hook installs without touching other Hook sources and is idempotent',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sidecar-grok-'));
  try {
    fs.mkdirSync(path.join(dir,'.grok','hooks'),{recursive:true});
    const file=path.join(dir,'.grok','hooks','english-sidecar.json');
    fs.writeFileSync(file,JSON.stringify({hooks:{SessionStart:[{hooks:[{type:'command',command:'echo untouched'}]}]}}));
    assert.equal(run(dir,'grok').status,0);
    assert.equal(JSON.parse(fs.readFileSync(file)).hooks.UserPromptSubmit,undefined);
    assert.equal(run(dir,'grok','--apply').status,0);
    assert.equal(run(dir,'grok','--apply').status,0);
    const cfg=JSON.parse(fs.readFileSync(file));
    assert.equal(cfg.hooks.SessionStart[0].hooks[0].command,'echo untouched');
    assert.equal(cfg.hooks.UserPromptSubmit.length,1);
    assert.match(cfg.hooks.UserPromptSubmit[0].hooks[0].command,/hook\.cjs" grok/);
    assert.equal(cfg.hooks.UserPromptSubmit[0].hooks[0].timeout,2);
    assert.ok(fs.readdirSync(path.dirname(file)).some(f=>f.includes('.backup-')));
    assert.equal(fs.existsSync(path.join(dir,'.cursor','hooks.json')),false);
    assert.equal(fs.existsSync(path.join(dir,'.claude','settings.json')),false);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
