import React,{useEffect,useMemo,useState} from 'react';
import {timelineRuler} from './timeline-ruler.mjs';
import './timeline-ruler.css';

export function AdaptiveTimelineRuler({scrollRef,fps,durationFrames,px,viewport,labelWidth,width,children}:{scrollRef:React.RefObject<HTMLDivElement>;fps:number;durationFrames:number;px:number;viewport:number;labelWidth:number;width:number;children?:React.ReactNode}){
 const [scrollLeft,setScrollLeft]=useState(0);
 useEffect(()=>{
  const node=scrollRef.current;if(!node)return;
  let raf=0;
  const update=()=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(()=>setScrollLeft(node.scrollLeft));};
  update();node.addEventListener('scroll',update,{passive:true});
  return()=>{cancelAnimationFrame(raf);node.removeEventListener('scroll',update);};
 },[scrollRef]);
 const layout=useMemo(()=>timelineRuler({fps,durationFrames,pxPerFrame:px,viewportWidth:Math.max(1,viewport-labelWidth),scrollLeft}),[fps,durationFrames,px,viewport,labelWidth,scrollLeft]);
 return <div className="ruler adaptive-ruler" data-ruler-mode={layout.mode} data-major-step-frames={layout.majorStepFrames} style={{left:labelWidth,width}}>
  {layout.ticks.map(t=><span className={`adaptive-tick ${t.label?'major':'minor'}`} key={t.frame} data-frame={t.frame} style={{left:t.x}} aria-hidden="true">{t.label&&<span className="ruler-time-label">{t.label}</span>}</span>)}
  {children}
 </div>;
}
