import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// Offline tests must never read a user's real ingest token.
const offlineEnv={...process.env,SIDECAR_DATA_DIR:path.join(root,'tests','nonexistent-test-data'),SIDECAR_PORT:'1'};

test('Codex and Claude adapters are completely silent when collector is offline',()=>{
  for(const source of ['codex','claude']) {
    const proc=spawnSync(process.execPath,[path.join(root,'bin/hook.cjs'),source],{input:JSON.stringify({prompt:'Hello',session_id:'s'}),encoding:'utf8',timeout:4000,env:offlineEnv});
    assert.equal(proc.status,0);assert.equal(proc.stdout,'');assert.equal(proc.stderr,'');
  }
});

test('Cursor adapter always tells main Agent to continue',()=>{
  const proc=spawnSync(process.execPath,[path.join(root,'bin/hook.cjs'),'cursor'],{input:JSON.stringify({prompt:'Hello'}),encoding:'utf8',timeout:4000,env:offlineEnv});
  assert.equal(proc.status,0);assert.deepEqual(JSON.parse(proc.stdout),{continue:true});
});

test('Grok Build adapter is silent and accepts camelCase hook fields',()=>{
  const proc=spawnSync(process.execPath,[path.join(root,'bin/hook.cjs'),'grok'],{
    input:JSON.stringify({hookEventName:'user_prompt_submit',prompt:'What is an agent?',sessionId:'grok-session',promptId:'grok-turn'}),encoding:'utf8',timeout:4000,env:offlineEnv
  });
  assert.equal(proc.status,0);assert.equal(proc.stdout,'');assert.equal(proc.stderr,'');
});

test('Grok Build forwards prompt and native camelCase identity to local collector',async()=>{
  const http=await import('node:http');
  const fs=await import('node:fs');
  const os=await import('node:os');
  const {spawn}=await import('node:child_process');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sidecar-grok-forward-'));
  fs.writeFileSync(path.join(dir,'ingest-token'),'t'.repeat(64));
  const received=[];
  const server=http.createServer((req,res)=>{
    const chunks=[];
    req.on('data',x=>chunks.push(x));
    req.on('end',()=>{
      received.push({authorization:req.headers['x-sidecar-token'],body:JSON.parse(Buffer.concat(chunks).toString())});
      res.writeHead(202,{'content-type':'application/json'}).end('{}');
    });
  });
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const port=server.address().port;
    const fixtures=[
      {source:'grok',payload:{prompt:'Explain this architecture.',sessionId:'g-session',promptId:'p-123',cwd:'/native/grok',project_dir:'/ignored'},sessionId:'g-session',turnId:'p-123',projectPath:'/native/grok'},
      {source:'claude',payload:{prompt:'Explain this architecture.',session_id:'c-session',turn_id:'c-turn',project_dir:'/native/claude'},sessionId:'c-session',turnId:'c-turn',projectPath:'/native/claude'},
      {source:'cursor',payload:{text:'Explain this architecture.',conversation_id:'cursor-session',workspace_roots:['/native/cursor']},sessionId:'cursor-session',turnId:'',projectPath:'/native/cursor'},
      {source:'codex',payload:{prompt:'Explain this architecture.',cwd:'relative-is-not-a-project',workspace_roots:['/native/codex']},sessionId:'',turnId:'',projectPath:'/native/codex'},
      {source:'codex',payload:{prompt:'Explain this architecture.'},sessionId:'',turnId:'',projectPath:root},
    ];
    for(const fixture of fixtures){
      const result=await new Promise((resolve,reject)=>{
        const child=spawn(process.execPath,[path.join(root,'bin/hook.cjs'),fixture.source],{
          cwd:root,env:{...process.env,SIDECAR_PORT:String(port),SIDECAR_DATA_DIR:dir},stdio:['pipe','pipe','pipe']
        });
        let out='',err='';
        child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);
        child.on('error',reject);child.on('close',code=>resolve({code,out,err}));
        child.stdin.end(JSON.stringify(fixture.payload));
      });
      assert.deepEqual(result,{code:0,out:fixture.source==='cursor'?'\u007b"continue":true\u007d\n':'',err:''});
      const request=received.at(-1);
      assert.equal(request.authorization,'t'.repeat(64));
      assert.deepEqual(request.body,{source:fixture.source,eventType:'user.prompt.submitted',sessionId:fixture.sessionId,turnId:fixture.turnId,projectPath:fixture.projectPath,content:'Explain this architecture.'});
    }
    assert.equal(received.length,fixtures.length);
  } finally {await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
});

test('Pi sends ctx.cwd or process.cwd without altering the input or capturing extension feedback',async()=>{
  const fs=await import('node:fs');
  const os=await import('node:os');
  const {default:extension}=await import('../extensions/pi/english-sidecar.ts');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sidecar-pi-forward-'));
  fs.writeFileSync(path.join(dir,'ingest-token'),'synthetic-test-token');
  const oldDir=process.env.SIDECAR_DATA_DIR;
  const oldFetch=globalThis.fetch;
  const received=[];
  try {
    process.env.SIDECAR_DATA_DIR=dir;
    globalThis.fetch=async(url,options)=>{received.push({url,options,body:JSON.parse(options.body)});return {};};
    let input;
    extension({on(name,handler){assert.equal(name,'input');input=handler;}});
    const event={text:'Please explain this design.',source:'interactive'};
    for(const cwd of ['/native/pi',undefined]){
      const result=input(event,{cwd,sessionManager:{getSessionId:()=> 'pi-native-session'}});
      assert.equal(result,undefined);
      assert.deepEqual(received.at(-1).body,{
        source:'pi',sessionId:'pi-native-session',content:event.text,
        projectPath:cwd||process.cwd(),eventType:'user.prompt.submitted',
      });
    }
    assert.deepEqual(event,{text:'Please explain this design.',source:'interactive'});
    input({text:'Do not loop',source:'extension'},{cwd:'/ignored'});
    input({text:' ',source:'interactive'},{cwd:'/ignored'});
    assert.equal(received.length,2);
  } finally {
    globalThis.fetch=oldFetch;
    if(oldDir===undefined)delete process.env.SIDECAR_DATA_DIR;else process.env.SIDECAR_DATA_DIR=oldDir;
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
