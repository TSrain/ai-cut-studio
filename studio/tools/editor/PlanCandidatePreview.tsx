import React,{useEffect,useRef,useState} from 'react';
import {Icon} from './Icon';
import {planMediaUrl} from './production-plan-sync.mjs';
import {productionPlanApi} from './useProductionPlan';
function localMedia(candidate:any,projectId:string){
 const path=candidate.path??candidate.localPath;
 if(!path)return null;
 const kind=candidate.kind??(/\.(png|jpe?g|webp|gif|svg|avif)(?:[?#]|$)/i.test(path)?'image':'video');
 const url=planMediaUrl(path,projectId,true);return {path,kind,url,downloadUrl:planMediaUrl(path,projectId)+'&download=1'};
}
export const candidatePreviewKey=(c:any,projectId:string,shotId:string)=>JSON.stringify([projectId,shotId,c.id,c.path,c.localPath,c.previewPath,c.url,c.pageUrl,c.downloadUrl,c.sha256,c.license]);
export function PlanCandidatePreview({candidate:c,projectId,shotId,rangeId,onPlay,onDownload,disabled}:any){
 const [media,setMedia]=useState<any>(()=>localMedia(c,projectId));
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[notice,setNotice]=useState(''),[retryAction,setRetryAction]=useState<'preview'|'add'|'fetch'>('add');
 const pending=useRef(false);
 const alive=useRef(true);useEffect(()=>()=>{alive.current=false;},[]);
 const title=c.title||'候选素材';
 const sourceUrl=/^https?:\/\//i.test(c.pageUrl??c.url??'')?(c.pageUrl??c.url):null;
 const evidence=[['画面内容',c.visibleContent],['对应口播的理由',c.matchReason??c.reason],['审阅结论',typeof c.review?.summary==='string'?c.review.summary:undefined]].filter(([,value])=>typeof value==='string'&&value.trim());
 useEffect(()=>{
  if(media)return;
  let cancelled=false;
  void productionPlanApi('/candidate-media?'+new URLSearchParams({projectId,shotId,candidateId:c.id})).then(data=>{if(!cancelled&&data.available)setMedia(data);}).catch(()=>{});
  return ()=>{cancelled=true;};
 },[projectId,shotId,c.id]);
 const download=async(addToTimeline=true)=>{
  if(pending.current||disabled)return;pending.current=true;setBusy(true);setError('');setNotice('');
  try{
   if(addToTimeline&&!onDownload)throw new Error('当前工程尚未就绪');
   if(addToTimeline)onPlay?.();
   const value=addToTimeline?await onDownload({shotId,candidateId:c.id,...(rangeId?{rangeId}:{})}):await productionPlanApi('/candidate-download',{projectId,shotId,candidateId:c.id});
   if(addToTimeline&&(!value.instanceId||!value.added&&!value.alreadyPresent))throw new Error('素材未能加入当前段');
   if(alive.current){setMedia(value);if(value.path!==media?.path)setAttempt(v=>v+1);if(addToTimeline)setNotice(value.alreadyPresent?'已在轨道中':'已加入当前段');}
  }
  catch(e:any){if(alive.current){setRetryAction(addToTimeline?'add':'fetch');setError(e.message||'下载或入轨失败');}}
  finally{pending.current=false;if(alive.current)setBusy(false);}
 };
 const play=(e:React.SyntheticEvent<HTMLVideoElement>)=>{
  onPlay?.();document.querySelectorAll<HTMLVideoElement>('video[data-plan-candidate-video]').forEach(v=>{if(v!==e.currentTarget)v.pause();});
 };
 return <article className="plan-candidate-preview" aria-label={title+' 候选预览'}>
  <div className="plan-candidate-caption"><b>{title}</b>
   <button disabled={busy||disabled} onClick={()=>void download()} aria-label={'下载并入轨 '+title} title="下载并加入当前段"><Icon name="download" size={15}/></button>
  </div>
  <div className="plan-candidate-player">
   {media?.url&&media.kind==='video'?<video key={attempt} data-plan-candidate-video="true" src={media.url} poster={c.previewPath?planMediaUrl(c.previewPath,projectId):undefined} controls controlsList="nodownload" playsInline muted preload="metadata" aria-label={'播放 '+title} onPlay={play} onError={()=>{setRetryAction('preview');setError('预览加载失败');}}/>:media?.url?<img key={attempt} src={media.url} alt={title} loading="lazy" onError={()=>{setRetryAction('preview');setError('预览加载失败');}}/>:<button className="plan-candidate-empty" disabled={busy||disabled} onClick={()=>void download()}>{busy?'下载并入轨中…':'下载并入轨'}</button>}
   {busy&&media&&<span className="plan-candidate-loading" role="status">正在下载并入轨…</span>}
  </div>
  {(sourceUrl||evidence.length>0)&&<details className="plan-candidate-evidence"><summary>素材依据与来源</summary>{sourceUrl&&<a href={sourceUrl} target="_blank" rel="noopener noreferrer">查看原始来源</a>}{evidence.map(([label,value])=><p key={label}><strong>{label}</strong><br/>{value}</p>)}<small>{c.status??'审核状态未提供'}{c.technical?.passed?' · 技术校验通过':''} · 画面能否支持口播仍需审片确认</small></details>}
  {notice&&<small className="plan-candidate-added" role="status">{notice}</small>}
  {error&&<div className="plan-candidate-error" role="alert"><span>{error}</span><button disabled={busy} onClick={()=>{setError('');if(retryAction==='preview'&&media){setAttempt(v=>v+1);}else void download(retryAction!=='fetch');}}>重试</button>{media&&<button disabled={busy||disabled} onClick={()=>void download(false)}>重新获取</button>}</div>}
 </article>;
}
