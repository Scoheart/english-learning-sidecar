import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../src/web/', import.meta.url));
const server = await createServer({
  configFile: false, root,
  resolve: { alias: { '@': path.resolve(root) } },
  server: { middlewareMode: true, hmr: false, watch: null, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom',
});
after(() => server.close());
const { CollectionView, CollectionCards } = await server.ssrLoadModule('/components/collection-view.tsx');
const { FavoriteButton, FavoriteNotice, favoriteKey } = await server.ssrLoadModule('/components/favorite-button.tsx');
const { VocabularyDetails } = await server.ssrLoadModule('/components/vocabulary-details.tsx');
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const favorite = { id: 'favorite-1', term: 'look up', meaning: '查找', category: 'vocabulary', created_at: '2026-01-01', event_id: 'event-1' };
const props = {
  favorites: [favorite], search: '', revision: 0, busy: false,
  renderFavorite: item => React.createElement(FavoriteButton, { item, saved: true, onToggle() {} }),
  onRemove() {}, onOpenEvent() {}, onSpeak() {}, onGoToPrompts() {},
};

test('favorite keys normalize case, Unicode compatibility and whitespace by category', () => {
  assert.equal(favoriteKey({ category: 'vocabulary', term: '  ＬＯＯＫ\t Up  ' }), favoriteKey(favorite));
  assert.notEqual(favoriteKey({ ...favorite, category: 'grammar' }), favoriteKey(favorite));
});

test('favorites show star, Chinese categories and no encounter counts', () => {
  const html = render(CollectionView, { ...props, mode: 'favorites', favorites: [{ ...favorite, encounters: 19 }] });
  for (const text of ['我的收藏', '单词', '语法', '例句', 'look up', '查找']) assert.ok(html.includes(text), text);
  assert.ok(html.includes('aria-label="收藏分类"'));
  assert.ok(html.includes('role="tabpanel"'));
  assert.ok(html.includes('lucide-star'));
  assert.doesNotMatch(html, /出现 19 次|查询 19 次|× seen/);
});

test('saved star exposes an enabled cancel action and pressed state', () => {
  const html = render(FavoriteButton, { item: favorite, saved: true, onToggle() {} });
  assert.ok(html.includes('aria-label="取消收藏 look up"'));
  assert.ok(html.includes('title="取消收藏"'));
  assert.ok(html.includes('aria-pressed="true"'));
  assert.ok(html.includes('fill-current'));
  assert.doesNotMatch(html, /disabled=""/);
});

test('unsaved star exposes the save action and passes the item on either toggle', () => {
  const html = render(FavoriteButton, { item: favorite, saved: false, onToggle() {} });
  assert.ok(html.includes('aria-label="收藏 look up"'));
  assert.ok(html.includes('aria-pressed="false"'));
  assert.doesNotMatch(html, /fill-current/);
  for (const saved of [false, true]) {
    const calls = [];
    FavoriteButton({ item: favorite, saved, onToggle: item => calls.push(item) }).props.onClick();
    assert.deepEqual(calls, [favorite]);
  }
  assert.match(render(FavoriteButton, { item: favorite, saved: true, disabled: true, onToggle() {} }), /disabled=""/);
});

test('favorite feedback is a compact, click-through fixed toast outside document flow', () => {
  for (const kind of ['success', 'removed', 'error']) {
    const notice = render(FavoriteNotice, { feedback: { kind, message: '测试反馈' } });
    for (const text of ['role="status"', 'aria-live="polite"', 'aria-atomic="true"', 'fixed', 'top-0', 'pointer-events-none', 'safe-area-inset-top', 'max-w-sm', '测试反馈']) {
      assert.ok(notice.includes(text), text);
    }
    assert.doesNotMatch(notice, /sticky|bottom-0|bg-background|role="dialog"/);
    const expected = {
      success: ['bg-primary/85', 'text-primary-foreground', 'lucide-star', 'fill-current'],
      removed: ['bg-amber-800/85', 'text-amber-50', 'dark:bg-amber-400/85', 'dark:text-amber-950', 'lucide-star-off'],
      error: ['bg-destructive/85', 'text-destructive-foreground', 'lucide-circle-alert'],
    };
    for (const text of expected[kind]) assert.ok(notice.includes(text), `${kind}: ${text}`);
  }
  const empty = render(FavoriteNotice, { feedback: null });
  assert.ok(empty.includes('role="status"'), 'live region stays mounted between notifications');
  assert.doesNotMatch(empty, /<p/);
});

test('history cards distinguish query counts and term encounters with complete-analysis navigation', () => {
  const html = render(CollectionCards, { ...props, mode: 'history', items: [
    { ...favorite, encounters: 3, last_seen: '2026-01-01' },
    { id: 'query-1', term: 'Please look it up.', meaning: '请查一下。', category: 'analysis', encounters: 2, last_seen: '2026-01-01', event_id: 'event-1', status: 'complete' },
  ] });
  assert.ok(html.includes('出现 3 次'));
  assert.ok(html.includes('查询 2 次'));
  assert.ok(html.includes('查看完整分析'));
  assert.ok(html.includes('查询与分析'));
});

test('favorites filter across term and meaning without altering saved contents', () => {
  const html = render(CollectionView, { ...props, mode: 'favorites', search: '查找', favorites: [favorite, { ...favorite, id: 'b', term: 'change', meaning: '变化' }] });
  assert.ok(html.includes('look up'));
  assert.doesNotMatch(html, />change</);
  const empty = render(CollectionView, { ...props, mode: 'favorites', search: 'unmatched' });
  assert.ok(empty.includes('没有匹配的内容'));
});

test('nested word forms and examples expose correct favorite payload categories', () => {
  const items = [];
  render(VocabularyDetails, { onSpeak() {}, renderFavorite(item) { items.push(item); return null; }, vocabulary: {
    term: 'look', meaning: '看',
    senses: [{ pos: 'v.', meaning: '看', example: { english: 'Look at this.', chinese: '看这个。' } }],
    examples: [{ english: 'Look it up.', chinese: '查一下。' }],
    wordFamily: [{ term: 'looking', pos: 'v.', meaning: '正在看', example: { english: 'I am looking.', chinese: '我正在看。' } }],
    synonyms: [{ term: 'see', pos: 'v.', meaning: '看见' }],
  } });
  assert.ok(items.some(item => item.term === 'looking' && item.category === 'vocabulary'));
  assert.ok(items.some(item => item.term === 'see' && item.category === 'vocabulary'));
  for (const term of ['Look at this.', 'Look it up.', 'I am looking.']) assert.ok(items.some(item => item.term === term && item.category === 'example'), term);
});
