import test from 'node:test';
import assert from 'node:assert/strict';
import {aiVideoCandidateState} from '../editor/ai-video-candidates.mjs';
function fixture(){
 const candidate={id:'ai-office',prompt:'办公室情境',promptVersion:1,requirementVersion:1,references:[]};
 const binding={instanceId:'shared-instance',resultId:'first-result',applicationKey:'same-application',aiVideoCandidateId:candidate.id,aiVideoPromptVersion:1,status:'current'};
 const shot={id:'s',requirementVersion:1,bindings:[binding]};
 const document={id:'p',instances:[{id:'shared-instance'}],productionPlan:{dismissedResultIds:[],shots:[shot]}};
 const first={id:'first-result',kind:'match',state:'applied',slotId:'ai-video-ai-office',requirementVersion:1,aiVideoCandidateId:candidate.id,aiVideoPromptVersion:1,applicationKey:binding.applicationKey,target:{rangeId:'r',startFrame:1409,durationFrames:90},media:{path:'/archive/same.mp4',sourceInSeconds:0.5,sourceOutSeconds:3.5},technical:{passed:true,details:{sha256:'a'.repeat(64)}},reason:'旧文件内容审核通过'};
 // Real duplicate ingestion reuses the first binding and may not copy its applicationKey onto the duplicate result.
 const duplicate={...structuredClone(first),id:'duplicate-result'};delete duplicate.applicationKey;
 const job=(id,results)=>({id,projectId:'p',shotId:'s',kind:'recognize',aiVideoCandidateId:candidate.id,aiVideoPromptVersion:1,status:'complete',results});
 const jobs=[job('duplicate-job',[duplicate]),job('first-job',[first])];
 return {candidate,binding,shot,document,first,duplicate,jobs,job,state(rows=jobs){return aiVideoCandidateState(document,shot,candidate,rows);},remove(){document.instances=[];binding.status='removed';first.state='ignored';document.productionPlan.dismissedResultIds.push(first.id);}};
}
test('two jobs sharing one instance show removed after UI deletion and replay of the first result',()=>{
 const f=fixture();assert.equal(f.state().state,'placed');f.remove();
 const view=f.state();assert.equal(view.state,'ignored');assert.equal(view.label,'已移除 · 保留项目素材');assert.equal(view.detail,undefined);
 assert.equal(f.jobs[0].results[0].state,'applied');assert.equal(f.jobs[0].results[0].applicationKey,undefined);
});
test('removed result identity also works when the latest duplicate carries the binding application key',()=>{
 const f=fixture();f.remove();f.duplicate.applicationKey=f.binding.applicationKey;
 assert.equal(f.state().label,'已移除 · 保留项目素材');
});
test('a new active upload and its failure override older removed history',()=>{
 const f=fixture();f.remove();
 for(const status of ['queued','running','cancelling'])assert.equal(f.state([{...f.job('new',[]),status},...f.jobs]).state,'verifying');
 for(const status of ['failed','interrupted']){const view=f.state([{...f.job('new',[]),status,error:'新文件解码失败'},...f.jobs]);assert.equal(view.state,'failed');assert.equal(view.detail,'新文件解码失败');}
});
test('new unmatched results or an empty completed new job are not hidden by previous removal',()=>{
 const f=fixture();f.remove();
 const next={...structuredClone(f.duplicate),id:'new-result',state:'pending',technical:{passed:true,details:{sha256:'b'.repeat(64)}},reason:'新文件没有可靠匹配'};
 const view=f.state([f.job('new',[next]),...f.jobs]);assert.equal(view.state,'unmatched');assert.equal(view.detail,next.reason);
 assert.equal(f.state([f.job('new-empty',[]),...f.jobs]).state,'unmatched');
});
test('a mixed upload reports the unmatched new file instead of the successful review of an old deleted duplicate',()=>{
 const f=fixture();f.remove();const next={...structuredClone(f.duplicate),id:'new-result',state:'pending',technical:{passed:true,details:{sha256:'b'.repeat(64)}},reason:'新文件没有可靠匹配'};
 const view=f.state([f.job('mixed',[f.duplicate,next]),...f.jobs]);assert.equal(view.state,'unmatched');assert.equal(view.detail,next.reason);
});
test('the same file at a different target or source window is a distinct new result',()=>{
 const f=fixture();f.remove();
 for(const patch of [{target:{rangeId:'new-range',startFrame:1500,durationFrames:90}},{media:{path:'/archive/same.mp4',sourceInSeconds:1,sourceOutSeconds:4}}]){
  const next={...structuredClone(f.duplicate),...patch,id:'new-use',state:'pending',reason:'新位置需要核验'};
  assert.equal(f.state([f.job('new-use',[next]),...f.jobs]).state,'unmatched');
 }
});
test('a later real instance still shows placed despite a deleted old implementation',()=>{
 const f=fixture();f.remove();f.document.instances.push({id:'new-instance'});f.shot.bindings.push({...f.binding,instanceId:'new-instance',resultId:'new-result',status:'current',applicationKey:'new-key'});
 assert.equal(f.state().state,'placed');assert.deepEqual(f.state().instanceIds,['new-instance']);
});
