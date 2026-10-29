import React,{useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {resolveReviewAnchor} from './review-anchor.mjs';
import {renderDocumentKey} from './render-document.mjs';
import './review-panel.css';
async function api(path:string,body?:any){const response=await fetch('/api/editor/review/'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const data=await response.json();if(!response.ok)throw Error(data.error??'审片操作失败');return data;}
export const REVIEW_STATUS:Record<string,string>={open:'待处理',queued:'等待 Codex',running:'Codex 正在修改',ready:'待接受',applied:'待复核',verified:'复核通过',failed:'未完成',cancelled:'已停止',reverted:'已撤回',dismissed:'已忽略',delegated:'已交给镜头制作'};
export function ReviewPanel({document:doc,getDocument,save,clock,onSeek,onPause,onSync,onEdit,onPreview,preview,active,onOpenPlan}:any){
 const [notes,setNotes]=useState<any[]>([]),[text,setText]=useState(''),[anchor,setAnchor]=useState<number|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[previewJob,setPreviewJob]=useState<any>(null);
 const live=useRef<any>();live.current={doc,getDocument,save,onSync,onPreview};
 const generation=useRef(0),capturedPreviewKey=useRef('');
 const refresh=async()=>{const id=live.current.doc.id,token=generation.current;try{const data=await api('notes?projectId='+encodeURIComponent(id));if(token===generation.current&&id===live.current.doc.id)setNotes(data.notes);}catch(e:any){if(token===generation.current)setError(e.message);}};
 useEffect(()=>{generation.current++;setNotes([]);setText('');setAnchor(null);setError('');setPreviewJob(null);onPreview(null);if(!active)return;void refresh();const t=setInterval(refresh,1800);return()=>{generation.current++;clearInterval(t);};},[doc.id,active]);
 useEffect(()=>{if(!previewJob||!['running','queued'].includes(previewJob.status))return;let cancelled=false;const id=doc.id,key=previewJob.key;const t=setInterval(async()=>{try{const job=await api(`preview?projectId=${encodeURIComponent(id)}&key=${key}`);if(cancelled||live.current.doc.id!==id)return;setPreviewJob(job);if(job.status==='ready')live.current.onPreview({...job,contentKey:capturedPreviewKey.current});}catch(e:any){if(!cancelled)setError(e.message);}},1500);return()=>{cancelled=true;clearInterval(t);};},[previewJob?.key,previewJob?.status,doc.id]);
 const perform=async(fn:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');try{await fn();}catch(e:any){setError(e.message);}finally{setBusy(false);}};
 const submit=()=>perform(async()=>{const id=doc.id,frame=anchor??clock.getSnapshot(),comment=text.trim();if(!comment)return;onPause();const saved=await save();if(live.current.doc.id!==id)throw Error('工程已切换');await api('notes',{projectId:id,revision:saved.revision,frame,text:comment});if(live.current.doc.id===id){setText('');setAnchor(null);await refresh();}});
 const act=(note:any,operation:string,status?:string)=>perform(async()=>{const id=doc.id;if(['accept','revert','delegate'].includes(operation)){
  const base=await save();if(live.current.doc.id!==id)throw Error('工程已切换');const data=await api(operation,{projectId:id,id:note.id,revision:base.revision});if(live.current.doc.id===id){if(data.document)onSync(base,data.document);if(operation==='delegate')onOpenPlan?.(note.anchor.shotId);}
 }else await api(operation,{projectId:id,id:note.id,status});if(live.current.doc.id===id)await refresh();});
 const generate=()=>perform(async()=>{onPause();const id=doc.id,token=generation.current,base=await save();if(live.current.doc.id!==id)throw Error('工程已切换');capturedPreviewKey.current=renderDocumentKey(base);const job=await api('preview',{projectId:id,revision:base.revision});if(live.current.doc.id!==id||token!==generation.current)return;setPreviewJob(job);if(job.status==='ready')onPreview({...job,contentKey:capturedPreviewKey.current});});
 if(!active)return null;
 const stale=preview&&preview.contentKey!==renderDocumentKey(doc);
 return <aside className="review-panel" aria-label="审片意见">
  <div className="review-panel-heading"><strong>审片</strong><button onClick={onEdit}>进入精调</button></div>
  <div className="review-preview-controls"><button disabled={busy||['queued','running'].includes(previewJob?.status)} onClick={generate}>{['queued','running'].includes(previewJob?.status)?'正在生成连续预览…':preview?'更新连续预览':'生成流畅预览'}</button>{['queued','running'].includes(previewJob?.status)&&<button onClick={()=>perform(async()=>setPreviewJob(await api('preview-cancel',{projectId:doc.id,key:previewJob.key})))}>停止预览</button>}{preview&&<button onClick={()=>onPreview(null)}>实时画面</button>}
  <small role="status">{stale?'画面已有修改，预览已过期；当前显示实时画面':preview?'连续预览已就绪':['failed','cancelled'].includes(previewJob?.status)?(previewJob.error??'预览已停止'):['queued','running'].includes(previewJob?.status)?(previewJob.progress?.detail??'预览任务排队中'):'实时画面 · 复杂场景可生成连续预览'}</small></div>
  <form onSubmit={e=>{e.preventDefault();void submit();}}>
   <label htmlFor="review-comment">{anchor===null?'在当前画面留下意见':`意见位置 ${(anchor/(doc.canvas.fps.num/doc.canvas.fps.den)).toFixed(2)} 秒`}</label>
   <textarea id="review-comment" value={text} maxLength={4000} placeholder="例如：把这句字幕上移一些，保留其他画面" onFocus={()=>{onPause();if(anchor===null)setAnchor(clock.getSnapshot());}} onChange={e=>setText(e.target.value)} />
   <div><button type="button" onClick={()=>{onPause();setAnchor(clock.getSnapshot());}}>定位到当前画面</button><button className="primary" disabled={busy||!text.trim()}>提交给 Codex</button></div>
   <small>保存当前版本，后台生成修改建议，接受后应用。</small>
  </form>
  {error&&<p className="review-error" role="alert">{error}</p>}
  <div className="review-note-list">{!notes.length&&<p className="review-empty">边看边记。每条意见会保留时间、原始版本和画面。</p>}{notes.map(note=><article key={note.id} className="review-note" data-status={note.status}>
   <div className="review-note-heading"><button onClick={()=>{onPause();const frame=resolveReviewAnchor(live.current.doc,note.anchor);if(frame===null){setError('这段原片已不在当前时间轴，保留旧版截图供复核');return;}onSeek(frame);}}>{(note.anchor.frame/note.anchor.fps).toFixed(2)} 秒</button><span>{note.status==='running'&&note.stage==='capturing'?'正在保存批注画面':REVIEW_STATUS[note.status]??note.status}</span></div>
   {note.screenshot&&<button className="review-frame" onClick={()=>{onPause();const frame=resolveReviewAnchor(live.current.doc,note.anchor);if(frame===null){setError('这段原片已不在当前时间轴，保留旧版截图供复核');return;}onSeek(frame);}} aria-label="定位批注画面"><img loading="lazy" src={`/api/editor/review/frame?projectId=${encodeURIComponent(doc.id)}&id=${note.id}`} alt={`版本 ${note.anchor.revision} 的批注画面`}/></button>}
   <p>{note.text}</p><small>记录于版本 {note.anchor.revision}{note.anchor.sourceFrame!==null?` · 原片 ${(note.anchor.sourceFrame/note.anchor.fps).toFixed(2)} 秒`:''}</small>
   {note.result&&<><p>{note.result.summary}</p><ul className="review-diff">{note.result.patches.map((p:any)=><li key={p.key}><span>{p.label??'当前片段'}</span><del>{String(p.before??'')}</del><strong>{String(p.value)}</strong></li>)}</ul>{note.result.gaps?.map((gap:string,i:number)=><p className="review-gap" key={i}>{gap}</p>)}</>}
   {note.status==='ready'&&note.anchor.shotId&&!!note.result?.gaps?.length&&<div className="review-gap"><small>需要替换素材或调整制作安排时，将只运行本镜头的现有制作流程；结果在制作计划中复核和撤回。</small><button disabled={busy} onClick={()=>act(note,'delegate')}>按此意见修改本镜头</button></div>}{note.jobId&&<button onClick={()=>onOpenPlan?.(note.anchor.shotId)}>查看镜头任务与差异</button>}
   {note.screenshotError&&<small className="review-gap">画面截图未生成；本次修改仅使用文字和工程参数。</small>}
   {note.error&&<p role="alert" className="review-error">{note.error}</p>}
   <div className="review-note-actions">{['running','queued'].includes(note.status)?<button disabled={busy} onClick={()=>act(note,'cancel')}>停止</button>:['open','failed','cancelled'].includes(note.status)?<button disabled={busy} onClick={()=>act(note,'retry')}>重试修改</button>:note.status==='ready'?<><button disabled={busy||!note.result?.patches.length} onClick={()=>act(note,'accept')}>接受修改</button><button disabled={busy} onClick={()=>act(note,'finish','dismissed')}>忽略</button></>:['applied','verified'].includes(note.status)?<>{note.status==='applied'&&<button disabled={busy} onClick={()=>act(note,'finish','verified')}>复核通过</button>}<button disabled={busy} onClick={()=>act(note,'revert')}>撤回修改</button></>:null}<button onClick={()=>{const frame=resolveReviewAnchor(live.current.doc,note.anchor);if(frame===null){setError('这段原片已不在当前时间轴，保留旧版截图供复核');return;}onSeek(frame);onEdit();}}>精调此处</button></div>
  </article>)}</div>
 </aside>;
}
export function ReviewScrubber({document:doc,clock,onSeek,notes=[]}:any){
 const frame=useSyncExternalStore<number>(clock.subscribe,clock.getSnapshot),fps=doc.canvas.fps.num/doc.canvas.fps.den;
 const shots=doc.productionPlan?.shots?.filter((s:any)=>!s.cancelled)??[];
 const clips=shots.length?[]:doc.source?.clips??[];
 return <div className="review-scrubber"><div><span>{(frame/fps).toFixed(2)} / {(doc.canvas.durationFrames/fps).toFixed(2)} 秒</span><input aria-label="审片播放位置" type="range" min={0} max={doc.canvas.durationFrames-1} value={frame} onChange={e=>onSeek(Number(e.target.value))}/></div><nav aria-label="审片场景">{shots.map((s:any)=>s.timing?.ranges?.[0]&&<button key={s.id} onClick={()=>onSeek(s.timing.ranges[0].startFrame)}>{s.title??s.narration?.slice(0,16)??s.id}</button>)}{clips.map((c:any,i:number)=><button key={c.id} onClick={()=>onSeek(c.startFrame)}>片段 {i+1}</button>)}</nav></div>;
}
