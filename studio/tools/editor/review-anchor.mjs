/** Re-locate an old review anchor without silently landing on unrelated footage. */
export function resolveReviewAnchor(document,anchor){
 if(document.id!==anchor.projectId)return null;
 if(anchor.sourceFrame!==null){
  if(document.source?.path!==anchor.sourcePath)return null;
  const clips=document.source?.clips??[{id:'legacy-source',startFrame:0,durationFrames:document.canvas.durationFrames,sourceInFrame:document.source?.startFrame??0}];
  const matches=clips.filter(c=>anchor.sourceFrame>=c.sourceInFrame&&anchor.sourceFrame<c.sourceInFrame+c.durationFrames);
  const match=matches.find(c=>c.id===anchor.clipId)??(matches.length===1?matches[0]:null);
  return match?match.startFrame+anchor.sourceFrame-match.sourceInFrame:null;
 }
 return document.revision===anchor.revision||!document.source?Math.min(anchor.frame,document.canvas.durationFrames-1):null;
}
