/** Envelope uses pre-split clip time; range sequences must not restart fades. */
const shape=(x,curve)=>curve==='smooth'?x*x*(3-2*x):curve==='equalPower'?Math.sin(x*Math.PI/2):x;
const expressionShape=(x,curve)=>curve==='smooth'?`(${x})*(${x})*(3-2*(${x}))`:curve==='equalPower'?`sin((${x})*PI/2)`:x;
export function audioVolumeAt(clip,frame){
 if(clip.muted)return 0;
 const t=frame+(clip.envelopeOffsetFrames??0),duration=clip.envelopeDurationFrames??clip.durationFrames;
 const fadeIn=clip.fadeInFrames?shape(Math.min(1,Math.max(0,t/clip.fadeInFrames)),clip.fadeInCurve):1;
 const fadeOut=clip.fadeOutFrames?shape(Math.min(1,Math.max(0,(duration-t)/clip.fadeOutFrames)),clip.fadeOutCurve):1;
 return clip.volume*Math.min(fadeIn,fadeOut);
}
/** Same envelope in FFmpeg seconds, including range-export and split offsets. */
export function audioVolumeExpression(clip,fps,rangeOffsetFrames=0){
 if(clip.muted)return '0';
 const offset=((clip.envelopeOffsetFrames??0)+rangeOffsetFrames)/fps,duration=(clip.envelopeDurationFrames??clip.durationFrames)/fps;
 const fadeIn=clip.fadeInFrames?expressionShape(`min(1,max(0,(t+${offset})/${clip.fadeInFrames/fps}))`,clip.fadeInCurve):'1';
 const fadeOut=clip.fadeOutFrames?expressionShape(`min(1,max(0,(${duration}-t-${offset})/${clip.fadeOutFrames/fps}))`,clip.fadeOutCurve):'1';
 return `${clip.volume}*min(${fadeIn},${fadeOut})`;
}
/** Explicitly editing fades makes their scope the current visible clip. */
export function editAudioFades(clip,patch){
 const c={...clip,...patch},duration=clip.durationFrames;
 return {...patch,fadeInFrames:Math.max(0,Math.min(duration,c.fadeInFrames)),fadeOutFrames:Math.max(0,Math.min(duration,c.fadeOutFrames)),envelopeOffsetFrames:0,envelopeDurationFrames:duration};
}
