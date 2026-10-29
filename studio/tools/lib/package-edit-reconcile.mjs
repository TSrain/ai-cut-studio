/** Pure three-way package publication against edits to the same original recording. */
import {isDeepStrictEqual as equal} from 'node:util';
const clone=x=>x===undefined?undefined:structuredClone(x);
const fail=message=>{throw Error(`Package reconciliation: ${message}`);};
const identity=s=>Object.fromEntries(Object.entries(s??{}).filter(([k])=>!['clips','startFrame','locked','hidden','muted','volume','cameraPlan'].includes(k)));
function clips(d){const s=d.source??{};return s.clips??[{startFrame:0,sourceInFrame:s.startFrame??0,durationFrames:d.canvas?.durationFrames}];}
export function inspectPackageEdits(base,current){
 if(!base.source?.clips&&!current.source?.clips&&(base.source?.startFrame??0)!==(current.source?.startFrame??0))fail('source origin changed; create a new baseline');
 if(!equal(identity(base.source),identity(current.source)))fail('original source identity changed; create a new package baseline');
 for(const k of ['fps','width','height'])if(!equal(base.canvas?.[k],current.canvas?.[k]))fail(`canvas ${k} changed; create a new baseline`);
 for(const d of [base,current]){let projectEnd=0,sourceEnd=0;for(const c of clips(d)){
  if([d.source,c].some(x=>['speed','playbackRate','rate'].some(k=>x?.[k]!==undefined&&x[k]!==1)))fail('source speed changes are unsupported');
  if(![c.startFrame,c.sourceInFrame,c.durationFrames].every(Number.isSafeInteger)||c.durationFrames<=0||c.startFrame<projectEnd||c.sourceInFrame<sourceEnd)fail('source clips must be chronological, non-overlapping, unit-speed intervals');
  projectEnd=c.startFrame+c.durationFrames;sourceEnd=c.sourceInFrame+c.durationFrames;
 }}
 for(const k of ['requirementVersion','semanticVersion'])if(!equal(base.productionPlan?.[k],current.productionPlan?.[k]))fail(`semantic ${k} changed; regenerate proposals from the current plan`);
 const shots=new Map((current.productionPlan?.shots??[]).map(s=>[s.id,s]));
 for(const shot of base.productionPlan?.shots??[])if(shots.has(shot.id)&&!equal(shot.requirementVersion,shots.get(shot.id).requirementVersion))fail(`semantic requirement for shot ${shot.id} changed; regenerate this proposal`);
 return {safe:true,sourceEdited:!equal(base.source,current.source)||!equal(base.canvas,current.canvas)};
}
function mapper(base,current){return (start,duration)=>{const out=[];for(const b of clips(base)){
 const a=Math.max(start,b.startFrame),z=Math.min(start+duration,b.startFrame+b.durationFrames);if(z<=a)continue;
 const src=b.sourceInFrame+a-b.startFrame;
 for(const c of clips(current)){const p=Math.max(src,c.sourceInFrame),q=Math.min(src+z-a,c.sourceInFrame+c.durationFrames);if(q>p)out.push({startFrame:c.startFrame+p-c.sourceInFrame,durationFrames:q-p,offset:a-start+p-src});}
 }const merged=[];for(const p of out.sort((a,b)=>a.startFrame-b.startFrame)){const previous=merged.at(-1);if(previous&&previous.startFrame+previous.durationFrames===p.startFrame&&previous.offset+previous.durationFrames===p.offset)previous.durationFrames+=p.durationFrames;else merged.push({...p});}return merged;};}
function mappedDocument(d,map){const out=clone(d);const mappings=new Map();
 const list=(items,kind)=> (items??[]).flatMap(x=>{
 if(!Number.isFinite(x.startFrame))return [clone(x)];
 const duration=kind==='caption'?x.endFrame-x.startFrame:x.durationFrames;if(!Number.isFinite(duration))return [clone(x)];
 const parts=map(x.startFrame,duration).map((p,i)=>{const y={...clone(x),...(i&&x.id?{id:`${x.id}-ripple-${x.startFrame+p.offset}`}:{}) ,startFrame:p.startFrame};
 if(kind==='caption')y.endFrame=p.startFrame+p.durationFrames;else y.durationFrames=p.durationFrames;
 if(kind==='visual'&&(p.offset||p.durationFrames!==duration)){y.sourceOffsetFrames=(x.sourceOffsetFrames??0)+p.offset;y.sourceDurationFrames=x.sourceDurationFrames??duration;}
 if(kind==='audio'&&(p.offset||p.durationFrames!==duration)){y.sourceInFrame=(x.sourceInFrame??0)+p.offset;y.envelopeOffsetFrames=(x.envelopeOffsetFrames??0)+p.offset;y.envelopeDurationFrames=x.envelopeDurationFrames??duration;}
 return y;});if(kind==='visual')mappings.set(x.id,parts);return parts;});
 if(d.instances)out.instances=list(d.instances,'visual');if(d.audioClips)out.audioClips=list(d.audioClips,'audio');if(d.captions)out.captions.cues=list(d.captions.cues,'caption');
 if(d.productionPlan)for(const s of out.productionPlan.shots??[]){const hadRanges=Boolean(s.timing?.ranges?.length);if(s.timing?.ranges)s.timing.ranges=list(s.timing.ranges,'range');if(hadRanges&&!s.timing.ranges.length){s.status='cancelled';s.cancelled=true;s.timing.status='unaligned';s.bindings=[];continue;}s.bindings=(s.bindings??[]).flatMap(b=>{if(!mappings.has(b.instanceId))return list([b],'range');return mappings.get(b.instanceId).map((i,n)=>({...b,...(n?{id:`${b.id}-package-${i.startFrame}`} :{}),instanceId:i.id,startFrame:i.startFrame,durationFrames:i.durationFrames,...(Number.isFinite(b.sourceInSeconds)?{sourceInSeconds:b.sourceInSeconds+((i.sourceOffsetFrames??0)-(d.instances?.find(x=>x.id===b.instanceId)?.sourceOffsetFrames??0))/(baseFps(d)),...(Number.isFinite(b.sourceOutSeconds)?{sourceOutSeconds:b.sourceInSeconds+((i.sourceOffsetFrames??0)-(d.instances?.find(x=>x.id===b.instanceId)?.sourceOffsetFrames??0)+i.durationFrames)/baseFps(d)}:{})}:{})}));});}
 // Camera anchors are original-source time and intentionally are not visited.
 return out;
}
const baseFps=d=>typeof d.canvas.fps==='number'?d.canvas.fps:d.canvas.fps.num/d.canvas.fps.den;
const at=(o,path)=>path.reduce((v,k)=>v?.[k],o);
function set(o,path,v){let t=o;for(const k of path.slice(0,-1))t=t[k]??={};if(v===undefined)delete t[path.at(-1)];else t[path.at(-1)]=v;}
export function reconcilePackageDocument(base,proposed,current,{kind,writeSet=[],acceptedCaptionDocuments=[]}={}){
 const inspection=inspectPackageEdits(base,current),map=mapper(base,current),b=mappedDocument(base,map),p=mappedDocument(proposed,map),document=clone(current);
 const currentShots=new Map((current.productionPlan?.shots??[]).map(s=>[s.id,s]));
 const baseShotIds=new Set((base.productionPlan?.shots??[]).map(s=>s.id));
 const blockedShotIds=new Set((p.productionPlan?.shots??[]).filter(s=>s.cancelled||currentShots.get(s.id)?.cancelled||baseShotIds.has(s.id)&&!currentShots.has(s.id)).map(s=>s.id));
 const blockedInstanceIds=new Set((p.productionPlan?.shots??[]).filter(s=>blockedShotIds.has(s.id)).flatMap(s=>(s.bindings??[]).map(b=>b.instanceId)));
 const report={status:'unchanged',kind, ...inspection,protectedPaths:[],needsReview:[],discardedIds:[]};
 const protectedTracks=new Set([...(current.tracks??[]),...(current.audioTracks??[])].filter(t=>t.locked||t.hidden||t.disabled).map(t=>t.id));
 const currentCues=new Map((current.captions?.cues??[]).map(c=>[c.id,c]));
 const trustedCues=acceptedCaptionDocuments.flatMap(d=>{inspectPackageEdits(d,current);return mappedDocument(d,mapper(d,current)).captions?.cues??[];});
 const overlaps=(a,b)=>a.startFrame<b.endFrame&&a.endFrame>b.startFrame;
 const sameCue=(a,b)=>a.id===b.id&&a.text===b.text;
 // A proven resegmentation replaces old cue IDs in its covered intervals.
 // Compare both additions and deletions against that accepted text, so later
 // edits to new IDs cannot disappear from the semantic-conflict check.
 const expectedCues=[...(b.captions?.cues??[]).filter(c=>!trustedCues.some(t=>overlaps(c,t))),...trustedCues];
 const changedCues=[...(current.captions?.cues??[]).filter(c=>!expectedCues.some(e=>sameCue(c,e))),...expectedCues.filter(c=>!Array.from(currentCues.values()).some(n=>sameCue(c,n)))];
 const captionConflict=x=>{const ranges=x.timing?.ranges??(Number.isFinite(x.startFrame)?[x]:[]);return ranges.some(r=>changedCues.some(c=>r.startFrame<c.endFrame&&r.startFrame+(r.durationFrames??r.endFrame-r.startFrame)>c.startFrame));};
 function merge(old,next,now,path){
  if(equal(old,next))return clone(now);
  if(now?.cancelled||now?.locked||now?.hidden||now?.disabled||protectedTracks.has(now?.trackId)){report.protectedPaths.push(path);return clone(now);}
  if(Array.isArray(next)&&next.every(x=>x&&typeof x==='object'&&x.id!==undefined)){
   const oldBy=new Map((old??[]).map(x=>[x.id,x])),nextBy=new Map(next.map(x=>[x.id,x]));const result=[];
   for(const x of now??[]){if(!nextBy.has(x.id)){if(path==='captions.cues'&&oldBy.has(x.id)&&equal(oldBy.get(x.id),x)&&!x.locked&&!x.disabled&&!x.hidden&&!current.captions?.locked)continue;result.push(clone(x));continue;}if(captionConflict(nextBy.get(x.id))&&['instances','productionPlan.shots'].includes(path)&&!equal(oldBy.get(x.id),nextBy.get(x.id))){report.needsReview.push({id:x.id,reason:'overlapping caption words changed'});result.push(clone(x));}else result.push(merge(oldBy.get(x.id),nextBy.get(x.id),x,`${path}[${x.id}]`));nextBy.delete(x.id);}
   for(const x of nextBy.values()){
    if(path==='captions.cues'&&(old??[]).some(c=>!(now??[]).some(n=>n.id===c.id)&&x.startFrame<c.endFrame&&x.endFrame>c.startFrame)){report.protectedPaths.push(`${path}[${x.id}]:deleted-caption-overlap`);continue;}
    if(path==='captions.cues'&&(now??[]).some(c=>(!oldBy.has(c.id)||!equal(oldBy.get(c.id),c))&&x.startFrame<c.endFrame&&x.endFrame>c.startFrame)){report.protectedPaths.push(`${path}[${x.id}]:manual-caption-overlap`);continue;}
    if(path==='instances'&&blockedInstanceIds.has(x.id)||path==='productionPlan.shots'&&blockedShotIds.has(x.id)&&currentShots.has(x.id)){report.protectedPaths.push(`${path}[${x.id}]:cancelled-shot`);continue;}
    if(oldBy.has(x.id)){report.protectedPaths.push(`${path}[${x.id}]:deleted`);continue;}
    if(x.locked||x.disabled||protectedTracks.has(x.trackId)||path==='captions.cues'&&current.captions?.locked){report.protectedPaths.push(`${path}[${x.id}]:locked`);continue;}
    if(captionConflict(x)&&['instances','productionPlan.shots'].includes(path)){report.needsReview.push({id:x.id,reason:'surviving captions changed; visual recommendation requires review'});continue;}
    result.push(clone(x));
   }return result;
  }
  if(next&&typeof next==='object'&&!Array.isArray(next)&&(now===undefined||now&&typeof now==='object'&&!Array.isArray(now))){
   const result=clone(now??{});for(const k of new Set([...Object.keys(old??{}),...Object.keys(next)])){
    if(equal(old?.[k],next[k]))continue;const v=merge(old?.[k],next[k],now?.[k],`${path}.${k}`);if(v===undefined)delete result[k];else result[k]=v;
   }return result;
  }
  if(equal(old,now))return clone(next);report.protectedPaths.push(path);return clone(now);
 }
 for(const raw of writeSet){const path=(typeof raw==='string'?raw:raw.path);if(typeof path!=='string'&&!Array.isArray(path))fail('writeSet entries require a dotted path or path array');const keys=Array.isArray(path)?path:path.replace(/^\//,'').split(/[./]/).filter(Boolean);
 if(keys[0]==='canvas'||keys[0]==='source'&&!(keys.length>=2&&keys[1]==='cameraPlan'))fail('source and canvas cannot be package write targets');
 if(keys.slice(0,-1).some((_,i)=>['locked','hidden','disabled'].some(k=>at(current,keys.slice(0,i+1))?.[k]))){report.protectedPaths.push(typeof path==='string'?path:keys.join('.'));continue;}
 if(keys[0]==='captions'&&current.captions?.locked){report.protectedPaths.push(path);continue;}
 set(document,keys,merge(at(b,keys),at(p,keys),at(current,keys),keys.join('.')));
 }
 report.status=equal(document,current)?'unchanged':'rebased';return {document,report};
}

/** Host-only trust filter: a readback is not itself evidence that every retained word was generated. */
export function acceptedPackageCaptionDocument(base,proposed,readback){
 inspectPackageEdits(base,readback);
 const expected=mappedDocument(proposed,mapper(base,readback)).captions?.cues??[];
 const accepted=clone(readback);
 if(accepted.captions)accepted.captions.cues=(readback.captions.cues??[]).filter(c=>expected.some(p=>p.id===c.id&&p.text===c.text&&p.startFrame===c.startFrame&&p.endFrame===c.endFrame)).map(clone);
 return accepted;
}
