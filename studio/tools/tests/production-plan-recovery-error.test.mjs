import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createDocument,saveDocument} from '../lib/editor-store.mjs';
import {createProductionPlanService} from '../lib/production-plan-jobs.mjs';
async function fixture(progress,manifest){
 const root=mkdtempSync(join(tmpdir(),'plan-recovery-error-')),options={root,rootDir:join(root,'index'),artifactRoot:join(root,'artifacts'),assetSourceRoot:root,autoStart:false};
 mkdirSync(join(root,'templates/remotion-base/public'),{recursive:true});
 const document=saveDocument(createDocument({id:'p',name:'P',canvas:{width:1280,height:720,fps:{num:30,den:1},durationFrames:300},productionPlan:{shots:[]}}),options),service=createProductionPlanService(options);
 const {job}=await service.createJob({projectId:'p',revision:document.revision,kind:'package'}),jobPath=join(dirname(job.snapshotPath),'job.json');
 const stored=JSON.parse(readFileSync(jobPath));stored.status='partial';stored.error='Worker exited 1';writeFileSync(jobPath,JSON.stringify(stored));
 if(progress!==undefined)writeFileSync(join(job.outputDir,'status.json'),JSON.stringify(progress));
 writeFileSync(join(job.outputDir,'manifest.json'),JSON.stringify(manifest??{state:'partial'}));
 return {service,job};
}
for(const state of ['partial','complete','plan_only'])test(`recovery clears obsolete worker exit after validated ${state} with no current error`,async()=>{
 const x=await fixture({state},{state});try{await x.service.recover();const j=x.service.getJob(x.job.id);assert.equal(j.status,state);assert.equal(j.error,undefined);}finally{x.service.close();}
});
for(const source of ['status','manifest'])test(`recovery retains current partial error from ${source}`,async()=>{
 const error='footage receipt missing for current run',x=await fixture({state:'partial',...(source==='status'?{error}:{})},{state:'partial',...(source==='manifest'?{error}:{})});
 try{await x.service.recover();assert.equal(x.service.getJob(x.job.id).error,error);}finally{x.service.close();}
});
test('recovery prefers current progress error over manifest fallback',async()=>{
 const x=await fixture({state:'partial',error:'current partial gap'},{state:'partial',error:'older manifest gap'});try{await x.service.recover();assert.equal(x.service.getJob(x.job.id).error,'current partial gap');}finally{x.service.close();}
});
test('missing terminal progress never clears a saved worker error',async()=>{
 const x=await fixture(undefined,{state:'partial'});try{await x.service.recover();assert.equal(x.service.getJob(x.job.id).error,'Worker exited 1');}finally{x.service.close();}
});
test('failed workflow receipt validation never clears a saved worker error',async()=>{
 const x=await fixture({state:'partial',workflowManifestPath:'invalid-workflow.json'});writeFileSync(join(x.job.outputDir,'invalid-workflow.json'),JSON.stringify({workflowMode:'semantic-template-v1',outputs:{summaryPath:join(x.job.outputDir,'missing-summary.md')}}));
 try{await x.service.recover();assert.equal(x.service.getJob(x.job.id).error,'Worker exited 1');}finally{x.service.close();}
});
