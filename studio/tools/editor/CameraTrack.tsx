import {TrackHeader} from './TrackHeader';
import {cameraDisplayClips,clipDensity,timelineSelection} from './timeline-view.mjs';
import {trackDrag,snapDelta,trackBoundaries} from './track-drag';
import {cameraEditReason} from './caption-camera-model.mjs';
import React,{useEffect,useRef,useState} from 'react';
import {cameraClips,clipEnd,retimeCameraClip,withCameraClips} from '../../templates/remotion-base/src/editor/camera-clips.mjs';
export function CameraTrack({doc,getDocument,onTrackMenu,px,labelWidth,selected,selectedRange,onContextMenu,onSelect,onSeek,onPointerSeek,onPreviewClip,onPreview,onCommit,snap=true,onSnap}:any){
 const cleanup=useRef<()=>void>();const [error,setError]=useState('');
 useEffect(()=>()=>cleanup.current?.(),[]);
 let clips:any[]=[];try{clips=cameraClips(doc.source?.cameraPlan);}catch{return null;}
 const fps=doc.canvas.fps.num/doc.canvas.fps.den;
 const display=cameraDisplayClips(doc);
 const currentRange=timelineSelection(doc,{cameraId:selected,cameraRange:selectedRange});
 const isSelected=(c:any)=>selected===c.id&&currentRange?.start===c.displayStart&&currentRange?.end===c.displayEnd;
 const begin=(e:React.PointerEvent,c:any,kind:string)=>{
  if(e.button!==0)return;e.stopPropagation();e.preventDefault();(e.currentTarget as HTMLElement).closest<HTMLElement>('.timeline')?.focus();cleanup.current?.();
  onSelect(c.id,{startFrame:c.displayStart,endFrame:c.displayEnd});if(kind==='move'&&onPointerSeek)onPointerSeek(e.clientX);else onSeek(c.displayStart??Math.round(c.start*fps));setError('');
  if(cameraEditReason(doc)){setError(cameraEditReason(doc));return;}
  const base=structuredClone(getDocument?.()??doc);c=cameraDisplayClips(base).find(x=>x.displayKey===c.displayKey)??c;const liveClips=cameraClips(base.source.cameraPlan);let latest=base;
  const boundaries=[...trackBoundaries(base),...liveClips.filter(x=>x.id!==c.id).flatMap(x=>[Math.round(x.start*fps),Math.round(clipEnd(x)*fps)])];
  cleanup.current=trackDrag(e,px,raw=>{
   const snapped=snap?snapDelta(raw,kind==='left'?[Math.round(c.start*fps)]:kind==='right'?[Math.round(clipEnd(c)*fps)]:[Math.round(c.start*fps),Math.round(clipEnd(c)*fps)],boundaries,px):{delta:raw,guide:null};
   const next=retimeCameraClip(c,kind,snapped.delta/fps,doc.canvas.durationFrames/fps);
   try{const plan=withCameraClips(base.source.cameraPlan,liveClips.map((x:any)=>x.id===c.id?next:x));latest={...base,source:{...base.source,cameraPlan:plan}};onPreview(latest);onSnap?.(snapped.guide);setError('');}catch{setError('镜头块不能重叠，也不能超出片长');}
  },()=>{cleanup.current=undefined;onSnap?.(null);if(JSON.stringify(latest)!==JSON.stringify(base))onCommit(base,latest);},()=>{cleanup.current=undefined;onSnap?.(null);onPreview(base);});
 };
 return <div className="track camera-track" data-camera-track="">
 <TrackHeader name="镜头变化" onMenu={onTrackMenu}/>
 {display.map((c:any,n:number)=><div key={c.displayKey} role="button" tabIndex={0} aria-label={`镜头块 ${n+1} ${c.name}`} aria-pressed={isSelected(c)} data-camera-clip={c.id} data-density={clipDensity((c.displayEnd-c.displayStart)*px)} onContextMenu={e=>onContextMenu?.(e,c)}
 className={'clip camera-clip '+(isSelected(c)?'selected ':'')+(c.enabled?'':'disabled-clip')} style={{left:labelWidth+c.displayStart*px,width:Math.max(1,(c.displayEnd-c.displayStart)*px)}}
 onPointerDown={e=>begin(e,c,'move')} onDoubleClick={()=>onPreviewClip(c)} onKeyDown={e=>{if(e.key==='Enter'){onSelect(c.id,{startFrame:c.displayStart,endFrame:c.displayEnd});onPreviewClip(c);}}} title={`${c.name} · ${(c.displayStart/fps).toFixed(2)}–${(c.displayEnd/fps).toFixed(2)}秒 · ${c.enabled?'双击预览':'已关闭'}`}>
 {!cameraEditReason(doc)&&clipDensity((c.displayEnd-c.displayStart)*px)!=='compact'&&<div className="handle left" role="separator" aria-label={`镜头开始 ${n+1}`} onPointerDown={e=>begin(e,c,'left')}/>}
 <div className="camera-phases" aria-hidden="true"><div style={{flex:c.in}}/><div className="camera-hold" style={{flex:c.hold}}/><div style={{flex:c.out}}/></div>
 <span className="clip-name" style={{position:'relative',pointerEvents:'none',overflow:'hidden',whiteSpace:'nowrap'}}>{n+1} · {c.name}</span>
 {!cameraEditReason(doc)&&clipDensity((c.displayEnd-c.displayStart)*px)!=='compact'&&<div className="handle right" role="separator" aria-label={`镜头结束 ${n+1}`} onPointerDown={e=>begin(e,c,'right')}/>}
 </div>)}
 {error&&<span role="alert" style={{position:'absolute',left:labelWidth,top:0,color:'#ffcfac',fontSize:11}}>{error}</span>}
 </div>;
}
