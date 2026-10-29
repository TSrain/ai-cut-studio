import {isPackageBgmApplied} from './package-bgm-execution.mjs';
import {resolvePackageOrchestrationVersion} from './package-orchestration-version.mjs';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, realpathSync, existsSync} from 'node:fs';
import {join, relative, resolve, isAbsolute} from 'node:path';

const fullBranches=['scriptReview','rhythm','camera','captions','cover','sound','footage'];
const fullLabels=['脚本审阅','节奏与留白','镜头推拉','字幕','封面与标题','声音','真实素材'];
const hashFile=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const sortJson=v=>Array.isArray(v)?v.map(sortJson):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sortJson(v[k])])):v;
const hashJson=v=>createHash('sha256').update(JSON.stringify(sortJson(v))??'null').digest('hex');
const operationContent=v=>{const value={...v};delete value.validationReceiptPath;delete value.validationReceiptSha256;return value;};
function receiptSnapshot(job,manifest){
 resolvePackageOrchestrationVersion(manifest.packageOrchestrationVersion);
 const snapshot=job.snapshotPath&&job.snapshotHash===hashFile(job.snapshotPath)?JSON.parse(readFileSync(job.snapshotPath,'utf8')):null;
 resolvePackageOrchestrationVersion(snapshot?snapshot.packageOrchestrationVersion:job.packageOrchestrationVersion);
 return snapshot;
}
export function verifyCompletePackageReceipt(job,document,manifest){
 const snapshot=receiptSnapshot(job,manifest);
 if(manifest.fullPackageVersion!==1)return null;
 const root=realpathSync(job.outputDir);
 function bound(path){
  if(typeof path!=='string'||!existsSync(path))throw new Error('完整package缺已绑定回执文件');
  const real=realpathSync(path),rel=relative(root,real);
  if(rel.startsWith('..')||isAbsolute(rel)||!manifest.files?.some(f=>existsSync(f.path)&&realpathSync(f.path)===real&&f.sha256===hashFile(real)))throw new Error('完整package回执文件/hash/输出目录不一致');
  return JSON.parse(readFileSync(real,'utf8'));
 }
 let orchestrationReady=true,bgmStatus=null;
 const state=bound(manifest.outputs.packageBranchesPath);
 if(state.version!==2||state.projectId!==document.id||state.runId!==manifest.runId)throw Error('v2 package branch state identity mismatch');
 const core=['templates','footage','aiVideo','camera','captions','cover',...(snapshot?.bgmPlanVersion===1?['bgm']:[])];
 if(!state.branches||Object.keys(state.branches).sort().join(',')!==core.slice().sort().join(','))throw Error('v2 requires exact frozen core branches including enabled BGM');
 const scope=snapshot?.scope??{};
 let journal;
 const inspect=(id,row)=>{
  if(row?.status==='skipped')return scope[id]===false;
  if(row?.status!=='complete'||row.validation?.status!=='passed')return false;
  const validation=bound(row.validation.receiptPath);
  if(hashFile(row.validation.receiptPath)!==(row.validation.receiptSha256??row.validation.sha256))return false;
  if(validation.status!=='passed'||validation.projectId!==document.id||validation.runId!==manifest.runId||validation.branchId!==id)return false;
  if(row.application?.status==='not_required')return !(id==='bgm'&&snapshot?.bgmExecutionVersion===1)&&!(validation.operations?.length);
  if(!['applied','preserved_manual'].includes(row.application?.status))return false;
  journal??=bound(manifest.outputs.packageApplicationJournalPath??join(root,'application-queue','journal.json'));
  if(journal.projectId!==document.id||journal.runId!==manifest.runId)return false;
  const operations=validation.operations??[],publications=row.publications??[];
  if(!operations.length||publications.length!==operations.length)return false;
  return publications.every(publication=>{
   const op=bound(publication.operationPath),live=bound(publication.validationReceiptPath);
   if(hashFile(publication.operationPath)!==publication.operationSha256||hashFile(publication.validationReceiptPath)!==publication.validationReceiptSha256||op.projectId!==document.id||op.runId!==manifest.runId||op.branchId!==id)return false;
   if(live.status!=='passed'||live.projectId!==document.id||live.runId!==manifest.runId||live.branchId!==id||live.proposalSha256!==validation.proposalSha256||live.resultSha256!==validation.resultSha256||!(live.operations??[]).some(x=>x.operationId===op.operationId&&hashJson(operationContent(x))===hashJson(operationContent(op))))return false;
   const actual=journal.operations?.find(x=>x.operation?.operationId===op.operationId&&x.operation.branchId===id);
   if(!actual||!['applied','preserved_manual'].includes(actual.status))return false;
   const receipt=bound(actual.receiptPath);
   if(hashFile(actual.receiptPath)!==actual.receiptSha256||!receipt.readbackPath)return false;
   bound(receipt.readbackPath);
   if(hashFile(receipt.readbackPath)!==receipt.readbackSha256)return false;
   return receipt.operationId===op.operationId&&receipt.projectId===document.id&&receipt.runId===manifest.runId&&receipt.status===actual.status&&(document.productionPlan?.changes??[]).some(c=>c.id===op.operationId&&c.type==='package-branch-application');
  });
 };
 orchestrationReady=core.every(id=>inspect(id,state.branches[id]));
 if(snapshot?.bgmExecutionVersion===1&&scope.bgm!==false){
  const ready=isPackageBgmApplied(document,manifest.runId),execution=document.productionPlan?.bgmExecution;
  if(!ready)orchestrationReady=false;
  bgmStatus={status:ready?'applied':execution?.runId===manifest.runId?(execution.status==='applied'?'stale':execution.status):'missing',gaps:execution?.gaps??[],clipIds:execution?.clipIds??[]};
 }
 if(scope.sound!==false)orchestrationReady=!!state.postStages?.sound&&inspect('sound',state.postStages.sound)&&orchestrationReady;
 const analysis=bound(manifest.outputs.semanticPackagePath);
 if(analysis.fullPackageVersion!==1||analysis.runId!==manifest.runId||analysis.projectId!==document.id)throw new Error('完整package本轮身份不一致');
 let expected;
 if(analysis.productionReadbackPath){const readback=bound(analysis.productionReadbackPath);expected=readback.document??readback;}
 else if(job.snapshotPath&&job.snapshotHash===hashFile(job.snapshotPath)){expected=JSON.parse(readFileSync(job.snapshotPath,'utf8')).document;}
 if(!expected)throw new Error('完整package缺已绑定源/画布回读');
 const identity=s=>{const value=structuredClone(s);if(value)delete value.cameraPlan;return value;};
 if(hashJson(expected.canvas)!==hashJson(document.canvas)||hashJson(identity(expected.source))!==hashJson(identity(document.source)))throw new Error('完整package source/canvas身份变化');
 const rows=[];
 for(let i=0;i<fullBranches.length;i++){
  const branch=fullBranches[i],r=bound(analysis.productionReceiptPaths?.[branch]);
  if(r.schemaVersion!==1||r.branch!==branch||r.projectId!==document.id||r.runId!==manifest.runId||r.status!==analysis.productionDesign?.[branch]?.decision||!['executed','leave_blank','preserved_manual','blocked','skipped'].includes(r.status))throw new Error('完整package职责回执缺失或不一致 '+branch);
  if(!r.files?.length||r.files.some(f=>!existsSync(f.path)||hashFile(f.path)!==f.sha256))throw new Error('完整package实际产物/hash已变 '+branch);
  const changed=[];
  if(r.engineering){
   for(const field of r.engineering.fields??[]){
    let value=document;try{for(const key of field.pointer.slice(1).split('/'))value=value[key.replace(/~1/g,'/').replace(/~0/g,'~')];if(hashJson(value)!==field.sha256)changed.push(field.pointer)}catch{changed.push(field.pointer)}
   }
   if(!r.files.some(f=>existsSync(f.path)&&realpathSync(f.path)===realpathSync(r.engineering.snapshotPath)&&f.sha256===hashFile(r.engineering.snapshotPath)))throw new Error('完整package工程回读快照缺固定SHA');
   const snap=JSON.parse(readFileSync(r.engineering.snapshotPath,'utf8'));const old=snap.document??snap;
   for(const id of r.engineering.instanceIds??[]){if(hashJson(document.instances.find(x=>x.id===id))!==hashJson(old.instances.find(x=>x.id===id)))changed.push(id)}
  }
  rows.push({branch,label:fullLabels[i],status:r.status,rationale:r.rationale,changed,protected:r.protected,acceptance:r.acceptance});
 }
 if(bgmStatus)rows.push({branch:'bgm',label:'自动配乐',status:bgmStatus.status,rationale:bgmStatus.gaps.join('；'),changed:bgmStatus.status==='applied'?[]:[bgmStatus.status==='protected'?'现有配乐已保护，本轮未覆盖':bgmStatus.gaps.join('；')||'缺少当前工程中的完整配乐应用'],acceptance:{listening:'not_performed'}});
 return {rows,state:!orchestrationReady||rows.some(r=>r.status==='blocked'||r.changed.length)?'partial':'complete',block:['## 完整package工程回读','',`本轮：${manifest.runId}；工程保存版本：${document.revision}。`,'| 职责 | 本轮结果 | 保存后差异 |','| --- | --- | --- |',...rows.map(r=>`| ${r.label} | ${r.status} | ${r.changed.length?r.changed.join('；'):'回执与当前工程一致'} |`),'','本轮执行与技术回读不代替全片连续观看和声音听审；手调保护及缺口见各支线。',''].join('\n')};
}

/** Derive a user summary from saved instances without editing hashed worker artifacts. */
export function finalizeAnimationReceipt(job, document, manifest) {
  if (document.id !== job.projectId) throw new Error('Animation receipt project identity mismatch');
  if (manifest.workflowMode !== 'semantic-template-v1') return {};
  receiptSnapshot(job,manifest);
  const original=realpathSync(manifest.outputs.planPath), root=realpathSync(job.outputDir), rel=relative(root,original);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Animation summary escapes output directory');
  const complete=verifyCompletePackageReceipt(job,document,manifest);
  const text=readFileSync(original,'utf8'), sha=createHash('sha256').update(text).digest('hex');
  if (!manifest.files.some(f=>realpathSync(f.path)===original && f.sha256===sha)) throw new Error('Animation summary hash mismatch');
  const bindings=(document.productionPlan?.shots??[]).flatMap(s=>(s.bindings??[]).map(b=>({...b,shotId:s.id})));
  const dismissed=new Set(document.productionPlan?.dismissedResultIds??[]);
  const templates=(job.results??[]).filter(r=>r.kind==='template' && r.state!=='ignored' && !dismissed.has(r.id));
  const rows=templates.map(result=>{
    const binding=bindings.find(b=>b.resultId===result.id || (result.applicationKey && b.applicationKey===result.applicationKey));
    const instance=binding?.status !== 'removed' && binding && document.instances.find(i=>i.id===binding.instanceId);
    return {shotId:result.shotId,presetId:result.template.id,resultId:result.id,instanceId:instance?.id,
      state:instance && result.state==='applied' ? 'applied' : result.state==='applied' ? 'removed' : result.state,
      startFrame:instance?.startFrame,durationFrames:instance?.durationFrames,reason:result.reason};
  });
  const applied=rows.filter(r=>r.state==='applied').length, missing=rows.length-applied;
  const block=['## 工程保存回读结果','',`工程：${document.id}；已保存版本：${document.revision}。`,
    `实际已入轨模板：${applied}。尚未应用模板：${missing}。`,
    '原素材和原模板保留；已入轨不代表用户最终采用，也不代表整片动态或声音验收通过。','',
    '| 计划段落 | 模板 | 状态 | 工程位置 |','| --- | --- | --- | --- |',
    ...rows.map(r=>`| ${r.shotId} | ${r.presetId} | ${r.state==='applied'?'已入轨':r.state} | ${r.state==='applied'?`${r.startFrame} 帧起 / ${r.durationFrames} 帧`:'未应用，见匹配记录'} |`),''].join('\n');
  const marker='## 给 Claude 的动画提示词',at=text.indexOf(marker);
  if(at<0) throw new Error('Animation summary missing Claude prompt');
  const finalText=text.slice(0,at)+(complete?.block??'')+'\n'+block+'\n'+text.slice(at);
  const finalSummaryPath=join(root,'最终package总结.md'),receiptPath=join(root,'工程应用回执.json');
  writeFileSync(finalSummaryPath,finalText,'utf8');
  writeFileSync(receiptPath,JSON.stringify({version:1,projectId:document.id,revision:document.revision,jobId:job.id,sourceSummarySha256:sha,appliedTemplates:applied,unappliedTemplates:missing,rows},null,2)+'\n');
  return {finalSummaryPath,applicationReceiptPath:receiptPath,appliedTemplates:applied,unappliedTemplates:missing,...(complete?{fullPackageState:complete.state,fullPackageBranches:complete.rows}: {})};
}
