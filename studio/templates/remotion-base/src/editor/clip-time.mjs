/** Visible clip boundaries never redefine the underlying animation clock. */
export function instanceTiming(instance) {
  return {offset: instance.sourceOffsetFrames ?? 0, duration: instance.sourceDurationFrames ?? instance.durationFrames};
}
export function sourceClipAt(source, frame, total) {
  if (!source || frame < 0 || frame >= total) return null;
  const clips = source.clips ?? [{id:'legacy-source', startFrame:0, durationFrames:total, sourceInFrame:source.startFrame}];
  return clips.find(c => frame >= c.startFrame && frame < c.startFrame + c.durationFrames) ?? null;
}
export function sourceFrameAt(source, frame, total) {
  const clip=sourceClipAt(source,frame,total);
  return clip ? clip.sourceInFrame + frame - clip.startFrame : null;
}
/** Coalesce contiguous splits so the decoder and linked audio remain continuous. */
export function sourceSegments(source,total) {
  if (!source) return [];
  const result=[];
  for(const clip of [...(source.clips ?? [{id:'legacy-source',startFrame:0,durationFrames:total,sourceInFrame:source.startFrame}])].sort((a,b)=>a.startFrame-b.startFrame)) {
    const previous=result.at(-1);
    if(previous && previous.startFrame+previous.durationFrames===clip.startFrame && previous.sourceInFrame+previous.durationFrames===clip.sourceInFrame) previous.durationFrames+=clip.durationFrames;
    else result.push({...clip});
  }
  return result;
}
/** Project an absolute media-frame interval onto all edited timeline occurrences. */
export function projectSourceRange(source,start,end,total) {
  return sourceSegments(source,total).flatMap(clip=>{
    const left=Math.max(start,clip.sourceInFrame),right=Math.min(end,clip.sourceInFrame+clip.durationFrames);
    return right>left?[{sourceClipId:clip.id,startFrame:clip.startFrame+left-clip.sourceInFrame,endFrame:clip.startFrame+right-clip.sourceInFrame}]:[];
  });
}
/** Generated source chapters follow content; hand-authored chapters keep project time. */
export function semanticFrame(document,instance,globalFrame) {
  if(instance.assetId!=='chapter-progress'||!(instance.props?.sourceCues!==undefined||instance.props?.timeBinding==='source'))return globalFrame;
  const sourceFrame=sourceFrameAt(document.source,globalFrame,document.canvas.durationFrames);
  return sourceFrame===null?null:sourceFrame-(document.source?.startFrame??0);
}
