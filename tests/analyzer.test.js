import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalyzer, SYSTEM_PROMPT, validateAnalysis } from '../src/lib/analyzer.js';

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

test('limits every learning section to the user question and excludes links and page content', async () => {
  assert.match(SYSTEM_PROMPT, /user's own natural-language question or request/);
  assert.match(SYSTEM_PROMPT, /Exclude links from ALL learning analysis/);
  assert.match(SYSTEM_PROMPT, /Markdown\/HTML link destinations/);
  assert.match(SYSTEM_PROMPT, /Never open a link or analyze\/summarize the linked page/);
  assert.match(SYSTEM_PROMPT, /exclude standalone pasted link titles and previews/);
  assert.match(SYSTEM_PROMPT, /Preserve meaningful words and named entities/);
  assert.match(SYSTEM_PROMPT, /translation, corrections, vocabulary, sentence anatomy, grammar, discourse, examples, notes, and summary/);
  assert.match(SYSTEM_PROMPT, /If no user-authored question or request remains, do not invent one/);
  let messages;
  const analyze = createAnalyzer({ model: 'test-model', apiKey: 'fake-key', baseUrl: 'https://example.com/v1' }, async (_url, options) => {
    messages = JSON.parse(options.body).messages;
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ translation: 'Could you explain this to me?' }) } }] }) };
  });
  await analyze('https://example.com/financial-markets?year=2026 帮我解释一下这个');
  assert.equal(messages[0].content, SYSTEM_PROMPT);
  assert.match(messages[0].content, /study only '帮我解释一下这个'/);
});

test('excludes images, attachment metadata and extracted text while retaining the user question', () => {
  assert.match(SYSTEM_PROMPT, /Exclude images and attachments from ALL learning analysis/);
  for (const scope of ['OCR/extracted text', 'including alt text', 'HTML img tags', 'data URLs/base64', 'attachment names', 'automatically generated image descriptions']) {
    assert.ok(SYSTEM_PROMPT.includes(scope), scope);
  }
  assert.match(SYSTEM_PROMPT, /even if the user's question asks the main assistant to do so/);
  assert.match(SYSTEM_PROMPT, /study only '这张图是什么意思？'/);
  assert.match(SYSTEM_PROMPT, /image-only input must not become an invented question or lesson/);
});

test('selects learning material by semantic role rather than an identifier blacklist', () => {
  assert.match(SYSTEM_PROMPT, /Select study material by semantic role, not by matching a list of names, formats, or patterns/);
  assert.match(SYSTEM_PROMPT, /Only A is study material/);
  assert.match(SYSTEM_PROMPT, /unfamiliar syntax, unlisted protocols, arbitrary identifier names/);
  assert.match(SYSTEM_PROMPT, /illustrative, not an exhaustive blacklist/);
  assert.match(SYSTEM_PROMPT, /Exclude implementation identifiers and specification fragments from ALL learning analysis/);
  for (const scope of ['API paths and operations of any protocol', 'field/parameter/property names', 'JSON key/value snippets or other structured data', 'standalone type declarations', 'internal configuration identifiers', 'function/class/table/column names', 'command lines']) {
    assert.ok(SYSTEM_PROMPT.includes(scope), scope);
  }
  assert.match(SYSTEM_PROMPT, /Remove only the incidental references within mixed sentences, not the whole sentence/);
  assert.match(SYSTEM_PROMPT, /actions, constraints, timing, negation, conditions, and meaningful quantities or precision/);
  assert.match(SYSTEM_PROMPT, /When the user's explicit purpose is to learn a word's meaning/);
  assert.match(SYSTEM_PROMPT, /Before returning JSON, check every learning section/);
  assert.doesNotMatch(SYSTEM_PROMPT, /\/cms\/v1\/modlib|ch-deepseek|"multiplier": 1\.20|Preserve proper nouns and any technical identifiers/);
});

test('sends the same general policy for varied technical formats and explicit word-learning requests', async () => {
  const inputs = [
    '[GET] /cms/v1/modlib/work/model/list，加了 "multiplier": 1.20,字段。Decimal。只读展示倍率。不参与扣费。',
    'POST /orders/{order_id}/cancel，取消后不能恢复，保留两位小数。',
    'query CurrentViewer { viewer { isEnabled } }，只展示当前登录用户的信息。',
    'rpc SaveDraft (DraftRequest) returns (DraftReply)，保存失败时保留本地内容。',
    '把 invoice_record.is_archived 改成只读；执行 tool --dry-run，不要真的提交。',
    '字段叫 enabledFlag，只能查看，不能修改。',
    'decimal 这个词怎么读，和 integer 的意思有什么区别？',
  ];
  let messages;
  const analyze = createAnalyzer({ model: 'test-model', apiKey: 'fake-key', baseUrl: 'https://example.com/v1' }, async (_url, options) => {
    messages = JSON.parse(options.body).messages;
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ translation: 'Study the natural-language request.' }) } }] }) };
  });
  for (const text of inputs) {
    await analyze(text);
    assert.equal(messages[0].content, SYSTEM_PROMPT);
    assert.equal(messages[1].content, `Study this user-authored text only:\n<user_text>\n${text}\n</user_text>`);
  }
});

test('teaches communication across topics without imposing an engineering register', () => {
  assert.match(SYSTEM_PROMPT, /real communication across all topics/);
  assert.match(SYSTEM_PROMPT, /everyday life, relationships, feelings, travel, culture, study, work, technology/);
  assert.match(SYSTEM_PROMPT, /Never force nontechnical content into a software engineering context/);
  assert.match(SYSTEM_PROMPT, /use conversational English for casual exchanges/);
  assert.match(SYSTEM_PROMPT, /formal or specialist language only when the text calls for it/);
  assert.match(SYSTEM_PROMPT, /Prefer clear, common expressions/);
  assert.doesNotMatch(SYSTEM_PROMPT, /for a Chinese-speaking software engineer|engineering collocations|professional engineering paragraph|Transferable engineering sentence/);
});

test('passes everyday learning material unchanged with the general communication prompt', async () => {
  let input;
  const text = '我今天有点累，想早点回家休息。';
  const translation = "I'm a bit tired today and want to go home early to rest.";
  const analyze = createAnalyzer({ model: 'test-model', apiKey: 'fake-key', baseUrl: 'https://example.com/v1' }, async (_url, options) => {
    input = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ translation }) } }] }) };
  });
  const result = await analyze(text);
  assert.equal(input.messages[0].content, SYSTEM_PROMPT);
  assert.equal(input.messages[1].content, `Study this user-authored text only:\n<user_text>\n${text}\n</user_text>`);
  assert.equal(result.translation, translation);
});

test('returns verified source excerpts for original display without rewriting the user text', async () => {
  const text = '整理需求变动https://rqqmslsz9y.feishu.[REDACTED TOKEN]，只保留已确认的内容。';
  const fragments = ['整理需求变动', '，只保留已确认的内容。'];
  const analyze = createAnalyzer({ model: 'test-model', apiKey: 'fake-key', baseUrl: 'https://example.com/v1' }, async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ sourceFragments: fragments, translation: 'Organize the changes to the requirements and retain only confirmed content.' }) } }] }),
  }));
  const result = await analyze(text);
  assert.equal(result.originalText, fragments.join('\n'));
  assert.doesNotMatch(result.originalText, /https|feishu|REDACTED/);
  assert.match(SYSTEM_PROMPT, /copied verbatim as non-overlapping contiguous substrings/);
});

test('original display rejects invented, translated, reordered, and duplicate source fragments', () => {
  const text = '先检查，再保存。https://example.com';
  const base = { translation: 'Check first, then save.' };
  assert.equal(validateAnalysis({ ...base, sourceFragments: ['Check first, then save.'] }, text).originalText, '先检查，再保存。');
  assert.equal(validateAnalysis({ ...base, sourceFragments: [null, {}, '伪造原文'] }, text).originalText, '先检查，再保存。');
  assert.equal(validateAnalysis({ ...base, sourceFragments: ['再保存。', '先检查', '再保存。'] }, text).originalText, '先检查，再保存。');
  assert.equal(validateAnalysis({ ...base, sourceFragments: ['先检查', '先检查', '，再保存。'] }, text).originalText, '先检查，再保存。');
  assert.equal(validateAnalysis({ ...base, sourceFragments: [] }, text).originalText, '');
  assert.equal(validateAnalysis(base, text).originalText, '先检查，再保存。');
  assert.equal(validateAnalysis({ ...base, sourceFragments: ['https://example.com'] }, text).originalText, '');
  assert.equal(Object.hasOwn(validateAnalysis(base), 'originalText'), false);
});

test('sanitizes optional arrays and missing fields', () => {
  const obj = validateAnalysis({translation:'Hello',vocabulary:[{term:'foo',meaning:'n'}]});
  assert.equal(obj.vocabulary[0].term,'foo');
  assert.deepEqual(obj.examples,[]);
  assert.throws(() => validateAnalysis({vocabulary:[]}),/Missing translation/);
});

const learningExample = (source) => ({
  english: 'People interact in different ways.', chinese: '人们以不同的方式互动。',
  note: 'interact with someone', ...(source === undefined ? {} : { source }),
});
const aiSource = { kind: 'ai', title: '', url: '', verification: 'not_applicable' };

test('requests compact multi-POS learning, word families, contrasts, and honest examples', () => {
  for (const field of ['senses', 'wordFamily', 'synonyms', 'antonyms', 'difference', 'relationship']) {
    assert.ok(SYSTEM_PROMPT.includes(`"${field}"`));
  }
  assert.match(SYSTEM_PROMPT, /IPA/);
  assert.match(SYSTEM_PROMPT, /multiple POS/);
  assert.match(SYSTEM_PROMPT, /interact\/interaction\/interactive/);
  assert.match(SYSTEM_PROMPT, /main-word example/);
  assert.match(SYSTEM_PROMPT, /antonyms only when natural/);
  assert.match(SYSTEM_PROMPT, /不编造词源/);
  assert.match(SYSTEM_PROMPT, /film, news, finance, politics, or official-source/);
  assert.match(SYSTEM_PROMPT, /no retrieval or trusted source context: use original AI examples/);
  assert.match(SYSTEM_PROMPT, /never invent quotations or attribution/);
  assert.match(SYSTEM_PROMPT, /never a verified citation/);
});

test('normalizes all vocabulary learning fields without losing legacy fields', () => {
  const example = learningExample();
  const oldFields = { term: 'interact', phonetic: '/ˌɪntərˈækt/', pos: 'v.', meaning: '互动', morphology: 'inter- 相互 + act 行动', usage: 'interact with people', nuance: '强调双向交流' };
  const result = validateAnalysis({ translation: 'We interact.', vocabulary: [{
    ...oldFields,
    senses: [{ pos: 'v.', meaning: '互动', example }, { pos: 'v.', meaning: '相互影响', example: null }],
    wordFamily: [{ term: 'interaction', phonetic: '/ˌɪntərˈækʃən/', pos: 'n.', meaning: '互动', relationship: '名词形式', example }],
    synonyms: [{ term: 'communicate', phonetic: '/kəˈmjuːnɪkeɪt/', pos: 'v.', meaning: '交流', difference: '侧重传达信息，interact 更强调相互影响', example }],
    antonyms: [{ term: 'avoid', phonetic: '/əˈvɔɪd/', pos: 'v.', meaning: '避开', difference: '在社交情境中可形成对比，并非严格反义', example }],
    examples: [example],
  }] }).vocabulary[0];
  for (const [key, value] of Object.entries(oldFields)) assert.equal(result[key], value);
  assert.deepEqual(result.senses[0], { pos: 'v.', meaning: '互动', example: { ...example, source: aiSource } });
  assert.equal(result.senses[1].example, null);
  assert.equal(result.wordFamily[0].relationship, '名词形式');
  assert.equal(result.wordFamily[0].phonetic, '/ˌɪntərˈækʃən/');
  assert.match(result.synonyms[0].difference, /传达信息/);
  assert.match(result.antonyms[0].difference, /社交情境/);
  for (const row of [result.wordFamily[0], result.synonyms[0], result.antonyms[0]]) assert.deepEqual(row.example.source, aiSource);
  assert.deepEqual(result.examples, [{ ...example, source: aiSource }]);
});

test('retains separate meanings across multiple parts of speech', () => {
  const senses = [
    { pos: 'n.', meaning: '工作', example: { english: 'I have work to do.', chinese: '我有工作要做。' } },
    { pos: 'v.', meaning: '工作', example: { english: 'I work from home.', chinese: '我在家办公。' } },
    { pos: 'v.', meaning: '奏效', example: { english: 'This plan works.', chinese: '这个计划有效。' } },
  ];
  const result = validateAnalysis({ translation: 'It works.', vocabulary: [{ term: 'work', pos: 'v.', meaning: '奏效', senses }] }).vocabulary[0];
  assert.deepEqual(result.senses.map(({ pos, meaning }) => ({ pos, meaning })), senses.map(({ pos, meaning }) => ({ pos, meaning })));
  assert.equal(result.senses[2].example.english, 'This plan works.');
});

test('preserves legacy vocabulary and top-level example shapes with safe empty extensions', () => {
  const result = validateAnalysis({ translation: 'Hello', vocabulary: [{ term: 'hello', meaning: '你好' }], examples: [{ english: 'Hello!', chinese: '你好！' }] });
  assert.equal(result.vocabulary[0].meaning, '你好');
  for (const key of ['senses', 'wordFamily', 'synonyms', 'antonyms', 'examples']) assert.deepEqual(result.vocabulary[0][key], []);
  assert.deepEqual(result.examples, [{ english: 'Hello!', chinese: '你好！' }]);
});

test('rejects nested nonobjects, empty rows, invalid strings, and incomplete examples', () => {
  const invalid = [null, [], ['bad'], '', 1, false, {}, { term: ' ' }, { term: ['bad'], meaning: {} }];
  const badExamples = [...invalid, { english: 'Hi' }, { chinese: '你好' }, { english: ' ', chinese: '你好' }, { english: {}, chinese: '你好' }];
  const goodSense = { pos: 'v.', meaning: '互动', example: [] };
  const goodRelated = { term: 'interaction', meaning: '互动', phonetic: [], pos: {}, relationship: false, difference: [], example: { english: 'Hi' } };
  const result = validateAnalysis({ translation: 'Hi', vocabulary: [...invalid, {
    term: 'interact', morphology: {}, usage: [], nuance: false,
    senses: [...invalid, { pos: 'n.' }, { meaning: '互动' }, goodSense],
    wordFamily: [...invalid, goodRelated], synonyms: [...invalid, goodRelated], antonyms: [...invalid, goodRelated],
    examples: [...badExamples, learningExample()],
  }], examples: badExamples });
  assert.equal(result.vocabulary.length, 1);
  const item = result.vocabulary[0];
  assert.equal(item.morphology, ''); assert.equal(item.usage, ''); assert.equal(item.nuance, '');
  assert.deepEqual(item.senses, [{ pos: 'v.', meaning: '互动', example: null }]);
  for (const key of ['wordFamily', 'synonyms', 'antonyms']) {
    assert.equal(item[key].length, 1);
    assert.equal(item[key][0].phonetic, ''); assert.equal(item[key][0].pos, ''); assert.equal(item[key][0].example, null);
  }
  assert.equal(item.examples.length, 1);
  assert.deepEqual(result.examples, []);
  for (const bad of [null, [], 'bad', 3, {}]) {
    const item = validateAnalysis({ translation: 'Hi', vocabulary: [{ term: 'hi', senses: bad, wordFamily: bad, synonyms: bad, antonyms: bad, examples: bad }] }).vocabulary[0];
    for (const key of ['senses', 'wordFamily', 'synonyms', 'antonyms', 'examples']) assert.deepEqual(item[key], []);
  }
});

test('bounds vocabulary rows, nested lists, and strings', () => {
  const long = 'x'.repeat(2000);
  const example = { english: long, chinese: long, note: long, source: { kind: 'reference', title: long, url: 'https://example.com/' } };
  const related = { term: long, phonetic: long, pos: long, meaning: long, relationship: long, difference: long, example };
  const vocabulary = { ...related, morphology: long, usage: long, nuance: long,
    senses: Array(6).fill({ pos: long, meaning: long, example }), wordFamily: Array(8).fill(related),
    synonyms: Array(8).fill(related), antonyms: Array(8).fill(related), examples: Array(8).fill(example) };
  const result = validateAnalysis({ translation: 'Hi', vocabulary: Array(8).fill(vocabulary), examples: Array(8).fill(example) });
  assert.equal(result.vocabulary.length, 4); assert.equal(result.examples.length, 2);
  const item = result.vocabulary[0];
  for (const [key, limit] of Object.entries({ senses: 3, wordFamily: 4, synonyms: 3, antonyms: 2, examples: 2 })) assert.equal(item[key].length, limit);
  for (const [key, limit] of Object.entries({ term: 100, phonetic: 80, pos: 40, meaning: 500, morphology: 400, usage: 500, nuance: 400 })) assert.equal(item[key].length, limit);
  for (const [key, limit] of Object.entries({ term: 100, phonetic: 80, pos: 40, meaning: 240, relationship: 300 })) assert.equal(item.wordFamily[0][key].length, limit);
  assert.equal(item.synonyms[0].difference.length, 300);
  assert.equal(item.senses[0].meaning.length, 240);
  assert.equal(item.examples[0].english.length, 300); assert.equal(item.examples[0].chinese.length, 300);
  assert.equal(item.examples[0].note.length, 200); assert.equal(item.examples[0].source.title.length, 160);
});

test('AI sources never accept model-provided verification claims', () => {
  for (const source of [undefined, null, [], 'reference', 1, {}, { kind: 'ai', verification: 'verified' }, { kind: 'verified', verification: 'verified' }]) {
    const example = validateAnalysis({ translation: 'Hi', vocabulary: [{ term: 'interact', examples: [learningExample(source)] }] }).vocabulary[0].examples[0];
    assert.deepEqual(example.source, aiSource);
  }
});

test('references remain unverified including missing or unsafe URLs and questionable attribution', () => {
  const sources = [
    { kind: 'reference', title: 'Official release', url: 'https://example.com/news?lang=en#speech', verification: 'verified' },
    { kind: 'reference', title: 'Film dialogue', verification: 'verified' },
    { kind: 'reference', url: 'javascript:alert(1)', verification: 'verified' },
    { kind: 'unknown', title: 'News report', url: 'not a URL', verification: 'verified' },
    { kind: 'ai', title: 'Attributed quotation', url: 'https://example.com/' },
    { url: 'http://example.com/news' },
  ];
  for (const source of sources) {
    const result = validateAnalysis({ translation: 'Hi', vocabulary: [{ term: 'interact', examples: [learningExample(source)], senses: [{ pos: 'v.', meaning: '互动', example: learningExample(source) }] }], examples: [learningExample(source)] });
    for (const example of [result.vocabulary[0].examples[0], result.vocabulary[0].senses[0].example, result.examples[0]]) {
      assert.equal(example.source.kind, 'reference');
      assert.equal(example.source.verification, 'unverified');
      assert.equal(example.source.title, source.title || '');
      assert.equal(example.source.url, /^https?:\/\//.test(source.url || '') ? source.url : '');
    }
  }
});

test('only permits credential-free HTTP(S) source URLs without truncating unsafe URLs into safe ones', () => {
  const unsafe = ['javascript:alert(1)', 'data:text/html,hello', 'file:///etc/passwd', '//example.com/path', '/relative', 'https://user:secret@example.com/', 'https://user@example.com/', 'https://example.com/\npath', 'https://example.com/ bad', 'https://example.com/' + 'x'.repeat(1100), {}, []];
  for (const url of unsafe) {
    const source = validateAnalysis({ translation: 'Hi', vocabulary: [{ term: 'hi', examples: [learningExample({ kind: 'reference', url })] }] }).vocabulary[0].examples[0].source;
    assert.deepEqual(source, { kind: 'reference', title: '', url: '', verification: 'unverified' });
  }
  for (const url of ['http://example.com/', 'https://example.com/path?q=one#two']) {
    const source = validateAnalysis({ translation: 'Hi', examples: [learningExample({ kind: 'reference', url, verification: 'verified' })] }).examples[0].source;
    assert.equal(source.url, url); assert.equal(source.verification, 'unverified');
  }
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

test('local inference has more time than the remote model deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let upstreamSignal;
  const analyze = createAnalyzer({ baseUrl: 'http://127.0.0.1:11434/v1', authMode: 'none', model: 'local' }, async (_url, { signal }) => {
    upstreamSignal = signal;
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  });
  const result = analyze('我想早点回家休息。').catch(error => error);
  t.mock.timers.tick(90_000);
  assert.equal(upstreamSignal.aborted, false);
  t.mock.timers.tick(90_000);
  assert.equal(upstreamSignal.aborted, true);
  assert.match((await result).message, /180 seconds/);
});
