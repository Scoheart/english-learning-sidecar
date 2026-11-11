import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalyzer, validateAnalysis } from '../src/lib/analyzer.js';

test('returns clearly labelled demo content when no provider is configured', async () => {
  const analyze = createAnalyzer({mode:'demo'});
  const result = await analyze('任意用户输入');
  assert.match(result.notes,/演示数据/);
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
