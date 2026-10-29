import {selectionBounds,timelineItems} from './timeline-model.mjs';
import {projectSourceRange} from '../../templates/remotion-base/src/editor/clip-time.mjs';
import {cameraClips,clipEnd} from '../../templates/remotion-base/src/editor/camera-clips.mjs';

export const clipDensity=width=>width<48?'compact':width<120?'label':'detail';
export function clampTimelineHeight(height,viewportHeight){
 const max=Math.max(180,viewportHeight-258);
 return Math.round(Math.min(max,Math.max(180,Number.isFinite(height)?height:320)));
}
export function cameraDisplayClips(doc){
 if(!doc.source?.cameraPlan)return [];
 const fps=doc.canvas.fps.num/doc.canvas.fps.den;
 return cameraClips(doc.source.cameraPlan).flatMap(c=>projectSourceRange(doc.source,doc.source.startFrame+Math.round(c.start*fps),doc.source.startFrame+Math.round(clipEnd(c)*fps),doc.canvas.durationFrames).map((range,n)=>({...c,displayStart:range.startFrame,displayEnd:range.endFrame,displayKey:`${c.id}-${n}`})));
}
export function timelineSelection(doc,{keys=[],captionId='',captionIds=[],cameraId='',cameraRange=null}={}){
 if(captionId||captionIds.length){const ids=captionIds.length?captionIds:[captionId],cues=doc.captions?.cues?.filter(c=>ids.includes(c.id))??[];return cues.length?{start:Math.min(...cues.map(c=>c.startFrame)),end:Math.max(...cues.map(c=>c.endFrame)),count:cues.length,kind:'caption'}:null;}
 if(cameraId){const occurrences=cameraDisplayClips(doc).filter(c=>c.id===cameraId);const c=occurrences.length===1?occurrences[0]:cameraRange?occurrences.find(c=>c.displayStart===cameraRange.startFrame&&c.displayEnd===cameraRange.endFrame):occurrences[0];return c?{start:c.displayStart,end:c.displayEnd,count:1,kind:'camera'}:null;}
 const b=selectionBounds(doc,keys);return b?{...b,count:timelineItems(doc).filter(i=>keys.includes(i.key)).length,kind:'clips'}:null;
}
export function visibleTimelineRange({scrollLeft,viewport,labelWidth,px,duration}){
 return {start:Math.max(0,Math.min(duration,Math.floor(scrollLeft/px))),end:Math.max(0,Math.min(duration,Math.ceil((scrollLeft+Math.max(0,viewport-labelWidth))/px)))};
}
