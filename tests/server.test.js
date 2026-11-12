import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createSidecar } from '../src/lib/server.js';
import { createAnalyzer } from '../src/lib/analyzer.js';
import { getOriginalText } from '../src/lib/original-text.js';

async function fixture(analyzer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-server-'));
  const app = createSidecar({host:'127.0.0.1',port:0,dataDir:dir,mode:'unconfigured',apiKey:'',model:''},
    {analyzer:analyzer ?? (async (input) => ({translation:`English: ${input}`,vocabulary:[{term:'life cycle',meaning:'生命周期'}],grammar:[],examples:[]}))});
  const address = await app.start();
  const token = fs.readFileSync(path.join(dir,'ingest-token'),'utf8').trim();
  return {
    base:`http://127.0.0.1:${address.port}`,token,
    close: async()=> {await app.close();fs.rmSync(dir,{recursive:true,force:true});},
  };
}

async function until(condition, timeout=2500) {
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline) { if(await condition())return; await new Promise(r=>setTimeout(r,30)); }
  throw new Error('timed out');
}

test('full ingest → queue → model → SQLite → API flow',async()=>{
  const s=await fixture();
  try {
    const payload={source:'codex',sessionId:'one',turnId:'two',content:'Explain MCP lifecycle'};
    const bad=await fetch(`${s.base}/api/events`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
    assert.equal(bad.status,401);
    const headers={'content-type':'application/json','x-sidecar-token':s.token};
    const response=await fetch(`${s.base}/api/events`,{method:'POST',headers,body:JSON.stringify(payload)});
    assert.equal(response.status,202);
    await until(async()=>{
      const r=await fetch(`${s.base}/api/events`);const body=await r.json();
      return body.events[0]?.status==='complete';
    });
    const events=(await (await fetch(`${s.base}/api/events`)).json()).events;
    assert.equal(events[0].analysis.translation,'English: Explain MCP lifecycle');
    assert.equal((await (await fetch(`${s.base}/api/knowledge`)).json()).knowledge.length,1);
    const repeat=await fetch(`${s.base}/api/events`,{method:'POST',headers,body:JSON.stringify(payload)});
    assert.equal((await repeat.json()).deduplicated,true);
    assert.equal((await (await fetch(`${s.base}/api/events`)).json()).events.length,1);
  } finally {await s.close();}
});

test('Cursor plan implementation bypasses storage and analysis while normal prompts still run', async () => {
  const calls = [];
  const s = await fixture(async content => {
    calls.push(content);
    return { translation: `English: ${content}`, vocabulary: [], grammar: [], examples: [] };
  });
  try {
    const headers = { 'content-type': 'application/json', 'x-sidecar-token': s.token };
    const content = `Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself.
To-do's from the plan have already been created. Do not create them again. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos.
# CMS接口变更适配\n增加封面配置字段 coverImageConfig。`;
    for (let i = 0; i < 2; i++) {
      const response = await fetch(`${s.base}/api/events`, {
        method: 'POST', headers, body: JSON.stringify({ source: 'cursor', content }),
      });
      assert.equal(response.status, 202);
      assert.deepEqual(await response.json(), { ignored: true, reason: 'cursor-plan-implementation' });
    }
    assert.deepEqual((await (await fetch(`${s.base}/api/events`)).json()).events, []);
    assert.deepEqual((await (await fetch(`${s.base}/api/knowledge`)).json()).knowledge, []);
    assert.deepEqual(calls, []);
    const normal = 'Please implement the plan and add tests.';
    const response = await fetch(`${s.base}/api/events`, {
      method: 'POST', headers, body: JSON.stringify({ source: 'cursor', content: normal }),
    });
    assert.equal(response.status, 202);
    await until(async () => (await (await fetch(`${s.base}/api/events`)).json()).events[0]?.status === 'complete');
    assert.deepEqual(calls, [normal]);
    assert.equal((await (await fetch(`${s.base}/api/events`)).json()).events.length, 1);
  } finally { await s.close(); }
});

test('selected original text survives model → storage → API while captured content stays unchanged', async () => {
  const analyze = createAnalyzer({ model: 'fixture', apiKey: 'fixture-key', baseUrl: 'https://example.com/v1' }, async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ sourceFragments: ['整理需求变动'], translation: 'Organize the changes to the requirements.' }) } }] }),
  }));
  const s = await fixture(analyze);
  try {
    const content = '整理需求变动https://example.com/doc';
    const response = await fetch(`${s.base}/api/events`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-sidecar-token': s.token },
      body: JSON.stringify({ source: 'manual', content }),
    });
    assert.equal(response.status, 202);
    await until(async () => (await (await fetch(`${s.base}/api/events`)).json()).events[0]?.status === 'complete');
    const event = (await (await fetch(`${s.base}/api/events`)).json()).events[0];
    assert.equal(event.content, content);
    assert.equal(event.analysis.originalText, '整理需求变动');
    assert.equal(getOriginalText(event.content, event.analysis.originalText), '整理需求变动');
  } finally { await s.close(); }
});

test('pause, origin protection, disabled capture and static content',async()=>{
  const s=await fixture();
  try {
    const rebindStatus = await new Promise((resolve,reject) => {
      http.get(s.base + '/api/status', {headers:{host:'malicious.example'}}, res => {
        res.resume();res.on('end',()=>resolve(res.statusCode));
      }).on('error',reject);
    });
    assert.equal(rebindStatus,403);
    const blocked=await fetch(`${s.base}/api/settings`,{method:'POST',headers:{'content-type':'application/json',origin:'https://attacker.test'},body:JSON.stringify({paused:true})});
    assert.equal(blocked.status,403);
    const r=await fetch(`${s.base}/api/settings`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({paused:true})});
    assert.equal(r.status,200);
    const ingest=await fetch(`${s.base}/api/events`,{method:'POST',headers:{'content-type':'application/json','x-sidecar-token':s.token},body:JSON.stringify({source:'codex',content:'Hello'})});
    assert.equal((await ingest.json()).ignored,true);
    const page=await fetch(`${s.base}/`);assert.equal(page.status,200);assert.match(await page.text(),/English Sidecar/);
    const icons=await fetch(`${s.base}/icons.js`);assert.equal(icons.status,200);assert.match(await icons.text(),/Lucide SVG icon shapes/);
    const style=await fetch(`${s.base}/styles.css`);assert.equal(style.status,200);assert.match(await style.text(),/summary-strip/);
    const traversal=await fetch(`${s.base}/not-found`);assert.equal(traversal.status,404);
  } finally {await s.close();}
});

test('removed Demo endpoint cannot generate lessons',async()=>{
  const s=await fixture();
  try {
    const r=await fetch(`${s.base}/api/demo`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:'讲一下 Tool Discovery'})});
    assert.equal(r.status,404);
  } finally {await s.close();}
});
