import {PresenterPreviewMask} from './PresenterPreviewMask';
import React,{useCallback,useId,useLayoutEffect,useState} from 'react';
import {Img,staticFile,useDelayRender,useRemotionEnvironment} from 'remotion';
import {presenterFrame,presenterMaskGeometry} from './presenter-layer.mjs';
import {sourceFrameAt} from './clip-time.mjs';
import {compileShotPlan,sampleCameraZoom} from './aroll-shot-plan.mjs';
import type {EditorDocument,EditorInstance} from './types';
type Masks={urls:[string|null,string|null];loaded:[boolean,boolean];active:number|null};
type MaskProps={document:EditorDocument;instance:EditorInstance;frame:number;children:React.ReactNode};
export const PresenterMask:React.FC<MaskProps>=(props)=>{
 const {isPlayer,isRendering}=useRemotionEnvironment();
 return isPlayer&&!isRendering?<PreviewMask {...props}/>:<FullResolutionMask {...props}/>;
};
const PreviewMask:React.FC<MaskProps>=({document,instance,frame,children})=>{
 const source=document.source!,mapped=sourceFrameAt(source,frame,document.canvas.durationFrames)!;
 const fps=document.canvas.fps.num/document.canvas.fps.den;
 const zoom=sampleCameraZoom(source.cameraPlan?compileShotPlan(source.cameraPlan):[],(mapped-source.startFrame)/fps);
 const matte=instance.props.presenterForeground;
 const geometry=presenterMaskGeometry(document.canvas,matte,zoom,source.cameraPlan?.anchor??{x:.5,y:.5});
 return <PresenterPreviewMask matte={matte} index={mapped-matte.sourceStartFrame} geometry={geometry} width={document.canvas.width} height={document.canvas.height}>{children}</PresenterPreviewMask>;
};
/** Stable SVG mask with two image slots: never replace the visible image's URL. */
const FullResolutionMask:React.FC<MaskProps>=({document,instance,frame,children})=>{
 const source=document.source!;const mapped=sourceFrameAt(source,frame,document.canvas.durationFrames)!;
 const fps=document.canvas.fps.num/document.canvas.fps.den;
 const zoom=sampleCameraZoom(source.cameraPlan?compileShotPlan(source.cameraPlan):[],(mapped-source.startFrame)/fps);
 const anchor=source.cameraPlan?.anchor??{x:.5,y:.5};
 const src=staticFile(presenterFrame(document,instance,frame));
 const g=presenterMaskGeometry(document.canvas,instance.props.presenterForeground,zoom,anchor);
 const [masks,setMasks]=useState<Masks>({urls:[null,null],loaded:[false,false],active:null});
 const maskId=`presenter-mask-${useId().replace(/:/g,'')}`,blackId=`${maskId}-black`;
 const activeSrc=masks.active===null?null:masks.urls[masks.active];
 // Decode before assigning the inactive SVG slot. The visible slot stays intact.
 const onDecoded=useCallback(()=>setMasks(previous=>{
  if(previous.active!==null&&previous.urls[previous.active]===src)return previous;
  const next=previous.active===0?1:0;
  if(previous.urls[next]===src)return previous.loaded[next]?{...previous,active:next}:previous;
  const urls=[...previous.urls] as Masks['urls'];const loaded=[...previous.loaded] as Masks['loaded'];urls[next]=src;loaded[next]=false;return {...previous,urls,loaded};
 }),[src]);
 const {delayRender,continueRender}=useDelayRender();
 useLayoutEffect(()=>{
  if(activeSrc===src)return;
  const renderHandle=delayRender('Waiting for presenter SVG mask');
  return ()=>{continueRender(renderHandle);};
 },[activeSrc,src,delayRender,continueRender]);
 return <>
  <Img key={src} src={src} onImageFrame={onDecoded} style={{position:'absolute',width:1,height:1,opacity:0,pointerEvents:'none'}}/>
  <svg width={document.canvas.width} height={document.canvas.height} style={{position:'absolute',inset:0,pointerEvents:'none'}} aria-hidden>
   <defs>
    <filter id={blackId} colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"/></filter>
    <mask id={maskId} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x={0} y={0} width={document.canvas.width} height={document.canvas.height} style={{maskType:'luminance'}}>
     <rect width={document.canvas.width} height={document.canvas.height} fill="white"/>
     {masks.urls.map((url,index)=>url&&<image key={index} href={url} x={g.left} y={g.top} width={g.width} height={g.height} preserveAspectRatio="none" filter={`url(#${blackId})`} opacity={masks.active===index?1:0} onLoad={()=>setMasks(previous=>{if(previous.urls[index]!==url)return previous;const loaded=[...previous.loaded] as Masks['loaded'];loaded[index]=true;return {...previous,loaded,active:url===src?index:previous.active};})}/>)}
    </mask>
   </defs>
  </svg>
  <div style={{position:'absolute',inset:0,visibility:activeSrc?'visible':'hidden',maskImage:`url(#${maskId})`,WebkitMaskImage:`url(#${maskId})`}}>{children}</div>
 </>;
};
