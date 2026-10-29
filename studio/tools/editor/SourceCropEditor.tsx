import React, {useContext,useEffect,useRef,useState} from 'react';
import {ControlGestures,Slider} from './Controls';
import {cropRect,editCropRect} from '../../templates/remotion-base/src/editor/source-pip.mjs';
import type {CropRect} from '../../templates/remotion-base/src/editor/source-pip.mjs';
const handles=[['nw',0,0,'左上'],['n',50,0,'上'],['ne',100,0,'右上'],['e',100,50,'右'],['se',100,100,'右下'],['s',50,100,'下'],['sw',0,100,'左下'],['w',0,50,'左']] as const;
export function SourceCropEditor({props,source,canvas,startFrame,onProp}:any) {
 const video=useRef<HTMLVideoElement>(null),stage=useRef<HTMLDivElement>(null);
 const [natural,setNatural]=useState<{width:number;height:number}|null>(null);
 const gesture=useContext(ControlGestures);
 const drag=useRef<{rect:CropRect;handle:string;x:number;y:number;w:number;h:number}|null>(null);
 const sourceUrl=source?`/${(source.publicPath??source.path).replace(/^\/+/, '')}`:null;
 useEffect(()=>{setNatural(null);},[sourceUrl]);
 const aspect=natural?natural.width/natural.height:source?.width&&source?.height?source.width/source.height:props.crop?.sourceAspect??canvas.width/canvas.height;
 const rect=cropRect(props,aspect),ratio=rect.width*rect.sourceAspect/rect.height;
 const change=(next:CropRect)=>onProp('crop',next);
 const seek=()=>{if(video.current) {const fps=canvas.fps.num/canvas.fps.den;video.current.currentTime=Math.min(Math.max(0,video.current.duration-.05),((source?.startFrame??0)+startFrame)/fps);}};
 useEffect(()=>{if(video.current?.readyState)seek();},[startFrame,source?.startFrame]);
 const begin=(event:React.PointerEvent,handle:string)=>{
  if(event.button!==0)return;
  event.preventDefault();event.stopPropagation();
  const bounds=stage.current!.getBoundingClientRect();
  drag.current={rect,handle,x:event.clientX,y:event.clientY,w:bounds.width,h:bounds.height};
  stage.current!.setPointerCapture(event.pointerId);gesture.start();
 };
 const finish=()=>{if(drag.current){drag.current=null;gesture.end();}};
 useEffect(()=>()=>{if(drag.current)gesture.end();},[]);
 const key=(event:React.KeyboardEvent,handle:string)=>{
  const d=event.shiftKey?.05:.01,delta=({ArrowLeft:[-d,0],ArrowRight:[d,0],ArrowUp:[0,-d],ArrowDown:[0,d]} as any)[event.key];
  if(!delta)return;event.preventDefault();event.stopPropagation();change(editCropRect(rect,handle,delta[0],delta[1]));
 };
 return <div className="source-crop-editor" style={{padding:10,border:'1px solid #343943',borderRadius:10,margin:'10px 0'}}>
  <strong style={{fontSize:12}}>原素材取景</strong>
  <p className="hint">拖动框体选位置，拖边或角改长宽；方向键微调。</p>
  <div ref={stage} aria-label="原素材裁切示意" style={{position:'relative',width:`min(100%, ${Math.min(260,170*aspect)}px)`,aspectRatio:String(aspect),margin:'8px auto',background:'#141820',overflow:'hidden',touchAction:'none',userSelect:'none'}}
   onPointerMove={event=>{const d=drag.current;if(d)change(editCropRect(d.rect,d.handle,(event.clientX-d.x)/d.w,(event.clientY-d.y)/d.h));}}
   onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}>
   {sourceUrl&&source?.kind==='image'?<img src={sourceUrl} alt="裁切用原图" onLoad={e=>setNatural({width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight})} style={{position:'absolute',width:'100%',height:'100%',objectFit:'contain',pointerEvents:'none'}}/>:sourceUrl?<video ref={video} src={sourceUrl} muted playsInline preload="auto" onLoadedMetadata={()=>{setNatural({width:video.current!.videoWidth,height:video.current!.videoHeight});seek();}} style={{position:'absolute',width:'100%',height:'100%',objectFit:'contain',pointerEvents:'none'}}/>:<span style={{position:'absolute',inset:0,display:'grid',placeItems:'center',fontSize:11,color:'#8a93a1'}}>未导入素材 · 可先设置裁切</span>}
   <div role="button" tabIndex={0} aria-label="移动裁切区域" onKeyDown={e=>key(e,'move')} onPointerDown={e=>begin(e,'move')} style={{position:'absolute',left:`${rect.x*100}%`,top:`${rect.y*100}%`,width:`${rect.width*100}%`,height:`${rect.height*100}%`,border:'2px solid #72a5fa',boxSizing:'border-box',boxShadow:'0 0 0 500px #0008',cursor:'move'}}>
    <div style={{position:'absolute',inset:'33.33% 0',borderTop:'1px solid #ffffff55',borderBottom:'1px solid #ffffff55',pointerEvents:'none'}}/>
    <div style={{position:'absolute',inset:'0 33.33%',borderLeft:'1px solid #ffffff55',borderRight:'1px solid #ffffff55',pointerEvents:'none'}}/>
    {handles.map(([id,x,y,label])=><span key={id} role="button" tabIndex={0} aria-label={`裁切${label}控制点`} onKeyDown={e=>{e.stopPropagation();key(e,id);}} onPointerDown={e=>begin(e,id)} style={{position:'absolute',left:`${x}%`,top:`${y}%`,transform:`translate(${x===0?0:x===100?-100:-50}%,${y===0?0:y===100?-100:-50}%)`,width:10,height:10,background:'#fff',border:'1px solid #72a5fa',borderRadius:2,cursor:`${id}-resize`}}/>)}
   </div>
  </div>
  <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'#aeb8c7',gap:8}}><span>原片 {natural?`${natural.width}×${natural.height}`:`${aspect.toFixed(2)}:1`}</span><span>裁切 {ratio.toFixed(2)}:1</span></div>
  <div style={{display:'flex',flexWrap:'wrap',gap:5,margin:'8px 0'}}>{[['1:1',1],['4:3',4/3],['16:9',16/9],['9:16',9/16],['原比例',aspect]].map(([label,a])=><button key={label} onClick={()=>{const ratio=Number(a),width=Math.min(1,ratio/aspect),height=Math.min(1,aspect/ratio);change({x:(1-width)/2,y:(1-height)/2,width,height,sourceAspect:aspect});}} style={{padding:'3px 6px',fontSize:10}}>{label}</button>)}</div>
  <Slider label="裁切宽度" min={5} max={100} step={.5} value={rect.width*100} unit="%" defaultValue={100} onChange={(v:number)=>change({...rect,width:v/100,x:Math.min(rect.x,1-v/100)})}/>
  <Slider label="裁切高度" min={5} max={100} step={.5} value={rect.height*100} unit="%" defaultValue={100} onChange={(v:number)=>change({...rect,height:v/100,y:Math.min(rect.y,1-v/100)})}/>
 </div>;
}
