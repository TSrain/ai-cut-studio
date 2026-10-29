/** Insert/delete project time. Everything above the source track follows one edit map. */
import {validateCaptionTrack} from '../../templates/remotion-base/src/editor/captions.mjs';
const end=c=>c.startFrame+c.durationFrames;
const unique=(used,base)=>{let id=base,n=1;while(used.has(id))id=`${base}-${n++}`;used.add(id);return id;};
export function rippleProject(document,{at,remove=0,insert=0}) {
 const d=structuredClone(document),delta=insert-remove,until=at+remove;
 if(!delta&&!remove)return d;
 if(![at,remove,insert].every(n=>Number.isSafeInteger(n)&&n>=0)||at+remove>d.canvas.durationFrames)throw Error('主视频联动区间无效');
 const portion=(start,finish)=>{
  const parts=[];
  if(start<at)parts.push({from:start,to:Math.min(finish,at),shift:0});
  if(finish>until)parts.push({from:Math.max(start,until),to:finish,shift:delta});
  return parts.filter(p=>p.to>p.from);
 };
 const visualParts=new Map();
 const mapList=(items,kind,locked)=>{
  const used=new Set(items.map(c=>c.id));
  return items.flatMap(c=>{
   const finish=kind==='caption'?c.endFrame:end(c);
   if(finish<=at){if(kind==='visual')visualParts.set(c.id,[c]);return [c];}
   if(locked(c)||c.locked)throw Error('受影响轨道或片段已锁定，请先解锁；所有轨道均未修改');
   const parts=portion(c.startFrame,finish);
   const mapped=parts.map((p,index)=>{
    const n={...structuredClone(c),id:index?unique(used,`${c.id}-ripple-${p.from}`):c.id,startFrame:p.from+p.shift};
    if(kind==='caption')n.endFrame=p.to+p.shift;
    else {
     n.durationFrames=p.to-p.from;
     if(p.from!==c.startFrame||n.durationFrames!==c.durationFrames){
      if(kind==='audio'){n.sourceInFrame=c.sourceInFrame+p.from-c.startFrame;n.envelopeOffsetFrames=(c.envelopeOffsetFrames??0)+p.from-c.startFrame;n.envelopeDurationFrames=c.envelopeDurationFrames??c.durationFrames;}
      else if(kind==='visual'){n.sourceOffsetFrames=(c.sourceOffsetFrames??0)+p.from-c.startFrame;n.sourceDurationFrames=c.sourceDurationFrames??c.durationFrames;}
     }
    }
    return n;
   });
   if(kind==='visual')visualParts.set(c.id,mapped);
   return mapped;
  });
 };
 d.instances=mapList(d.instances??[],'visual',c=>d.tracks?.find(t=>t.id===c.trackId)?.locked);
 d.audioClips=mapList(d.audioClips??[],'audio',c=>d.audioTracks?.find(t=>t.id===c.trackId)?.locked);
 if(d.captions)d.captions.cues=mapList(d.captions.cues,'caption',()=>d.captions.locked).sort((a,b)=>a.startFrame-b.startFrame);
 d.canvas.durationFrames+=delta;
 if(d.markers)d.markers=d.markers.map(m=>({...m,frame:Math.min(d.canvas.durationFrames-1,m.frame<at?m.frame:m.frame>=until?m.frame+delta:at)}));
 if(d.productionPlan){
  for(const shot of d.productionPlan.shots??[]){
   if(shot.timing)shot.timing.ranges=mapList(shot.timing.ranges??[],'range',()=>false);
   // Source-time anchors/effectTiming remain tied to the unchanged original footage.
   shot.bindings=(shot.bindings??[]).flatMap(b=>{
    const before=document.instances?.find(i=>i.id===b.instanceId);
    if(!before)return [b];
    const parts=visualParts.get(before.id)??[];
    if(!parts.length)return [{...b,status:'removed'}];
    return parts.map((i,n)=>({...b,...(n?{id:`${b.id}-ripple-${i.id}`} : {}),instanceId:i.id,startFrame:i.startFrame,durationFrames:i.durationFrames,...(Number.isFinite(b.sourceInSeconds)?{sourceInSeconds:b.sourceInSeconds+((i.sourceOffsetFrames??0)-(before.sourceOffsetFrames??0))/(d.canvas.fps.num/d.canvas.fps.den),...(Number.isFinite(b.sourceOutSeconds)?{sourceOutSeconds:b.sourceInSeconds+((i.sourceOffsetFrames??0)-(before.sourceOffsetFrames??0)+i.durationFrames)/(d.canvas.fps.num/d.canvas.fps.den)}:{})}:{})}));
   });
  }
  d.productionPlan.revision=(d.productionPlan.revision??0)+1;
 }
 if(d.captions)validateCaptionTrack(d.captions,{durationFrames:d.canvas.durationFrames});
 return d;
}
export function rippleTrimSource(document,id,edge,delta){
 const c=document.source.clips.find(c=>c.id===id);
 if(!c)return structuredClone(document);
 if(document.source.locked||c.locked)throw Error('主视频轨道或片段已锁定');
 if(!['left','right'].includes(edge)||!Number.isFinite(delta))throw Error('主视频裁剪参数无效');
 const total=document.source.durationFrames??Math.max(...document.source.clips.map(c=>c.sourceInFrame+c.durationFrames));
 const dx=edge==='left'?Math.max(-c.sourceInFrame,Math.min(c.durationFrames-1,Math.round(delta))):Math.max(1-c.durationFrames,Math.min(total-c.sourceInFrame-c.durationFrames,Math.round(delta)));
 if(!dx)return structuredClone(document);
 const durationDelta=edge==='left'?-dx:dx;
 const at=edge==='left'?c.startFrame:end(c)+Math.min(dx,0);
 const edit={at,remove:Math.max(0,-durationDelta),insert:Math.max(0,durationDelta)};
 for(const other of document.source.clips)if(other.id!==id&&other.startFrame>=end(c)&&other.locked)throw Error('受影响主视频片段已锁定');
 let d=rippleProject(document,edit);
 d.source.durationFrames??=total;
 d.source.clips=d.source.clips.map(other=>other.id===id?{...other,durationFrames:c.durationFrames+durationDelta,sourceInFrame:c.sourceInFrame+(edge==='left'?dx:0)}:other.startFrame>=end(c)?{...other,startFrame:other.startFrame+durationDelta}:other);
 return {document:d,edit,revealed:durationDelta>0?{sourceInFrame:edge==='left'?c.sourceInFrame+dx:c.sourceInFrame+c.durationFrames,startFrame:at,durationFrames:durationDelta}:null};
}
