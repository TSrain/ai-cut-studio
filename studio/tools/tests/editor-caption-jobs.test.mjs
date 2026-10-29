import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createCaptionService,acceptCaptionEdit} from '../lib/editor-caption-jobs.mjs';
const wait=async(fn)=>{for(let i=0;i<100;i++){const r=fn();if(r)return r;await new Promise(r=>setTimeout(r,10));}throw Error('timed out');};
test('recognition snapshots input, reports progress and keeps document untouched; cached source is reused',async()=>{
 const root=mkdtempSync(join(tmpdir(),'caption-jobs-')),pub=join(root,'public');mkdirSync(pub);writeFileSync(join(pub,'voice.mp4'),'local test source');let calls=0;
 const service=createCaptionService({root,publicRoot:pub,runner:async({onProgress})=>{calls++;onProgress('recognizing');return {cues:[{start:0,end:2,text:'大家好，这是字幕测试'}]};},polisher:async cues=>cues});
 const doc={id:'test',canvas:{width:1920,height:1080,fps:{num:30,den:1},durationFrames:90},source:{publicPath:'voice.mp4',path:'voice.mp4',startFrame:0},instances:[]},before=JSON.stringify(doc);
 const first=service.start(doc);assert.equal(service.start(doc).id,first.id);
 const done=await wait(()=>{const j=service.get(first.id);return j.status!=='running'&&j;});assert.equal(done.status,'complete');assert.ok(done.track.cues.length);assert.equal(JSON.stringify(doc),before);assert.ok(done.sourceKey);
 const second=service.start(doc);await wait(()=>service.get(second.id).status==='complete');assert.equal(calls,1);
 const restarted=createCaptionService({root,publicRoot:pub});assert.equal(restarted.get(first.id).status,'complete');
 rmSync(root,{recursive:true,force:true});
});
test('invalid source paths are rejected before any cloud upload and failed jobs can retry',async()=>{
 const root=mkdtempSync(join(tmpdir(),'caption-errors-')),pub=join(root,'public');mkdirSync(pub);writeFileSync(join(pub,'voice.mp4'),'x');let calls=0;
 const service=createCaptionService({root,publicRoot:pub,runner:async()=>{calls++;throw Error('飞书登录失效');},polisher:async x=>x});const doc={id:'test',canvas:{width:1920,height:1080,fps:{num:30,den:1},durationFrames:90},source:{publicPath:'../secret',startFrame:0},instances:[]};assert.throws(()=>service.start(doc));assert.equal(calls,0);
 doc.source.publicPath='voice.mp4';const job=service.start(doc);const failed=await wait(()=>service.get(job.id).status==='failed'&&service.get(job.id));assert.match(failed.error,/飞书登录/);assert.notEqual(service.start(doc).id,job.id);await wait(()=>calls===2);await new Promise(r=>setTimeout(r,30));rmSync(root,{recursive:true,force:true});
});
test('source replacement during recognition fails before publishing cache',async()=>{
 const root=mkdtempSync(join(tmpdir(),'caption-change-')),pub=join(root,'public');mkdirSync(pub);const file=join(pub,'v.mp4');writeFileSync(file,'original');
 const service=createCaptionService({root,publicRoot:pub,runner:async()=>{writeFileSync(file,'different source');return{cues:[{start:0,end:1,text:'错误缓存'}]};},polisher:async x=>x});
 const doc={id:'changed',canvas:{width:1920,height:1080,fps:{num:30,den:1},durationFrames:90},source:{publicPath:'v.mp4',startFrame:0},instances:[]};
 const j=service.start(doc);const done=await wait(()=>service.get(j.id).status==='failed'&&service.get(j.id));assert.match(done.error,/变化/);
 const {readdirSync,existsSync}=await import('node:fs');for(const hash of readdirSync(join(root,'workspace/editor-caption-cache')))assert.equal(existsSync(join(root,'workspace/editor-caption-cache',hash,'recognized.json')),false);
 rmSync(root,{recursive:true,force:true});
});

test('caption compression protects English identifiers, numbers and repeated negations',()=>{
 assert.equal(acceptCaptionEdit('其实我觉得AI可以帮助普通人','AI可以帮助普通人'),true);
 assert.equal(acceptCaptionEdit('不是不需要AI','不需要AI'),false);
 assert.equal(acceptCaptionEdit('费用是100元','费用是10元'),false);
 assert.equal(acceptCaptionEdit('AI不是万能的','AI是万能的'),false);
});
test('Codex text transfer requires explicit per-job choice; cached AI text is not used after opt-out',async()=>{
 const root=mkdtempSync(join(tmpdir(),'caption-consent-')),pub=join(root,'public');mkdirSync(pub);writeFileSync(join(pub,'v.mp4'),'source');let calls=0;
 const service=createCaptionService({root,publicRoot:pub,runner:async()=>({cues:[{start:0,end:2,text:'其实我觉得这个字幕很清楚'}]}),polisher:async(cues,options)=>{assert.equal(options.allowCodex,true);calls++;return cues.map(c=>({...c,originalText:c.text,text:'字幕很清楚'}));}});
 const doc={id:'consent',canvas:{width:1920,height:1080,fps:{num:30,den:1},durationFrames:90},source:{publicPath:'v.mp4',startFrame:0},instances:[]};
 const run=async options=>{const j=service.start(doc,options);return wait(()=>service.get(j.id).status==='complete'&&service.get(j.id));};
 assert.equal((await run()).track.cues[0].text,'其实我觉得这个字幕很清楚');assert.equal(calls,0);
 assert.equal((await run({polish:true})).track.cues[0].text,'字幕很清楚');assert.equal(calls,1);
 assert.equal((await run()).track.cues[0].text,'其实我觉得这个字幕很清楚');assert.equal(calls,1);
 rmSync(root,{recursive:true,force:true});
});
