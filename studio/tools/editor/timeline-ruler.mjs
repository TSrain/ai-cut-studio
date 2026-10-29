const SECONDS=[1,2,5,10,15,30,60,120,300,600,900,1800,3600,7200,18000,36000,86400];
const pad=value=>String(value).padStart(2,'0');
function clock(seconds){
 const s=Math.floor(seconds),m=Math.floor(s/60);
 return s>=3600?`${pad(Math.floor(s/3600))}:${pad(m%60)}:${pad(s%60)}`:`${pad(m)}:${pad(s%60)}`;
}
/** Pixel density controls labels independently from the quieter subdivisions. */
export function timelineRuler({fps,durationFrames,pxPerFrame,viewportWidth,scrollLeft=0}) {
 const empty={mode:'overview',majorStepFrames:0,minLabelSpacing:160,ticks:[]};
 if(![fps,durationFrames,pxPerFrame,viewportWidth].every(v=>Number.isFinite(v)&&v>0))return empty;
 const visibleSeconds=viewportWidth/pxPerFrame/fps;
 const mode=visibleSeconds>120?'overview':visibleSeconds>15?'editing':'detail';
 const minLabelSpacing=mode==='overview'?160:mode==='editing'?112:96;
 const minMinorSpacing=mode==='overview'?24:mode==='editing'?16:10;
 const frameSteps=[...new Set([1,2,5,10,15,20,30,...(Number.isInteger(fps/2)?[fps/2]:[])])].filter(s=>s<fps).sort((a,b)=>a-b);
 const candidates=[...frameSteps.map(step=>({step,unit:'frames',frames:step})),...SECONDS.map(step=>({step,unit:'seconds',frames:step*fps}))];
 let major=candidates.find(c=>c.frames*pxPerFrame>=minLabelSpacing);
 if(!major){const step=Math.ceil(minLabelSpacing/(pxPerFrame*fps*86400))*86400;major={step,unit:'seconds',frames:step*fps};}
 const fine=major.unit==='frames';
 const divisions=fine?frameSteps:[.1,.2,.5,...SECONDS];
 const minor=divisions.find(step=>step<major.step&&Math.abs(major.step/step-Math.round(major.step/step))<1e-7&&step*(fine?1:fps)>=1&&step*(fine?1:fps)*pxPerFrame>=minMinorSpacing)??major.step;
 const minorFrames=minor*(fine?1:fps),perMajor=Math.round(major.step/minor);
 const left=Math.max(0,Number.isFinite(scrollLeft)?scrollLeft:0);
 const first=Math.max(0,Math.floor((left/pxPerFrame-major.frames)/minorFrames));
 const last=Math.min(Math.floor(durationFrames/minorFrames),Math.ceil(((left+viewportWidth)/pxPerFrame+major.frames)/minorFrames));
 const ticks=[];
 for(let index=first;index<=last;index++){
  const frame=Math.ceil(index*minorFrames-1e-7);
  if(frame>durationFrames)continue;
  const isMajor=index%perMajor===0;
  const seconds=Math.floor(frame/fps+1e-9);
  const label=isMajor?(fine?`${clock(seconds)}:${pad(Math.floor(frame-seconds*fps+1e-7))}`:clock(index*minor)):null;
  ticks.push({frame,x:frame*pxPerFrame,label});
 }
 return {mode,majorStepFrames:major.frames,minLabelSpacing,ticks};
}
