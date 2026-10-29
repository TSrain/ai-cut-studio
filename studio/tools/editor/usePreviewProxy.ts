import {useEffect,useState} from 'react';
import type {EditorDocument} from '../../templates/remotion-base/src/editor/types';
type PreviewSource={path:string;url:string};
type Candidate={sourceKey:string;preview?:PreviewSource};
/** Ephemeral Player state only: never mutate the saved document or export props. */
export function usePreviewProxy(source:EditorDocument['source'],playing:boolean) {
 const path=source?.path??'',sourceKey=JSON.stringify([path,source?.publicPath??'']);
 const [candidate,setCandidate]=useState<Candidate|null>(null);
 const [applied,setApplied]=useState<Candidate|null>(null);
 useEffect(()=>{
  if(!path)return;
  let cancelled=false,timer:ReturnType<typeof setTimeout>|undefined,errors=0;
  const controller=new AbortController();
  const poll=async()=>{
   try{
    const response=await fetch('/api/editor/preview-proxy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path}),signal:controller.signal});
    if(!response.ok)throw Error('preview unavailable');
    const job=await response.json();if(cancelled)return;errors=0;
    if(job.status==='ready'&&typeof job.url==='string'&&job.url.startsWith('/workspace/editor-preview-proxy/')){
     setCandidate(previous=>previous?.sourceKey===sourceKey&&previous.preview?.url===job.url?previous:{sourceKey,preview:{path,url:job.url}});
    }else setCandidate(previous=>previous?.sourceKey===sourceKey&&!previous.preview?previous:{sourceKey});
    // Recheck file identity even after a cache hit; long interval keeps idle work small.
    if(['ready','queued','running'].includes(job.status))timer=setTimeout(poll,job.status==='ready'?30000:1500);
   }catch{
    if(!cancelled&&++errors<3)timer=setTimeout(poll,5000);
   }
  };
  void poll();
  return()=>{cancelled=true;controller.abort();clearTimeout(timer);};
 },[path,sourceKey]);
 useEffect(()=>{
  // Swapping a decoder during playback can briefly stall/desynchronise it.
  if(!playing&&candidate?.sourceKey===sourceKey)setApplied(candidate);
 },[playing,candidate,sourceKey]);
 return applied?.sourceKey===sourceKey?applied.preview:undefined;
}
