import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('Codex and Claude adapters are completely silent when collector is offline',()=>{
  for(const source of ['codex','claude']) {
    const proc=spawnSync(process.execPath,[path.join(root,'bin/hook.cjs'),source],{input:JSON.stringify({prompt:'Hello',session_id:'s'}),encoding:'utf8',timeout:4000});
    assert.equal(proc.status,0);assert.equal(proc.stdout,'');assert.equal(proc.stderr,'');
  }
});

test('Cursor adapter always tells main Agent to continue',()=>{
  const proc=spawnSync(process.execPath,[path.join(root,'bin/hook.cjs'),'cursor'],{input:JSON.stringify({prompt:'Hello'}),encoding:'utf8',timeout:4000});
  assert.equal(proc.status,0);assert.deepEqual(JSON.parse(proc.stdout),{continue:true});
});

test('Grok Build adapter is silent and accepts camelCase hook fields',()=>{
  const proc=spawnSync(process.execPath,[path.join(root,'bin/hook.cjs'),'grok'],{
    input:JSON.stringify({hookEventName:'user_prompt_submit',prompt:'What is an agent?',sessionId:'grok-session',promptId:'grok-turn'}),encoding:'utf8',timeout:4000
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
    const result=await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,[path.join(root,'bin/hook.cjs'),'grok'],{
        env:{...process.env,SIDECAR_PORT:String(port),SIDECAR_DATA_DIR:dir},stdio:['pipe','pipe','pipe']
      });
      let out='',err='';
      child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);
      child.on('error',reject);child.on('close',code=>resolve({code,out,err}));
      child.stdin.end(JSON.stringify({prompt:'Explain this architecture.',sessionId:'g-session',promptId:'p-123',hookEventName:'user_prompt_submit'}));
    });
    assert.deepEqual(result,{code:0,out:'',err:''});
    assert.equal(received.length,1);
    assert.equal(received[0].authorization,'t'.repeat(64));
    assert.deepEqual(received[0].body,{source:'grok',eventType:'user.prompt.submitted',sessionId:'g-session',turnId:'p-123',content:'Explain this architecture.'});
  } finally {await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
});
