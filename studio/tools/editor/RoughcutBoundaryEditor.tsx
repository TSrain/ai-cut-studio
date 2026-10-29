import React,{useEffect,useMemo,useRef,useState} from 'react';
import {roughcutSnapPoints,snapToPoints,adjacentSnapPoint,SNAP_KIND_LABEL,SNAP_THRESHOLD_PX} from './roughcut-snap.mjs';

type Row={id:string;startFrame:number;endFrame:number;enabled:boolean};
type Props={row:Row;index:number;fps:number;sourceFrames:number;roughcut:any;onCommit:(patch:{startFrame:number;endFrame:number})=>void;parse:(start:string,end:string,sourceFrames:number)=>{startFrame:number;endFrame:number}};
const seconds=(frame:number,fps:number)=>`${(frame/fps).toFixed(2)} 秒`;

/** Snap-aware boundary editing: drag/nudge to word or silence points; frame entry stays as fallback. */
export function RoughcutBoundaryEditor({row,index,fps,sourceFrames,roughcut,onCommit,parse}:Props){
 const [start,setStart]=useState(String(row.startFrame)),[end,setEnd]=useState(String(row.endFrame));
 const [error,setError]=useState(''),[open,setOpen]=useState(false),[snapNote,setSnapNote]=useState('');
 useEffect(()=>{setStart(String(row.startFrame));setEnd(String(row.endFrame));setError('');setSnapNote('');},[row.startFrame,row.endFrame]);
 const dirty=start!==String(row.startFrame)||end!==String(row.endFrame);
 const points=useMemo(()=>open?roughcutSnapPoints(roughcut):[],[open,roughcut]);
 const commit=()=>{try{onCommit(parse(start,end,sourceFrames));setError('');}catch(e:any){setError(e?.message||String(e));}};
 const reset=()=>{setStart(String(row.startFrame));setEnd(String(row.endFrame));setError('');setSnapNote('');};
 const s=Number(start),e=Number(end),valid=Number.isFinite(s)&&Number.isFinite(e);
 const nudge=(edge:'start'|'end',direction:number)=>{
  const frame=edge==='start'?s:e,point=adjacentSnapPoint(points,frame,direction);
  if(!point){setSnapNote('这一侧没有更多字词或停顿吸附点');return;}
  if(edge==='start'&&point.frame>=e||edge==='end'&&point.frame<=s){setSnapNote('起点必须早于终点');return;}
  (edge==='start'?setStart:setEnd)(String(point.frame));setSnapNote(`${edge==='start'?'起点':'终点'}吸附到${SNAP_KIND_LABEL[point.kind as keyof typeof SNAP_KIND_LABEL]}${point.text?`「${point.text}」`:''}`);setError('');
 };
 return <details className="roughcut-boundaries" onToggle={event=>setOpen(event.currentTarget.open)}><summary>调整原片切点</summary>
  {open&&valid&&<BoundaryStrip start={s} end={e} fps={fps} sourceFrames={sourceFrames} roughcut={roughcut} points={points} label={`片段 ${index+1}`} onChange={(edge,frame,note)=>{(edge==='start'?setStart:setEnd)(String(frame));setSnapNote(note);setError('');}}/>}
  <div className="roughcut-nudges" aria-label={`片段 ${index+1} 吸附微调`}>
   <span>起点</span><button type="button" title="起点移到上一个字词 / 停顿边界" aria-label={`片段 ${index+1} 起点吸附到上一个边界`} onClick={()=>nudge('start',-1)}>‹</button><button type="button" title="起点移到下一个字词 / 停顿边界" aria-label={`片段 ${index+1} 起点吸附到下一个边界`} onClick={()=>nudge('start',1)}>›</button>
   <span>终点</span><button type="button" title="终点移到上一个字词 / 停顿边界" aria-label={`片段 ${index+1} 终点吸附到上一个边界`} onClick={()=>nudge('end',-1)}>‹</button><button type="button" title="终点移到下一个字词 / 停顿边界" aria-label={`片段 ${index+1} 终点吸附到下一个边界`} onClick={()=>nudge('end',1)}>›</button>
  </div>
  {snapNote&&<p className="roughcut-muted roughcut-snap-note" role="status">{snapNote}</p>}
  <details className="roughcut-frame-entry"><summary>按帧输入</summary>
   <div className="roughcut-frame-fields" onKeyDown={ev=>{ev.stopPropagation();if(ev.key==='Enter'){ev.preventDefault();commit();}else if(ev.key==='Escape')reset();}}>
    <label>起点帧<input type="number" min={0} max={sourceFrames-1} step={1} inputMode="numeric" aria-label={`片段 ${index+1} 起点帧`} value={start} onChange={ev=>{setStart(ev.target.value);setError('');setSnapNote('');}}/></label>
    <label>终点帧（不含）<input type="number" min={1} max={sourceFrames} step={1} inputMode="numeric" aria-label={`片段 ${index+1} 终点帧`} value={end} onChange={ev=>{setEnd(ev.target.value);setError('');setSnapNote('');}}/></label>
   </div>
  </details>
  <div className="roughcut-edit-actions"><span>{valid?`${seconds(s,fps)}–${seconds(e,fps)}`:''} · {fps.toFixed(3).replace(/0+$/,'').replace(/\.$/,'')} 帧/秒</span><button type="button" disabled={!dirty} onClick={reset}>还原</button><button type="button" disabled={!dirty} onClick={commit}>应用切点</button></div>
  {error&&<p role="alert" className="roughcut-error">{error}</p>}
 </details>;
}

function BoundaryStrip({start,end,fps,sourceFrames,roughcut,points,label,onChange}:{start:number;end:number;fps:number;sourceFrames:number;roughcut:any;points:any[];label:string;onChange:(edge:'start'|'end',frame:number,note:string)=>void}){
 const ref=useRef<HTMLDivElement>(null),[width,setWidth]=useState(300),[zoom,setZoom]=useState(1),[guide,setGuide]=useState<number|null>(null);
 useEffect(()=>{const el=ref.current;if(!el||typeof ResizeObserver==='undefined')return;const o=new ResizeObserver(entries=>setWidth(Math.max(120,entries[0].contentRect.width)));o.observe(el);return()=>o.disconnect();},[]);
 // Window: the cut plus context on both sides; zoom narrows the context (finer snapping).
 const length=Math.max(1,end-start),pad=Math.max(Math.round(.4*fps),Math.round((length*.6+fps)/zoom));
 const from=Math.max(0,start-pad),to=Math.min(sourceFrames,end+pad),px=width/Math.max(1,to-from);
 const x=(frame:number)=>(frame-from)*px;
 const units=useMemo(()=>(roughcut?.analysis?.units??[]).filter((u:any)=>u.endSeconds*fps>from&&u.startSeconds*fps<to),[roughcut,from,to,fps]);
 const silences=useMemo(()=>(roughcut?.analysis?.silences??[]).filter((s:any)=>s.endSeconds*fps>from&&s.startSeconds*fps<to),[roughcut,from,to,fps]);
 const drag=(edge:'start'|'end')=>(ev:React.PointerEvent)=>{
  if(ev.button!==0)return;ev.preventDefault();ev.stopPropagation();
  const rect=ref.current!.getBoundingClientRect();
  const update=(clientX:number,alt:boolean)=>{
   const raw=from+(clientX-rect.left)/px;
   const result=snapToPoints(raw,points,{pxPerFrame:px,thresholdPx:SNAP_THRESHOLD_PX,disabled:alt,min:edge==='start'?0:start+1,max:edge==='start'?end-1:sourceFrames});
   setGuide(result.snapped?result.frame:null);
   onChange(edge,result.frame,result.snapped?`${edge==='start'?'起点':'终点'}吸附到${SNAP_KIND_LABEL[result.point.kind as keyof typeof SNAP_KIND_LABEL]}${result.point.text?`「${result.point.text}」`:''}`:alt?'已按住 Option：不吸附，逐帧移动':'');
  };
  const move=(e:PointerEvent)=>update(e.clientX,e.altKey);
  const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);setGuide(null);};
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);
 };
 const keyMove=(edge:'start'|'end')=>(ev:React.KeyboardEvent)=>{
  if(ev.key!=='ArrowLeft'&&ev.key!=='ArrowRight')return;ev.preventDefault();ev.stopPropagation();
  const frame=edge==='start'?start:end,direction=ev.key==='ArrowLeft'?-1:1;
  const next=ev.altKey?frame+direction:adjacentSnapPoint(points,frame,direction)?.frame;
  if(next===undefined||(edge==='start'?next<0||next>=end:next<=start||next>sourceFrames))return;
  onChange(edge,next,ev.altKey?'逐帧移动（Option）':'已吸附到相邻字词 / 停顿边界');
 };
 return <div className="roughcut-strip-wrap">
  <div className="roughcut-strip" ref={ref} aria-label={`${label} 切点吸附条`}>
   {silences.map((s:any,i:number)=><div key={'s'+i} className="roughcut-strip-silence" style={{left:x(s.startSeconds*fps),width:Math.max(1,(s.endSeconds-s.startSeconds)*fps*px)}} title="停顿（静音检测）"/>)}
   {units.map((u:any)=><div key={u.id} className="roughcut-strip-word" style={{left:x(u.startSeconds*fps),width:Math.max(1,(u.endSeconds-u.startSeconds)*fps*px)}} title={u.text}>{(u.endSeconds-u.startSeconds)*fps*px>14?u.text:''}</div>)}
   <div className="roughcut-strip-cut" style={{left:x(start),width:Math.max(1,(end-start)*px)}}/>
   <div role="slider" tabIndex={0} aria-label={`${label} 起点`} aria-valuemin={0} aria-valuemax={end-1} aria-valuenow={start} aria-valuetext={`${(start/fps).toFixed(2)} 秒`} className="roughcut-strip-handle is-start" style={{left:x(start)}} onPointerDown={drag('start')} onKeyDown={keyMove('start')}/>
   <div role="slider" tabIndex={0} aria-label={`${label} 终点`} aria-valuemin={start+1} aria-valuemax={sourceFrames} aria-valuenow={end} aria-valuetext={`${(end/fps).toFixed(2)} 秒`} className="roughcut-strip-handle is-end" style={{left:x(end)}} onPointerDown={drag('end')} onKeyDown={keyMove('end')}/>
   {guide!==null&&<div className="roughcut-strip-guide" style={{left:x(guide)}}/>}
  </div>
  <div className="roughcut-strip-tools"><small>拖动两端吸附到字词 / 停顿；按住 Option 取消吸附</small><button type="button" aria-label="缩小切点视图" onClick={()=>setZoom(z=>Math.max(.25,z/2))}>−</button><button type="button" aria-label="放大切点视图" onClick={()=>setZoom(z=>Math.min(16,z*2))}>+</button></div>
 </div>;
}
