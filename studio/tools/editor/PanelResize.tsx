import React,{useEffect,useRef,useState} from 'react';
import './panel-resize.css';
type PanelSide='library'|'inspector';
const defaults={library:260,inspector:284};
const clamp=(value:number)=>Math.max(200,Math.min(380,Math.round(value)));
/** Mount as a direct child of .workspace. Absolute handles do not add grid cells. */
export function PanelResize({side}:{side:PanelSide}){
 const ref=useRef<HTMLDivElement>(null),cancel=useRef<null|(()=>void)>(null),[width,setWidth]=useState(defaults[side]);
 const key=`motion-studio.panel-width.${side}`;
 const apply=(value:number,persist=false)=>{const next=clamp(value);ref.current?.closest<HTMLElement>('.workspace')?.style.setProperty(`--${side}-width`,`${next}px`);setWidth(next);if(persist)try{localStorage.setItem(key,String(next));}catch{}return next;};
 useEffect(()=>{let saved=defaults[side];try{const raw=localStorage.getItem(key);if(raw!==null&&Number.isFinite(Number(raw)))saved=clamp(Number(raw));}catch{}apply(saved);return()=>cancel.current?.();},[side]);
 const begin=(event:React.PointerEvent<HTMLDivElement>)=>{
  if(event.button!==0)return;event.preventDefault();event.stopPropagation();cancel.current?.();event.currentTarget.focus();
  const original=width,start=event.clientX;let next=original;
  const move=(e:PointerEvent)=>{next=apply(original+(e.clientX-start)*(side==='library'?1:-1));};
  const clean=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',abort);window.removeEventListener('blur',abort);window.removeEventListener('keydown',keyDown,true);cancel.current=null;};
  const finish=()=>{clean();apply(next,true);};const abort=()=>{clean();apply(original);};const keyDown=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();abort();}};
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',finish,{once:true});window.addEventListener('pointercancel',abort,{once:true});window.addEventListener('blur',abort,{once:true});window.addEventListener('keydown',keyDown,true);cancel.current=abort;
 };
 return <div ref={ref} className={`panel-resize panel-resize-${side}`} role="separator" tabIndex={0} aria-label={side==='library'?'调整素材库宽度':'调整属性面板宽度'} aria-orientation="vertical" aria-valuemin={200} aria-valuemax={380} aria-valuenow={width} aria-valuetext={`${width} 像素`} title="拖动调整宽度；方向键微调，Home / End 最窄 / 最宽" onPointerDown={begin} onDoubleClick={()=>apply(defaults[side],true)} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();e.stopPropagation();const step=e.shiftKey?20:8;apply(e.key==='Home'?200:e.key==='End'?380:width+(e.key==='ArrowRight'?1:-1)*(side==='library'?1:-1)*step,true);}}/>;
}
