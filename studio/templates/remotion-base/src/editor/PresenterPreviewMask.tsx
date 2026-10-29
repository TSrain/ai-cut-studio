import React,{useId,useState}from'react';
import{staticFile}from'remotion';
import{presenterAtlasTile}from'./presenter-atlas.mjs';
import{sourceFrameAt}from'./clip-time.mjs';
import type{EditorDocument,EditorInstance}from'./types';
// Native images preload without stopping the Player clock. Keep current + next page resident.
export const PresenterMaskPreload:React.FC<{document:EditorDocument;instances:EditorInstance[];frame:number}>=({document,instances,frame})=>{
 const paths=new Set<string>();const lead=Math.ceil(document.canvas.fps.num/document.canvas.fps.den*2);
 for(const i of instances){if(i.props.presenterLayer!=='behind'||frame<i.startFrame-lead||frame>=i.startFrame+i.durationFrames)continue;
  const m=i.props.presenterForeground;const n=sourceFrameAt(document.source,Math.max(i.startFrame,frame),document.canvas.durationFrames);
  if(n===null)continue;const index=n-m.sourceStartFrame;if(index<0||index>=m.frameCount)continue;
  paths.add(presenterAtlasTile(m,index).path);const next=(Math.floor(index/64)+1)*64;if(next<m.frameCount)paths.add(presenterAtlasTile(m,next).path);
 }
 return <>{[...paths].map(path=><img key={path} src={staticFile(path)} alt="" aria-hidden decoding="async" style={{position:'absolute',width:1,height:1,opacity:0,pointerEvents:'none'}}/>)}</>;
};
export const PresenterPreviewMask:React.FC<{matte:any;index:number;geometry:{left:number;top:number;width:number;height:number};width:number;height:number;children:React.ReactNode}>=({matte,index,geometry:g,width,height,children})=>{
 const tile=presenterAtlasTile(matte,index),id=`presenter-mask-${useId().replace(/:/g,'')}`;
 const[loaded,setLoaded]=useState<Record<string,boolean>>({}),[failed,setFailed]=useState<Record<string,boolean>>({});
 // Mount both adjacent pages so changing frames only changes the SVG viewport.
 const pages=[tile,...(Math.min((tile.page+1)*tile.capacity,matte.frameCount)<matte.frameCount?[presenterAtlasTile(matte,(tile.page+1)*tile.capacity)]:[])];
 return <>
  <svg width={width} height={height} style={{position:'absolute',inset:0,pointerEvents:'none'}} aria-hidden><defs>
   <mask id={id} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x={0} y={0} width={width} height={height} style={{maskType:'luminance'}}>
    <rect width={width} height={height} fill="white"/>
    {pages.map(p=><svg key={p.path} x={g.left} y={g.top} width={g.width} height={g.height} viewBox={`${tile.x} ${tile.y} ${tile.width} ${tile.height}`} preserveAspectRatio="none" overflow="hidden" opacity={p.page===tile.page?1:0}><image href={staticFile(p.path)} width={p.columns*p.width} height={p.rows*p.height} onLoad={()=>setLoaded(prev=>({...prev,[p.path]:true}))} onError={()=>setFailed(prev=>({...prev,[p.path]:true}))}/></svg>)}
   </mask>
  </defs></svg>
  <div data-presenter-frame={index} data-presenter-preview={loaded[tile.path]?'ready':'loading'} style={{position:'absolute',inset:0,visibility:loaded[tile.path]?'visible':'hidden',maskImage:`url(#${id})`,WebkitMaskImage:`url(#${id})`}}>{children}</div>
  {failed[tile.path]&&<div role="alert" style={{position:'absolute',top:20,left:20,color:'white',background:'#802626',padding:12,fontSize:32}}>人物遮罩预览缓存缺失，请重新准备人物前景</div>}
 </>;
};
