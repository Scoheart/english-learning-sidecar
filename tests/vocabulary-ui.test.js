import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../src/web/', import.meta.url));
// Transform the real TSX components without starting an HTTP server or file watcher.
const server = await createServer({
  configFile: false,
  root,
  resolve: { alias: { '@': path.resolve(root) } },
  server: { middlewareMode: true, hmr: false, watch: null, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: 'custom',
});
after(() => server.close());
const { VocabularyDetails, VocabularyExample, ExampleAttribution } = await server.ssrLoadModule('/components/vocabulary-details.tsx');
const { VocabularyHeading, VocabularyCoreMeanings } = await server.ssrLoadModule('/components/vocabulary-summary.tsx');
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));
const example = { english: 'We interact with each other every day.', chinese: '我们每天都会相互交流。', source: { kind: 'ai', verification: 'not_applicable' } };

test('renders family meanings, examples and accessible relation tabs without duplicate senses', () => {
  const html = render(VocabularyDetails, {
    vocabulary: {
      term: 'interact',
      meaning: '互动',
      senses: [{ pos: 'v.', meaning: '交流；相互作用', example }],
      wordFamily: [{ term: 'interaction', pos: 'n.', phonetic: '/ˌɪntərˈækʃən/', meaning: '互动；相互作用', relationship: 'interact + -ion → 名词', example }],
      synonyms: [{ term: 'communicate', pos: 'v.', meaning: '沟通', difference: 'communicate 强调信息传递；interact 强调双方的相互影响。', example }],
      antonyms: [],
      examples: [example],
    },
    onSpeak() {},
  });
  for (const value of ['用法例句', 'interaction', '互动；相互作用', 'interact + -ion', 'communicate 强调信息传递', 'AI 原创例句', '同义词', '反义词']) assert.ok(html.includes(value), value);
  assert.match(html, /role="tablist"[^>]*aria-label="interact 的同反义词"|aria-label="interact 的同反义词"[^>]*role="tablist"/);
  assert.match(html, /role="tabpanel"/);
  assert.match(html, /aria-label="朗读 interaction"/);
  assert.doesNotMatch(html, /surface-card|词性与释义|Word Family/);
  assert.ok(html.includes('同源词派生'));
  assert.match(html, /class="[^"]*relation-tabs[^\"]*border-0[^\"]*bg-accent\/50/);
});

test('word heading keeps phonetic beside the word in one wrapping baseline row', () => {
  const html = render(VocabularyHeading, { vocabulary: { term: 'change', pos: 'v.', phonetic: '/tʃeɪndʒ/', meaning: '改变' } });
  assert.match(html, /^<div class="[^"]*flex[^"]*flex-wrap[^"]*items-baseline/);
  assert.ok(html.indexOf('change') < html.indexOf('/tʃeɪndʒ/'));
  assert.equal((html.match(/<div/g) ?? []).length, 2, 'only the wrapping row and CardTitle div, no separate phonetic row');
  assert.match(html, /<\/div><span[^>]*>v\.<\/span><span[^>]*>\/tʃeɪndʒ\/<\/span><\/div>$/);
  assert.ok(html.includes('v.'));
  const legacy = render(VocabularyHeading, { vocabulary: { term: 'change', meaning: '改变' } });
  assert.ok(legacy.includes('change'));
  assert.doesNotMatch(legacy, /font-phonetic|undefined/);
});

test('core meanings show every part of speech and preserve multiple meanings for one POS', () => {
  const senses = [
    { pos: 'v.', meaning: '改变；更改' },
    { pos: 'v.', meaning: '更换；兑换' },
    { pos: 'n.', meaning: '变化；零钱' },
    { pos: 'adj.', meaning: '形容词释义示例' },
  ];
  const html = render(VocabularyCoreMeanings, { vocabulary: { term: 'fixture', meaning: '旧的单一摘要', senses } });
  for (const sense of senses) {
    assert.ok(html.includes(sense.pos));
    assert.ok(html.includes(sense.meaning));
  }
  assert.equal((html.match(/<li /g) ?? []).length, senses.length);
  assert.doesNotMatch(html, /旧的单一摘要/);
  assert.ok(html.includes('aria-label="fixture 的核心释义"'));
});

test('core meanings fall back to stored meaning for old vocabulary and empty senses', () => {
  for (const senses of [undefined, []]) {
    const html = render(VocabularyCoreMeanings, { vocabulary: { term: 'change', meaning: 'v. 改变；更改', senses } });
    assert.ok(html.includes('v. 改变；更改'));
    assert.doesNotMatch(html, /<li|undefined/);
  }
});

test('legacy vocabulary remains compatible without inventing missing relations', () => {
  const html = render(VocabularyDetails, { vocabulary: { term: 'interact', meaning: '互动', morphology: 'inter- + act' }, onSpeak() {} });
  assert.equal(html, '');
});

test('empty synonyms explain the absence instead of making up a comparison', () => {
  const html = render(VocabularyDetails, { vocabulary: { term: 'hello', meaning: '你好', synonyms: [], antonyms: [] }, onSpeak() {} });
  assert.ok(html.includes('暂无适合当前词义的同义词'));
});

test('examples use darker text, omit usage notes and retain translation, attribution and pronunciation', () => {
  const html = render(VocabularyExample, { example: { ...example, note: 'interact with somebody：与某人互动。' }, onSpeak() {} });
  assert.ok(html.includes(example.chinese));
  assert.doesNotMatch(html, /interact with somebody/);
  assert.match(html, /lang="en" class="[^"]*font-medium[^"]*text-foreground"/);
  assert.match(html, /class="[^"]*text-foreground\/90"/);
  assert.ok(html.includes('AI 原创例句'));
  assert.ok(html.includes(`aria-label="朗读例句 ${example.english}"`));
});

test('sense examples move into usage examples once without repeating POS meanings', () => {
  const senseExample = { english: 'That is a small change.', chinese: '那是一个小改动。', note: '可数名词说明' };
  const items = [];
  const html = render(VocabularyDetails, {
    vocabulary: {
      term: 'change', meaning: '变化', examples: [example],
      senses: [
        { pos: 'v.', meaning: '动词重复释义', example: { ...example } },
        { pos: 'n.', meaning: '名词重复释义', example: senseExample },
      ],
    },
    onSpeak() {}, renderFavorite(item) { items.push(item); return null; },
  });
  assert.ok(html.includes('用法例句'));
  assert.doesNotMatch(html, /词性与释义|动词重复释义|名词重复释义|可数名词说明/);
  assert.equal(items.filter(item => item.term === example.english).length, 1);
  assert.equal(items.filter(item => item.term === senseExample.english).length, 1);
  assert.ok(html.includes(senseExample.chinese));
});

test('source labels distinguish original examples, unverified references and legacy unknowns', () => {
  assert.ok(render(ExampleAttribution, { example }).includes('AI 原创例句'));
  const html = render(ExampleAttribution, { example: { ...example, source: { kind: 'reference', title: 'Official speech', url: 'https://example.org/speech', verification: 'verified' } } });
  assert.ok(html.includes('引用来源待核实'));
  assert.ok(html.includes('Official speech'));
  assert.ok(html.includes('href="https://example.org/speech"'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
  assert.doesNotMatch(html, /已核实/);
  assert.ok(render(ExampleAttribution, { example: { english: 'Hi.', chinese: '你好。' } }).includes('来源未记录'));
});

test('old stored unsafe citation URLs never become active links', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,unsafe', 'https://user:secret@example.org/', '/relative']) {
    const html = render(ExampleAttribution, { example: { ...example, source: { kind: 'reference', title: '<script>unsafe</script>', url } } });
    assert.doesNotMatch(html, /href=/);
    assert.doesNotMatch(html, /<script>/);
    assert.ok(html.includes('引用来源待核实'));
  }
});
