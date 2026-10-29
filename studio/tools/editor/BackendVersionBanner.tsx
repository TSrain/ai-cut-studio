import React,{useEffect,useState} from 'react';
import {backendBanner} from './backend-version.mjs';
// Polls the panel server's build status; shows a top banner when the running server
// is older than the working tree (HEAD changed or sources edited after it started).
export function BackendVersionBanner({interval=20000}:{interval?:number}){
 const [banner,setBanner]=useState<{text:string;detail:string}|null>(null);
 useEffect(()=>{
  let stopped=false,timer:ReturnType<typeof setTimeout>;
  const poll=async()=>{
   try{const r=await fetch('/api/build-info',{cache:'no-store'});if(r.ok&&!stopped)setBanner(backendBanner(await r.json()));}catch{}
   if(!stopped)timer=setTimeout(poll,interval);
  };
  poll();return()=>{stopped=true;clearTimeout(timer);};
 },[interval]);
 if(!banner)return null;
 return <div role="alert" title={banner.detail} style={{position:'fixed',top:0,left:0,right:0,zIndex:10000,padding:'6px 12px',background:'#b42318',color:'#fff',font:'13px/1.4 system-ui',textAlign:'center'}}>{banner.text}{banner.detail?`：${banner.detail}`:''}</div>;
}
