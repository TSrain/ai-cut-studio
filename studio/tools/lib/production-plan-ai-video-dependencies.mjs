import {dependencyFingerprint,normalizePlan,planRanges} from './production-plan-model.mjs';
import {aiVideoSlotId} from './production-plan-ai-video.mjs';
const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
export function automaticAiVideoSlot(candidate,requirementVersion){
 return {id:aiVideoSlotId(candidate),type:'video',description:candidate.reason,requirementVersion,aiVideoOwner:{kind:'ai-video-slot-v1',candidateId:candidate.id}};
}
/** Read only the semantic and temporal inputs AI recognition actually used. */
export function captureAiVideoReadSet(document,request){
 const shot=normalizePlan(document.productionPlan).shots.find(s=>s.id===request.shotId);
 if(!shot)throw Error('AI video shot missing');
 const dependency=JSON.parse(dependencyFingerprint(document,shot.id));
 delete dependency.target;delete dependency.slots;
 const source=document.source;
 return JSON.parse(JSON.stringify({
  ...dependency,
  canvas:document.canvas,
  timing:shot.timing,
  canonicalRanges:planRanges(document).filter(r=>r.shotId===shot.id).map(({rangeId,startFrame,durationFrames})=>({rangeId,startFrame,durationFrames})),
  source:source?{path:source.path,publicPath:source.publicPath??null,startFrame:source.startFrame??0,durationFrames:source.durationFrames??null,clips:source.clips?.map(c=>({id:c.id,startFrame:c.startFrame,durationFrames:c.durationFrames,sourceInFrame:c.sourceInFrame,playbackRate:c.playbackRate??c.speed??1}))??null}:null,
  transcript:{sourceSrtPath:document.productionPlan?.sourceSrtPath??source?.sourceSrtPath??source?.cameraPlan?.sourceSrtPath??null,transcriptBinding:document.productionPlan?.transcriptBinding??null,sourceVersion:document.productionPlan?.sourceVersion??null},
  slots:shot.slots,
 }));
}
export function aiVideoReadSetMatches(snapshot,current){
 const before=snapshot.aiVideoReadSet;
 // Historical snapshots did not record a sufficiently narrow temporal read set.
 // A fresh retry captures one; never silently apply their old timing conclusion.
 if(!before)return false;
 const after=captureAiVideoReadSet(current,snapshot),shot=normalizePlan(current.productionPlan).shots.find(s=>s.id===snapshot.shotId);
 const baselineIds=new Set(before.slots.map(s=>s.id));
 after.slots=after.slots.filter(slot=>{
  if(baselineIds.has(slot.id))return true;
  const owner=slot.aiVideoOwner,candidate=shot.aiVideoCandidates.find(c=>c.id===owner?.candidateId);
  // Only exact host-owned additions are compatible. User edits, selected slots
  // already present at submission, reordering and arbitrary new slots still count.
  return !candidate||owner?.kind!=='ai-video-slot-v1'||canonical(slot)!==canonical(automaticAiVideoSlot(candidate,shot.requirementVersion));
 });
 return canonical(before)===canonical(after);
}
export function aiVideoPlacementFits(document,shotId,target,selectedRangeId){
 if(!target||!Number.isInteger(target.startFrame)||target.startFrame<0||!Number.isInteger(target.durationFrames)||target.durationFrames<=0)return false;
 if(selectedRangeId&&target.rangeId!==selectedRangeId)return false;
 return planRanges(document).some(r=>r.shotId===shotId&&(!target.rangeId||target.rangeId===r.rangeId)&&target.startFrame>=r.startFrame&&target.startFrame+target.durationFrames<=r.startFrame+r.durationFrames);
}
