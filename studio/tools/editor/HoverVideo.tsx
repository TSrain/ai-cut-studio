import React, {useEffect, useRef, useState} from 'react';

/** One active card owns playback; leaving or unmounting always releases it. */
export function HoverVideo({src, poster, active}: {src:string; poster?:string; active:boolean}) {
  const ref=useRef<HTMLVideoElement>(null);
  const [failed,setFailed]=useState(false);
  useEffect(()=>{setFailed(false);},[src]);
  useEffect(()=>{
    const video=ref.current;
    if(!video)return;
    let cancelled=false;
    if(active){
      video.currentTime=0;
      video.play().then(()=>{if(cancelled)video.pause();}).catch(()=>{});
    } else video.pause();
    return ()=>{cancelled=true;video.pause();};
  },[active,src]);
  return <span style={{position:'relative',display:'block',width:'100%',height:'100%'}}>
    <video ref={ref} src={src} poster={poster||undefined} muted preload="none" playsInline loop onError={()=>setFailed(true)}/>
    {failed&&active&&<span style={{position:'absolute',inset:0,display:'grid',placeItems:'center',background:'#171b22dd',color:'#bac4d5',fontSize:11}}>点击查看预览</span>}
  </span>;
}
