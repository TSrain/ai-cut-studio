import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {coverWorkerArgs,coverPrompt,newCoverRuns,getCoverJob} from '../lib/editor-cover-jobs.mjs';
import {codexModelArgs} from '../lib/codex-cli.mjs';
import {createDocument,saveDocument,loadDocument} from '../lib/editor-store.mjs';
import {validateCoverAsset} from '../lib/editor-cover-selection.mjs';
import {createHash} from 'node:crypto';
import {editorCoverApi} from '../lib/editor-cover-api.mjs';
test('worker uses original skill with the pinned shared model and no shell interpolation',()=>{
 const args=coverWorkerArgs({workflowRoot:'/a b',artifactRoot:'/a/产物',dir:'/a/job'});
 assert.ok(args.includes('--approve-for-me'));assert.ok(!args.includes('--sandbox'));assert.deepEqual(args.slice(args.indexOf('--model'),args.indexOf('--model')+4),codexModelArgs());
 assert.equal(args[args.indexOf('-C')+1],'/a b');
 const prompt=coverPrompt({source:'/a/$(`x`).md',workflowRoot:'/work',episode:'SC-0032'});
 assert.match(prompt,/\$content-cover/);assert.match(prompt,/content-cover\/SKILL.md/);assert.match(prompt,/本地运行不写飞书/);assert.match(prompt,/不嵌套启动/);
});
test('old candidates never count as a completed generation',()=>{
 assert.deepEqual(newCoverRuns({runs:[{id:'a'}]},{existingRunIds:['a']}),[]);
 assert.deepEqual(newCoverRuns({runs:[{id:'b'},{id:'a'}]},{existingRunIds:['a']}),[{id:'b'}]);
});
test('worker exit zero with no deliverable is a failure, with durable log',t=>{
 const root=mkdtempSync(join(tmpdir(),'cover-worker-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const dir=join(root,'job');mkdirSync(dir);const cli=join(root,'fake-cli');
 writeFileSync(cli,'#!/bin/sh\ncat >/dev/null\nexit 0\n',{mode:0o755});
 writeFileSync(join(dir,'job.json'),JSON.stringify({id:'test',cli,source:'SC-0032',workflowRoot:root,artifactRoot:root,createdAt:Date.now(),status:'running',existingRunIds:[]}));
 writeFileSync(join(dir,'request.json'),JSON.stringify({document:{name:'SC-0032'},episode:'SC-0032'}));
 const out=spawnSync(process.execPath,[resolve('tools/editor-cover-worker.mjs'),dir],{encoding:'utf8',timeout:10000});assert.equal(out.status,0,out.stderr);
 const job=JSON.parse(readFileSync(join(dir,'job.json')));assert.equal(job.status,'failed');assert.match(job.error,/没有新增/);
});
test('cover persists in saved document; corrupt frozen image is rejected',t=>{
 const root=mkdtempSync(join(tmpdir(),'cover-save-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 mkdirSync(join(root,'editor-covers'));
 const bytes=Buffer.from('fixture png'),hash=createHash('sha256').update(bytes).digest('hex'),publicPath=`editor-covers/${hash}.png`;
 const cover={publicPath,runId:'abc123',groupId:'A',ratio:'4:3',title:'选定封面'};writeFileSync(join(root,publicPath),bytes);
 validateCoverAsset(cover,root);
 const doc=createDocument({id:'test',name:'Test',canvas:{width:1920,height:1080,fps:{num:30,den:1},durationFrames:30},cover});
 const saved=saveDocument(doc,{rootDir:join(root,'projects')});assert.deepEqual(loadDocument(saved.id,{rootDir:join(root,'projects')}).cover,cover);
 writeFileSync(join(root,publicPath),'modified');assert.throws(()=>validateCoverAsset(cover,root),/已被修改/);
 assert.throws(()=>createDocument({...doc,cover:{...cover,publicPath:'../private.png'}}),/invalid cover/);
});

test('start API launches one detached task and exposes its terminal failure',async t=>{
 const base=mkdtempSync(join(tmpdir(),'cover-api-')),root=join(base,'visualization');
 const cli=join(base,'fake-cli');writeFileSync(cli,'#!/bin/sh\ncat >/dev/null\nsleep 0.2\nexit 0\n',{mode:0o755});
 mkdirSync(join(root,'tools'),{recursive:true});symlinkSync(resolve('tools/editor-cover-worker.mjs'),join(root,'tools/editor-cover-worker.mjs'));
 const previous=process.env.EDITOR_CODEX_BIN;process.env.EDITOR_CODEX_BIN=cli;
 t.after(()=>{if(previous===undefined)delete process.env.EDITOR_CODEX_BIN;else process.env.EDITOR_CODEX_BIN=previous;rmSync(base,{recursive:true,force:true});});
 saveDocument(createDocument({id:'api-test',name:'SC-0032',canvas:{width:640,height:360,fps:{num:30,den:1},durationFrames:60}}),{rootDir:join(root,'workspace/editor-projects')});
 async function request(action,method='POST'){
  let data;const res={writeHead(code){assert.equal(code,200);},end(body){data=JSON.parse(body);}};
  assert.equal(await editorCoverApi(action,{method},res,new URL('http://localhost/?id=api-test'),{documentId:'api-test'},{root}),true);return data;
 }
 const first=await request('covers/start'),second=await request('covers/start');
 assert.equal(first.job.id,second.job.id);assert.equal(first.job.status,'running');
 let listing;
 for(let i=0;i<100;i++){listing=await request('covers','GET');if(listing.job.status!=='running')break;await new Promise(done=>setTimeout(done,50));}
 assert.equal(listing.job.status,'failed');assert.match(listing.job.error,/没有新增/);
 const dir=join(base,'workflow/workspace/editor-cover-jobs',first.job.id);
 assert.match(readFileSync(join(dir,'prompt.md'),'utf8'),/\$content-cover/);
 assert.match(readFileSync(join(dir,'prompt.md'),'utf8'),new RegExp('--run-id '+first.job.runId));
});
