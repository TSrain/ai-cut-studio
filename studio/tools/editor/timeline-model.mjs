import {rippleTrimSource} from './source-ripple.mjs';
import {recordRoughcutTimeline,restoreRoughcutCaptions} from './roughcut-model.mjs';
import {remapSourceCaptions,sourceCaptionPortions,checkedCaptions} from './caption-camera-model.mjs';
/** Pure, frame-based timeline edits. All commands return a new document. */
const overlap=(a,b)=>a.startFrame<b.startFrame+b.durationFrames&&b.startFrame<a.startFrame+a.durationFrames;
const end=c=>c.startFrame+c.durationFrames;
const nextTrackId=tracks=>{let n=1;while(tracks.some(t=>t.id===`visual-${n}`))n++;return `visual-${n}`;};
export function ensureTimeline(document){
 const d=structuredClone(document);d.timelineVersion=2;d.tracks??=[];d.audioTracks??=[];d.audioClips??=[];
 const assigned=[];
 for(const i of [...d.instances].sort((a,b)=>a.zIndex-b.zIndex)){
  if(!d.tracks.some(t=>t.id===i.trackId)){
   const lower=assigned.filter(x=>overlap(x,i)).map(x=>d.tracks.findIndex(t=>t.id===x.trackId));
   const min=lower.length?Math.max(...lower)+1:0;
   let track=d.tracks.find((t,n)=>n>=min&&!t.locked&&!assigned.some(x=>x.trackId===t.id&&overlap(x,i)));
   if(!track){track={id:nextTrackId(d.tracks),name:`叠加画面 ${d.tracks.length+1}`};d.tracks.push(track);}i.trackId=track.id;
  }
  assigned.push(i);
 }
 if(d.source&&!Array.isArray(d.source.clips))d.source.clips=[{id:'source-main',name:'主视频',startFrame:0,durationFrames:d.canvas.durationFrames,sourceInFrame:d.source.startFrame??0}];
 return d;
}
export function timelineItems(d){return [
 ...(d.audioClips??[]).map(i=>({...i,key:`audio/${i.id}`,kind:'audio',locked:!!d.audioTracks?.find(t=>t.id===i.trackId)?.locked})),
 ...d.instances.map(i=>({...i,key:i.id,kind:'instance',locked:!!d.tracks?.find(t=>t.id===i.trackId)?.locked})),
 ...(d.source?.clips??[]).map(i=>({...i,key:`source/${i.id}`,kind:'source',trackId:'__source',locked:!!d.source.locked}))
];}
export function selectionBounds(d,ids){const items=timelineItems(d).filter(i=>ids.includes(i.key));return items.length?{start:Math.min(...items.map(i=>i.startFrame)),end:Math.max(...items.map(end))}:null;}
const selectedItems=(d,ids)=>timelineItems(d).filter(i=>ids.includes(i.key)&&!i.locked);
function update(d,key,fn){if(key.startsWith('audio/'))d.audioClips=d.audioClips.map(i=>i.id===key.slice(6)?fn(i):i);else if(key.startsWith('source/'))d.source.clips=d.source.clips.map(i=>i.id===key.slice(7)?fn(i):i);else d.instances=d.instances.map(i=>i.id===key?fn(i):i);}
function assertNoCollision(d,ids){const all=timelineItems(d);for(const a of all.filter(i=>ids.includes(i.key))){if(all.some(b=>a.key!==b.key&&a.trackId===b.trackId&&overlap(a,b)))throw Error('此轨道没有足够空位，片段不能重叠；请移到其他轨道');}}
function syncLayers(d){for(const i of d.instances)i.zIndex=d.tracks.findIndex(t=>t.id===i.trackId)*1000;return d;}
/** Instances under moved source ranges follow the same content, including legacy documents. */
export function linkedMoveKeys(document,ids){
 const all=timelineItems(document),sources=all.filter(i=>ids.includes(i.key)&&i.kind==='source'&&!i.locked);
 return [...new Set([...ids,...all.filter(i=>i.kind==='instance'&&sources.some(c=>overlap(i,c))).map(i=>i.key)])];
}
function prepareLinkedMove(d,ids){
 const initial=selectedItems(d,ids),sources=initial.filter(i=>i.kind==='source');
 if(!sources.length)return initial;
 const used=new Set(d.instances.map(i=>i.id)),moving=new Set(initial.map(i=>i.key));
 d.instances=d.instances.flatMap(i=>{
  if(!sources.some(c=>overlap(i,c)))return [i];
  if(d.tracks.find(t=>t.id===i.trackId)?.locked)throw Error('关联模板轨道已锁定，请先解锁；主视频与模板未移动');
  if(moving.has(i.id))return [i]; // Explicit group selection moves each whole clip exactly once.
  const boundaries=[...new Set([i.startFrame,end(i),...sources.flatMap(c=>[c.startFrame,end(c)]).filter(f=>f>i.startFrame&&f<end(i))])].sort((a,b)=>a-b);
  return boundaries.slice(0,-1).map((from,index)=>{
   let id=i.id;
   if(index){const base=`${i.id}-linked-${from}`;id=base;let n=1;while(used.has(id))id=`${base}-${n++}`;used.add(id);}
   const part={...structuredClone(i),id,startFrame:from,durationFrames:boundaries[index+1]-from};
   if(boundaries.length>2){part.sourceOffsetFrames=(i.sourceOffsetFrames??0)+from-i.startFrame;part.sourceDurationFrames=i.sourceDurationFrames??i.durationFrames;}
   if(sources.some(c=>overlap(part,c)))moving.add(id);
   return part;
  });
 });
 return timelineItems(d).filter(i=>moving.has(i.key));
}
export function moveSelection(document,ids,delta,targetTrack){
 let d=ensureTimeline(document);const initial=selectedItems(d,ids);if(!initial.length)return d;
 delta=Math.round(delta);if(!delta&&!targetTrack)return d;
 if(targetTrack){const audio=d.audioTracks.find(t=>t.id===targetTrack),visual=d.tracks.find(t=>t.id===targetTrack);if(!audio&&!visual)throw Error('目标轨道不存在');if(initial.some(i=>i.kind!==(audio?'audio':'instance')))throw Error('片段与目标轨道类型不匹配');if((audio??visual).locked)throw Error('目标轨道已锁定');}
 const items=prepareLinkedMove(d,ids);
 delta=Math.round(Math.max(-Math.min(...items.map(i=>i.startFrame)),Math.min(d.canvas.durationFrames-Math.max(...items.map(end)),delta)));
 if(!delta&&!targetTrack)return ensureTimeline(document);
 for(const i of items)update(d,i.key,c=>({...c,startFrame:c.startFrame+delta,...(targetTrack?{trackId:targetTrack,zIndex:d.tracks.findIndex(t=>t.id===targetTrack)*1000}: {})}));
 assertNoCollision(d,items.map(i=>i.key));d=remapSourceCaptions(d,initial.filter(i=>i.kind==='source').map(i=>({from:i.startFrame,to:end(i),delta})));return targetTrack?syncLayers(d):d;
}
export function trimClip(document,key,edge,delta){
 const d=ensureTimeline(document);
 if(key.startsWith('source/')){
  const result=rippleTrimSource(d,key.slice(7),edge,delta);
  if(!result.document)return result;
  const next=restoreRoughcutCaptions(result.document,result.revealed);
  return recordRoughcutTimeline(next);
 }
 const item=selectedItems(d,[key])[0];if(!item)return d;
 delta=Math.round(delta);
 update(d,key,c=>{
  if(item.kind==='instance'&&c.assetId==='source-pip'&&c.props?.sourceMode==='media'&&c.props.media?.kind==='image'){
   // A still has no finite source endpoint. Reset legacy source offsets after trim.
   const dx=edge==='left'?Math.max(-c.startFrame,Math.min(c.durationFrames-1,delta)):0;
   const startFrame=c.startFrame+dx,durationFrames=edge==='left'?c.durationFrames-dx:Math.max(1,c.durationFrames+delta);
   d.canvas.durationFrames=Math.max(d.canvas.durationFrames,startFrame+durationFrames);
   const fps=d.canvas.fps.num/d.canvas.fps.den;
   return {...c,startFrame,durationFrames,sourceOffsetFrames:0,sourceDurationFrames:durationFrames,props:{...c.props,durationSeconds:durationFrames/fps}};
  }
  const audio=item.kind==='audio',source=item.kind==='source'||audio,offset=source?c.sourceInFrame:(c.sourceOffsetFrames??0);
  const total=audio?c.sourceDurationFrames:source?(d.source.durationFrames??d.source.startFrame+d.canvas.durationFrames):(c.sourceDurationFrames??c.durationFrames);
  if(edge==='left'){
   const dx=Math.max(-c.startFrame,-offset,audio?-(c.envelopeOffsetFrames??0):-Infinity,Math.min(c.durationFrames-1,delta));
   return {...c,startFrame:c.startFrame+dx,durationFrames:c.durationFrames-dx,...(audio?{envelopeOffsetFrames:(c.envelopeOffsetFrames??0)+dx,envelopeDurationFrames:c.envelopeDurationFrames??c.durationFrames}:{}),...(source?{sourceInFrame:offset+dx}:{sourceOffsetFrames:offset+dx,sourceDurationFrames:total})};
  }
  const duration=Math.max(1,Math.min(c.durationFrames+delta,total-offset,d.canvas.durationFrames-c.startFrame));
  return {...c,durationFrames:duration,...(audio?{envelopeOffsetFrames:c.envelopeOffsetFrames??0,envelopeDurationFrames:c.envelopeDurationFrames??c.durationFrames}:{}),...(!source?{sourceOffsetFrames:offset,sourceDurationFrames:total}:{})};
 });assertNoCollision(d,[key]);if(item.kind==='source'){const next=d.source.clips.find(c=>c.id===item.id),changes=[];if(next.startFrame>item.startFrame)changes.push({from:item.startFrame,to:next.startFrame,remove:true});if(end(next)<end(item))changes.push({from:end(next),to:end(item),remove:true});return remapSourceCaptions(d,changes);}return d;
}
export function splitSelection(document,ids,frame,idFactory){
 const d=ensureTimeline(document);frame=Math.round(frame);
 for(const item of selectedItems(d,ids)){
  if(frame<=item.startFrame||frame>=end(item))continue;
  const list=item.kind==='audio'?d.audioClips:item.kind==='source'?d.source.clips:d.instances,index=list.findIndex(i=>i.id===item.id),original=list[index],left=frame-original.startFrame;
  const metadata=item.kind==='audio'?{envelopeOffsetFrames:original.envelopeOffsetFrames??0,envelopeDurationFrames:original.envelopeDurationFrames??original.durationFrames}:item.kind==='source'?{}:{sourceDurationFrames:original.sourceDurationFrames??original.durationFrames,sourceOffsetFrames:original.sourceOffsetFrames??0};
  const a={...original,...metadata,durationFrames:left},b={...structuredClone(original),...metadata,id:idFactory(),startFrame:frame,durationFrames:original.durationFrames-left};
  if(item.kind==='audio'){b.sourceInFrame=original.sourceInFrame+left;b.envelopeOffsetFrames=(original.envelopeOffsetFrames??0)+left;}else if(item.kind==='source')b.sourceInFrame=original.sourceInFrame+left;else b.sourceOffsetFrames=(original.sourceOffsetFrames??0)+left;
  list.splice(index,1,a,b);
 }return ids.some(key=>key.startsWith('source/'))?recordRoughcutTimeline(d):d;
}
export function deleteSelection(document,ids){const d=ensureTimeline(document),keys=selectedItems(d,ids).map(i=>i.key);d.audioClips=d.audioClips.filter(i=>!keys.includes(`audio/${i.id}`));d.instances=d.instances.filter(i=>!keys.includes(i.id));const removed=(d.source?.clips??[]).filter(i=>keys.includes(`source/${i.id}`));if(d.source)d.source.clips=d.source.clips.filter(i=>!keys.includes(`source/${i.id}`));return remapSourceCaptions(d,removed.map(i=>({from:i.startFrame,to:end(i),remove:true})));}
export function copySelection(d,ids){const normalized=ensureTimeline(d),items=selectedItems(normalized,ids);return {version:1,trackOrder:normalized.tracks.map(t=>t.id),documentId:d.id,sourcePath:d.source?.path,fps:d.canvas.fps.num/d.canvas.fps.den,items:structuredClone(items),sourceCaptions:sourceCaptionPortions(normalized,items.filter(i=>i.kind==='source')),start:items.length?Math.min(...items.map(i=>i.startFrame)):0};}
export function pasteSelection(document,clipboard,frame,idFactory){
 const d=ensureTimeline(document);if(!clipboard?.items?.length)throw Error('请先复制片段');
 if(clipboard.fps!==d.canvas.fps.num/d.canvas.fps.den)throw Error('请在相同帧率的项目中粘贴');
 const groupIds=new Map();
 const dx=Math.round(frame)-clipboard.start,items=clipboard.items.map(i=>({...structuredClone(i),id:idFactory(),startFrame:i.startFrame+dx}));
 for(const item of items)if(item.groupId){if(!groupIds.has(item.groupId))groupIds.set(item.groupId,idFactory());item.groupId=groupIds.get(item.groupId);}
 if(items.some(i=>i.startFrame<0||end(i)>d.canvas.durationFrames))throw Error('粘贴内容超出片尾，请先增加项目时长或选择更早的位置');
 if(items.some(i=>i.kind==='source')&&clipboard.sourcePath!==d.source?.path)throw Error('主视频来自其他项目，请先关联相同底片');
 if(items.some(i=>i.kind==='source')&&d.source?.locked)throw Error('主视频轨道已锁定，无法粘贴');
 const tracks=new Map(),layers=items.filter(i=>i.kind==='instance');
 const originalOrder=clipboard.trackOrder??[...new Set([...layers].sort((a,b)=>a.zIndex-b.zIndex).map(i=>i.trackId))];
 const groups=[...new Set(layers.map(i=>i.trackId))].sort((a,b)=>originalOrder.indexOf(a)-originalOrder.indexOf(b));
 // Reuse the whole ordered group or create the whole group above existing tracks.
 // Partial reuse can invert layers when a lower blocked track is appended above an upper one.
 const canReuse=clipboard.documentId===d.id&&groups.every((old,index)=>{
  const target=d.tracks.find(t=>t.id===old),position=d.tracks.findIndex(t=>t.id===old);
  return target&&!target.locked&&(index===0||position>d.tracks.findIndex(t=>t.id===groups[index-1]))&&!layers.filter(i=>i.trackId===old).some(a=>d.instances.some(b=>b.trackId===old&&overlap(a,b)));
 });
 const baseZ=Math.max(0,...d.instances.map(i=>i.zIndex))+1000;
 for(const [index,old] of groups.entries()){
  let target=canReuse?d.tracks.find(t=>t.id===old):null;
  if(!target){target={id:nextTrackId(d.tracks),name:`叠加画面 ${d.tracks.length+1}`};d.tracks.push(target);}
  tracks.set(old,{id:target.id,zIndex:canReuse?null:baseZ+index*1000});
 }
 for(const item of items){const {kind,key,locked,...c}=item;if(kind==='audio'){const placed=placeAudio(d,c,c.trackId);d.audioTracks=placed.audioTracks;d.audioClips=placed.audioClips;}else if(kind==='source')d.source.clips.push(c);else{const target=tracks.get(c.trackId);c.trackId=target.id;c.zIndex=target.zIndex??c.zIndex;d.instances.push(c);}}
 assertNoCollision(d,items.map(i=>i.kind==='audio'?`audio/${i.id}`:i.kind==='source'?`source/${i.id}`:i.id));if(items.some(i=>i.kind==='source')&&clipboard.sourceCaptions?.length)return checkedCaptions(d,[...(d.captions?.cues??[]),...clipboard.sourceCaptions.map(c=>({...structuredClone(c),id:idFactory(),startFrame:c.startFrame+dx,endFrame:c.endFrame+dx}))]);return d;
}
export function placeInstance(document,instance,trackId){const d=ensureTimeline(document),i=structuredClone(instance);let t=d.tracks.find(t=>t.id===trackId&&!t.locked&&!d.instances.some(c=>c.trackId===t.id&&overlap(c,i)));if(!t)t=d.tracks.find(t=>!t.locked&&!d.instances.some(c=>c.trackId===t.id&&overlap(c,i)));if(!t){t={id:nextTrackId(d.tracks),name:`叠加画面 ${d.tracks.length+1}`};d.tracks.push(t);}i.trackId=t.id;i.zIndex=d.tracks.indexOf(t)*1000;d.instances.push(i);return syncLayers(d);}
export function marqueeIds(rect,items){const x=Math.min(rect.x,rect.x+rect.width),y=Math.min(rect.y,rect.y+rect.height),right=Math.max(rect.x,rect.x+rect.width),bottom=Math.max(rect.y,rect.y+rect.height);return items.filter(i=>i.x<right&&i.x+i.width>x&&i.y<bottom&&i.y+i.height>y).map(i=>i.id);}
export function zoomAtPointer({scrollLeft,clientX,rectLeft,labelWidth,oldPx,newPx}){const x=clientX-rectLeft-labelWidth;return Math.max(0,(scrollLeft+x)/oldPx*newPx-x);}

export function placeAudio(document,clip,trackId){const d=ensureTimeline(document),c=structuredClone(clip);let t=d.audioTracks.find(t=>t.id===trackId&&!t.locked&&!d.audioClips.some(i=>i.trackId===t.id&&overlap(i,c)));if(!t)t=d.audioTracks.find(t=>!t.locked&&!d.audioClips.some(i=>i.trackId===t.id&&overlap(i,c)));if(!t){let n=1;while(d.audioTracks.some(t=>t.id===`audio-${n}`))n++;t={id:`audio-${n}`,name:`音频 ${n}`};d.audioTracks.push(t);}c.trackId=t.id;d.audioClips.push(c);return d;}
