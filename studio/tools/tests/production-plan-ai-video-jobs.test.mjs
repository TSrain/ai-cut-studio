import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createDocument,saveDocument,loadDocument} from '../lib/editor-store.mjs';
import {createProductionPlanService} from '../lib/production-plan-jobs.mjs';
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
function setup({multi=false,noSlot=false}={}){
 const root=mkdtempSync(join(tmpdir(),'ai-video-jobs-')),options={root,rootDir:join(root,'index'),artifactRoot:join(root,'artifacts'),assetSourceRoot:root,autoStart:false};
 mkdirSync(join(root,'templates/remotion-base/public'),{recursive:true});
 const reference=join(root,'ref.png');execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=1280x720','-frames:v','1',reference]);
 const media=join(root,'generated.mp4');execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=1280x720:r=30:d=2','-c:v','libx264','-pix_fmt','yuv420p',media]);
 const ai={id:'ai-1',title:'示意',prompt:'汽车驶入收费站',promptVersion:1,requirementVersion:1,sourceCueIds:[1],reason:'示意',aspectRatio:'16:9',durationSeconds:5,references:[{path:reference,label:'参考',purpose:'主体',sha256:sha(reference)}]};
 const document=saveDocument(createDocument({id:'p',name:'P',canvas:{width:1920,height:1080,fps:{num:30,den:1},durationFrames:300},productionPlan:{shots:[{id:'s',title:'段',slots:noSlot?[]:[{id:'v',type:'animation',description:'动画',presentationMode:'overlay'}],aiVideoCandidates:[ai],timing:{manual:true,status:'manual',ranges:[{id:'r',startFrame:30,durationFrames:60},...(multi?[{id:'r2',startFrame:150,durationFrames:60}]:[])]}}]}}),options);
 return {options,document,service:createProductionPlanService(options),reference,media,ai};
}
const request=(x,extra={})=>JSON.parse(JSON.stringify({projectId:'p',revision:x.service.read('p').document.revision,kind:'recognize',shotId:'s',slotId:'v',aiVideoCandidateId:'ai-1',aiVideoPromptVersion:1,mediaPaths:[x.media],...extra}));
const result=(x,job,id='r1')=>({id,jobId:job.id,projectId:'p',kind:'match',shotId:'s',slotId:'v',requirementVersion:1,aiVideoCandidateId:'ai-1',aiVideoPromptVersion:1,target:{rangeId:'r',startFrame:30,durationFrames:60},media:{path:JSON.parse(readFileSync(job.snapshotPath)).mediaPaths[0],sourceInSeconds:0,sourceOutSeconds:2,sourceKind:'ai-generated'},technical:{passed:true,details:{sha256:sha(x.media)}},contentReview:{passed:true,frames:[{path:x.reference,sha256:sha(x.reference)}]}});
test('AI request validates explicit identity and freezes references into snapshot inputs',async()=>{
 const x=setup();const {job}=await x.service.createJob(request(x));const snapshot=JSON.parse(readFileSync(job.snapshotPath));
 assert.equal(snapshot.aiVideoCandidateId,'ai-1');assert.equal(snapshot.aiVideoPromptVersion,1);assert.equal(job.aiVideoCandidateId,'ai-1');
 assert.equal(snapshot.aiVideoCandidate.prompt,x.ai.prompt);assert.equal(snapshot.aiVideoCandidate.references[0].sha256,sha(x.reference));
 assert.ok(snapshot.inputs.some(i=>i.sha256===sha(x.reference)));
 assert.equal(x.service.resolveFile('p',x.reference),realpathSync(x.reference));
 for(const extra of [{shotId:undefined},{aiVideoPromptVersion:2},{candidateId:'network'},{instanceId:'user'},{aiVideoCandidateId:'missing'}])await assert.rejects(()=>x.service.createJob(request(x,extra)),/AI video|AI 视频/i);
});
test('AI references cannot silently change after prompt generation',async()=>{
 const x=setup();writeFileSync(x.reference,'changed');await assert.rejects(()=>x.service.createJob(request(x)),/hash|SHA|identity/i);
});
test('AI multi-range request leaves verified placement to recognition',async()=>{
 const x=setup({multi:true});const {job}=await x.service.createJob(request(x));assert.equal(JSON.parse(readFileSync(job.snapshotPath)).target,undefined);
});
test('AI media requires its exact candidate identity and real content hashes',async()=>{
 const x=setup();const {job}=await x.service.createJob(request(x));
 await assert.rejects(()=>x.service.ingest({projectId:'p',jobId:job.id,results:[{...result(x,job),aiVideoPromptVersion:2}]}),/AI video|AI 视频/i);
 const weak=result(x,job,'weak');delete weak.contentReview.frames[0].sha256;
 await x.service.ingest({projectId:'p',jobId:job.id,results:[weak]});assert.equal(x.service.read('p').document.instances.length,0);
 const r=result(x,job);await x.service.ingest({projectId:'p',jobId:job.id,results:[r]});const d=x.service.read('p').document;
 assert.equal(d.instances.length,1);assert.equal(d.productionPlan.shots[0].bindings[0].aiVideoCandidateId,'ai-1');assert.equal(d.productionPlan.shots[0].bindings[0].aiVideoPromptVersion,1);assert.equal(d.instances[0].props.media.muted,true);
 const again=await x.service.createJob(request(x));await x.service.ingest({projectId:'p',jobId:again.job.id,results:[result(x,again.job,'repeat')]});assert.equal(x.service.read('p').document.instances.length,1);
 let edited=loadDocument('p',x.options);edited.instances=[];edited=saveDocument(edited,x.options);const third=await x.service.createJob(request(x));await x.service.ingest({projectId:'p',jobId:third.job.id,results:[result(x,third.job,'deleted-repeat')]});assert.equal(x.service.read('p').document.instances.length,0);
});
test('changed prompt or requirements after submit cannot write stale generated results',async()=>{
 for(const change of ['prompt','requirementVersion']){
  const x=setup();const {job}=await x.service.createJob(request(x));let d=loadDocument('p',x.options);
  if(change==='prompt')d.productionPlan.shots[0].aiVideoCandidates[0].prompt='new prompt';else d.productionPlan.shots[0].requirementVersion=2;
  saveDocument(d,x.options);await x.service.ingest({projectId:'p',jobId:job.id,results:[result(x,job)]});assert.equal(x.service.read('p').document.instances.length,0);assert.equal(x.service.getJob(job.id).results[0].state,'stale');
 }
});
test('full-package partial suppresses legacy footage dispatch using immutable input marker',async()=>{
 const x=setup();const {job}=await x.service.createJob({projectId:'p',revision:x.document.revision,kind:'package'});
 writeFileSync(join(job.outputDir,'status.json'),JSON.stringify({state:'partial'}));await x.service.ingest({projectId:'p',jobId:job.id,status:'partial'});await x.service.recover();
 assert.equal(x.service.getJob(job.id).footageStatus,'handled-in-full-package');assert.equal(x.service.read('p').jobs.length,1);
});

test('AI without any existing slot stages a dedicated video slot and commits only verified media',async()=>{
 const x=setup({noSlot:true});const {job}=await x.service.createJob(request(x,{slotId:undefined}));const snapshot=JSON.parse(readFileSync(job.snapshotPath));
 assert.equal(snapshot.slotId,'ai-video-ai-1');assert.equal(x.service.read('p').document.productionPlan.shots[0].slots.length,0);
 const r={...result(x,job),slotId:snapshot.slotId};await x.service.ingest({projectId:'p',jobId:job.id,results:[r]});
 assert.equal(x.service.read('p').document.instances.length,1);assert.equal(x.service.read('p').document.productionPlan.shots[0].slots[0].id,snapshot.slotId);
});
test('linked upload identity cannot be silently rebound while request waits in a queue',async()=>{
 const x=setup();await assert.rejects(()=>x.service.createJob(request(x,{aiVideoCandidateIdentity:'old prompt'})),/AI video|变化/i);
});
test('AI late cancelled results and user locked or removed uses are preserved',async()=>{
 const x=setup();const {job}=await x.service.createJob(request(x));x.service.cancel(job.id);
 await x.service.ingest({projectId:'p',jobId:job.id,results:[result(x,job)]});assert.equal(x.service.read('p').document.instances.length,0);
 const next=await x.service.createJob(request(x));await x.service.ingest({projectId:'p',jobId:next.job.id,results:[result(x,next.job,'second')]});
 let d=loadDocument('p',x.options);d.instances[0].startFrame=100;d.instances[0].disabled=true;d.tracks[0].locked=true;d=saveDocument(d,x.options);
 const instance=structuredClone(d.instances[0]),track=structuredClone(d.tracks[0]);const again=await x.service.createJob(request(x));await x.service.ingest({projectId:'p',jobId:again.job.id,results:[result(x,again.job,'locked-repeat')]});
 const current=x.service.read('p').document;assert.deepEqual(current.instances[0],instance);assert.deepEqual(current.tracks[0],track);assert.equal(current.instances.length,1);
});

test('AI result cannot be explicitly retargeted onto another shot',async()=>{
 const x=setup();let before=loadDocument('p',x.options);before.productionPlan.shots.push({...structuredClone(before.productionPlan.shots[0]),id:'other'});saveDocument(before,x.options);const {job}=await x.service.createJob(request(x));x.service.cancel(job.id);const r=result(x,job);
 await x.service.ingest({projectId:'p',jobId:job.id,results:[r]});const d=x.service.read('p').document;
 await assert.rejects(()=>x.service.applyResults({projectId:'p',revision:d.revision,operation:{type:'apply-results',resultIds:[r.id],overrides:{[r.id]:{shotId:'other'}}}}),/AI video/i);
});
test('an image upload cannot be labelled as generated AI video',async()=>{
 const x=setup();const {job}=await x.service.createJob(request(x,{mediaPaths:[x.reference]}));const r=result(x,job);
 r.media.path=JSON.parse(readFileSync(job.snapshotPath)).mediaPaths[0];r.technical.details.sha256=sha(x.reference);
 await x.service.ingest({projectId:'p',jobId:job.id,results:[r]});assert.equal(x.service.read('p').document.instances.length,0);assert.match(x.service.getJob(job.id).results[0].reason,/AI video.*video/i);
});

test('failed dedicated AI slot can retry without first committing a slot',async()=>{
 const x=setup({noSlot:true}),{job}=await x.service.createJob(request(x,{slotId:undefined}));x.service.cancel(job.id);
 const retried=await x.service.retry(job.id),snapshot=JSON.parse(readFileSync(retried.job.snapshotPath));
 assert.equal(snapshot.slotId,'ai-video-ai-1');assert.equal(x.service.read('p').document.productionPlan.shots[0].slots.length,0);
 await assert.rejects(()=>x.service.createJob(request(x,{slotId:'ai-video-unknown'})),/AI video target slot/);
});
test('parallel candidates without slots do not invalidate each other through automatic dedicated slots',async()=>{
 const x=setup({noSlot:true});let d=loadDocument('p',x.options);d.productionPlan.shots[0].aiVideoCandidates.push({...structuredClone(x.ai),id:'ai-2'});saveDocument(d,x.options);
 const a=await x.service.createJob(request(x,{slotId:undefined})),b=await x.service.createJob(request(x,{slotId:undefined,aiVideoCandidateId:'ai-2'}));
 await x.service.ingest({projectId:'p',jobId:a.job.id,results:[{...result(x,a.job,'parallel-a'),slotId:'ai-video-ai-1'}]});
 await x.service.ingest({projectId:'p',jobId:b.job.id,results:[{...result(x,b.job,'parallel-b'),slotId:'ai-video-ai-2',aiVideoCandidateId:'ai-2'}]});
 const read=x.service.read('p');assert.equal(read.document.instances.length,2);assert.equal(x.service.getJob(b.job.id).results[0].state,'applied');
});
for(const change of ['timing','sourceClips','sourceStartFrame','sourceSrtPath','transcriptBinding','canvasDuration'])test('AI read set rejects late results after '+change+' changes',async()=>{
 const x=setup();let d=loadDocument('p',x.options);
 if(['sourceClips','sourceStartFrame'].includes(change)){d.source={path:'generated.mp4',startFrame:0,clips:[{id:'source-c',startFrame:0,durationFrames:60,sourceInFrame:0}]};d=saveDocument(d,x.options);}
 const {job}=await x.service.createJob(request(x));d=loadDocument('p',x.options);
 if(change==='timing')d.productionPlan.shots[0].timing.ranges[0].startFrame=60;
 if(change==='sourceClips')d.source.clips[0].sourceInFrame=10;
 if(change==='sourceStartFrame')d.source.startFrame=5;
 if(change==='sourceSrtPath')d.productionPlan.sourceSrtPath='/new-shared-transcript.srt';
 if(change==='transcriptBinding')d.productionPlan.transcriptBinding={sourceSha256:'a'.repeat(64),transcriptSha256:'b'.repeat(64)};
 if(change==='canvasDuration')d.canvas.durationFrames=330;
 saveDocument(d,x.options);await x.service.ingest({projectId:'p',jobId:job.id,results:[result(x,job)]});
 assert.equal(x.service.read('p').document.instances.length,0);assert.equal(x.service.getJob(job.id).results[0].state,'stale');
});
test('AI placement must be fully contained by its current canonical range',async()=>{
 const x=setup(),{job}=await x.service.createJob(request(x));const r=result(x,job);r.target.startFrame=15;
 await x.service.ingest({projectId:'p',jobId:job.id,results:[r]});assert.equal(x.service.read('p').document.instances.length,0);assert.equal(x.service.getJob(job.id).results[0].state,'stale');
});
test('unrelated cameraPlan changes do not invalidate AI timing input',async()=>{
 const x=setup();let d=loadDocument('p',x.options);d.source={path:'generated.mp4',startFrame:0,clips:[{id:'source-c',startFrame:0,durationFrames:60,sourceInFrame:0}]};saveDocument(d,x.options);
 const {job}=await x.service.createJob(request(x));d=loadDocument('p',x.options);d.source.cameraPlan={version:2,duration:2,levels:{A:1,B:1.12,C:1.18},anchor:{x:0.5,y:0.1},events:[{at:0,to:'A',transition:'cut',purpose:'hook',cue:'开场',reason:'基础'}]};saveDocument(d,x.options);
 await x.service.ingest({projectId:'p',jobId:job.id,results:[result(x,job)]});assert.equal(x.service.read('p').document.instances.length,1);
});
test('AI dependency still protects manually changed selected slots and user slot additions',async()=>{
 for(const change of ['selected','added']){
  const x=setup(),{job}=await x.service.createJob(request(x));let d=loadDocument('p',x.options);
  if(change==='selected')d.productionPlan.shots[0].slots[0].description='用户手调的槽位';else d.productionPlan.shots[0].slots.push({id:'user-slot',type:'video',description:'用户新增',requirementVersion:1});
  saveDocument(d,x.options);await x.service.ingest({projectId:'p',jobId:job.id,results:[result(x,job)]});assert.equal(x.service.read('p').document.instances.length,0);assert.equal(x.service.getJob(job.id).results[0].state,'stale');
 }
});

test('AI source transcript cannot change in place while a result is pending',async()=>{
 const x=setup(),srt=join(x.options.root,'shared.srt');writeFileSync(srt,'1\n00:00:01,000 --> 00:00:03,000\n汽车驶入收费站\n');let d=loadDocument('p',x.options);d.productionPlan.sourceSrtPath=srt;saveDocument(d,x.options);
 const {job}=await x.service.createJob(request(x));writeFileSync(srt,'1\n00:00:04,000 --> 00:00:06,000\n汽车驶入收费站\n');
 await x.service.ingest({projectId:'p',jobId:job.id,results:[result(x,job)]});assert.equal(x.service.read('p').document.instances.length,0);assert.equal(x.service.getJob(job.id).results[0].state,'stale');
});

test('sequential AI candidates receive their own slots after the first candidate is applied',async()=>{
 const x=setup({noSlot:true});
 try{
  let d=loadDocument('p',x.options);d.productionPlan.shots[0].aiVideoCandidates.push({...structuredClone(x.ai),id:'ai-2'});saveDocument(d,x.options);
  const a=await x.service.createJob(request(x,{slotId:undefined}));
  await x.service.ingest({projectId:'p',jobId:a.job.id,results:[{...result(x,a.job,'sequential-a'),slotId:'ai-video-ai-1'}]});
  assert.equal(x.service.getJob(a.job.id).results[0].state,'applied');
  const first=structuredClone(x.service.read('p').document.instances[0]);
  const b=await x.service.createJob(request(x,{slotId:undefined,aiVideoCandidateId:'ai-2'}));
  assert.equal(JSON.parse(readFileSync(b.job.snapshotPath)).slotId,'ai-video-ai-2');
  await x.service.ingest({projectId:'p',jobId:b.job.id,results:[{...result(x,b.job,'sequential-b'),slotId:'ai-video-ai-2',aiVideoCandidateId:'ai-2'}]});
  const current=x.service.read('p').document;assert.equal(current.instances.length,2);assert.deepEqual(current.instances.find(i=>i.id===first.id),first);
  assert.deepEqual(current.productionPlan.shots[0].bindings.map(v=>[v.aiVideoCandidateId,v.slotId]),[['ai-1','ai-video-ai-1'],['ai-2','ai-video-ai-2']]);
 }finally{x.service.close();}
});
test('implicit AI target does not reuse an existing ordinary video slot',async()=>{
 const x=setup();
 try{
  const d=loadDocument('p',x.options);d.productionPlan.shots[0].slots[0].type='video';saveDocument(d,x.options);
  const {job}=await x.service.createJob(request(x,{slotId:undefined}));assert.equal(JSON.parse(readFileSync(job.snapshotPath)).slotId,'ai-video-ai-1');
  assert.deepEqual(x.service.read('p').document.productionPlan.shots[0].slots,d.productionPlan.shots[0].slots);
 }finally{x.service.close();}
});
test('explicit existing video slot remains a compatible AI target',async()=>{
 const x=setup();
 try{
  const d=loadDocument('p',x.options);d.productionPlan.shots[0].slots[0].type='video';saveDocument(d,x.options);
  const {job}=await x.service.createJob(request(x,{slotId:'v'}));assert.equal(JSON.parse(readFileSync(job.snapshotPath)).slotId,'v');
  await x.service.ingest({projectId:'p',jobId:job.id,results:[result(x,job,'explicit-video')]});
  const current=x.service.read('p').document;assert.equal(current.instances.length,1);assert.equal(current.productionPlan.shots[0].bindings[0].slotId,'v');
 }finally{x.service.close();}
});

for(const canvas of [{width:3840,height:2160},{width:1080,height:1920}])test(`AI returned video fits ${canvas.width}x${canvas.height} canvas without cropping or transparent gaps`,async()=>{
 const x=setup();
 try{
  const {pipGeometry}=await import('../../templates/remotion-base/src/editor/source-pip.mjs');
  const d=loadDocument('p',x.options);Object.assign(d.canvas,canvas);saveDocument(d,x.options);
  const {job}=await x.service.createJob(request(x));await x.service.ingest({projectId:'p',jobId:job.id,results:[result(x,job,'display-fit')]});
  const instance=x.service.read('p').document.instances[0];assert.ok(instance);
  const p=instance.props,scale=Math.min(canvas.width/p.media.width,canvas.height/p.media.height),width=p.media.width*scale,height=p.media.height*scale;
  for(const frame of [0,30,59]){
   const g=pipGeometry(canvas.width,canvas.height,instance.durationFrames,frame,30,p);
   for(const [key,expected] of Object.entries({width,height,left:(canvas.width-width)/2,top:(canvas.height-height)/2}))assert.ok(Math.abs(g[key]-expected)<1e-6,`${key}: actual=${g[key]} expected=${expected}`);
   assert.ok(Math.abs(g.crop.width-1)<1e-6&&Math.abs(g.crop.height-1)<1e-6,'actual geometry keeps complete source');
  }
  assert.deepEqual(p.crop,{x:0,y:0,width:1,height:1,sourceAspect:16/9});
  assert.equal(p.editorBackground,'original');assert.deepEqual(p.sceneBackground,{type:'solid',color:'#111318'});
  assert.equal(p.media.hasAlpha,false);assert.equal(p.media.muted,true);assert.equal(p.media.startSeconds,0);
 }finally{x.service.close();}
});
test('ordinary unlinked media keeps its existing presentation defaults',async()=>{
 const x=setup();
 try{
  const d=loadDocument('p',x.options);delete d.productionPlan.shots[0].slots[0].presentationMode;saveDocument(d,x.options);
  const {job}=await x.service.createJob(request(x,{aiVideoCandidateId:undefined,aiVideoPromptVersion:undefined}));
  const r=result(x,job,'ordinary-media');delete r.aiVideoCandidateId;delete r.aiVideoPromptVersion;delete r.media.sourceKind;
  await x.service.ingest({projectId:'p',jobId:job.id,results:[r]});
  const p=x.service.read('p').document.instances[0].props;assert.equal(p.size,100);assert.equal(p.sceneBackground,undefined);assert.equal(p.editorBackground,undefined);
 }finally{x.service.close();}
});
