import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Storage } from '../src/lib/storage.js';
import { ensurePrivateData, loadConfig } from '../src/lib/config.js';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-db-'));
  const db = new Storage(dir);
  return { db, close: () => { db.close(); fs.rmSync(dir,{recursive:true,force:true}); } };
}

test('stores redacted event and deduplicates same source+turn', () => {
  const {db, close} = fixture();
  try {
    const event = {source:'codex',eventType:'user.prompt.submitted',sessionId:'a',turnId:'b',content:'Explain this',eligible:true};
    const first = db.addEvent(event); const second = db.addEvent(event);
    assert.equal(first.deduplicated,false); assert.equal(second.deduplicated,true);
    assert.equal(db.stats().total,1);
    assert.equal(db.getEvent(first.id).status,'pending');
  } finally { close(); }
});

test('creates knowledge items from one completed lesson and supports retry', () => {
  const {db, close} = fixture();
  try {
    const {id} = db.addEvent({source:'pi',eventType:'user.prompt.submitted',sessionId:'s',turnId:'t',content:'Hello',eligible:true});
    db.setProcessing(id); db.fail(id,'test failure');
    assert.equal(db.retry(id),true);
    db.finish(id,{translation:'Hello!',vocabulary:[{term:'Hello',meaning:'你好'}],grammar:[]});
    assert.equal(db.getEvent(id).status,'complete');
    assert.equal(db.stats().knowledge,1);
    assert.equal(db.listKnowledge()[0].encounters,1);
    db.delete(id);
    assert.equal(db.stats().total,0);
  } finally { close(); }
});

test('pause setting is persisted', () => {
  const {db, close} = fixture();
  try { db.setPaused(true); assert.equal(db.getPaused(),true); db.setPaused(false); assert.equal(db.getPaused(),false); }
  finally { close(); }
});

test('local token is stable and restricted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-auth-'));
  try {
    const config = loadConfig({SIDECAR_DATA_DIR:dir,LEARNING_MODE:'demo'});
    const first = ensurePrivateData(config), second = ensurePrivateData(config);
    assert.equal(first,second); assert.equal(first.length,64);
    if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir,'ingest-token')).mode & 0o777,0o600);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
