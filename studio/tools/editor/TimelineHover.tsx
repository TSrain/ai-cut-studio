import React,{useEffect,useLayoutEffect,useRef,useState,useSyncExternalStore} from 'react';
import type {TimelineHoverController} from './timeline-hover.mjs';
import {createTimelineSnap} from './timeline-snap.mjs';
import {formatStudioTime} from './studio-state.mjs';
import './timeline-hover.css';

type Props={snap:boolean;snapPoints:number[];controller:TimelineHoverController;scrollRef:React.RefObject<HTMLDivElement>;enabled:boolean;blocked:boolean;px:number;labelWidth:number;duration:number;fps:number;documentId:string;onPlay():void};
const excluded='.production-plan-track,button,input,textarea,select,[contenteditable="true"],.track-label,.timeline-label-head,.playhead-grip';

/** Only this overlay and the preview timecode subscribe to pointer movement. */
export function TimelineHover(props:Props){
 const {controller,scrollRef,px,labelWidth,fps}=props;
 const latest=useRef(props);latest.current=props;
 const frame=useSyncExternalStore<number|null>(controller.subscribe,controller.getSnapshot);
 const magnet=useRef(createTimelineSnap()),alt=useRef(false);
 const [snapped,setSnapped]=useState(false);
 const point=useRef<{x:number;y:number}|null>(null),raf=useRef(0),refresh=useRef(()=>{});
 const cancel=()=>{magnet.current.reset();setSnapped(false);point.current=null;cancelAnimationFrame(raf.current);raf.current=0;controller.cancel();};
 useEffect(()=>{
  const el=scrollRef.current;if(!el)return;
  const update=()=>{
   raf.current=0;const p=point.current,c=latest.current;
   if(!p||!c.enabled||c.blocked){cancel();return;}
   const rect=el.getBoundingClientRect(),target=document.elementFromPoint(p.x,p.y);
   const header=el.scrollLeft>8?40:c.labelWidth;
   if(p.x<rect.left+header||p.x>=rect.left+el.clientWidth||p.y<rect.top||p.y>=rect.top+el.clientHeight||!target||!el.contains(target)||target.closest(excluded)){cancel();return;}
   const raw=(p.x-rect.left+el.scrollLeft-c.labelWidth)/c.px;
   const result=magnet.current.resolve(raw,{points:c.snapPoints,px:c.px,duration:c.duration,enabled:c.snap&&!alt.current});
   setSnapped(result.snapped);controller.preview(result.frame);
  };
  const schedule=()=>{if(point.current&&!raf.current)raf.current=requestAnimationFrame(update);};
  refresh.current=schedule;
  const move=(e:PointerEvent)=>{
   if(e.pointerType!=='mouse'||e.buttons||!latest.current.enabled||latest.current.blocked){cancel();return;}
   alt.current=e.altKey;point.current={x:e.clientX,y:e.clientY};schedule();
  };
  const down=(e:PointerEvent)=>{
   const target=e.target as HTMLElement;
   controller.capturePointerSeek(null);
   if(e.button===0&&e.pointerType==='mouse'&&el.contains(target)&&!target.closest(excluded+',.handle,[role="separator"]')){
    // Flush a queued mouse move so fast move+click still uses the visible cut.
    alt.current=e.altKey;point.current={x:e.clientX,y:e.clientY};cancelAnimationFrame(raf.current);update();
    controller.capturePointerSeek(e.clientX);
   }
   cancel();
  };
  const modifier=(e:KeyboardEvent)=>{if(e.key==='Alt'){alt.current=e.altKey;schedule();}};
  const key=(e:KeyboardEvent)=>{
   modifier(e);
   if(controller.getSnapshot()===null)return;
   if((e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable="true"]')){cancel();return;}
   if(e.code==='Space'&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();e.stopImmediatePropagation();point.current=null;cancelAnimationFrame(raf.current);raf.current=0;latest.current.onPlay();return;}
   if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();cancel();return;}
   if(!['Shift','Control','Alt','Meta'].includes(e.key))cancel();
  };
  // Capture cancels before any track's own drag/trim/select handler runs.
  el.addEventListener('pointermove',move);el.addEventListener('pointerleave',cancel);
  el.addEventListener('scroll',schedule);window.addEventListener('resize',schedule);
  window.addEventListener('pointerdown',down,true);window.addEventListener('dragstart',cancel,true);
  window.addEventListener('dragover',cancel,true);window.addEventListener('contextmenu',cancel,true);
  window.addEventListener('keyup',modifier,true);window.addEventListener('keydown',key,true);window.addEventListener('blur',cancel);
  document.addEventListener('visibilitychange',cancel);
  const unsubscribe=controller.subscribe(()=>{if(controller.getSnapshot()===null){point.current=null;cancelAnimationFrame(raf.current);raf.current=0;}});
  return()=>{
   unsubscribe();cancel();refresh.current=()=>{};
   el.removeEventListener('pointermove',move);el.removeEventListener('pointerleave',cancel);
   el.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);
   window.removeEventListener('pointerdown',down,true);window.removeEventListener('dragstart',cancel,true);
   window.removeEventListener('dragover',cancel,true);window.removeEventListener('contextmenu',cancel,true);
   window.removeEventListener('keyup',modifier,true);window.removeEventListener('keydown',key,true);window.removeEventListener('blur',cancel);
   document.removeEventListener('visibilitychange',cancel);
  };
 },[controller,scrollRef,props.documentId]);
 useLayoutEffect(()=>{magnet.current.reset();if(!props.enabled||props.blocked)cancel();else refresh.current();},[props.enabled,props.blocked,props.snap,props.snapPoints,px,props.duration]);
 if(frame===null||!props.enabled||props.blocked)return null;
 const el=scrollRef.current;
 const right=el?labelWidth+frame*px-el.scrollLeft>el.clientWidth-130:false;
 return <div className="timeline-hover-line" data-frame={frame} data-snapped={snapped} aria-hidden="true" style={{left:labelWidth+frame*px}}>
  <span className={'timeline-hover-time'+(right?' align-left':'')}>{formatStudioTime(frame,fps)}{snapped?' · 切点':''}</span>
 </div>;
}
