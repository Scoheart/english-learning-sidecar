import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIncomingEvent, redactSensitive, isWorthLearning, extractLearningText,
  normalizeCapturePolicy, isProjectAllowed } from '../src/lib/privacy.js';

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

const cursorPlanPrompt = `Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself.

To-do's from the plan have already been created. Do not create them again. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos.`;

test('ignores Cursor-generated plan implementation wrappers before extraction', () => {
  for (const content of [cursorPlanPrompt, `  ${cursorPlanPrompt}\n `,
    cursorPlanPrompt.replaceAll(' ', '\n\t'), cursorPlanPrompt.toLowerCase(),
    `${cursorPlanPrompt}\n\n# CMS接口变更适配\n增加封面配置字段 coverImageConfig。`]) {
    const event = normalizeIncomingEvent({ source: 'Cursor', content });
    assert.equal(event.ignoredReason, 'cursor-plan-implementation');
    assert.equal(event.eligible, false);
    assert.equal(event.content, '[No learnable natural language]');
  }
});

test('keeps learner-authored plan requests, template questions, and other platforms', () => {
  for (const content of ['Implement the plan as specified.', 'Please implement the plan and add tests.',
    '按这个 plan 实施 CMS 接口变更，不要修改计划文件。',
    'Implement the plan as specified, but explain the trade-offs first.',
    `请翻译这段 Cursor 指令：\n${cursorPlanPrompt}`,
    `What does this mean?\n${cursorPlanPrompt}`, `> ${cursorPlanPrompt}`]) {
    const event = normalizeIncomingEvent({ source: 'cursor', content });
    assert.equal(event.eligible, true, content);
    assert.equal(event.ignoredReason, undefined);
  }
  for (const source of ['manual', 'codex', 'claude', 'grok', 'pi']) {
    const event = normalizeIncomingEvent({ source, content: cursorPlanPrompt });
    assert.equal(event.eligible, true, source);
    assert.equal(event.ignoredReason, undefined);
  }
  const reply = normalizeIncomingEvent({ source: 'cursor', eventType: 'assistant.reply', content: cursorPlanPrompt });
  assert.equal(reply.eligible, false);
  assert.equal(reply.ignoredReason, undefined);
});

test('quoted JSON credential names and common credentials are redacted', () => {
  for (const name of ['password', 'apiKey', 'session_token', 'token', 'secret', 'access_token', 'refreshToken', 'client_secret', 'authorization', 'private_key']) {
    for (const value of ['"sensitive-value"', "'sensitive-value'", 'sensitive-value']) {
      const redacted = redactSensitive(`{"${name}": ${value}}`);
      assert.ok(!redacted.includes('sensitive-value'), `${name}: ${redacted}`);
    }
  }
  for (const secret of ['sk-proj-abcdefghijklmnopqrst', 'ghp_abcdefghijklmnopqrst',
    'github_pat_abcdefghijklmnopqrst', 'glpat-abcdefghijklmnopqrst', 'xoxb-1234567890-abcdefghi',
    'npm_abcdefghijklmnopqrstuvwxyz', 'AKIA1234567890123456', 'ASIA1234567890123456',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature', 'aVeryLongOpaqueCredential12345678901234567890']) {
    assert.ok(!redactSensitive(`Use ${secret} safely`).includes(secret), secret);
  }
  assert.ok(!redactSensitive('{"password":"escaped\\\\\\"secret"}').includes('secret'));
  assert.ok(!redactSensitive('-----BEGIN PRIVATE KEY-----\nunfinished-secret').includes('unfinished-secret'));
});

test('mixed input returns natural language only, not just an eligibility flag', () => {
  const content = [
    '请解释这个错误，并帮我优化接口。',
    '```js', 'const secret = "never-store-this";', '```',
    '{"payload": {"token":"never-store-this-either"}, "items": [1,2]}',
    'const result = await fetch("/sensitive-endpoint");',
    'console.log(result);',
    '2026-11-11T10:00:00Z INFO internal details',
    'ERROR database password failed',
    'TypeError: Cannot read properties',
    '    at run (/private/project/index.js:12:3)',
    'Traceback (most recent call last):',
    '  File "/private/code.py", line 3, in main',
    'ValueError: bad value',
    'Please explain the trade-offs in plain English.',
  ].join('\n');
  const expected = '请解释这个错误，并帮我优化接口。\nPlease explain the trade-offs in plain English.';
  assert.equal(extractLearningText(content), expected);
  const event = normalizeIncomingEvent({source:'codex', content});
  assert.equal(event.content, expected);
  assert.equal(event.eligible, true);
  assert.equal(extractLearningText('Before this JSON. {"nested":{"x":1}} After it.'), 'Before this JSON. After it.');
});

test('pure code, logs, serialized data, and secrets never persist raw content', () => {
  for (const content of ['```js\nconst hidden = 1;\n```', '```\nunfinished code',
    'const hidden = 42;', 'console.log("internal");', 'return internal_value', 'raise RuntimeError("internal")',
    'class Internal:', 'SELECT * FROM internal_users;', 'curl https://example.invalid/private',
    '<div>internal implementation details</div>', '{"message":"internal message"}',
    '[{"message":"internal message"}]', 'INFO internal-secret-details',
    'Error: internal-secret-details\n    at run (/private/path:1:2)',
    'password="do-not-store"', 'token: do-not-store', 'sk-proj-abcdefghijklmnopqrst',
    'token=sk-proj-abcdefghijklmnopqrst', 'authorization: Bearer abcdefghijklmnopqrstuvwxyz',
    'Bearer abcdefghijklmnopqrstuvwxyz', '-----BEGIN PRIVATE KEY-----\nnever-store']) {
    assert.equal(extractLearningText(content), '', content);
    const event = normalizeIncomingEvent({source:'codex', content});
    assert.equal(event.eligible, false, content);
    assert.equal(event.content, '[No learnable natural language]', content);
    assert.notEqual(event.content, content);
  }
});

test('preserves ordinary English, Chinese, punctuation, indentation, and API questions', () => {
  for (const content of ['你好，帮我看看这个问题。', 'Hi', 'Explain API authentication and session tokens.',
    'How do I use JSON arrays [and objects] in my API?', 'Is x = y a useful analogy?',
    'Please explain: why is this happening?', 'I think this is good; what do you think?',
    '    请解释 HTTP 401 和 403 的区别。']) {
    assert.equal(extractLearningText(content), content.trim());
    assert.equal(isWorthLearning(content), true);
  }
});

test('inline technical terms survive while inline paths, assignments, calls and secrets do not', () => {
  const content = '请解释 `MCP` 与 `Tool Discovery` 的关系。';
  assert.equal(extractLearningText(content), '请解释 MCP 与 Tool Discovery 的关系。');
  assert.equal(normalizeIncomingEvent({source:'codex',content}).content, '请解释 MCP 与 Tool Discovery 的关系。');
  for (const inline of ['/private/secret-project', 'C:\\private\\project', 'password=internal', 'fetch("/private")', 'sk-proj-abcdefghijklmnopqrst']) {
    const result = extractLearningText(`Please explain this: \`${inline}\` safely.`);
    assert.equal(result, 'Please explain this: safely.');
    assert.ok(!result.includes(inline));
  }
});

test('strict capture policy rejects invalid object, mode, lists and project paths', () => {
  for (const policy of [undefined,null,[],true,'all',{mode:'invalid'},{mode:null},
    {allowedProjects:'/repo'},{excludedProjects:null},{excludedProjects:['relative/private']},
    {excludedProjects:['/valid',42]},{allowedProjects:['']},{excludedProjects:['/repo\0private']}]) {
    assert.throws(() => normalizeCapturePolicy(policy,{strict:true}));
  }
  const policy = {mode:'allowlist',allowedProjects:['/repo/app/../app/'],excludedProjects:['/repo/app/private/']};
  assert.deepEqual(normalizeCapturePolicy(policy,{strict:true}), {
    mode:'allowlist',allowedProjects:['/repo/app'],excludedProjects:['/repo/app/private'],
  });
  assert.deepEqual(normalizeCapturePolicy({}, {strict:true}), {mode:'all',allowedProjects:[],excludedProjects:[]});
  // Non-strict reads of legacy settings retain their compatibility defaults.
  assert.deepEqual(normalizeCapturePolicy({mode:'legacy',excludedProjects:['relative/private']}), {
    mode:'all',allowedProjects:[],excludedProjects:[],
  });
});

test('metadata is deterministically hashed, without storing raw paths or credentials', () => {
  const input = {source:'codex', content:'Explain this change.',
    sessionId:'password=metadata-secret', turnId:'sk-proj-turnsecret123456789',
    projectPath:'/Users/private-company/secret-project/../secret-project'};
  const first = normalizeIncomingEvent(input);
  const second = normalizeIncomingEvent(input);
  for (const key of ['sessionId', 'turnId', 'projectId']) {
    assert.match(first[key], /^sha256:[a-f0-9]{64}$/);
    assert.equal(first[key], second[key]);
  }
  assert.equal('projectPath' in first, false);
  assert.ok(!JSON.stringify(first).includes('metadata-secret'));
  assert.ok(!JSON.stringify(first).includes('private-company'));
  assert.equal(first.projectId, normalizeIncomingEvent({...input,projectPath:'/Users/private-company/secret-project/'}).projectId);
  const absent = normalizeIncomingEvent({source:'codex',content:'Hello'});
  assert.equal(absent.sessionId, ''); assert.equal(absent.turnId, ''); assert.equal(absent.projectId, '');
});

test('capture policy defaults to all and normalizes absolute paths only', () => {
  assert.deepEqual(normalizeCapturePolicy(), {mode:'all',allowedProjects:[],excludedProjects:[]});
  assert.deepEqual(normalizeCapturePolicy({mode:'allowlist',allowedProjects:['/repo/app/../app/', '/repo/app', 'relative', null],excludedProjects:['/repo/private/']}), {
    mode:'allowlist', allowedProjects:['/repo/app'], excludedProjects:['/repo/private'],
  });
  assert.equal(isProjectAllowed(undefined), true);
  assert.equal(isProjectAllowed('/anywhere', {}), true);
  assert.equal(isProjectAllowed(undefined, {mode:'allowlist',allowedProjects:['/repo']}), false);
  assert.equal(isProjectAllowed('relative', {mode:'allowlist',allowedProjects:['/repo']}), false);
});

test('capture policy uses directory boundaries with exclusions taking priority', () => {
  const policy = {mode:'allowlist',allowedProjects:['/repo/app/'],excludedProjects:['/repo/app/private']};
  for (const project of ['/repo/app', '/repo/app/src', '/repo/app/./src', '/repo/app/sub/../src']) {
    assert.equal(isProjectAllowed(project,policy), true, project);
  }
  for (const project of ['/repo/app-other', '/repo/application', '/repo/app/../elsewhere', '/repo/app/private', '/repo/app/private/sub']) {
    assert.equal(isProjectAllowed(project,policy), false, project);
  }
  assert.equal(isProjectAllowed('/repo/app/private-other',policy), true);
  assert.equal(isProjectAllowed('/repo/app/private/x', {...policy,mode:'all'}), false);
  assert.equal(isProjectAllowed('/repo', {mode:'allowlist',allowedProjects:['/']}), true);
  assert.equal(isProjectAllowed('C:\\Work\\App\\src', {mode:'allowlist',allowedProjects:['c:/work/app']}), true);
  assert.equal(isProjectAllowed('C:/Work/App-other', {mode:'allowlist',allowedProjects:['c:/work/app']}), false);
  assert.equal(isProjectAllowed('C:/Work/App', {mode:'allowlist',allowedProjects:['C:/']}), true);
  assert.equal(isProjectAllowed('C:/Work/App', {mode:'all',excludedProjects:['C:/']}), false);
  assert.deepEqual(normalizeCapturePolicy(normalizeCapturePolicy({mode:'allowlist',allowedProjects:['C:/']})), {mode:'allowlist',allowedProjects:['c:/'],excludedProjects:[]});
});

test('rejects malformed and oversized payloads', () => {
  assert.throws(() => normalizeIncomingEvent({source:'X',content:'a'}));
  assert.throws(() => normalizeIncomingEvent({source:'codex',content:'a'.repeat(12001)}));
});
