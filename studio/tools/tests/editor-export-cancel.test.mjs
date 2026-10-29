import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startEditorExport,cancelEditorExport,getEditorJob} from '../lib/editor-export.mjs';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let n=0;n<100;n++){if(await fn())return;await wait(50);}throw Error('timeout');}
test('cancellation stops only its process tree, removes queued tasks, is idempotent and never publishes partial output',async()=>{
 const root=mkdtempSync(join(tmpdir(),'export-cancel-'));mkdirSync(join(root,'tools'));
 writeFileSync(join(root,'tools/render-queue.mjs'),`import {spawn} from 'node:child_process';import {writeFileSync,readFileSync} from 'node:fs';const q=JSON.parse(readFileSync(process.argv[2]));writeFileSync(q[0].expectedOutput,'partial');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)']);writeFileSync(process.argv[2]+'.pid',String(c.pid));setInterval(()=>{},1000);`);
 const doc={id:'cancel-test',revision:0,canvas:{width:1920,height:1080,fps:{num:30,den:1},durationFrames:60},instances:[],source:null};
 let active,queued;
 try{
  active=startEditorExport(doc,'full',{root});queued=startEditorExport(doc,'full',{root});
  const p=join(active.directory,'queue.json.pid');await until(()=>existsSync(p));const pid=Number(readFileSync(p));
  assert.equal(cancelEditorExport(queued.id).status,'cancelled');assert.equal(cancelEditorExport(queued.id).status,'cancelled');
  assert.equal(cancelEditorExport(active.id).status,'cancelling');
  await until(async()=>(await getEditorJob(active.id)).status==='cancelled');
  await until(()=>{try{process.kill(pid,0);return false;}catch{return true;}});
  assert.equal(existsSync(active.items[0].path),false);assert.equal(existsSync(join(queued.directory,'queue.json')),false);
  assert.equal(cancelEditorExport(active.id).status,'cancelled');
 }finally{if(active)cancelEditorExport(active.id);if(queued)cancelEditorExport(queued.id);rmSync(root,{recursive:true,force:true});}
});
