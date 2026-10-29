import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createDocument,saveDocument,loadDocument} from '../lib/editor-store.mjs';
import {createProductionPlanService} from '../lib/production-plan-jobs.mjs';
import {branchValueHash,branchOperationId} from '../lib/package-branch-application.mjs';
import {DEFAULT_CAPTION_STYLE} from '../../templates/remotion-base/src/editor/captions.mjs';
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
test('real host: package snapshot, user trim and text correction, frozen caption operation, save/reload, replay',async()=>{
 const root=mkdtempSync(join(tmpdir(),'package-edit-host-'));mkdirSync(join(root,'templates/remotion-base/public'),{recursive:true});writeFileSync(join(root,'source.mp4'),'isolated-test-source');
 const opts={root,rootDir:join(root,'index'),artifactRoot:join(root,'artifacts'),assetSourceRoot:root,autoStart:false};
 let d=createDocument({id:'p',name:'隔离并行验证',source:{path:'source.mp4',startFrame:0,durationFrames:900,clips:[{id:'one',startFrame:0,sourceInFrame:300,durationFrames:300}]},canvas:{width:1920,height:1080,fps:{num:30,den:1},durationFrames:300},captions:{version:1,enabled:true,style:{...DEFAULT_CAPTION_STYLE},cues:[{id:'c',text:'名字错字',originalText:'名字错字',startFrame:90,endFrame:150}]}});
 d=saveDocument(d,opts);const service=createProductionPlanService(opts);
 try {
 const {job}=await service.createJob({kind:'package',projectId:'p',revision:d.revision,packageOrchestrationVersion:2,packageExecution:{streamingApply:true,reusePolicy:'same-run'}});
 const baseline=JSON.parse(readFileSync(job.snapshotPath)).document;assert.equal(JSON.parse(readFileSync(job.snapshotPath)).editReconciliationVersion,1);
 const payload={value:structuredClone(baseline.captions)};payload.value.cues[0].text='名字纠正提案';payload.value.style.fontSize=70;
 const op={schemaVersion:1,packageOrchestrationVersion:2,projectId:'p',runId:job.runId,branchId:'captions',attemptId:'a',kind:'captions',dependencyFingerprint:'c'.repeat(64),payload,payloadSha256:branchValueHash(payload),readSet:['source','canvas','captions'].map(k=>({path:[k],beforeHash:branchValueHash(baseline[k])})),writeSet:[{path:['captions'],beforeHash:branchValueHash(baseline.captions)}],dependsOn:[],files:[]};op.operationId=branchOperationId(op);
 const basePath=join(job.outputDir,'reconciliation-base.json');writeFileSync(basePath,JSON.stringify({document:baseline}));op.files.push({path:basePath,sha256:sha(basePath)});
 op.validationReceiptPath=join(job.outputDir,'gate.json');writeFileSync(op.validationReceiptPath,JSON.stringify({status:'passed',projectId:'p',runId:job.runId,branchId:'captions',attemptId:'a',dependencyFingerprint:op.dependencyFingerprint,payloadSha256:op.payloadSha256,reconciliationBasePath:basePath,reconciliationBaseSha256:sha(basePath)}));op.validationReceiptSha256=sha(op.validationReceiptPath);
 let edit=loadDocument('p',opts);edit.source.clips[0]={...edit.source.clips[0],sourceInFrame:330,durationFrames:270};edit.canvas.durationFrames=270;edit.captions.cues[0]={...edit.captions.cues[0],startFrame:60,endFrame:120,text:'用户校正'};edit=saveDocument(edit,{...opts,expectedRevision:edit.revision});
 const result={id:'caption-proposal',projectId:'p',jobId:job.id,kind:'packageOperation',operation:op};
 const actual=await service.ingest({projectId:'p',jobId:job.id,status:'running',results:[result]});
 assert.equal(actual.job.results[0].state,'applied',JSON.stringify(actual.job.results[0]));
 const readback=loadDocument('p',opts);assert.equal(readback.captions.cues[0].text,'用户校正');assert.equal(readback.captions.cues[0].startFrame,60);assert.equal(readback.captions.style.fontSize,70);assert.equal(readback.canvas.durationFrames,270);assert.deepEqual(readback.source,edit.source);
 const rev=readback.revision;await service.ingest({projectId:'p',jobId:job.id,status:'running',results:[result]});assert.equal(loadDocument('p',opts).revision,rev);
 const planOp=structuredClone(op);planOp.kind='semanticPlan';planOp.branchId='initialPlan';planOp.attemptId='plan';planOp.payload={nativeResult:{id:'final-plan',projectId:'p',jobId:job.id,kind:'plan',plan:{...structuredClone(baseline.productionPlan),script:'旧的冻结稿'}}};planOp.payloadSha256=branchValueHash(planOp.payload);planOp.writeSet=[{path:['productionPlan'],beforeHash:branchValueHash(baseline.productionPlan)}];planOp.operationId=branchOperationId(planOp);planOp.validationReceiptPath=join(job.outputDir,'plan-gate.json');writeFileSync(planOp.validationReceiptPath,JSON.stringify({status:'passed',projectId:'p',runId:job.runId,branchId:planOp.branchId,attemptId:planOp.attemptId,dependencyFingerprint:planOp.dependencyFingerprint,payloadSha256:planOp.payloadSha256,reconciliationBasePath:basePath,reconciliationBaseSha256:sha(basePath)}));planOp.validationReceiptSha256=sha(planOp.validationReceiptPath);
 const final=await service.ingest({projectId:'p',jobId:job.id,status:'running',results:[{id:'plan-publication',projectId:'p',jobId:job.id,kind:'packageOperation',operation:planOp}]});assert.equal(final.job.results.find(x=>x.id==='plan-publication').state,'applied',JSON.stringify(final.job.results));
 const completed=loadDocument('p',opts);assert.match(completed.productionPlan.script,/用户校正/);assert.equal(completed.productionPlan.transcriptTimeBase,'project');assert.match(readFileSync(completed.productionPlan.sourceSrtPath,'utf8'),/00:00:02,000 --> 00:00:04,000/);
 const nextJob=await service.createJob({kind:'package',projectId:'p',revision:completed.revision,packageOrchestrationVersion:2,packageExecution:{streamingApply:true,reusePolicy:'same-run'}});const nextSnapshot=JSON.parse(readFileSync(nextJob.job.snapshotPath));assert.equal(nextSnapshot.transcriptTimeBase,'project');assert.ok(nextSnapshot.transcriptProvenancePath);assert.equal(sha(nextSnapshot.transcriptProvenancePath),sha(completed.productionPlan.transcriptProvenancePath));

 }finally{service.close();}
});
