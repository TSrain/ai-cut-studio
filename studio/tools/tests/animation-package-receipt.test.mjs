import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, readFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {finalizeAnimationReceipt} from '../lib/animation-package-receipt.mjs';
test('final summary reports actual instances and retains a single complete Claude block',()=>{
 const outputDir=mkdtempSync(join(tmpdir(),'animation-receipt-'));
 const planPath=join(outputDir,'plan.md'),text='# 总结\n\n原匹配内容\n\n## 给 Claude 的动画提示词\n\nSRT：/本地/原始.srt\n段落01：表达需求\n';
 writeFileSync(planPath,text);
 const manifest={workflowMode:'semantic-template-v1',outputs:{planPath},files:[{path:planPath,sha256:createHash('sha256').update(text).digest('hex')}]};
 const job={id:'j',projectId:'p',outputDir,status:'complete',results:[{id:'r',kind:'template',shotId:'s',template:{id:'word-cascade'},state:'applied'},{id:'r2',kind:'template',shotId:'s2',template:{id:'step-flow'},state:'pending',reason:'时长缺口'}]};
 const doc={id:'p',revision:4,instances:[{id:'i',startFrame:30,durationFrames:90}],productionPlan:{shots:[{id:'s',bindings:[{resultId:'r',instanceId:'i'}]}]}};
 const result=finalizeAnimationReceipt(job,doc,manifest);
 assert.equal(result.appliedTemplates,1);assert.equal(result.unappliedTemplates,1);
 assert.ok(existsSync(result.finalSummaryPath));
 const summary=readFileSync(result.finalSummaryPath,'utf8');
 assert.ok(summary.includes('实际已入轨模板：1'));assert.ok(summary.includes('尚未应用模板：1'));
 assert.ok(summary.endsWith(text.slice(text.indexOf('## 给 Claude'))));
 assert.equal(summary.split('## 给 Claude').length,2);
 assert.equal(readFileSync(planPath,'utf8'),text);
});
test('receipt refuses changed hashed summary and another project document',()=>{
 const outputDir=mkdtempSync(join(tmpdir(),'animation-receipt-')),planPath=join(outputDir,'plan.md');writeFileSync(planPath,'changed');
 const job={id:'j',projectId:'p',outputDir,results:[]};
 assert.throws(()=>finalizeAnimationReceipt(job,{id:'other'},{workflowMode:'semantic-template-v1',outputs:{planPath},files:[]}),/identity/);
 assert.throws(()=>finalizeAnimationReceipt(job,{id:'p'},{workflowMode:'semantic-template-v1',outputs:{planPath},files:[{path:planPath,sha256:'0'.repeat(64)}]}),/hash/);
});

test('deleted instance is never counted applied from an old result flag',()=>{
 const outputDir=mkdtempSync(join(tmpdir(),'animation-receipt-')),planPath=join(outputDir,'plan.md'),text='# 总结\n\n## 给 Claude 的动画提示词\n需求\n';writeFileSync(planPath,text);
 const manifest={workflowMode:'semantic-template-v1',outputs:{planPath},files:[{path:planPath,sha256:createHash('sha256').update(text).digest('hex')}]};
 const result=finalizeAnimationReceipt({id:'j',projectId:'p',outputDir,results:[{id:'r',kind:'template',shotId:'s',template:{id:'word-cascade'},state:'applied'}]}, {id:'p',revision:2,instances:[],productionPlan:{shots:[{id:'s',bindings:[{resultId:'r',instanceId:'deleted',status:'removed'}]}]}},manifest);
 assert.equal(result.appliedTemplates,0);assert.equal(result.unappliedTemplates,1);
});

 test('full package cannot finalize using templates alone',()=>{
 const outputDir=mkdtempSync(join(tmpdir(),'full-receipt-')),planPath=join(outputDir,'plan.md'),text='# 总结\n\n## 给 Claude 的动画提示词\n需求\n';writeFileSync(planPath,text);
 const manifest={workflowMode:'semantic-template-v1',fullPackageVersion:1,runId:'run',outputs:{planPath},files:[{path:planPath,sha256:createHash('sha256').update(text).digest('hex')}]};
 assert.throws(()=>finalizeAnimationReceipt({id:'j',projectId:'p',outputDir,results:[]},{id:'p',revision:1,instances:[],productionPlan:{shots:[]}},manifest),/complete|full|完整/i);
 });

test('full package validates seven actual branch receipts and reports later edits',()=>{
 const outputDir=mkdtempSync(join(tmpdir(),'full-package-')),planPath=join(outputDir,'plan.md'),analysisPath=join(outputDir,'analysis.json'),proof=join(outputDir,'proof.md'),text='# 总结\n\n## 给 Claude 的动画提示词\n需求\n';
 writeFileSync(planPath,text);writeFileSync(proof,'本轮复审');
 const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),file=p=>({path:p,sha256:sha(p)});
 const paths={},design={},files=[file(planPath)];writeFileSync(join(outputDir,'readback.json'),JSON.stringify({document:{id:'p',revision:3,canvas:{width:1080,height:1920},source:{cameraPlan:{value:1}},instances:[],productionPlan:{shots:[]}}}));
 for(const branch of ['scriptReview','rhythm','camera','captions','cover','sound','footage']){
  const path=join(outputDir,branch+'.json');paths[branch]=path;design[branch]={decision:'leave_blank',reason:'本轮复审留白'};
  const receipt={schemaVersion:1,branch,projectId:'p',runId:'run',status:'leave_blank',rationale:'本轮复审留白',files:[file(proof)],protected:[],acceptance:{technical:'passed',visual:'not_performed',listening:'not_performed'}};
  if(branch==='camera')receipt.engineering={snapshotPath:join(outputDir,'readback.json'),fields:[{pointer:'/source/cameraPlan',sha256:createHash('sha256').update('{"value":1}').digest('hex')}]};
  if(receipt.engineering)receipt.files.push(file(receipt.engineering.snapshotPath));writeFileSync(path,JSON.stringify(receipt));files.push(file(path));
 }
 const doc={id:'p',revision:3,canvas:{width:1080,height:1920},source:{cameraPlan:{value:1}},instances:[],productionPlan:{shots:[]}};writeFileSync(join(outputDir,'readback.json'),JSON.stringify({document:doc}));
 writeFileSync(analysisPath,JSON.stringify({projectId:'p',fullPackageVersion:1,runId:'run',productionReceiptPaths:paths,productionDesign:design,productionReadbackPath:join(outputDir,'readback.json')}));files.push(file(analysisPath),file(join(outputDir,'readback.json')));
 const manifest={workflowMode:'semantic-template-v1',fullPackageVersion:1,runId:'run',outputs:{planPath,semanticPackagePath:analysisPath},files};
 // Shared receipt checks now require v2 orchestration evidence even without an explicit version.
 const rows={};for(const id of ['templates','footage','aiVideo','camera','captions','cover','sound']){const path=join(outputDir,id+'-validation.json');writeFileSync(path,JSON.stringify({schemaVersion:1,projectId:'p',runId:'run',branchId:id,status:'passed',operations:[]}));manifest.files.push(file(path));rows[id]={status:'complete',validation:{status:'passed',receiptPath:path,receiptSha256:sha(path)},application:{status:'not_required'}};}
 const branchesPath=join(outputDir,'package-branches.json');writeFileSync(branchesPath,JSON.stringify({version:2,projectId:'p',runId:'run',branches:Object.fromEntries(Object.entries(rows).filter(([id])=>id!=='sound')),postStages:{sound:rows.sound}}));manifest.outputs.packageBranchesPath=branchesPath;manifest.files.push(file(branchesPath));
 const job={id:'j',projectId:'p',outputDir,results:[]};let result=finalizeAnimationReceipt(job,doc,manifest);assert.equal(result.fullPackageState,'complete');assert.equal(result.fullPackageBranches.length,7);
 doc.canvas.width=777;assert.throws(()=>finalizeAnimationReceipt(job,doc,manifest),/source|canvas|身份/i);doc.canvas.width=1080;
 doc.source.path='switched.mp4';assert.throws(()=>finalizeAnimationReceipt(job,doc,manifest),/source|canvas|身份/i);delete doc.source.path;
 doc.source.clips=[];assert.throws(()=>finalizeAnimationReceipt(job,doc,manifest),/source|canvas|身份/i);delete doc.source.clips;
 doc.source.cameraPlan.value=2;result=finalizeAnimationReceipt(job,doc,manifest);assert.equal(result.fullPackageState,'partial');assert.ok(readFileSync(result.finalSummaryPath,'utf8').includes('/source/cameraPlan'));
});
test('final receipt rejects unknown orchestration versions before accepting early evidence',()=>{const outputDir=mkdtempSync(join(tmpdir(),'v2-final-'));assert.throws(()=>finalizeAnimationReceipt({id:'j',projectId:'p',outputDir,results:[]},{id:'p'},{workflowMode:'semantic-template-v1',fullPackageVersion:1,packageOrchestrationVersion:3,outputs:{},files:[]}),/version|版本/)});
test('v2 final receipt cannot treat six proposal complete claims as applied',()=>{
 const outputDir=mkdtempSync(join(tmpdir(),'full-package-')),planPath=join(outputDir,'plan.md'),analysisPath=join(outputDir,'analysis.json'),proof=join(outputDir,'proof.md'),text='# 总结\n\n## 给 Claude 的动画提示词\n需求\n';
 writeFileSync(planPath,text);writeFileSync(proof,'本轮复审');
 const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),file=p=>({path:p,sha256:sha(p)});
 const paths={},design={},files=[file(planPath)];writeFileSync(join(outputDir,'readback.json'),JSON.stringify({document:{id:'p',revision:3,canvas:{width:1080,height:1920},source:{cameraPlan:{value:1}},instances:[],productionPlan:{shots:[]}}}));
 for(const branch of ['scriptReview','rhythm','camera','captions','cover','sound','footage']){
  const path=join(outputDir,branch+'.json');paths[branch]=path;design[branch]={decision:'leave_blank',reason:'本轮复审留白'};
  const receipt={schemaVersion:1,branch,projectId:'p',runId:'run',status:'leave_blank',rationale:'本轮复审留白',files:[file(proof)],protected:[],acceptance:{technical:'passed',visual:'not_performed',listening:'not_performed'}};
  if(branch==='camera')receipt.engineering={snapshotPath:join(outputDir,'readback.json'),fields:[{pointer:'/source/cameraPlan',sha256:createHash('sha256').update('{"value":1}').digest('hex')}]};
  if(receipt.engineering)receipt.files.push(file(receipt.engineering.snapshotPath));writeFileSync(path,JSON.stringify(receipt));files.push(file(path));
 }
 const doc={id:'p',revision:3,canvas:{width:1080,height:1920},source:{cameraPlan:{value:1}},instances:[],productionPlan:{shots:[]}};writeFileSync(join(outputDir,'readback.json'),JSON.stringify({document:doc}));
 writeFileSync(analysisPath,JSON.stringify({projectId:'p',fullPackageVersion:1,runId:'run',productionReceiptPaths:paths,productionDesign:design,productionReadbackPath:join(outputDir,'readback.json')}));files.push(file(analysisPath),file(join(outputDir,'readback.json')));
 const manifest={workflowMode:'semantic-template-v1',fullPackageVersion:1,runId:'run',outputs:{planPath,semanticPackagePath:analysisPath},files};
 const branchesPath=join(outputDir,'package-branches.json');writeFileSync(branchesPath,JSON.stringify({version:2,projectId:'p',runId:'run',branches:Object.fromEntries(['templates','footage','aiVideo','camera','captions','cover'].map(id=>[id,{status:'complete',validation:{status:'pending'},application:{status:'applied'}}]))}));manifest.packageOrchestrationVersion=2;manifest.outputs.packageBranchesPath=branchesPath;manifest.files.push(file(branchesPath));
 const result=finalizeAnimationReceipt({id:'j',projectId:'p',outputDir,results:[]},doc,manifest);assert.equal(result.fullPackageState,'partial');
});
test('v2 complete requires current bound branch validation plus seven production receipts',()=>{
 const outputDir=mkdtempSync(join(tmpdir(),'full-package-')),planPath=join(outputDir,'plan.md'),analysisPath=join(outputDir,'analysis.json'),proof=join(outputDir,'proof.md'),text='# 总结\n\n## 给 Claude 的动画提示词\n需求\n';
 writeFileSync(planPath,text);writeFileSync(proof,'本轮复审');
 const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),file=p=>({path:p,sha256:sha(p)});
 const paths={},design={},files=[file(planPath)];writeFileSync(join(outputDir,'readback.json'),JSON.stringify({document:{id:'p',revision:3,canvas:{width:1080,height:1920},source:{cameraPlan:{value:1}},instances:[],productionPlan:{shots:[]}}}));
 for(const branch of ['scriptReview','rhythm','camera','captions','cover','sound','footage']){
  const path=join(outputDir,branch+'.json');paths[branch]=path;design[branch]={decision:'leave_blank',reason:'本轮复审留白'};
  const receipt={schemaVersion:1,branch,projectId:'p',runId:'run',status:'leave_blank',rationale:'本轮复审留白',files:[file(proof)],protected:[],acceptance:{technical:'passed',visual:'not_performed',listening:'not_performed'}};
  if(branch==='camera')receipt.engineering={snapshotPath:join(outputDir,'readback.json'),fields:[{pointer:'/source/cameraPlan',sha256:createHash('sha256').update('{"value":1}').digest('hex')}]};
  if(receipt.engineering)receipt.files.push(file(receipt.engineering.snapshotPath));writeFileSync(path,JSON.stringify(receipt));files.push(file(path));
 }
 const doc={id:'p',revision:3,canvas:{width:1080,height:1920},source:{cameraPlan:{value:1}},instances:[],productionPlan:{shots:[]}};writeFileSync(join(outputDir,'readback.json'),JSON.stringify({document:doc}));
 writeFileSync(analysisPath,JSON.stringify({projectId:'p',fullPackageVersion:1,runId:'run',productionReceiptPaths:paths,productionDesign:design,productionReadbackPath:join(outputDir,'readback.json')}));files.push(file(analysisPath),file(join(outputDir,'readback.json')));
 const manifest={workflowMode:'semantic-template-v1',fullPackageVersion:1,runId:'run',outputs:{planPath,semanticPackagePath:analysisPath},files};
 const rows={};for(const id of ['templates','footage','aiVideo','camera','captions','cover','sound']){const path=join(outputDir,id+'-validation.json');writeFileSync(path,JSON.stringify({schemaVersion:1,projectId:'p',runId:'run',branchId:id,status:'passed',operations:[]}));manifest.files.push(file(path));rows[id]={status:'complete',validation:{status:'passed',receiptPath:path,receiptSha256:sha(path)},application:{status:'not_required'}};}
 const branchesPath=join(outputDir,'package-branches.json');writeFileSync(branchesPath,JSON.stringify({version:2,projectId:'p',runId:'run',branches:Object.fromEntries(Object.entries(rows).filter(([id])=>id!=='sound')),postStages:{sound:rows.sound}}));manifest.packageOrchestrationVersion=2;manifest.outputs.packageBranchesPath=branchesPath;manifest.files.push(file(branchesPath));
 const result=finalizeAnimationReceipt({id:'j',projectId:'p',outputDir,results:[]},doc,manifest);assert.equal(result.fullPackageState,'complete');
});
test('v2 live revalidated publication uses new operation identity bound to original proposal',()=>{
 const outputDir=mkdtempSync(join(tmpdir(),'full-package-')),planPath=join(outputDir,'plan.md'),analysisPath=join(outputDir,'analysis.json'),proof=join(outputDir,'proof.md'),text='# 总结\n\n## 给 Claude 的动画提示词\n需求\n';
 writeFileSync(planPath,text);writeFileSync(proof,'本轮复审');
 const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),file=p=>({path:p,sha256:sha(p)});
 const paths={},design={},files=[file(planPath)];writeFileSync(join(outputDir,'readback.json'),JSON.stringify({document:{id:'p',revision:3,canvas:{width:1080,height:1920},source:{cameraPlan:{value:1}},instances:[],productionPlan:{shots:[]}}}));
 for(const branch of ['scriptReview','rhythm','camera','captions','cover','sound','footage']){
  const path=join(outputDir,branch+'.json');paths[branch]=path;design[branch]={decision:'leave_blank',reason:'本轮复审留白'};
  const receipt={schemaVersion:1,branch,projectId:'p',runId:'run',status:'leave_blank',rationale:'本轮复审留白',files:[file(proof)],protected:[],acceptance:{technical:'passed',visual:'not_performed',listening:'not_performed'}};
  if(branch==='camera')receipt.engineering={snapshotPath:join(outputDir,'readback.json'),fields:[{pointer:'/source/cameraPlan',sha256:createHash('sha256').update('{"value":1}').digest('hex')}]};
  if(receipt.engineering)receipt.files.push(file(receipt.engineering.snapshotPath));writeFileSync(path,JSON.stringify(receipt));files.push(file(path));
 }
 const doc={id:'p',revision:3,canvas:{width:1080,height:1920},source:{cameraPlan:{value:1}},instances:[],productionPlan:{shots:[]}};writeFileSync(join(outputDir,'readback.json'),JSON.stringify({document:doc}));
 writeFileSync(analysisPath,JSON.stringify({projectId:'p',fullPackageVersion:1,runId:'run',productionReceiptPaths:paths,productionDesign:design,productionReadbackPath:join(outputDir,'readback.json')}));files.push(file(analysisPath),file(join(outputDir,'readback.json')));
 const manifest={workflowMode:'semantic-template-v1',fullPackageVersion:1,runId:'run',outputs:{planPath,semanticPackagePath:analysisPath},files};
 const rows={};for(const id of ['templates','footage','aiVideo','camera','captions','cover','sound']){const path=join(outputDir,id+'-validation.json');writeFileSync(path,JSON.stringify({schemaVersion:1,projectId:'p',runId:'run',branchId:id,status:'passed',operations:[]}));manifest.files.push(file(path));rows[id]={status:'complete',validation:{status:'passed',receiptPath:path,receiptSha256:sha(path)},application:{status:'not_required'}};}
 const originalPath=rows.templates.validation.receiptPath,original=JSON.parse(readFileSync(originalPath));original.operations=[{operationId:'old-snapshot-operation'}];original.proposalSha256='a'.repeat(64);original.resultSha256='b'.repeat(64);writeFileSync(originalPath,JSON.stringify(original));rows.templates.validation.receiptSha256=sha(originalPath);manifest.files.push(file(originalPath));
 const readbackPath=join(outputDir,'native-readback.json');writeFileSync(readbackPath,JSON.stringify({document:doc}));
 const actualOperation={operationId:'new-live-operation',projectId:'p',runId:'run',branchId:'templates'},operationPath=join(outputDir,'operation.json');writeFileSync(operationPath,JSON.stringify(actualOperation));
 const liveProof=join(outputDir,'live-validation.json');writeFileSync(liveProof,JSON.stringify({...original,operations:[actualOperation]}));
 const appPath=join(outputDir,'application.json');writeFileSync(appPath,JSON.stringify({projectId:'p',runId:'run',operationId:actualOperation.operationId,status:'applied',readbackPath,readbackSha256:sha(readbackPath)}));
 const journalPath=join(outputDir,'journal.json');writeFileSync(journalPath,JSON.stringify({projectId:'p',runId:'run',operations:[{operation:actualOperation,status:'applied',receiptPath:appPath,receiptSha256:sha(appPath)}]}));manifest.outputs.packageApplicationJournalPath=journalPath;manifest.files.push(...[readbackPath,operationPath,liveProof,appPath,journalPath].map(file));
 rows.templates.application={status:'applied'};rows.templates.publications=[{operationPath,operationSha256:sha(operationPath),validationReceiptPath:liveProof,validationReceiptSha256:sha(liveProof)}];doc.productionPlan.changes=[{id:actualOperation.operationId,type:'package-branch-application'}];
 const branchesPath=join(outputDir,'package-branches.json');writeFileSync(branchesPath,JSON.stringify({version:2,projectId:'p',runId:'run',branches:Object.fromEntries(Object.entries(rows).filter(([id])=>id!=='sound')),postStages:{sound:rows.sound}}));manifest.packageOrchestrationVersion=2;manifest.outputs.packageBranchesPath=branchesPath;manifest.files.push(file(branchesPath));
 const result=finalizeAnimationReceipt({id:'j',projectId:'p',outputDir,results:[]},doc,manifest);assert.equal(result.fullPackageState,'complete');
});
test('frozen BGM-enabled v2 requires seven proposal branches while legacy six stays compatible',()=>{
 const outputDir=mkdtempSync(join(tmpdir(),'full-package-')),planPath=join(outputDir,'plan.md'),analysisPath=join(outputDir,'analysis.json'),proof=join(outputDir,'proof.md'),text='# 总结\n\n## 给 Claude 的动画提示词\n需求\n';
 writeFileSync(planPath,text);writeFileSync(proof,'本轮复审');
 const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),file=p=>({path:p,sha256:sha(p)});
 const paths={},design={},files=[file(planPath)];writeFileSync(join(outputDir,'readback.json'),JSON.stringify({document:{id:'p',revision:3,canvas:{width:1080,height:1920},source:{cameraPlan:{value:1}},instances:[],productionPlan:{shots:[]}}}));
 for(const branch of ['scriptReview','rhythm','camera','captions','cover','sound','footage']){
  const path=join(outputDir,branch+'.json');paths[branch]=path;design[branch]={decision:'leave_blank',reason:'本轮复审留白'};
  const receipt={schemaVersion:1,branch,projectId:'p',runId:'run',status:'leave_blank',rationale:'本轮复审留白',files:[file(proof)],protected:[],acceptance:{technical:'passed',visual:'not_performed',listening:'not_performed'}};
  if(branch==='camera')receipt.engineering={snapshotPath:join(outputDir,'readback.json'),fields:[{pointer:'/source/cameraPlan',sha256:createHash('sha256').update('{"value":1}').digest('hex')}]};
  if(receipt.engineering)receipt.files.push(file(receipt.engineering.snapshotPath));writeFileSync(path,JSON.stringify(receipt));files.push(file(path));
 }
 const doc={id:'p',revision:3,canvas:{width:1080,height:1920},source:{cameraPlan:{value:1}},instances:[],productionPlan:{shots:[]}};writeFileSync(join(outputDir,'readback.json'),JSON.stringify({document:doc}));
 writeFileSync(analysisPath,JSON.stringify({projectId:'p',fullPackageVersion:1,runId:'run',productionReceiptPaths:paths,productionDesign:design,productionReadbackPath:join(outputDir,'readback.json')}));files.push(file(analysisPath),file(join(outputDir,'readback.json')));
 const manifest={workflowMode:'semantic-template-v1',fullPackageVersion:1,runId:'run',outputs:{planPath,semanticPackagePath:analysisPath},files};
 const rows={};for(const id of ['templates','footage','aiVideo','camera','captions','cover','sound']){const path=join(outputDir,id+'-validation.json');writeFileSync(path,JSON.stringify({schemaVersion:1,projectId:'p',runId:'run',branchId:id,status:'passed',operations:[]}));manifest.files.push(file(path));rows[id]={status:'complete',validation:{status:'passed',receiptPath:path,receiptSha256:sha(path)},application:{status:'not_required'}};}
 const branchesPath=join(outputDir,'package-branches.json');writeFileSync(branchesPath,JSON.stringify({version:2,projectId:'p',runId:'run',branches:Object.fromEntries(Object.entries(rows).filter(([id])=>id!=='sound')),postStages:{sound:rows.sound}}));manifest.packageOrchestrationVersion=2;manifest.outputs.packageBranchesPath=branchesPath;manifest.files.push(file(branchesPath));
 const snapshotPath=join(outputDir,'snapshot.json');writeFileSync(snapshotPath,JSON.stringify({bgmPlanVersion:1,packageOrchestrationVersion:2,scope:{}}));const job={id:'j',projectId:'p',outputDir,results:[],snapshotPath,snapshotHash:sha(snapshotPath)};
 assert.throws(()=>finalizeAnimationReceipt(job,doc,manifest),/core|BGM|branch/i);
 const bgmProof=join(outputDir,'bgm-validation.json');writeFileSync(bgmProof,JSON.stringify({schemaVersion:1,projectId:'p',runId:'run',branchId:'bgm',status:'passed',operations:[]}));const state=JSON.parse(readFileSync(branchesPath));state.branches.bgm={status:'complete',validation:{status:'passed',receiptPath:bgmProof,receiptSha256:sha(bgmProof)},application:{status:'not_required'}};writeFileSync(branchesPath,JSON.stringify(state));manifest.files.push(file(bgmProof),file(branchesPath));
 assert.equal(finalizeAnimationReceipt(job,doc,manifest).fullPackageState,'complete');
 writeFileSync(snapshotPath,JSON.stringify({bgmPlanVersion:1,bgmExecutionVersion:1,packageOrchestrationVersion:2,scope:{}}));job.snapshotHash=sha(snapshotPath);
 assert.equal(finalizeAnimationReceipt(job,doc,manifest).fullPackageState,'partial','new execution cannot complete from a plan-only not_required claim');
 doc.productionPlan.bgmExecution={version:1,runId:'run',status:'applied',gaps:[],clipIds:['missing']};
 assert.equal(finalizeAnimationReceipt(job,doc,manifest).fullPackageBranches.find(row=>row.branch==='bgm').status,'stale','summary must not repeat an old applied flag after audio disappears');
});
