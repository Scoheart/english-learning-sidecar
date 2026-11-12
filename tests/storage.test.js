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

function addLesson(db, turnId, content, analysis) {
  const { id } = db.addEvent({ source: 'manual', eventType: 'user.prompt.submitted', sessionId: 'history', turnId, content, eligible: true });
  db.finish(id, analysis);
  return id;
}

const historyLesson = () => ({
  translation: 'Try to interact naturally.',
  vocabulary: [{ term: 'Interact', meaning: '互动',
    examples: [{ english: 'We interact every day.', chinese: '我们每天互动。' }],
    senses: [{ meaning: '相互作用', example: { english: 'They interact.', chinese: '它们相互作用。' } }],
    wordFamily: [{ term: 'Interaction', meaning: '互动', example: { english: 'It was a good interaction.', chinese: '那是一次良好的互动。' } }],
    synonyms: [{ term: 'Communicate', meaning: '沟通', example: { english: 'We communicate openly.', chinese: '我们坦诚沟通。' } }],
    antonyms: [{ term: 'Ignore', meaning: '忽视', example: { english: 'Do not ignore me.', chinese: '不要忽视我。' } }],
  }, { term: '  INTERACT  ', meaning: '互动' }],
  grammar: [{ label: '祈使句', explanation: '使用动词原形。' }],
  examples: [{ english: 'We interact every day.', chinese: '我们每天互动。' }],
});

test('history includes analyses, nested vocabulary and examples, counting once per event', () => {
  const { db, close } = fixture();
  try {
    const first = addLesson(db, 'one', '  Help   me learn  ', historyLesson());
    assert.equal(db.finish(first, historyLesson()), false);
    // Simulate a retried analysis after an interrupted legacy write.
    db.db.prepare("UPDATE events SET status='failed' WHERE id=?").run(first);
    assert.equal(db.retry(first), true);
    db.finish(first, historyLesson());
    const second = addLesson(db, 'two', 'help me LEARN', historyLesson());
    assert.equal(db.listFavorites().length, 0, 'automatic learning never populates favorites');
    assert.equal(db.listHistory({ category: 'analysis' }).total, 1);
    const analysis = db.listHistory({ category: 'analysis' }).history[0];
    assert.equal(analysis.encounters, 2);
    assert.ok([first, second].includes(analysis.event_id));
    assert.equal(analysis.status, 'complete');
    const vocabulary = db.listHistory({ category: 'vocabulary' });
    assert.equal(vocabulary.total, 4);
    assert.ok(vocabulary.history.every(row => row.encounters === 2));
    assert.equal(db.listHistory({ category: 'example' }).total, 5);
    assert.ok(db.listHistory({ category: 'example' }).history.every(row => row.encounters === 2));
    assert.equal(db.listHistory({ category: 'grammar' }).history[0].encounters, 2);
    assert.equal(db.listKnowledge().length, 2, 'existing knowledge list only exposes main vocabulary and grammar');
    assert.equal(db.stats().knowledge, 2);
    assert.equal(db.stats().favorites, 0);
  } finally { close(); }
});

test('history searches all persisted records and paginates with stable totals', () => {
  const { db, close } = fixture();
  try {
    for (let index = 0; index < 165; index++) {
      const id = addLesson(db, `turn-${index}`, `Study item ${index}`, { translation: `Translation ${index}` });
      db.db.prepare('UPDATE events SET updated_at=? WHERE id=?').run(new Date(1700000000000 + index * 1000).toISOString(), id);
    }
    const page = db.listHistory({ category: 'analysis', offset: 60, limit: 60 });
    assert.equal(page.total, 165);
    assert.equal(page.history.length, 60);
    assert.equal(page.history[0].term, 'Study item 104');
    assert.equal(db.listHistory({ q: '  STUDY   ITEM 0  ' }).total, 1);
    assert.equal(db.listHistory({ q: 'Translation 0' }).history[0].term, 'Study item 0');
    assert.equal(db.listHistory({ offset: 165 }).history.length, 0);
    assert.equal(db.listHistory({ limit: 1000 }).history.length, 165);
    assert.throws(() => db.listHistory({ category: 'secret' }), /category/);
    assert.throws(() => db.listHistory({ offset: -1 }), /offset/);
    assert.throws(() => db.listHistory({ limit: 0 }), /limit/);
  } finally { close(); }
});

test('legacy analysis backfill merges normalized knowledge and is idempotent across reopen', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-legacy-history-'));
  let db = new Storage(dir);
  try {
    const { id } = db.addEvent({ source: 'manual', eventType: 'user.prompt.submitted', sessionId: 'legacy', turnId: 'one', content: 'Legacy query', eligible: true });
    db.db.prepare("UPDATE events SET status='complete',analysis=? WHERE id=?").run(JSON.stringify(historyLesson()), id);
    for (const [legacyId, term] of [['legacy-one', 'Interact'], ['legacy-two', '  INTERACT  ']]) {
      db.db.prepare("INSERT INTO knowledge(id,term,meaning,category,encounters,last_seen) VALUES (?,?,?,'vocabulary',1,?)")
        .run(legacyId, term, '互动', '2020-01-01T00:00:00.000Z');
      db.db.prepare('INSERT INTO event_knowledge(event_id,knowledge_id) VALUES (?,?)').run(id, legacyId);
    }
    db.db.prepare("DELETE FROM settings WHERE key='historyMigrationVersion'").run();
    db.close(); db = new Storage(dir);
    const before = db.listHistory({ limit: 200 });
    assert.equal(before.total, 11);
    assert.ok(before.history.every(row => row.encounters === 1));
    assert.equal(db.listFavorites().length, 0);
    db.close(); db = new Storage(dir);
    assert.deepEqual(db.listHistory({ limit: 200 }), before);
    assert.equal(db.listKnowledge().length, 2);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('history uses cleaned authoritative originals and never reflects secrets or analysis errors', () => {
  const { db, close } = fixture();
  try {
    addLesson(db, 'one', 'Captured text token=hidden-value', {
      originalText: 'User question https://example.com/private?token=hidden-value', translation: 'Try this. sk-secretvalue1234',
    });
    const history = db.listHistory();
    assert.equal(history.history[0].term, 'User question');
    assert.doesNotMatch(JSON.stringify(history), /hidden-value|secretvalue1234|example\.com/);
    assert.equal(history.history[0].meaning, 'Try this. [REDACTED KEY]');
  } finally { close(); }
});

test('event deletion preserves keep/purge encounter behavior without affecting favorites', () => {
  const { db, close } = fixture();
  try {
    const first = addLesson(db, 'one', 'First query', historyLesson());
    const second = addLesson(db, 'two', 'Second query', historyLesson());
    const favorite = db.addFavorite({ term: 'Interact', meaning: '互动', category: 'vocabulary', eventId: first }).favorite;
    assert.equal(db.delete(first), true);
    assert.equal(db.listFavorites()[0].id, favorite.id);
    assert.equal(db.listFavorites()[0].event_id, null);
    assert.equal(db.listKnowledge()[0].encounters, 2);
    assert.equal(db.listHistory({ category: 'analysis' }).total, 1);
    assert.equal(db.listHistory({ category: 'example' }).history[0].encounters, 2);
    assert.equal(db.delete(second, { purgeKnowledge: true }), true);
    assert.equal(db.listKnowledge()[0].encounters, 1);
    assert.ok(db.listHistory().history.every(row => row.event_id === null));
    assert.equal(db.listFavorites().length, 1);
    assert.equal(db.deleteFavorite(favorite.id), true);
    assert.ok(db.listHistory().total > 0);
  } finally { close(); }
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
