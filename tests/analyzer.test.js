import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalyzer, validateAnalysis } from '../src/lib/analyzer.js';

test('missing key prompts model setup and never creates fake content, even with legacy Demo config', async () => {
  let called = false;
  const analyze = createAnalyzer({ mode: 'demo', apiKey: '' }, async () => { called = true; });
  await assert.rejects(() => analyze('任意用户输入'), /请先接入模型/);
  assert.equal(called, false);
});

test('sends safe structured messages to compatible model endpoint', async () => {
  let input;
  const fakeFetch = async (_url, options) => {
    input = JSON.parse(options.body);
    return { ok: true, json: async () => ({choices:[{message:{content:'{"translation":"Explain this concept.","vocabulary":[],"grammar":[],"examples":[]}'}}]}) };
  };
  const analyze = createAnalyzer({mode:'live',model:'test-model',apiKey:'fake-key',baseUrl:'https://example.com/v1'},fakeFetch);
  const result = await analyze('解释这个概念');
  assert.equal(result.translation,'Explain this concept.');
  assert.equal(input.messages[0].role,'system');
  assert.equal(input.model,'test-model');
  assert.equal(input.messages[1].role,'user');
});

test('sanitizes optional arrays and missing fields', () => {
  const obj = validateAnalysis({translation:'Hello',vocabulary:[{term:'foo',meaning:'n'}]});
  assert.equal(obj.vocabulary[0].term,'foo');
  assert.deepEqual(obj.examples,[]);
  assert.throws(() => validateAnalysis({vocabulary:[]}),/Missing translation/);
});

test('throws friendly 90 seconds timeout error on abort without slowing tests', async () => {
  const fakeAbortFetch = async () => {
    const error = new Error('This operation was aborted');
    error.name = 'AbortError';
    throw error;
  };
  const analyze = createAnalyzer({mode:'live',model:'test-model',apiKey:'fake-key',baseUrl:'https://example.com/v1'}, fakeAbortFetch);
  await assert.rejects(
    () => analyze('测试超时请求'),
    (err) => {
      assert.equal(err.message, 'The learning model did not respond within 90 seconds');
      return true;
    }
  );
});

test('preserves HTTP and other unexpected errors without rewriting', async () => {
  const fakeErrorFetch = async () => ({ ok: false, status: 503 });
  const analyze = createAnalyzer({mode:'live',model:'test-model',apiKey:'fake-key',baseUrl:'https://example.com/v1'}, fakeErrorFetch);
  await assert.rejects(
    () => analyze('测试其他错误'),
    /Model API returned HTTP 503/
  );
});
