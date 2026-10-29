import {DEFAULT_CAPTION_STYLE,validateCaptionTrack} from '../../templates/remotion-base/src/editor/captions.mjs';
import {cameraClips,clipEnd,withCameraClips,duplicateCameraClip} from '../../templates/remotion-base/src/editor/camera-clips.mjs';
import {sourceSegments} from '../../templates/remotion-base/src/editor/clip-time.mjs';
const trackFor=d=>d.captions??{version:1,enabled:true,style:{...DEFAULT_CAPTION_STYLE},cues:[]};
export function checkedCaptions(document,cues){const track={...trackFor(document),cues:[...cues].sort((a,b)=>a.startFrame-b.startFrame)};validateCaptionTrack(track,{durationFrames:document.canvas.durationFrames});return {...document,captions:track};}
const unique=(used,base)=>{let id=base,n=1;while(used.has(id))id=`${base}-${n++}`;used.add(id);return id;};
/** Range transforms use project occurrences, never source footage time (repeated excerpts stay independent). */
export function remapSourceCaptions(document,changes){
 if(!document.captions||document.captions.timeBinding==='project'||!changes.length)return document;
 const used=new Set(document.captions.cues.map(c=>c.id));
 const cues=document.captions.cues.flatMap(c=>{
  const cuts=[...new Set([c.startFrame,c.endFrame,...changes.flatMap(x=>[x.from,x.to]).filter(x=>x>c.startFrame&&x<c.endFrame)])].sort((a,b)=>a-b);
  return cuts.slice(0,-1).flatMap((from,n)=>{const to=cuts[n+1],change=changes.find(x=>from>=x.from&&to<=x.to);if(change?.remove)return [];return [{...c,id:n?unique(used,`${c.id}-part-${from}`):c.id,startFrame:from+(change?.delta??0),endFrame:to+(change?.delta??0)}];});
 });return checkedCaptions(document,cues);
}
export function sourceCaptionPortions(document,sources){
 if(!document.captions||document.captions.timeBinding==='project')return [];
 return document.captions.cues.flatMap(c=>sources.flatMap(s=>{const startFrame=Math.max(c.startFrame,s.startFrame),endFrame=Math.min(c.endFrame,s.startFrame+s.durationFrames);return endFrame>startFrame?[{...c,startFrame,endFrame}]:[];}));
}
export function captionTimelineCommand(document,id,command,frame,payload,idFactory){
 const cues=trackFor(document).cues,c=cues.find(x=>x.id===id),fps=document.canvas.fps.num/document.canvas.fps.den;
 if(command==='paste'){
  if(payload?.kind!=='caption'||payload.fps!==fps)throw Error('请复制同帧率项目的字幕');
  const cue={...structuredClone(payload.cue),id:idFactory(),startFrame:Math.round(frame),endFrame:Math.round(frame)+payload.cue.endFrame-payload.cue.startFrame};return {document:checkedCaptions(document,[...cues,cue]),selected:cue.id};
 }
 if(!c)throw Error('请先选择字幕');
 const copied={kind:'caption',fps,cue:structuredClone(c)};
 if(command==='copy')return {document,selected:id,payload:copied};
 if(command==='delete'||command==='cut')return {document:checkedCaptions(document,cues.filter(x=>x.id!==id)),selected:'',...(command==='cut'?{payload:copied}:{})};
 if(command==='split'){frame=Math.round(frame);if(frame<=c.startFrame||frame>=c.endFrame)throw Error('播放位置须在字幕内部');const right={...c,id:idFactory(),startFrame:frame};return {document:checkedCaptions(document,[...cues.filter(x=>x.id!==id),{...c,endFrame:frame},right]),selected:right.id};}
 if(command==='duplicate'){const length=c.endFrame-c.startFrame;let start=c.endFrame;for(const other of cues){if(other.endFrame<=start)continue;if(other.startFrame>=start+length)break;start=other.endFrame;}return captionTimelineCommand(document,id,'paste',start,copied,idFactory);}
 throw Error('不支持的字幕命令');
}
export function cameraEditReason(document){
 if(document.source?.locked)return '主视频已锁定，镜头效果不可编辑';
 const segments=sourceSegments(document.source,document.canvas.durationFrames);
 if(segments.length!==1||segments[0]?.startFrame!==0||segments[0]?.sourceInFrame!==(document.source?.startFrame??0)||segments[0]?.durationFrames!==document.canvas.durationFrames)return '镜头效果已跟随主视频剪辑映射；请在原始时间轴编辑';
 return '';
}
export function cameraTimelineCommand(document,id,command,frame,payload,idFactory){
 if(command==='split')throw Error('镜头曲线暂不支持切分；请调整完整镜头块');
 const reason=cameraEditReason(document);if(reason)throw Error(reason);
 const plan=document.source?.cameraPlan,clips=cameraClips(plan),c=clips.find(x=>x.id===id),fps=document.canvas.fps.num/document.canvas.fps.den;
 if(command==='paste'){if(payload?.kind!=='camera'||payload.fps!==fps)throw Error('请复制同帧率项目的镜头块');const clip={...structuredClone(payload.clip),id:idFactory(),start:Math.round(frame)/fps};return {document:{...document,source:{...document.source,cameraPlan:withCameraClips(plan,[...clips,clip])}},selected:clip.id};}
 if(!c)throw Error('请先选择镜头块');
 const copied={kind:'camera',fps,clip:structuredClone(c)};
 if(command==='copy')return {document,selected:id,payload:copied};
 if(command==='duplicate'){const next=duplicateCameraClip(clips,id,document.canvas.durationFrames/fps),added=next.find(x=>!clips.some(y=>y.id===x.id));added.id=idFactory();return {document:{...document,source:{...document.source,cameraPlan:withCameraClips(plan,next)}},selected:added.id};}
 if(command==='delete'||command==='cut')return {document:{...document,source:{...document.source,cameraPlan:withCameraClips(plan,clips.filter(x=>x.id!==id))}},selected:'',...(command==='cut'?{payload:copied}:{})};
 throw Error('不支持的镜头命令');
}
export function parseSrtCaptions(text,fps,idFactory){
 const blocks=text.replace(/^\uFEFF/,'').replace(/\r/g,'').trim().split(/\n\s*\n/),stamp=s=>{const m=s.match(/^(\d+):(\d{2}):(\d{2})[,.](\d{3})$/);if(!m||+m[2]>59||+m[3]>59)throw Error('SRT 时间格式无效');return Math.round((+m[1]*3600+ +m[2]*60+ +m[3]+ +m[4]/1000)*fps);};
 if(!text.trim())throw Error('请粘贴 SRT 字幕');
 return blocks.map((block,n)=>{const lines=block.split('\n');if(/^\d+$/.test(lines[0].trim()))lines.shift();const time=lines.shift().trim().split(/\s*-->\s*/);if(time.length!==2)throw Error(`第 ${n+1} 条 SRT 时间格式无效`);const text=lines.join('\n').trim();return {id:idFactory(),startFrame:stamp(time[0]),endFrame:stamp(time[1]),text,originalText:text,initialText:text};});
}
