import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIncomingEvent, redactSensitive, isWorthLearning } from '../src/lib/privacy.js';

test('redacts credentials and addresses before persistence', () => {
  const result = redactSensitive('my email is dev@example.com; password=abc123; Bearer abcdefghijklmnopqrstuvwxyz');
  assert.ok(!result.includes('dev@example.com'));
  assert.ok(!result.includes('abc123'));
  assert.ok(!result.includes('abcdefghijklmnopqrstuvwxyz'));
});

test('normalizes native adapter events while preserving semantic text', () => {
  const event = normalizeIncomingEvent({source:'Codex',content:'帮我分析 API 调用',sessionId:'s1',turnId:'t1'});
  assert.equal(event.source,'codex');
  assert.equal(event.eligible, true);
  assert.equal(event.content, '帮我分析 API 调用');
});

test('skips raw code/log payloads and assistant replies', () => {
  assert.equal(isWorthLearning('```js\nconst x=1\n```'), false);
  const reply = normalizeIncomingEvent({source:'cursor',eventType:'assistant.reply',content:'Here is an explanation'});
  assert.equal(reply.eligible,false);
});

test('rejects malformed and oversized payloads', () => {
  assert.throws(() => normalizeIncomingEvent({source:'X',content:'a'}));
  assert.throws(() => normalizeIncomingEvent({source:'codex',content:'a'.repeat(12001)}));
});
