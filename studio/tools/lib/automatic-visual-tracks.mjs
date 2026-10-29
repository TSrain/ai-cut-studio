import {createHash} from 'node:crypto';

const overlaps=(a,b)=>a.startFrame<b.startFrame+b.durationFrames&&b.startFrame<a.startFrame+a.durationFrames;
const marker='automatic-visual-v1';

/** Assign only a new automatic instance; never repack existing/user tracks. */
export function appendAutomaticVisualTrack(document,instance) {
 document.tracks??=[];
 const tracks=document.tracks,instances=document.instances??[];
 const overlapping=instances.filter(i=>overlaps(i,instance));
 const known=overlapping.map(i=>tracks.findIndex(t=>t.id===i.trackId));
 // An untracked old layer has no durable lane ordering: append above it.
 const minimum=known.some(index=>index<0)?tracks.length:Math.max(-1,...known)+1;
 let track=tracks.find((t,index)=>{
  const origin=t.autoPlacement;
  return index>=minimum&&origin?.kind===marker&&origin.createdIndex===index&&origin.originalName===t.name&&
   !t.locked&&!t.disabled&&instances.filter(i=>i.trackId===t.id).every(i=>
    i.autoPlacement?.kind===marker&&i.autoPlacement.instanceId===i.id&&i.autoPlacement.trackId===t.id)&&
   !instances.some(i=>i.trackId===t.id&&overlaps(i,instance));
 });
 if(!track){
  const base=`production-${createHash('sha256').update(instance.id).digest('hex').slice(0,20)}`;
  let id=base,n=2;while(tracks.some(t=>t.id===id))id=`${base}-${n++}`;
  let number=1,name='自动素材与动画';
  while(tracks.some(t=>t.name===name))name=`自动素材与动画 ${++number}`;
  track={id,name,autoPlacement:{kind:marker,createdIndex:tracks.length,originalName:name}};
  tracks.push(track);
 }
 instance.trackId=track.id;
 instance.autoPlacement={kind:marker,instanceId:instance.id,trackId:track.id};
 return track.id;
}
