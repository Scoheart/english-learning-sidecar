import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanOriginalText, getOriginalText } from '../src/lib/original-text.js';

test('screenshot regression: Chinese heading with a partially redacted Feishu URL', () => {
  assert.equal(cleanOriginalText('整理需求变动https://rqqmslsz9y.feishu.[REDACTED TOKEN]'), '整理需求变动');
  assert.equal(cleanOriginalText('整理需求变动https://rqqmslsz9y.feishu.[REDACTED TOKEN]，然后确认范围。'), '整理需求变动，然后确认范围。');
  assert.equal(cleanOriginalText('整理需求变动https://rqqmslsz9y.feishu.[REDACTED TOKEN]/wiki/[REDACTED TOKEN]'), '整理需求变动');
});

test('removes normal and www URLs glued to Chinese without eating adjacent prose', () => {
  assert.equal(cleanOriginalText('请看https://example.com/path然后继续。'), '请看然后继续。');
  assert.equal(cleanOriginalText('请看www.example.com/path，然后继续。'), '请看，然后继续。');
  assert.equal(cleanOriginalText('See https://example.com/path. Keep this sentence.'), 'See . Keep this sentence.');
  assert.equal(cleanOriginalText('请看https://example.com/a，继续www.example.org/b。'), '请看，继续。');
  assert.equal(cleanOriginalText('Use https://example.com/a and https://example.org/b today.'), 'Use and today.');
});

test('keeps punctuation around URLs and handles balanced URL parentheses', () => {
  assert.equal(cleanOriginalText('请看（https://example.com/a_(b)）。'), '请看（）。');
  assert.equal(cleanOriginalText('Read (https://example.com/a_(b)). Next!'), 'Read (). Next!');
  assert.equal(cleanOriginalText('See https://example.com/path?x=42&y=1; thanks!'), 'See ; thanks!');
});

test('keeps Markdown natural labels but removes destinations and all image text', () => {
  assert.equal(cleanOriginalText('请看[需求变更](https://example.com/a_(b) "Title")，再确认。'), '请看需求变更，再确认。');
  assert.equal(cleanOriginalText('Read [API guide](/private/path) today.'), 'Read API guide today.');
  assert.equal(cleanOriginalText('说明 ![screenshot alt](https://example.com/a.png "title") 结束。'), '说明 结束。');
  assert.equal(cleanOriginalText('![截图](data:image/png;base64,abc) 然后继续。'), '然后继续。');
  assert.equal(cleanOriginalText('[需求说明][doc]\n[doc]: https://example.com/private'), '需求说明');
  assert.equal(cleanOriginalText('![private screenshot][shot]\n[shot]: /private/image.png'), '');
});

test('removes HTML images including alt text and quoted angle brackets', () => {
  assert.equal(cleanOriginalText('之前 <img src="x.png" alt="private > screenshot" /> 之后。'), '之前 之后。');
  assert.equal(cleanOriginalText('<IMG SRC="x.png" ALT="Screenshot">'), '');
});

test('removes redactions and explicit image/attachment placeholders, not ordinary terms', () => {
  assert.equal(cleanOriginalText('请解释 [REDACTED TOKEN] [REDACTED_EMAIL] [image] [attachment: spec.pdf] 【图片】 <image> 这个问题。'), '请解释 这个问题。');
  assert.equal(cleanOriginalText('image processing and attachment handling are useful.'), 'image processing and attachment handling are useful.');
  assert.equal(cleanOriginalText('请解释图片压缩与附件上传。'), '请解释图片压缩与附件上传。');
});

test('strips fenced code, including unfinished blocks, while preserving prose line breaks', () => {
  assert.equal(cleanOriginalText('之前\n```js\nconst secret = 42;\n```\n之后'), '之前\n\n\n\n之后');
  assert.equal(cleanOriginalText('保留说明\n~~~python\nsecret = 42'), '保留说明');
  assert.equal(cleanOriginalText('```js\nsecret'), '');
});

test('preserves ordinary Chinese/English punctuation, whitespace, numbers, and identifiers', () => {
  for (const input of [
    '请整理需求变动，保留 2026 年的 42 条记录。',
    'Explain API 401 / 403, MCP, Tool Discovery, and version 2.5.',
    'ThisNaturalIdentifier1234567890ShouldNotDisappear and camelCase remain.',
    '第一行\n第二行\n\nThird line:  42\titems.',
    '普通的 [括号]、(parentheses)、English punctuation: yes; no!',
  ]) assert.equal(cleanOriginalText(input), input);
});

test('empty, invalid, or link-only input never returns unfiltered content', () => {
  for (const input of [undefined, null, 42, {}, [], '', ' \n\t ', 'https://example.com', 'www.example.com',
    '[https://example.com](https://example.com)', '![alt](https://example.com/x.png)', '[REDACTED TOKEN]']) {
    assert.equal(cleanOriginalText(input), '');
  }
});

test('original text selection supports legacy fallback and authoritative empty strings', () => {
  assert.equal(getOriginalText('旧记录https://example.com'), '旧记录');
  assert.equal(getOriginalText('旧记录https://example.com', null), '旧记录');
  assert.equal(getOriginalText('旧记录https://example.com', 42), '旧记录');
  assert.equal(getOriginalText('raw content', '模型选中的原文https://example.com'), '模型选中的原文');
  assert.equal(getOriginalText('must not reappear', ''), '');
  assert.equal(getOriginalText('must not reappear', ' \n '), '');
  assert.equal(getOriginalText('must not reappear', 'https://example.com'), '');
  const record = Object.freeze({ content: '原文https://example.com', originalText: '[image]' });
  assert.equal(getOriginalText(record.content, record.originalText), '');
  assert.deepEqual(record, { content: '原文https://example.com', originalText: '[image]' });
});
