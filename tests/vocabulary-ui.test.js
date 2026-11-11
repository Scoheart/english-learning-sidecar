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
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));
const example = { english: 'We interact with each other every day.', chinese: '我们每天都会相互交流。', source: { kind: 'ai', verification: 'not_applicable' } };

test('renders word senses, family meanings, examples and accessible compact relation tabs without new cards', () => {
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
  for (const value of ['词性与释义', 'interaction', '互动；相互作用', 'interact + -ion', 'communicate 强调信息传递', 'AI 原创例句', '同义词', '反义词']) assert.ok(html.includes(value), value);
  assert.match(html, /role="tablist"[^>]*aria-label="interact 的同反义词"|aria-label="interact 的同反义词"[^>]*role="tablist"/);
  assert.match(html, /role="tabpanel"/);
  assert.match(html, /aria-label="朗读 interaction"/);
  assert.doesNotMatch(html, /surface-card/);
});

test('legacy vocabulary remains compatible without inventing missing relations', () => {
  const html = render(VocabularyDetails, { vocabulary: { term: 'interact', meaning: '互动', morphology: 'inter- + act' }, onSpeak() {} });
  assert.equal(html, '');
});

test('empty synonyms explain the absence instead of making up a comparison', () => {
  const html = render(VocabularyDetails, { vocabulary: { term: 'hello', meaning: '你好', synonyms: [], antonyms: [] }, onSpeak() {} });
  assert.ok(html.includes('暂无适合当前词义的同义词'));
});

test('examples render translation, usage note and a named pronunciation button', () => {
  const html = render(VocabularyExample, { example: { ...example, note: 'interact with somebody：与某人互动。' }, onSpeak() {} });
  assert.ok(html.includes(example.chinese));
  assert.ok(html.includes('interact with somebody'));
  assert.ok(html.includes(`aria-label="朗读例句 ${example.english}"`));
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
