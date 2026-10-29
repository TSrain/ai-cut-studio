import {invalidateRequirements} from "./production-plan-model.mjs";
import {createHash} from "node:crypto";
import {projectSourceRange,sourceSegments} from "../../templates/remotion-base/src/editor/clip-time.mjs";
import {withCameraClips} from "../../templates/remotion-base/src/editor/camera-clips.mjs";
// Only existing, bounded objects may be changed. Immutable before values make
// concurrent edits fail closed; durable applied/dismissed IDs make replay safe.
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fields={'camera-create':['clip'],shot:['visualRequirement','mediaDescription','rationale','animationNeed','expressionGoal','requiredInformation','relationships','comprehensionDifficulty','factBoundary'],instance:['props'],audio:['volume','muted','fadeInFrames','fadeOutFrames'],caption:['text'],camera:['zoom','in','hold','out','inEasing','outEasing','enabled']};
const protectedObject=o=>!o||o.locked===true||o.manual===true||o.userModified===true;
function shot(s,d){return d.productionPlan?.shots?.find(x=>x.id===s.shotId);}
function bounded(s,o,kind,d){
 const t=s.target;if(!t||protectedObject(o))return false;
 let start=o.startFrame,duration=o.durationFrames;
 if(kind==='camera'){
  if(protectedObject(d.source))return false;
  const fps=d.canvas.fps.num/d.canvas.fps.den;
  const sourceStart=(o.start??0)*fps+(d.source?.startFrame??0),sourceEnd=sourceStart+((o.in??0)+(o.hold??0)+(o.out??0))*fps;
  const ranges=projectSourceRange(d.source,sourceStart,sourceEnd,d.canvas.durationFrames??d.source.durationFrames??(t.startFrame+t.durationFrames));
  if(ranges.length!==1)return false;start=ranges[0].startFrame;duration=ranges[0].endFrame-start;
  if(Math.abs(duration-(sourceEnd-sourceStart))>1e-5)return false;
 }
 if(kind==='caption'){start=o.from??o.startFrame;duration=(o.endFrame??o.to??((o.startFrame??0)+(o.durationFrames??0)))-start;}
 return Number.isFinite(start)&&Number.isFinite(duration)&&duration>0&&start>=t.startFrame&&start+duration<=t.startFrame+t.durationFrames;
}
function locate(s,d,p){
 const selected=shot(s,d);if(!selected||selected.cancelled||protectedObject(selected))throw Error('Selected shot deleted or protected');
 if(p.entity==='camera-create'){
  if(p.id!==cameraCreationId(s)||protectedObject(d.source)||!creationAvailable(s,d)||d.source?.cameraPlan?.clipGroups?.some(x=>x.id===p.id)||!equal(d.source?.cameraPlan,s.document.source?.cameraPlan))throw Error('Camera creation source changed or protected');
  return {clip:null};
 }
 if(p.entity==='shot'){if(p.id!==s.shotId)throw Error('Cross-shot patch');return selected;}
 const collection=p.entity==='instance'?d.instances:p.entity==='audio'?d.audioClips:p.entity==='caption'?d.captions?.cues:p.entity==='camera'?d.source?.cameraPlan?.clipGroups:undefined;
 const object=collection?.find(x=>x.id===p.id);
 if(!bounded(s,object,p.entity,d))throw Error('Target deleted, protected, or outside selected shot range');
 if(p.entity==='instance'){
  const bound=selected.bindings?.some(x=>x.instanceId===p.id&&x.status!=='removed');
  const identity=object.props?.footageIdentity??object.props?.deliveryIdentity;
  const verified=identity&&typeof identity.resultId==='string'&&/^[a-f0-9]{64}$/.test(identity.applicationKey??'')&&d.productionPlan.appliedResultIds?.includes(identity.resultId)&&(!object.props?.footageIdentity||(typeof identity.candidateId==='string'&&typeof identity.placementId==='string'));
  if(!bound&&!verified)throw Error('Instance is not bound or verified for current source');
  if(!bound&&d.productionPlan.shots.some(x=>x.id!==s.shotId&&x.timing?.ranges?.some(r=>object.startFrame<r.startFrame+r.durationFrames&&object.startFrame+object.durationFrames>r.startFrame)))throw Error('Automatic media intersects another shot');
  if((protectedObject(d.tracks?.find(x=>x.id===object.trackId))||d.tracks?.find(x=>x.id===object.trackId)?.disabled))throw Error('Visual track protected');
  if(d.productionPlan.shots.some(x=>x.id!==s.shotId&&x.bindings?.some(b=>b.instanceId===p.id&&b.status!=='removed')))throw Error('Instance shared across shots');
 }
 if(p.entity==='audio'){
  if((protectedObject(d.audioTracks?.find(x=>x.id===object.trackId))||d.audioTracks?.find(x=>x.id===object.trackId)?.disabled))throw Error('Audio track protected');
  const baseline=d.styleReference?.allowedOverrides?.soundDesign?.baselines?.[object.id];
  if(!baseline||baseline!==digest(object))throw Error('Manual or unknown audio clip protected');
 }
 if(p.entity==='caption'&&(protectedObject(d.captions)||(object.initialText===undefined||object.text!==object.initialText)))throw Error('Captions protected');
 return object;
}
function creationAvailable(s,d){
 if(!d.source||protectedObject(d.source))return false;
 const t=s.target,total=d.canvas.durationFrames??d.source.durationFrames??(t.startFrame+t.durationFrames);
 const segments=sourceSegments(d.source,total).filter(c=>t.startFrame>=c.startFrame&&t.startFrame+t.durationFrames<=c.startFrame+c.durationFrames);
 if(segments.length!==1)return false;
 const c=segments[0],sourceStart=c.sourceInFrame+t.startFrame-c.startFrame,sourceEnd=sourceStart+t.durationFrames;
 const occurrences=projectSourceRange(d.source,sourceStart,sourceEnd,total);
 if(occurrences.length!==1)return false;
 const fps=d.canvas.fps.num/d.canvas.fps.den,start=(sourceStart-(d.source.startFrame??0))/fps,end=(sourceEnd-(d.source.startFrame??0))/fps;
 if(d.source.cameraPlan?.events?.length>1&&!d.source.cameraPlan?.clipGroups)return false;
 if(d.source.cameraPlan?.clipGroups?.some(g=>g.start<end&&g.start+g.in+g.hold+g.out>start))return false;
 return {startSeconds:start,endSeconds:end};
}
function cameraCreationId(s){return `revision-camera-${s.shotId}-${s.target?.rangeId??s.target?.startFrame}`;}
function cameraPlan(d){return (d.source.cameraPlan?.events?.length?d.source.cameraPlan:null)??{version:2,duration:(d.source.durationFrames??d.canvas.durationFrames)/(d.canvas.fps.num/d.canvas.fps.den),levels:{A:1,B:1.12,C:1.18},anchor:{x:.5,y:.5},events:[{at:0,to:'A',transition:'cut',purpose:'hook',cue:'开场',reason:'基础构图'}]};}
function safeValue(value,old){
 if(equal(value,old))return true;
 if(value===null||typeof value!=='object')return typeof value===typeof old&&!(typeof value==='number'&&!Number.isFinite(value));
 if(Array.isArray(value))return Array.isArray(old)&&value.length===old.length&&value.every((v,i)=>safeValue(v,old[i]));
 return old&&typeof old==='object'&&Object.keys(value).every(k=>Object.hasOwn(old,k)&&(equal(value[k],old[k])||!/(path|url|src|file|identity|reference)/i.test(k)&&safeValue(value[k],old[k])))&&Object.keys(old).every(k=>Object.hasOwn(value,k));
}
export function validateShotRevision(r,s){
 if(s.kind!=='revise'||r.kind!=='shot-revision'||r.shotId!==s.shotId||r.jobId!==s.jobId||r.projectId!==s.projectId||!equal(r.target,s.target))throw Error('Revision snapshot identity mismatch');
 if(typeof r.reason!=='string'||!r.reason.trim()||!Array.isArray(r.gaps)||!r.gaps.every(x=>typeof x==='string')||!Array.isArray(r.patches))throw Error('Invalid shot revision result');
 if(r.execution!==undefined&&(!r.execution||Object.keys(r.execution).some(k=>!['kind','instructions'].includes(k))||r.execution.kind!=='footage'||typeof r.execution.instructions!=='string'||!r.execution.instructions.trim()))throw Error('Invalid revision execution');
 const seen=new Set();
 for(const p of r.patches){
  if(!fields[p.entity]?.includes(p.field)||typeof p.id!=='string'||!Object.hasOwn(p,'before')||!Object.hasOwn(p,'after'))throw Error('Unsupported revision field');
  const key=`${p.entity}:${p.id}:${p.field}`;if(seen.has(key))throw Error('Duplicate patch');seen.add(key);
  const o=locate(s,s.document,p);if(!equal(o[p.field]??null,p.before))throw Error('Patch before does not match immutable snapshot');
  if(p.entity==='camera-create'){
   const allowed=['id','start','in','hold','out','zoom','enabled','name','inEasing','outEasing'];
   if(!p.after||typeof p.after!=='object'||Object.keys(p.after).some(k=>!allowed.includes(k))||p.after.id!==p.id||!bounded(s,p.after,'camera',s.document))throw Error('Invalid bounded camera creation');
   withCameraClips(cameraPlan(s.document),[...(s.document.source.cameraPlan?.clipGroups??[]),p.after]);
  } else if(p.entity==='shot'&&p.before===null){
   if(!(typeof p.after==='string'||Array.isArray(p.after)&&p.after.every(v=>typeof v==='string')))throw Error('Absent semantic field requires text or text list');
   if(p.field==='animationNeed'&&!['required','optional','none'].includes(p.after))throw Error('Invalid animationNeed');
  } else if(!safeValue(p.after,p.before))throw Error('Patch cannot introduce paths, structure, or incompatible values');
  if(p.entity==='audio'&&p.field==='volume'&&(p.after<0||p.after>2))throw Error('Invalid volume');
  if(['in','hold','out','fadeInFrames','fadeOutFrames'].includes(p.field)&&p.after<0)throw Error('Invalid duration');
 }
 return r;
}
export function applyShotRevision(r,s,current){
 validateShotRevision(r,s);
 if(current.productionPlan.appliedResultIds.includes(r.id)||current.productionPlan.dismissedResultIds.includes(r.id))return structuredClone(current);
 if(!equal([current.source?.path,current.source?.startFrame,current.source?.clips],[s.document.source?.path,s.document.source?.startFrame,s.document.source?.clips])||!equal(current.canvas,s.document.canvas))throw Error('Source or canvas changed');
 const baseline=shot(s,s.document),latest=shot(s,current);
 if(!latest||!equal(latest.timing,baseline.timing)||!equal(latest.narration,baseline.narration)||latest.requirementVersion!==baseline.requirementVersion)throw Error('Selected shot target changed');
 const next=structuredClone(current);
 for(const p of r.patches){const o=locate(s,next,p),base=locate(s,s.document,p);
  if(p.entity==='camera-create'){next.source.cameraPlan=withCameraClips(cameraPlan(next),[...(next.source.cameraPlan?.clipGroups??[]),structuredClone(p.after)]);continue;}
  if(p.entity!=='shot'&&!equal([o.startFrame,o.durationFrames,o.start,o.endFrame,o.trackId],[base.startFrame,base.durationFrames,base.start,base.endFrame,base.trackId]))throw Error('Concurrent target position edit');
  if(!equal(o[p.field]??null,p.before))throw Error('Concurrent target edit');o[p.field]=structuredClone(p.after);
  if(p.entity==='caption'&&o.initialText!==undefined)o.initialText=o.text;
  if(p.entity==='audio')next.styleReference.allowedOverrides.soundDesign.baselines[o.id]=digest(o);
  if(!bounded(s,o,p.entity,next)&&p.entity!=='shot')throw Error('Revision moved outside selected range');}
 if(r.patches.some(p=>p.entity==='camera')) next.source.cameraPlan=withCameraClips(next.source.cameraPlan,next.source.cameraPlan.clipGroups);
 if(r.patches.some(p=>p.entity==='shot'))invalidateRequirements(next.productionPlan,shot(s,next),baseline);
 next.productionPlan.appliedResultIds.push(r.id);next.productionPlan.revision=(next.productionPlan.revision??0)+1;
 return next;
}
export function revisionContext(s){
 const editable=[];
 const collections={shot:[shot(s,s.document)],instance:s.document.instances,audio:s.document.audioClips,caption:s.document.captions?.cues,camera:s.document.source?.cameraPlan?.clipGroups};
 for(const [entity,items] of Object.entries(collections))for(const o of items??[])for(const field of fields[entity]){
  if(!o||(entity!=='shot'&&!Object.hasOwn(o,field)))continue;
  try{locate(s,s.document,{entity,id:o.id,field});editable.push({entity,id:o.id,field,before:structuredClone(o[field]??null)});}catch{}
 }
 const cameraSourceInterval=creationAvailable(s,s.document);
 if(cameraSourceInterval){
  editable.push({entity:'camera-create',id:cameraCreationId(s),field:'clip',before:null});
 }
 return {document:s.document,target:s.target,shotId:s.shotId,editable,cameraSourceInterval:cameraSourceInterval||null,contextPaths:s.revisionContextPaths??{},contextGaps:s.revisionContextGaps??[]};
}
