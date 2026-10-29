import {aiVideoIdentity} from '../lib/production-plan-ai-video.mjs';
export function aiVideoPromptText(candidate){
 return [candidate.prompt,`画幅：${candidate.aspectRatio}；建议生成时长：${candidate.durationSeconds} 秒。`,...(candidate.references.length?['参考图上传顺序：',...candidate.references.map((ref,i)=>`图${i+1}：${ref.label}（${ref.purpose}）`)]:[])].join('\n\n');
}
// Duplicate jobs can reuse an existing binding without copying its applicationKey.
// Match the same verified implementation, never just a filename or candidate ID.
function mediaImplementation(result){
 const sha=result.technical?.details?.sha256,target=result.target,media=result.media;
 if(!/^[a-f0-9]{64}$/.test(sha??'')||!target||!Number.isInteger(target.startFrame)||!Number.isInteger(target.durationFrames)||!media||!Number.isFinite(media.sourceOutSeconds))return '';
 return JSON.stringify([sha,result.slotId,result.requirementVersion,target.startFrame,target.durationFrames,media.sourceInSeconds??0,media.sourceOutSeconds]);
}
export function aiVideoCandidateState(document,shot,candidate,jobs=[]){
 if(shot.cancelled||candidate.ignored)return {state:'ignored',label:'已忽略'};
 if(candidate.requirementVersion!==shot.requirementVersion)return {state:'stale',label:'需求已变化 · 待重新匹配'};
 if(!candidate.prompt?.trim())return {state:'preparing',label:'正在准备提示词'};
 if(candidate.references.some(r=>!r.path))return {state:'references',label:'待参考素材'};
 const bindings=(shot.bindings??[]).filter(b=>b.aiVideoCandidateId===candidate.id&&b.aiVideoPromptVersion===candidate.promptVersion);
 const live=bindings.filter(b=>b.status!=='removed'&&(document.instances??[]).some(i=>i.id===b.instanceId));
 if(live.length)return {state:'placed',label:'已入轨 · 待观看',instanceIds:live.map(b=>b.instanceId)};
 const relevant=jobs.filter(j=>j.projectId===document.id&&j.kind==='recognize'&&j.shotId===shot.id&&j.aiVideoCandidateId===candidate.id&&j.aiVideoPromptVersion===candidate.promptVersion);
 const removed=bindings.filter(b=>b.status==='removed'),removedIds=new Set(removed.map(b=>b.resultId)),removedKeys=new Set(removed.map(b=>b.applicationKey).filter(Boolean));
 const removedImplementations=new Set(relevant.flatMap(j=>j.results??[]).filter(r=>removedIds.has(r.id)||(r.applicationKey&&removedKeys.has(r.applicationKey))).map(mediaImplementation).filter(Boolean));
 const wasRemoved=r=>removedIds.has(r.id)||(r.applicationKey&&removedKeys.has(r.applicationKey))||removedImplementations.has(mediaImplementation(r));
 const removedState={state:'ignored',label:'已移除 · 保留项目素材'};
 const job=relevant[0];
 if(job){
  if(['queued','running','cancelling'].includes(job.status))return {state:'verifying',label:'正在核验生成结果'};
  if(['failed','interrupted'].includes(job.status))return {state:'failed',label:'核验失败',detail:job.error||job.stage};
  const results=(job.results??[]).filter(r=>r.aiVideoCandidateId===candidate.id&&r.aiVideoPromptVersion===candidate.promptVersion);
  if(job.status==='cancelled')return {state:'ignored',label:'已忽略 / 已取消'};
  const currentResults=results.filter(r=>!wasRemoved(r));
  if(results.length&&!currentResults.length)return removedState;
  if(currentResults.some(r=>r.state==='stale'||r.state==='conflict'))return {state:'stale',label:'待重新匹配',detail:currentResults.find(r=>r.reason)?.reason};
  if(currentResults.length&&currentResults.every(r=>r.state==='ignored'))return {state:'ignored',label:'已忽略 / 已取消'};
  if(['complete','partial','plan_only'].includes(job.status))return {state:'unmatched',label:'结果已入库 · 未匹配入轨',detail:currentResults.find(r=>r.state!=='ignored'&&r.reason)?.reason||'未找到可靠画面匹配；可更换生成结果后重试'};
 }
 if(removed.length)return removedState;
 return {state:'ready',label:'提示词已就绪 · 待生成结果'};
}
export async function recognizeAiVideoImport({expected,files,getDocument,getProjectId,startJob,rangeId}){
 const doc=getDocument();
 if(doc.id!==expected.projectId||getProjectId()!==expected.projectId)throw Error('工程已切换，素材保留在原项目；请在目标项目重试');
 const shot=doc.productionPlan?.shots.find(s=>s.id===expected.shotId),candidate=shot?.aiVideoCandidates?.find(c=>c.id===expected.candidate.id);
 if(!shot||shot.cancelled||shot.locked||candidate?.ignored||shot.requirementVersion!==expected.candidate.requirementVersion||aiVideoIdentity(candidate)!==aiVideoIdentity(expected.candidate))throw Error('提示词或当前段需求已变化，素材已保留；请按当前版本重新匹配');
 return startJob('recognize',{shotId:shot.id,aiVideoCandidateId:candidate.id,aiVideoPromptVersion:candidate.promptVersion,aiVideoCandidateIdentity:aiVideoIdentity(expected.candidate),...(rangeId?{rangeId}:{}),mediaIds:files.map(f=>f.id).filter(Boolean),mediaPaths:files.map(f=>f.path||f.stagedPath||f.publicPath).filter(Boolean)});
}
