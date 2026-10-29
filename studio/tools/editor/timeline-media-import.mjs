import {configureMediaClip} from './media-clip.mjs';
import {ensureTimeline,placeInstance} from './timeline-model.mjs';
import {insertEmptyTrack} from './track-insertion.mjs';
/** One drop is one undoable edit. Files retain order on a new top visual track. */
export function placeImportedMedia(document,files,frame,createInstance){
 if(!files.length)return {document,ids:[]};
 if(!Number.isFinite(frame)||frame<0)throw Error('播放头位置无效');
 let d=ensureTimeline(document),start=Math.round(frame);
 const fps=d.canvas.fps.num/d.canvas.fps.den;
 const durations=files.map(file=>{
  if(!['image','video'].includes(file.kind))throw Error('时间轴只接受图片和视频');
  const seconds=file.kind==='image'?3:file.durationSeconds;
  if(!Number.isFinite(seconds)||seconds<=0)throw Error('无法读取素材时长');
  return Math.max(1,Math.round(seconds*fps));
 });
 // Normalize legacy source clips before extending the canvas, so main footage stays unchanged.
 d.canvas.durationFrames=Math.max(d.canvas.durationFrames,start+durations.reduce((a,b)=>a+b,0));
 const created=insertEmptyTrack(d,'visual',d.tracks.length);d=created.document;
 const ids=[];
 files.forEach((file,index)=>{
  const base=createInstance('source-pip',d,start);
  const clip=configureMediaClip(base,file,file.kind,d,file.name);
  clip.assetReferences={media:file.path,...(file.sourceSharedPath?{shared:file.sourceSharedPath}:{})};
  d=placeInstance(d,clip,created.trackId);ids.push(clip.id);start+=durations[index];
 });
 return {document:d,ids};
}
