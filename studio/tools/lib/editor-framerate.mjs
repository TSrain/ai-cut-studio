import {retimeRoughcutDocument} from '../editor/roughcut-model.mjs';
import {validateCaptionTrack} from '../../templates/remotion-base/src/editor/captions.mjs';
/** Convert frame-based times together; visual durations and source trim stay in seconds. */
export function retimeEditorDocument(document, fps = 30) {
  if (![24, 25, 30, 50, 60].includes(fps))
    throw new Error("请选择 24、25、30、50 或 60 帧");
  const copy = structuredClone(document),
    old = document.canvas.fps.num / document.canvas.fps.den,
    ratio = fps / old;
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, v] of Object.entries(value)) {
      if(key === "roughcut") continue;
      if (
        ["startFrame", "endFrame", "durationFrames", "sourceOffsetFrames", "sourceDurationFrames", "sourceInFrame", "fadeInFrames", "fadeOutFrames", "envelopeOffsetFrames", "envelopeDurationFrames"].includes(key) &&
        Number.isFinite(v)
      )
        value[key] = Math.round(v * ratio);
      else if (typeof v === "object") visit(v);
    }
  };
  visit(copy);
  if(copy.markers)copy.markers=copy.markers.map(m=>({...m,frame:Math.min(copy.canvas.durationFrames-1,Math.round(m.frame*ratio))}));
  copy.canvas.fps = { num: fps, den: 1 };
  copy.canvas.durationFrames = Math.max(1, copy.canvas.durationFrames);
  if (copy.source?.clips) {
    copy.source.clips.forEach((clip,index)=>{
      const original=document.source.clips[index];
      clip.durationFrames=Math.round((original.startFrame+original.durationFrames)*ratio)-clip.startFrame;
      clip.durationFrames=Math.min(clip.durationFrames,copy.canvas.durationFrames-clip.startFrame,(copy.source.durationFrames??copy.source.startFrame+copy.canvas.durationFrames)-clip.sourceInFrame);
    });
    copy.source.clips=copy.source.clips.filter(clip=>clip.durationFrames>0);
  }
  if(copy.audioClips)copy.audioClips=copy.audioClips.map((clip,index)=>{const original=document.audioClips[index];clip.durationFrames=Math.min(Math.round((original.startFrame+original.durationFrames)*ratio)-clip.startFrame,copy.canvas.durationFrames-clip.startFrame,clip.sourceDurationFrames-clip.sourceInFrame);return clip;}).filter(c=>c.durationFrames>0);
  for (const [index,i] of copy.instances.entries()) {
    const original=document.instances[index];
    i.durationFrames=Math.round((original.startFrame+original.durationFrames)*ratio)-i.startFrame;
    i.durationFrames = Math.max(1, i.durationFrames);
    i.startFrame = Math.min(i.startFrame, copy.canvas.durationFrames - 1);
    i.durationFrames = Math.min(
      i.durationFrames,
      copy.canvas.durationFrames - i.startFrame,
    );
    if(i.sourceDurationFrames!==undefined) i.durationFrames=Math.min(i.durationFrames,i.sourceDurationFrames-(i.sourceOffsetFrames??0));
    i.props.durationSeconds = (i.sourceDurationFrames ?? i.durationFrames) / fps;
  }
  copy.instances=copy.instances.filter(i=>i.durationFrames>0);
  if(copy.captions!==undefined)validateCaptionTrack(copy.captions,{durationFrames:copy.canvas.durationFrames});
  return document.roughcut && old !== fps ? retimeRoughcutDocument(document,copy) : copy;
}
/** Convert explicit selection endpoints alongside the document, without changing caller data. */
export function retimeEditorTarget(target,document,fps=30) {
  if(target?.kind!=='camera'||(target.rangeStartFrame===undefined&&target.durationFrames===undefined))return target;
  if(!Number.isInteger(target.rangeStartFrame)||target.rangeStartFrame<0||!Number.isInteger(target.durationFrames)||target.durationFrames<=0)throw Error('镜头片段时间范围无效');
  const ratio=fps/(document.canvas.fps.num/document.canvas.fps.den);
  const start=Math.round(target.rangeStartFrame*ratio),end=Math.round((target.rangeStartFrame+target.durationFrames)*ratio);
  if(end<=start)throw Error('镜头片段短于导出帧率的一帧');
  return {...target,rangeStartFrame:start,durationFrames:end-start};
}
