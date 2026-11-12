import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Storage } from '../src/lib/storage.js';
import { createSidecar } from '../src/lib/server.js';

const config = dataDir => ({ host: '127.0.0.1', port: 0, dataDir, mode: 'unconfigured', apiKey: '', model: '' });
const headers = { 'content-type': 'application/json' };

function completeEvent(db, index = 0) {
  const { id } = db.addEvent({ source: 'manual', eventType: 'user.prompt.submitted', sessionId: 'test', turnId: `turn-${index}`, content: `Question ${index}`, eligible: true });
  db.finish(id, { translation: `Translation ${index}`, vocabulary: [{ term: 'Hello', meaning: '你好' }], grammar: [], examples: [{ english: 'Hello there!', chinese: '你好啊！' }] });
  return id;
}

async function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-favorites-api-'));
  const app = createSidecar(config(dir));
  const address = await app.start();
  return { dir, app, base: `http://127.0.0.1:${address.port}`, close: async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('favorites normalize Unicode, case and whitespace, but keep categories distinct and persist', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-favorites-db-'));
  let db = new Storage(dir);
  try {
    const first = db.addFavorite({ term: '  Ｃａｆé\t au\n LAIT  ', meaning: '咖啡', category: 'vocabulary' });
    assert.equal(first.duplicate, false);
    const duplicate = db.addFavorite({ term: 'cafe\u0301 au lait', meaning: '应保留原释义', category: 'vocabulary' });
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.message, '已在收藏夹，无需重复收藏');
    assert.equal(duplicate.favorite.id, first.favorite.id);
    assert.equal(duplicate.favorite.meaning, '咖啡');
    for (const category of ['grammar', 'example']) assert.equal(db.addFavorite({ term: 'café au lait', meaning: '分类不同', category }).duplicate, false);
    assert.equal(db.listFavorites().length, 3);
    assert.equal(db.listKnowledge().length, 0);
    assert.equal(db.listHistory().total, 0, 'explicit favorite does not manufacture automatic history');
    db.close(); db = new Storage(dir);
    assert.equal(db.listFavorites().length, 3);
    assert.equal(db.addFavorite({ term: 'CAFÉ AU LAIT', meaning: '重复', category: 'vocabulary' }).duplicate, true);
    assert.equal(db.deleteFavorite(first.favorite.id), true);
    assert.equal(db.deleteFavorite(first.favorite.id), false);
    assert.equal(db.listFavorites().length, 2);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('favorites API returns exact envelopes and stays independent of event and history deletion', async () => {
  const s = await fixture();
  try {
    const eventId = completeEvent(s.app.storage);
    assert.deepEqual(await (await fetch(`${s.base}/api/favorites`)).json(), { favorites: [] });
    const post = body => fetch(`${s.base}/api/favorites`, { method: 'POST', headers, body: JSON.stringify(body) });
    const response = await post({ term: ' Hello ', meaning: '你好', category: 'vocabulary', eventId });
    assert.equal(response.status, 201);
    const created = await response.json();
    assert.equal(created.duplicate, false);
    assert.equal(created.favorite.event_id, eventId);
    assert.ok(created.favorite.created_at);
    const repeat = await post({ term: '\tHELLO\n', meaning: 'different', category: 'vocabulary' });
    assert.equal(repeat.status, 200);
    const duplicate = await repeat.json();
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.message, '已在收藏夹，无需重复收藏');
    assert.equal(duplicate.favorite.id, created.favorite.id);
    const status = await (await fetch(`${s.base}/api/status`)).json();
    assert.equal(status.stats.favorites, 1);
    const historyBefore = await (await fetch(`${s.base}/api/history`)).json();
    assert.equal(historyBefore.total, 3);
    const removedFavorite = await fetch(`${s.base}/api/favorites/${created.favorite.id}`, { method: 'DELETE' });
    assert.equal(removedFavorite.status, 200);
    assert.deepEqual(await removedFavorite.json(), { removed: true });
    assert.deepEqual(await (await fetch(`${s.base}/api/history`)).json(), historyBefore);
    assert.equal((await fetch(`${s.base}/api/favorites/${created.favorite.id}`, { method: 'DELETE' })).status, 404);
    const savedAgain = await (await post({ term: 'Hello', meaning: '你好', category: 'vocabulary', eventId })).json();
    assert.equal((await fetch(`${s.base}/api/events/${eventId}?knowledge=purge`, { method: 'DELETE' })).status, 200);
    const favorites = (await (await fetch(`${s.base}/api/favorites`)).json()).favorites;
    assert.equal(favorites.length, 1);
    assert.equal(favorites[0].id, savedAgain.favorite.id);
    assert.equal(favorites[0].event_id, null);
    assert.equal((await (await fetch(`${s.base}/api/history`)).json()).total, 0);
    assert.equal((await fetch(`${s.base}/api/events/${eventId}`)).status, 404);
  } finally { await s.close(); }
});

test('history API searches older persisted records, filters categories, paginates and opens old events', async () => {
  const s = await fixture();
  try {
    let oldest;
    for (let index = 0; index < 145; index++) {
      const id = completeEvent(s.app.storage, index);
      if (!index) oldest = id;
      s.app.storage.db.prepare('UPDATE events SET updated_at=? WHERE id=?').run(new Date(1700000000000 + index * 1000).toISOString(), id);
    }
    const first = await (await fetch(`${s.base}/api/history?category=analysis&limit=60&offset=0`)).json();
    const second = await (await fetch(`${s.base}/api/history?category=analysis&limit=60&offset=60`)).json();
    assert.equal(first.total, 145);
    assert.equal(second.total, 145);
    assert.equal(first.history.length, 60);
    assert.equal(second.history.length, 60);
    assert.equal(new Set([...first.history, ...second.history].map(row => row.id)).size, 120);
    const searched = await (await fetch(`${s.base}/api/history?q=${encodeURIComponent('  QUESTION   0  ')}&category=analysis`)).json();
    assert.equal(searched.total, 1);
    assert.equal(searched.history[0].event_id, oldest);
    const detail = await (await fetch(`${s.base}/api/events/${oldest}`)).json();
    assert.equal(detail.event.id, oldest);
    assert.equal(detail.event.analysis.translation, 'Translation 0');
    const examples = await (await fetch(`${s.base}/api/history?category=example`)).json();
    assert.equal(examples.total, 1);
    assert.equal(examples.history[0].encounters, 145);
    assert.equal(examples.history[0].term, 'Hello there!');
    assert.equal((await (await fetch(`${s.base}/api/knowledge`)).json()).knowledge.length, 1);
  } finally { await s.close(); }
});

test('favorites/history API validates inputs, caps sizes, redacts secrets and follows origin policy', async () => {
  const s = await fixture();
  try {
    const post = (body, extraHeaders = {}) => fetch(`${s.base}/api/favorites`, { method: 'POST', headers: { ...headers, ...extraHeaders }, body: JSON.stringify(body) });
    for (const body of [null, [], {}, { term: 123, meaning: '有效', category: 'vocabulary' }, { term: ' ', meaning: '有效', category: 'vocabulary' },
      { term: 'Hello', meaning: '', category: 'grammar' }, { term: 'Hello', meaning: '你好', category: 'analysis' },
      { term: 'a'.repeat(1201), meaning: '你好', category: 'vocabulary' }, { term: 'Hello', meaning: '好'.repeat(3001), category: 'vocabulary' },
      { term: 'Hello', meaning: '你好', category: 'vocabulary', eventId: '../../secret' },
      { term: 'Hello', meaning: '你好', category: 'vocabulary', eventId: '00000000-0000-0000-0000-000000000000' }]) {
      assert.equal((await post(body)).status, 400);
    }
    assert.equal((await fetch(`${s.base}/api/favorites`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 415);
    assert.equal((await fetch(`${s.base}/api/favorites`, { method: 'POST', headers, body: '{' })).status, 400);
    assert.equal((await post({ term: 'Hello', meaning: '好'.repeat(130000), category: 'vocabulary' })).status, 413);
    for (const query of ['category=unknown', 'offset=-1', 'offset=1.5', 'offset=NaN', 'limit=0', 'limit=Infinity', `q=${'a'.repeat(501)}`]) {
      assert.equal((await fetch(`${s.base}/api/history?${query}`)).status, 400, query);
    }
    const protectedBody = { term: 'Hello sk-secretvalue1234', meaning: 'password=hidden-value', category: 'vocabulary' };
    const saved = await (await post(protectedBody)).json();
    assert.doesNotMatch(JSON.stringify(saved), /secretvalue1234|hidden-value/);
    const favoriteId = saved.favorite.id;
    for (const route of ['/api/history', '/api/favorites']) assert.equal((await fetch(`${s.base}${route}`, { headers: { origin: 'https://attacker.test' } })).status, 403);
    assert.equal((await post({ term: 'Blocked', meaning: '不应保存', category: 'grammar' }, { origin: 'https://attacker.test' })).status, 403);
    assert.equal((await fetch(`${s.base}/api/favorites/${favoriteId}`, { method: 'DELETE', headers: { origin: 'https://attacker.test' } })).status, 403);
    assert.equal((await (await fetch(`${s.base}/api/favorites`)).json()).favorites.length, 1);
  } finally { await s.close(); }
});
