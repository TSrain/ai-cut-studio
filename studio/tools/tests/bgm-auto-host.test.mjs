import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createDocument,saveDocument,loadDocument} from '../lib/editor-store.mjs';
import {createProductionPlanService} from '../lib/production-plan-jobs.mjs';
import {branchValueHash,branchOperationId} from '../lib/package-branch-application.mjs';
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const at=(d,p)=>p.reduce((v,k)=>v?.[k],d);
test('BGM accepts only time-equivalent implicit source normalization',async()=>{
 const {assertBgmReconciliation}=await import('../lib/package-bgm-execution.mjs');
 const base={canvas:{durationFrames:300},source:{path:'source.mov',startFrame:15,durationFrames:300},productionPlan:{shots:[]}};
 const current=structuredClone(base);current.source.clips=[{id:'source-main',name:'主视频',startFrame:0,sourceInFrame:15,durationFrames:300}];
 assert.doesNotThrow(()=>assertBgmReconciliation(base,current));
 current.audioClips=[];current.audioTracks=[];
 assert.doesNotThrow(()=>assertBgmReconciliation(base,current));
 const audioEdited=structuredClone(current);audioEdited.audioClips=[{id:'manual'}];
 assert.throws(()=>assertBgmReconciliation(base,audioEdited),/concurrent audio/);
 for(const change of [d=>d.source.clips[0].sourceInFrame++,d=>d.source.clips[0].durationFrames--,d=>d.source.clips=[],d=>d.source.clips[0].playbackRate=2,d=>d.source.path='other.mov']){
  const changed=structuredClone(current);change(changed);assert.throws(()=>assertBgmReconciliation(base,changed),/source timeline/);
 }
});
async function setup(extra={},version=2){
 const root=mkdtempSync(join(tmpdir(),'bgm-auto-host-'));mkdirSync(join(root,'templates/remotion-base/public'),{recursive:true});
 const options={root,rootDir:join(root,'index'),artifactRoot:join(root,'artifacts'),assetSourceRoot:root,autoStart:false};
 const d=saveDocument(createDocument({id:'p',name:'P',canvas:{width:320,height:180,fps:{num:30,den:1},durationFrames:300},productionPlan:{shots:[{id:'s',title:'S',requirementVersion:1,timing:{status:'aligned',ranges:[{id:'r',startFrame:30,durationFrames:60}]}}]},...extra}),options);
 const service=createProductionPlanService(options);const {job}=await service.createJob({kind:'package',projectId:'p',revision:d.revision,...(version?{packageOrchestrationVersion:version}:{}),...(version===2?{packageExecution:{streamingApply:true,reusePolicy:'same-run'}}:{})});
 return {root,options,service,job,current:service.read('p').document};
}
function operation(f,{gap=false,badSha=false,mutate,extension='.wav',omitSource=false}={}){
 const file=join(f.job.outputDir,'music'+extension);execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=220:duration=5','-f','wav','-y',file]);
 const payload={value:{bgmPlanVersion:1,sections:[{id:'s',requirementVersion:1,bgmDesign:{decision:'music',reason:'叙述连续',purpose:'continuity',musicType:'柔和',texture:'稀疏',transition:'渐入渐出',recommendationIds:['r']}}],recommendations:[{id:'r',title:'Song',artist:'Author',url:'https://example.org/song',reason:'匹配',licenseStatus:'verified',licenseUrl:'https://example.org/license',audition:'not_listened'}],recommendationGaps:[],execution:{version:1,assets:[{recommendationId:'r',path:file,sha256:badSha?'0'.repeat(64):sha(file),sourceDurationSeconds:5,credit:'Author',licenseUrl:'https://example.org/license',sourceUrl:'https://example.org/song'}],clips:[{id:'c',shotIds:['s'],requirementVersions:{s:1},startFrame:30,durationFrames:60,sourceInFrame:0,assetId:'r',volume:.12,fadeInFrames:10,fadeOutFrames:20,fadeInCurve:'smooth',fadeOutCurve:'equalPower',method:'continuous'}],gaps:gap?['其他选段未取得']:[],searchAudit:{sources:['a','b','c']}}}};
 mutate?.(payload.value);
 const paths=[['productionPlan'],['audioClips'],['audioTracks'],['styleReference','allowedOverrides','bgmApplication']];
 const op={schemaVersion:1,packageOrchestrationVersion:2,projectId:'p',runId:f.job.runId,branchId:'bgm',attemptId:'a',kind:'bgm',dependencyFingerprint:'c'.repeat(64),payload,payloadSha256:branchValueHash(payload),readSet:[...paths,...(omitSource?[]:[['source']]),['canvas']].map(path=>({path,beforeHash:branchValueHash(at(f.current,path))})),writeSet:paths.map(path=>({path,beforeHash:branchValueHash(at(f.current,path))})),files:[{path:file,sha256:sha(file)}],dependsOn:[]};
 const basePath=join(f.job.outputDir,'bgm-base.json');writeFileSync(basePath,JSON.stringify({document:f.current}));op.files.push({path:basePath,sha256:sha(basePath)});
 op.operationId=branchOperationId(op);op.validationReceiptPath=join(f.job.outputDir,'bgm-gate.json');writeFileSync(op.validationReceiptPath,JSON.stringify({status:'passed',projectId:'p',runId:f.job.runId,branchId:'bgm',attemptId:'a',dependencyFingerprint:op.dependencyFingerprint,operations:[op],reconciliationBasePath:basePath,reconciliationBaseSha256:sha(basePath)}));op.validationReceiptSha256=sha(op.validationReceiptPath);return op;
}
async function ingest(f,op){return f.service.ingest({projectId:'p',jobId:f.job.id,status:'running',results:[{id:'music-result',projectId:'p',jobId:f.job.id,kind:'packageOperation',operation:op}]});}
test('explicit and default v2 packages freeze automatic BGM execution',async()=>{
 for(const version of [2,undefined]){const f=await setup({},version??null);try{const snap=JSON.parse(readFileSync(f.job.snapshotPath));assert.equal(snap.bgmExecutionVersion,1);assert.equal(f.job.bgmExecutionVersion,1);}finally{f.service.close();}}
});
test('real queue stages decoded SHA audio, saves editable clips and attribution, replay is idempotent',async()=>{
 const f=await setup();try{const op=operation(f);const result=await ingest(f,op);assert.equal(result.job.results[0].state,'applied',JSON.stringify(result.job.results));const d=loadDocument('p',f.options);assert.equal(d.audioClips.length,1);const c=d.audioClips[0];assert.equal(c.startFrame,30);assert.equal(c.volume,.12);assert.equal(c.fadeOutCurve,'equalPower');assert.equal(sha(join(f.root,c.path)),sha(op.payload.value.execution.assets[0].path));const app=d.styleReference.allowedOverrides.bgmApplication;assert.equal(app.runId,f.job.runId);assert.equal(app.audition,'not_listened');assert.equal(app.clips[0].clipId,c.id);assert.equal(app.assets[0].credit,'Author');assert.equal(d.productionPlan.bgmExecution.status,'applied');const revision=d.revision;await ingest(f,op);assert.equal(loadDocument('p',f.options).revision,revision);}finally{f.service.close();}
});
test('prior manual BGM application is protected, including its deletion records',async()=>{
 const prior={version:1,runId:'manual',clips:[{clipId:'deleted',shotIds:['s']}],baseline:{clips:[],tracks:[]},audition:'not_listened'};
 const f=await setup({styleReference:{contractPath:null,styleframePath:null,allowedOverrides:{bgmApplication:prior}},audioClips:[],audioTracks:[]});try{await ingest(f,operation(f));const d=loadDocument('p',f.options);assert.deepEqual(d.styleReference.allowedOverrides.bgmApplication,prior);assert.deepEqual(d.audioClips,[]);assert.equal(d.productionPlan.bgmExecution.status,'protected');}finally{f.service.close();}
});
test('source timeline changed after validation rejects frozen BGM rather than losing metadata alignment',async()=>{
 const f=await setup();try{const op=operation(f);let d=loadDocument('p',f.options);d.canvas.durationFrames=290;saveDocument(d,{...f.options,expectedRevision:d.revision});const result=await ingest(f,op);assert.notEqual(result.job.results[0].state,'applied');assert.equal(loadDocument('p',f.options).audioClips,undefined);}finally{f.service.close();}
});
test('concurrent manual audio edit rejects entire frozen BGM operation',async()=>{
 const f=await setup();try{const op=operation(f);let d=loadDocument('p',f.options);d.audioTracks=[{id:'manual',name:'手动音乐',locked:true}];saveDocument(d,{...f.options,expectedRevision:d.revision});const result=await ingest(f,op);assert.notEqual(result.job.results[0].state,'applied');d=loadDocument('p',f.options);assert.equal(d.audioTracks[0].locked,true);assert.equal(d.styleReference?.allowedOverrides?.bgmApplication,undefined);}finally{f.service.close();}
});
test('missing asset SHA fails the queue and execution gaps remain partial',async()=>{
 for(const badSha of [true,false]){const f=await setup();try{const result=await ingest(f,operation(f,{badSha,gap:true}));const d=loadDocument('p',f.options);if(badSha){assert.notEqual(result.job.results[0].state,'applied');assert.equal(d.audioClips,undefined);}else{assert.equal(d.productionPlan.bgmExecution.status,'partial');assert.equal(d.audioClips.length,1);}}finally{f.service.close();}}
});
test('resuming a historical v2 snapshot without execution flag stays plan-only',async()=>{
 const f=await setup();try{const snap=JSON.parse(readFileSync(f.job.snapshotPath));delete snap.bgmExecutionVersion;writeFileSync(f.job.snapshotPath,JSON.stringify(snap));const jobPath=join(f.job.snapshotPath,'..','job.json');const stored=JSON.parse(readFileSync(jobPath));delete stored.bgmExecutionVersion;stored.snapshotHash=sha(f.job.snapshotPath);stored.status='failed';writeFileSync(jobPath,JSON.stringify(stored));const {job}=await f.service.createJob({kind:'package',projectId:'p',revision:f.current.revision,resumeJobId:f.job.id});assert.equal(JSON.parse(readFileSync(job.snapshotPath)).bgmExecutionVersion,undefined);}finally{f.service.close();}
});
test('automatic clips use minimal lanes for overlapping and chronologically unordered transitions',async()=>{
 const f=await setup();try{await ingest(f,operation(f,{mutate:value=>{const c=value.execution.clips[0];value.execution.clips=[{...c,id:'later',startFrame:100},c,{...c,id:'bridge',startFrame:60}];}}));const d=loadDocument('p',f.options);assert.equal(d.audioClips.length,3);assert.equal(d.audioTracks.length,2);assert.equal(d.audioClips.find(c=>c.startFrame===100).trackId,d.audioClips.find(c=>c.startFrame===30).trackId);}finally{f.service.close();}
});
test('locked shot preserves its BGM design and receives no new music',async()=>{
 const f=await setup({productionPlan:{bgmPlanVersion:1,shots:[{id:'s',title:'S',requirementVersion:1,locked:true,bgmDesign:{decision:'silence',reason:'用户留白',requirementVersion:1}}]}});try{await ingest(f,operation(f));const d=loadDocument('p',f.options);assert.equal(d.audioClips?.length??0,0);assert.equal(d.productionPlan.shots[0].bgmDesign.reason,'用户留白');assert.equal(d.productionPlan.bgmExecution.status,'partial');}finally{f.service.close();}
});

test('verified CDN audio with no attribution requirement remains playable without fabricated credit',async()=>{
 const f=await setup();try{const result=await ingest(f,operation(f,{extension:'.audio',mutate:value=>{value.execution.assets[0].credit='';value.execution.assets[0].attributionRequired=false;}}));assert.equal(result.job.results[0].state,'applied',result.job.results[0].reason);const d=loadDocument('p',f.options);assert.match(d.audioClips[0].path,/\.wav$/);assert.equal(d.styleReference.allowedOverrides.bgmApplication.assets[0].credit,'');}finally{f.service.close();}
});
test('actual BGM readiness requires surviving exact clips, tracks and current semantic versions',async()=>{
 const {isPackageBgmApplied}=await import('../lib/package-bgm-execution.mjs');
 const f=await setup();try{await ingest(f,operation(f));const d=loadDocument('p',f.options);assert.equal(isPackageBgmApplied(d,f.job.runId),true);for(const mutate of [d=>d.audioClips.splice(0),d=>d.audioClips[0].volume=.8,d=>d.audioTracks[0].locked=true,d=>d.productionPlan.shots[0].requirementVersion++,d=>d.productionPlan.shots[0].timing.ranges[0].startFrame++]){const edited=structuredClone(d);mutate(edited);assert.equal(isPackageBgmApplied(edited,f.job.runId),false);}}finally{f.service.close();}
});

test('host rejects zero-gain music and missing source protection even with a native validation claim',async()=>{
 for(const options of [{omitSource:true},{mutate:value=>{value.execution.clips[0].volume=0;}}]){const f=await setup();try{const result=await ingest(f,operation(f,options));assert.notEqual(result.job.results[0].state,'applied');assert.equal(loadDocument('p',f.options).audioClips,undefined);}finally{f.service.close();}}
});
test('new run replaces only exact automatic baselines and keeps unrelated tracks',async()=>{
 const f=await setup({audioTracks:[{id:'sfx',name:'音效'}]});try{await ingest(f,operation(f));const old=loadDocument('p',f.options),oldId=old.audioClips[0].id;const next=await f.service.createJob({kind:'package',projectId:'p',revision:old.revision,packageOrchestrationVersion:2,packageExecution:{streamingApply:true,reusePolicy:'same-run'}});f.job=next.job;f.current=f.service.read('p').document;const result=await ingest(f,operation(f));assert.equal(result.job.results[0].state,'applied');const d=loadDocument('p',f.options);assert.equal(d.productionPlan.bgmExecution.status,'applied');assert.equal(d.audioClips.length,1);assert.notEqual(d.audioClips[0].id,oldId);assert.equal(d.audioTracks.length,2);assert.equal(d.audioTracks[0].id,'sfx');}finally{f.service.close();}
});
test('a new run never resurrects deleted auto clips or replaces renamed/locked/foreign-content tracks',async()=>{
 for(const mutate of [d=>d.audioClips=[],d=>d.audioTracks[0].name='用户命名',d=>d.audioTracks[0].locked=true,d=>d.audioClips.push({...d.audioClips[0],id:'foreign',startFrame:180})]){const f=await setup();try{await ingest(f,operation(f));let old=loadDocument('p',f.options);mutate(old);old=saveDocument(old,{...f.options,expectedRevision:old.revision});const next=await f.service.createJob({kind:'package',projectId:'p',revision:old.revision,packageOrchestrationVersion:2,packageExecution:{streamingApply:true,reusePolicy:'same-run'}});f.job=next.job;f.current=f.service.read('p').document;await ingest(f,operation(f));const d=loadDocument('p',f.options);assert.deepEqual(d.audioClips,old.audioClips);assert.deepEqual(d.audioTracks,old.audioTracks);assert.deepEqual(d.styleReference.allowedOverrides.bgmApplication,old.styleReference.allowedOverrides.bgmApplication);assert.equal(d.productionPlan.bgmExecution.status,'protected');}finally{f.service.close();}}
});
test('cross-run replacement remains atomic when an unrelated plan edit triggers reconciliation',async()=>{
 const f=await setup();try{await ingest(f,operation(f));let d=loadDocument('p',f.options);const next=await f.service.createJob({kind:'package',projectId:'p',revision:d.revision,packageOrchestrationVersion:2,packageExecution:{streamingApply:true,reusePolicy:'same-run'}});f.job=next.job;f.current=f.service.read('p').document;const op=operation(f);d=loadDocument('p',f.options);d.productionPlan.hoverEnabled=false;saveDocument(d,{...f.options,expectedRevision:d.revision});await ingest(f,op);d=loadDocument('p',f.options);assert.equal(d.audioClips.length,1);assert.equal(d.audioTracks.length,1);assert.equal(d.productionPlan.hoverEnabled,false);assert.equal(d.styleReference.allowedOverrides.bgmApplication.runId,f.job.runId);}finally{f.service.close();}
});
test('additional manual music preserves the entire prior automatic BGM before returning protected',async()=>{
 const f=await setup();try{await ingest(f,operation(f));let old=loadDocument('p',f.options);old.audioTracks.push({id:'manual-music',name:'手动音乐'});old.audioClips.push({...old.audioClips[0],id:'manual-clip',trackId:'manual-music',startFrame:120});old=saveDocument(old,{...f.options,expectedRevision:old.revision});const next=await f.service.createJob({kind:'package',projectId:'p',revision:old.revision,packageOrchestrationVersion:2,packageExecution:{streamingApply:true,reusePolicy:'same-run'}});f.job=next.job;f.current=f.service.read('p').document;await ingest(f,operation(f));const d=loadDocument('p',f.options);assert.equal(d.productionPlan.bgmExecution.status,'protected');assert.deepEqual(d.audioClips,old.audioClips);assert.deepEqual(d.audioTracks,old.audioTracks);assert.deepEqual(d.styleReference.allowedOverrides.bgmApplication,old.styleReference.allowedOverrides.bgmApplication);}finally{f.service.close();}
});
