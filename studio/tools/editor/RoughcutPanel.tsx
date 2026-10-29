import React,{useEffect,useMemo,useRef,useState} from 'react';
import {adoptRoughcutCutManually,createRoughcut,resetRoughcut,roughcutRows,roughcutSourceKey,roughcutSrt,setRoughcutCut} from './roughcut-model.mjs';
import './roughcut-panel.css';
import {TranscriptView} from './TranscriptView';
import {RoughcutBoundaryEditor} from './RoughcutBoundaryEditor';
import {reviewHotkeyCommand,isEditingTarget,adjacentRow,reviewDecision} from './review-hotkeys.mjs';
import {roughcutSnapPoints,snapToPoints,projectToSourceFrame,SNAP_KIND_LABEL} from './roughcut-snap.mjs';

export {roughcutSourceKey};
type RoughcutJob={id:string;documentId:string;sourceKey:string;status:'running'|'complete'|'failed';stage?:string;error?:string;analysis?:any};
type Baseline={documentId:string;sourceKey:string;fingerprint:string};
type Task={job:RoughcutJob;baseline:Baseline;applied?:boolean;conflict?:string;pollError?:string};
type Props={previewSource?:{path:string;url:string};onTranscriptEdit?:(result:any)=>void;getFrame?:()=>number;onSplitAtPlayhead?:()=>string|void;hotkeys?:boolean;pxPerFrame?:number;document:any;getDocument:()=>any;save:()=>Promise<any>;onChange:(document:any)=>void;onSeek:(frame:number)=>void;onPlayCut:(frame:number,loop?:boolean)=>void;onPause:()=>void;onChooseSource:()=>void;onOpenDocument:(document:any)=>void;active:boolean;playing?:boolean};
type Cut={id:string;kind:string;unitIds?:string[];text:string;reason:string;reviewReason?:string;confidence?:number;review:boolean;enabled:boolean;safeToEnable?:boolean;manual?:boolean;startFrame:number;endFrame:number;projectFrame:number};
const stages:Record<string,string>={queued:'等待分析',preparing:'读取原片',probing:'检查原片',transcribing:'获取共享转写',recognizing:'识别口播',reusing:'复用已有转写',analyzing:'分析口播与停顿',audio:'分析停顿',silence:'分析停顿',aligning:'核对字词时间',semantic:'判断重复与口误',reviewing:'判断重复与口误',deciding:'判断重复与口误',validating:'校验粗剪结果',complete:'分析完成',failed:'分析失败',stale:'进度已过期（后台进程已退出）'};
const kinds:Record<string,string>={'complete-take':'重录与录制余量',aside:'录制插话',silence:'停顿',pause:'停顿',retake:'重说',repeat:'重复',repetition:'重复',filler:'口头语',mistake:'口误',false_start:'中断',interruption:'中断'};

// Ignore save revisions and presentation-only changes; protect the content and timing
// the analysis will replace, along with any newly added timeline material.
export function roughcutEditFingerprint(doc:any){
 return JSON.stringify({sourceKey:roughcutSourceKey(doc),sourceLocked:doc.source?.locked,sourceCamera:doc.source?.cameraPlan,duration:doc.canvas?.durationFrames,captions:doc.captions?{enabled:doc.captions.enabled,cues:doc.captions.cues?.map(({style,...cue}:any)=>cue)}:undefined,instances:doc.instances,tracks:doc.tracks,audioClips:doc.audioClips,audioTracks:doc.audioTracks,roughcut:doc.roughcut,productionPlan:doc.productionPlan},(_,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value);
}
export function roughcutApplyConflict(doc:any,job:RoughcutJob,baseline:Baseline){
 if(!doc||doc.id!==baseline.documentId||job.documentId!==baseline.documentId)return '已切换工程，结果保留在原工程的粗剪面板。';
 if(!doc.source)return '原片已经移除，未应用这次结果。';
 try{
  if(job.sourceKey!==baseline.sourceKey||roughcutSourceKey(doc)!==baseline.sourceKey)return '原片或片段映射已经变化，未应用这次结果。';
  if(roughcutEditFingerprint(doc)!==baseline.fingerprint)return '分析期间时间轴或字幕已有修改，未覆盖当前编辑。';
 }catch(e){return `无法核验当前原片，结果已保留：${errorText(e)}`;}
 return '';
}
export function parseRoughcutBoundary(start:string,end:string,sourceFrames:number){
 if(!/^\d+$/.test(start.trim())||!/^\d+$/.test(end.trim()))throw new Error('切点须为非负整数帧。');
 const startFrame=Number(start),endFrame=Number(end);
 if(!Number.isSafeInteger(startFrame)||!Number.isSafeInteger(endFrame))throw new Error('切点须为有效整数帧。');
 if(endFrame<=startFrame)throw new Error('终点必须晚于起点。');
 if(endFrame>sourceFrames)throw new Error(`终点不能超出原片（${sourceFrames} 帧）。`);
 return {startFrame,endFrame};
}
export function roughcutSourceUrl(source:any){
 const path=source?.publicPath??source?.path;
 return typeof path==='string'&&path?'/'+path.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/'):'';
}
const taskStorageKey='motion-roughcut-tasks-v1';
export function serializeRoughcutTasks(tasks:Record<string,Task>){
 return JSON.stringify(Object.values(tasks).filter(task=>!task.applied&&['running','complete'].includes(task.job.status)).map(task=>({
  job:{id:task.job.id,documentId:task.job.documentId,sourceKey:task.job.sourceKey,status:'running',stage:task.job.stage},
  baseline:task.baseline,...(task.conflict?{conflict:task.conflict}:{}),
 })));
}
export function restoreRoughcutTasks(value:string|null){
 const result:Record<string,Task>={};
 try{
  const saved=JSON.parse(value??'[]');if(!Array.isArray(saved))return result;
  for(const item of saved){
   const {job,baseline}=item??{};
   if(!job||!baseline||typeof job.id!=='string'||!job.id||typeof job.documentId!=='string'||!job.documentId||typeof job.sourceKey!=='string'||!job.sourceKey||job.status!=='running'||job.documentId!==baseline.documentId||job.sourceKey!==baseline.sourceKey||typeof baseline.fingerprint!=='string')continue;
   result[job.documentId]={job:{id:job.id,documentId:job.documentId,sourceKey:job.sourceKey,status:'running',stage:typeof job.stage==='string'?job.stage:undefined},baseline:{documentId:baseline.documentId,sourceKey:baseline.sourceKey,fingerprint:baseline.fingerprint},...(typeof item.conflict==='string'?{conflict:item.conflict}:{})};
  }
 }catch{}
 return result;
}
function loadTasks(){try{return typeof window==='undefined'?{}:restoreRoughcutTasks(window.localStorage.getItem(taskStorageKey));}catch{return {};}}
function persistTasks(tasks:Record<string,Task>){try{if(typeof window!=='undefined')window.localStorage.setItem(taskStorageKey,serializeRoughcutTasks(tasks));}catch{}}
function time(seconds:number){
 const value=Math.max(0,Number.isFinite(seconds)?seconds:0),minutes=Math.floor(value/60);
 return `${String(minutes).padStart(2,'0')}:${(value%60).toFixed(2).padStart(5,'0')}`;
}
function errorText(error:any){return error?.message||String(error||'操作失败');}
async function request(path:string,body?:any,signal?:AbortSignal){
 const response=await fetch(`/api/editor/roughcut/${path}`,{method:body?'POST':'GET',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),signal});
 let result:any;
 try{result=await response.json();}catch{throw new Error(`服务未返回有效结果（${response.status}）。`);}
 if(!response.ok)throw new Error(typeof result.error==='string'?result.error:result.error?.message||result.message||`请求失败（${response.status}）。`);
 return result;
}
function readJob(payload:any):RoughcutJob{
 const job=payload.job??payload;
 if(!job?.id||!job.documentId||!job.sourceKey||!['running','complete','failed'].includes(job.status))throw new Error('粗剪任务信息不完整。');
 return job;
}

function reviewReasonText(reason:string){
 return [...new Set(reason.replace(/zero_duration_alignment|zero_alignment/g,'部分字词无法单独定位').replace(/possible_missing_transcript/g,'可能有漏识别的原话').split('；').map(part=>part.trim()).filter(Boolean))].join('；');
}

function CutRow({row,index,fps,sourceFrames,roughcut,onEdit,onAdopt,onPreview,onOriginal,onSeek,previewing,focused,onFocus}: {row:Cut;index:number;fps:number;sourceFrames:number;roughcut:any;onEdit:(id:string,patch:any)=>void;onAdopt:(id:string)=>void;onPreview:()=>void;onOriginal:()=>void;onSeek:()=>void;previewing:boolean;focused?:boolean;onFocus?:()=>void}){
 const [error,setError]=useState('');const ref=useRef<HTMLElement>(null);
 useEffect(()=>{if(focused)ref.current?.scrollIntoView?.({block:'nearest'});},[focused]);
 const toggle=()=>{try{onEdit(row.id,{enabled:!row.enabled});setError('');}catch(e){setError(errorText(e));}};
 const adopt=()=>{try{onAdopt(row.id);setError('');}catch(e){setError(errorText(e));}};
 return <article ref={ref} data-roughcut-row={row.id} className={`roughcut-row${row.enabled?' is-removed':''}${row.review&&!row.enabled?' needs-review':''}${focused?' is-focused':''}`} aria-label={`粗剪片段 ${index+1}`} aria-current={focused?'true':undefined} onPointerDown={onFocus}>
  <header className="roughcut-row-heading"><span>{kinds[row.kind]??'口播片段'}</span><span className="roughcut-badge">{row.enabled?'已删除':row.review?'待检查 · 已保留':'已恢复'}{row.manual?' · 手动采用':''}</span></header>
  <p className="roughcut-quote">{row.text||'无口播文字的停顿'}</p>
  <p className="roughcut-reason">{row.reason||'粗剪候选'}{row.reviewReason&&row.reviewReason!==row.reason?` · ${reviewReasonText(row.reviewReason)}`:''}</p>
  <button type="button" className="roughcut-time" onClick={onSeek}>原片 {time(row.startFrame/fps)}–{time(row.endFrame/fps)} <span>定位切口</span></button>
  <div className="roughcut-row-actions">
   <button type="button" onClick={onPreview}>预览切口</button>
   <button type="button" aria-pressed={previewing} onClick={onOriginal}>播放原片</button>
   <button type="button" className={row.enabled?'':'roughcut-delete'} disabled={!row.enabled&&row.safeToEnable===false&&!row.manual} onClick={toggle}>{row.enabled?'恢复这段':'删除这段'}</button>
  </div>
  {row.safeToEnable===false&&!row.enabled&&!row.manual&&<><p className="roughcut-muted">这段未自动删除，需先播放原片核对。手动采用会删除所列整段，可恢复。</p><button type="button" className="roughcut-delete" onClick={adopt}>手动删除整段</button></>}
  <RoughcutBoundaryEditor row={row} index={index} fps={fps} sourceFrames={sourceFrames} roughcut={roughcut} parse={parseRoughcutBoundary} onCommit={patch=>onEdit(row.id,patch)}/>
  {error&&<p role="alert" className="roughcut-error">{error}</p>}
 </article>;
}

export function roughcutLoopCleanup(active:boolean,loop:{current:boolean},onPause:()=>void){
 return ()=>{if(active&&loop.current){loop.current=false;onPause();}};
}

export function RoughcutPreviewControls({loop,onLoopChange,onStop}:{loop:boolean;onLoopChange:(loop:boolean)=>void;onStop:()=>void}){
 return <div className="roughcut-preview-controls">
  <label><input type="checkbox" checked={loop} onChange={event=>{const enabled=event.currentTarget.checked;onLoopChange(enabled);if(!enabled)onStop();}}/>循环切口</label>
  <button type="button" onClick={onStop}>停止预览</button>
 </div>;
}

export function RoughcutPanel(props:Props){
 const {document:doc,active,playing=false}=props;
 const live=useRef(props);live.current=props;
 const [tasks,setTasks]=useState<Record<string,Task>>(loadTasks),tasksRef=useRef(tasks);tasksRef.current=tasks;
 const [busy,setBusy]=useState<{id:string;action:'start'|'copy'}|null>(null),busyRef=useRef(false);
 const [message,setMessage]=useState(''),[notice,setNotice]=useState('');
 const [copies,setCopies]=useState<Record<string,any>>({});
 const [filter,setFilter]=useState<'all'|'removed'|'review'>('all');
 const [loopCut,setLoopCut]=useState(false),cutLoopStarted=useRef(false);
 const [preview,setPreview]=useState<{documentId:string;id:string;start:number;end:number;text:string}|null>(null);
 const [focusId,setFocusId]=useState<string|null>(null);
 const [view,setView]=useState<'segments'|'transcript'>(()=>{try{return localStorage.getItem('motion-roughcut-view')==='transcript'?'transcript':'segments';}catch{return 'segments';}});
 useEffect(()=>{try{localStorage.setItem('motion-roughcut-view',view);}catch{}},[view]);
 const videoRef=useRef<HTMLVideoElement>(null),mounted=useRef(true),appliedJobs=useRef(new Set<string>());
 const task=tasks[doc.id],running=task?.job.status==='running',ownBusy=busy?.id===doc.id;
 const fps=doc.canvas.fps.num/doc.canvas.fps.den;
 // roughcutRows validates the whole roughcut state (fingerprints = full serialization);
 // recompute only when the document object changes, not on every render/poll tick.
 const {rows,rowError}=useMemo(()=>{try{return {rows:roughcutRows(doc) as Cut[],rowError:''};}catch(e){return {rows:[] as Cut[],rowError:errorText(e)};}},[doc]);
 const sourceFrames=doc.source?.durationFrames??Math.round((doc.roughcut?.analysis?.sourceDurationSeconds??doc.canvas.durationFrames/fps)*fps);
 const [originalProxy,setOriginalProxy]=useState<string|undefined>();
 const sourceUrl=originalProxy??roughcutSourceUrl(doc.source);
 const removed=rows.filter(row=>row.enabled).length,review=rows.filter(row=>row.review&&!row.enabled).length;
 const visible=rows.filter(row=>filter==='all'||(filter==='removed'?row.enabled:row.review&&!row.enabled));
 const pauseOriginal=()=>videoRef.current?.pause();
 const showMessage=(id:string,text:string)=>{if(mounted.current&&live.current.getDocument()?.id===id)setMessage(text);};
 const updateTask=(id:string,jobId:string,patch:Partial<Task>)=>setTasks(previous=>previous[id]?.job.id===jobId?{...previous,[id]:{...previous[id],...patch}}:previous);

 useEffect(()=>{persistTasks(tasks);},[tasks]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;videoRef.current?.pause();};},[]);
 useEffect(()=>{pauseOriginal();setPreview(null);setMessage('');setNotice('');setFilter('all');setLoopCut(false);setFocusId(null);},[doc.id,doc.source?.path,doc.source?.publicPath]);
 // Review hotkeys (see review-hotkeys.mjs). Transport J/K/L and ? live in the editor shell.
 const hotkeyState=useRef<any>(null);
 hotkeyState.current={rows:visible,focusId,doc};
 useEffect(()=>{
  if(!active||props.hotkeys===false||!doc.roughcut)return;
  const handler=(e:KeyboardEvent)=>{
   if(e.defaultPrevented)return;
   const command=reviewHotkeyCommand(e,{editing:isEditingTarget(e.target),modal:false,review:true});
   if(!command||command==='help'||command.startsWith('transport-'))return;
   e.preventDefault();
   const {rows:list,focusId:currentId}=hotkeyState.current,frame=live.current.getFrame?.()??0;
   const current=live.current.getDocument(),sourceFrame=projectToSourceFrame(current,frame);
   const focused=list.find((row:Cut)=>row.id===currentId)??list.find((row:Cut)=>sourceFrame>=row.startFrame&&sourceFrame<row.endFrame)??null;
   try{
    if(command==='next'||command==='previous'){
     const row=adjacentRow(list,focused?.id??null,command==='next'?1:-1,sourceFrame);
     if(row){setFocusId(row.id);pauseOriginal();live.current.onSeek(row.projectFrame);setNotice(`片段 ${list.indexOf(row)+1}/${list.length}：${row.text||'停顿'}`);}
     return;
    }
    if(command==='split'){const result=live.current.onSplitAtPlayhead?.();if(typeof result==='string')setNotice(result);return;}
    if(!focused){setNotice('先用 N / P 选择一个片段');return;}
    setFocusId(focused.id);
    if(command==='markIn'||command==='markOut'){
     const points=roughcutSnapPoints(current.roughcut),fps=current.canvas.fps.num/current.canvas.fps.den;
     // Generous capture (≈0.25 s) so I/O land on a whole-word boundary the model accepts.
     const snapped=snapToPoints(sourceFrame,points,{pxPerFrame:1,thresholdPx:Math.max(2,Math.round(.25*fps)),min:command==='markIn'?0:focused.startFrame+1,max:command==='markIn'?focused.endFrame-1:sourceFrames});
     const patch=command==='markIn'?{startFrame:snapped.frame}:{endFrame:snapped.frame};
     hotkeyState.current.changeCut(focused.id,patch);
     setNotice(`${command==='markIn'?'起点':'终点'}已设到 ${time(snapped.frame/fps)}${snapped.snapped?`（${SNAP_KIND_LABEL[snapped.point.kind as keyof typeof SNAP_KIND_LABEL]}）`:''}`);
     return;
    }
    const decision=reviewDecision(focused,command);
    if(!decision){setNotice(focused.enabled?'这段已删除':'这段已保留');return;}
    if('blocked' in decision){setMessage(decision.blocked as string);return;}
    if('adopt' in decision)hotkeyState.current.adoptCut(focused.id);else hotkeyState.current.changeCut(focused.id,decision.patch);
    setNotice(command==='reject'||(command==='toggle'&&focused.enabled)?'已保留这段（可撤销）':'已删除这段（可撤销）');
   }catch(error){setMessage(errorText(error));}
  };
  window.addEventListener('keydown',handler);
  return()=>window.removeEventListener('keydown',handler);
 },[active,props.hotkeys,!!doc.roughcut,sourceFrames]);
 useEffect(()=>{if(!active||playing)pauseOriginal();},[active,playing]);
 useEffect(()=>roughcutLoopCleanup(active,cutLoopStarted,()=>live.current.onPause()),[active,doc.id]);
 // Keep polling while the panel is hidden or another project is open.
 useEffect(()=>{
  let stopped=false,timer:ReturnType<typeof setTimeout>;const controller=new AbortController();
  const poll=async()=>{
   const entries=Object.values(tasksRef.current).filter(entry=>entry.job.status==='running');
   await Promise.all(entries.map(async entry=>{
    try{
     const next=readJob(await request(`job?id=${encodeURIComponent(entry.job.id)}`,undefined,controller.signal));
     if(stopped)return;
     if(next.id!==entry.job.id||next.documentId!==entry.job.documentId||next.sourceKey!==entry.job.sourceKey)throw new Error('任务身份不匹配，未读取其他工程结果。');
     updateTask(entry.job.documentId,entry.job.id,{job:next,pollError:''});
    }catch(e){if(!stopped)updateTask(entry.job.documentId,entry.job.id,{pollError:errorText(e)});}
   }));
   if(!stopped)timer=setTimeout(poll,1500);
  };
  timer=setTimeout(poll,600);
  return()=>{stopped=true;clearTimeout(timer);controller.abort();};
 },[]);
 useEffect(()=>{
  if(!task||task.job.status!=='complete'||task.applied||task.conflict||appliedJobs.current.has(task.job.id))return;
  const current=live.current.getDocument();
  if(current?.id!==task.baseline.documentId)return;
  let conflict=roughcutApplyConflict(current,task.job,task.baseline);
  if(!task.job.analysis)conflict='任务已结束，但没有可应用的分析结果。';
  if(conflict){updateTask(doc.id,task.job.id,{conflict});return;}
  try{
   const next=createRoughcut(current,task.job.analysis);
   appliedJobs.current.add(task.job.id);
   live.current.onChange(next);
   updateTask(doc.id,task.job.id,{applied:true});
   persistTasks({...tasksRef.current,[doc.id]:{...task,applied:true}});
  }catch(e){updateTask(doc.id,task.job.id,{conflict:errorText(e)});}
 },[doc,task]);

 const start=async()=>{
  if(busyRef.current)return;
  const current=live.current.getDocument(),id=current.id;
  if(tasksRef.current[id]?.job.status==='running')return;
  busyRef.current=true;setBusy({id,action:'start'});setMessage('');setNotice('');pauseOriginal();
  try{
   const saved=await live.current.save();
   if(live.current.getDocument()?.id!==id||saved?.id!==id)throw new Error('工程已切换，未开始新的分析。');
   const baseline={documentId:id,sourceKey:roughcutSourceKey(saved),fingerprint:roughcutEditFingerprint(saved)};
   const job=readJob(await request('start',{documentId:id}));
   if(job.documentId!==id||job.sourceKey!==baseline.sourceKey)throw new Error('服务返回的原片身份与已保存工程不一致。');
   if(mounted.current)setTasks(previous=>({...previous,[id]:{job,baseline}}));
  }catch(e){showMessage(id,errorText(e));}
  finally{busyRef.current=false;if(mounted.current)setBusy(null);}
 };
 const copySource=async()=>{
  if(busyRef.current)return;
  const id=live.current.getDocument().id;
  busyRef.current=true;setBusy({id,action:'copy'});setMessage('');pauseOriginal();
  try{
   const saved=await live.current.save();
   if(saved?.id!==id||live.current.getDocument()?.id!==id)throw new Error('工程已切换，未创建副本。');
   const payload=await request('source-copy',{documentId:id}),copy=payload.document??payload.doc??payload;
   if(!copy?.id||copy.id===id||!copy.source)throw new Error('服务未返回有效的原片副本。');
   if(!mounted.current)return;
   setCopies(previous=>({...previous,[id]:copy}));
   if(live.current.getDocument()?.id===id)live.current.onOpenDocument(copy);
  }catch(e){showMessage(id,errorText(e));}
  finally{busyRef.current=false;if(mounted.current)setBusy(null);}
 };
 const changeCut=(id:string,patch:any)=>{
  const current=live.current.getDocument();
  if(current.id!==doc.id)throw new Error('工程已切换，请在当前工程重新操作。');
  const next=setRoughcutCut(current,id,patch);pauseOriginal();cutLoopStarted.current=false;if(preview?.id===id)setPreview(null);live.current.onChange(next);setMessage('');
 };
 const adoptCut=(id:string)=>{
  const current=live.current.getDocument();
  if(current.id!==doc.id)throw new Error('工程已切换，请在当前工程重新操作。');
  const next=adoptRoughcutCutManually(current,id);pauseOriginal();cutLoopStarted.current=false;if(preview?.id===id)setPreview(null);live.current.onChange(next);setMessage('');
 };
 hotkeyState.current.changeCut=changeCut;hotkeyState.current.adoptCut=adoptCut;
 const restore=()=>{
  try{const current=live.current.getDocument();if(current.id!==doc.id)return;const next=resetRoughcut(current);pauseOriginal();cutLoopStarted.current=false;setPreview(null);live.current.onChange(next);setMessage('');setNotice('已恢复粗剪前的原片与字幕，可用撤销返回。');}
  catch(e){setMessage(errorText(e));}
 };
 const downloadSrt=()=>{
  try{
   const current=live.current.getDocument();if(current.id!==doc.id)return;
   const srt=roughcutSrt(current);if(!srt.trim())throw new Error('当前没有可导出的字幕。');
   const url=URL.createObjectURL(new Blob([srt],{type:'application/x-subrip;charset=utf-8'})),link=window.document.createElement('a');
   link.href=url;link.download=`${String(current.name||'口播粗剪').replace(/[\\/:*?"<>|]/g,'_')}-粗剪字幕.srt`;
   window.document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
   setNotice('已下载当前粗剪字幕。');setMessage('');
  }catch(e){setMessage(errorText(e));}
 };
 const downloadAnalysis=()=>{
  if(!task?.job.analysis)return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(task.job.analysis,null,2)],{type:'application/json;charset=utf-8'}));
  const link=window.document.createElement('a');link.href=url;link.download=`roughcut-${task.job.id}.json`;window.document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 const original=(row:Cut)=>{
  cutLoopStarted.current=false;live.current.onPause();setMessage('');
  setOriginalProxy(props.previewSource?.path===doc.source?.path?props.previewSource?.url:undefined);
  setPreview({documentId:doc.id,id:row.id,start:Math.max(0,row.startFrame/fps-.6),end:Math.min(sourceFrames/fps,row.endFrame/fps+.6),text:row.text||'停顿'});
 };
 const playOriginal=()=>{
  const video=videoRef.current;
  if(!video||!preview||!live.current.active||live.current.getDocument()?.id!==preview.documentId)return;
  cutLoopStarted.current=false;live.current.onPause();video.currentTime=preview.start;
  void video.play().catch(e=>{if(e?.name!=='AbortError'&&mounted.current&&video===videoRef.current&&live.current.active&&live.current.getDocument()?.id===preview.documentId)setMessage(`原片暂时无法播放：${errorText(e)}`);});
 };
 useEffect(()=>{if(preview&&videoRef.current?.readyState)playOriginal();},[preview]);
 const decisions=task?.job.analysis?.decisions??[],units=new Map<string,string>((task?.job.analysis?.units??[]).map((unit:any)=>[unit.id,unit.text]));
 const editPlan=doc.roughcut?.analysis?.editPlan??task?.job.analysis?.editPlan;
 const warnings=[...new Set([...(doc.roughcut?.warnings??doc.roughcut?.analysis?.warnings??task?.job.analysis?.warnings??[]),...(editPlan?.reviewNotes??[])])];

 return <section className="roughcut-panel" aria-label="口播粗剪" hidden={!active}>
  <div className="roughcut-heading"><h3>口播粗剪</h3>{doc.roughcut&&<span>可撤销</span>}</div>
  {!doc.source?<div className="roughcut-empty"><p>选择原始口播视频，分析重复、口误和长停顿。</p><button type="button" className="roughcut-primary" onClick={props.onChooseSource}>选择口播视频</button></div>:<>
   {!doc.roughcut&&<div className="roughcut-empty"><p>先选完整表达，去掉重复重录和中断起句，再安排句间气口。之后可逐条恢复和微调切点。</p><button type="button" className="roughcut-primary" disabled={running||!!busy} onClick={start}>{ownBusy&&busy?.action==='start'?'保存并开始…':running?'正在分析…':'开始口播粗剪'}</button></div>}
   {task&&<div className={`roughcut-job${task.job.status==='failed'?' roughcut-error':''}`} role="status" aria-live="polite">
    <strong>{task.applied?(doc.roughcut?'粗剪已应用':'分析已完成'):task.conflict?'结果待处理':stages[task.job.stage??task.job.status]??(running?'正在分析口播':'分析完成')}</strong>
    {running&&<><progress aria-label="粗剪分析进度"/><span>可关闭面板继续编辑，任务会继续运行。</span></>}
    {task.job.error&&<span>{task.job.error}</span>}
    {task.pollError&&<span className="roughcut-error">读取进度失败：{task.pollError} 正在重试。</span>}
    {task.conflict&&<span>{task.conflict}</span>}
    {task.applied&&<span>{doc.roughcut?'原片保留，修改已进入撤销历史。':'当前未应用粗剪，可重新开始。'}</span>}
    {task.conflict&&task.job.analysis&&<button type="button" onClick={downloadAnalysis}>下载完整分析结果</button>}
    {task.conflict&&decisions.length>0&&<details><summary>查看保留的分析结果（{decisions.length} 条）</summary><div className="roughcut-pending">{decisions.map((decision:any,index:number)=><div key={decision.id??index}><strong>{(decision.unitIds??[]).map((id:string)=>units.get(id)??'').join('')||kinds[decision.kind]||'停顿候选'}</strong><p>{decision.reason??'未提供原因'}</p><small>{decision.action==='delete'?'建议删除':decision.action==='review'?'待检查':'保留'}</small></div>)}</div></details>}
   </div>}
   {doc.roughcut&&<>
    {editPlan?.mode==='complete-takes'&&<p className="roughcut-muted">完整表达优先 · 当前保留 {doc.source?.clips?.length??1} 段口播</p>}
    <dl className="roughcut-stats"><div><dt>保留时长</dt><dd>{time(doc.canvas.durationFrames/fps)}</dd></div><div><dt>已删除</dt><dd>{removed}<small> 段</small></dd></div><div><dt>待检查</dt><dd>{review}<small> 段</small></dd></div></dl>
    <div className="roughcut-tools"><button type="button" onClick={downloadSrt}>下载当前 SRT</button><button type="button" onClick={restore}>恢复原片</button></div>
    <RoughcutPreviewControls loop={loopCut} onLoopChange={setLoopCut} onStop={()=>{cutLoopStarted.current=false;pauseOriginal();live.current.onPause();}}/>
    <p className="roughcut-muted">切口自然度仍需试听；恢复、改切点及整次粗剪都可撤销。<span className="roughcut-hotkey-hint">快捷键：J/K/L 播放 · 文稿剪辑中 ⌫ 删除 / ⇧⌫ 恢复 · N/P 切换片段 · A 删除 · R 保留 · X 切换 · I/O 设切点 · S 分割 · ? 全部</span></p>
   </>}
   {(warnings.length>0)&&<details className="roughcut-warnings"><summary>分析说明（{warnings.length}）</summary><ul>{warnings.map((warning:any,index:number)=><li key={index}>{typeof warning==='string'?warning:warning.message??warning.reason??'存在需检查的时间边界'}</li>)}</ul></details>}
   {(message||rowError)&&<p role="alert" className="roughcut-error">{message||rowError}</p>}
   {notice&&<p role="status" className="roughcut-muted">{notice}</p>}
   {preview?.documentId===doc.id&&<div className="roughcut-original"><div><strong>原片试听{originalProxy?' · 流畅代理':''}</strong>{originalProxy&&<button type="button" onClick={()=>{pauseOriginal();setOriginalProxy(undefined);}}>原画质复核</button>}<button type="button" onClick={()=>{pauseOriginal();setPreview(null);}}>关闭</button></div><video key={doc.id+sourceUrl} ref={videoRef} src={sourceUrl} controls playsInline preload="metadata" aria-label="粗剪片段原片预览" onLoadedMetadata={playOriginal} onPlay={()=>{if(!live.current.active){pauseOriginal();return;}cutLoopStarted.current=false;live.current.onPause();const video=videoRef.current;if(video&&(video.currentTime<preview.start||video.currentTime>=preview.end))video.currentTime=preview.start;}} onTimeUpdate={event=>{if(event.currentTarget.currentTime>=preview.end)event.currentTarget.pause();}} onError={()=>{if(originalProxy){setOriginalProxy(undefined);setNotice('代理暂不可用，切回原片');}else setMessage('原片预览加载失败，请确认媒体文件仍可用。');}}/><p>{time(preview.start)}–{time(preview.end)} · 含前后语境</p></div>}
   {doc.roughcut&&<div className="roughcut-views" role="group" aria-label="粗剪视图"><button type="button" aria-pressed={view==='segments'} onClick={()=>setView('segments')}>片段</button><button type="button" aria-pressed={view==='transcript'} onClick={()=>setView('transcript')}>文稿剪辑</button></div>}
   {doc.roughcut&&view==='transcript'&&<TranscriptView document={doc} getDocument={live.current.getDocument} getFrame={props.getFrame} active={active} onSeek={frame=>{pauseOriginal();live.current.onSeek(frame);}} onEdit={result=>{pauseOriginal();cutLoopStarted.current=false;setPreview(null);setMessage('');(live.current.onTranscriptEdit??((r:any)=>live.current.onChange(r.document)))(result);}}/>}
   {doc.roughcut&&view==='segments'&&<><div className="roughcut-filters" aria-label="筛选粗剪片段">{review>0&&<button type="button" onClick={()=>{setFilter('review');setFocusId(rows.find(r=>r.review&&!r.enabled)?.id??null);}}>优先复核 {review} 处</button>}{([['all','全部',rows.length],['removed','已删除',removed],['review','待检查',review]] as const).map(([value,label,count])=><button type="button" key={value} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label} {count}</button>)}</div><div className="roughcut-list">{visible.length?visible.map((row,index)=><CutRow key={`${doc.id}:${row.id}`} row={row} index={index} fps={fps} sourceFrames={sourceFrames} roughcut={doc.roughcut} focused={focusId===row.id} onFocus={()=>setFocusId(row.id)} onEdit={changeCut} onAdopt={adoptCut} onSeek={()=>{pauseOriginal();props.onSeek(row.projectFrame);}} onPreview={()=>{pauseOriginal();cutLoopStarted.current=loopCut;props.onPlayCut(row.projectFrame,loopCut);}} onOriginal={()=>original(row)} previewing={preview?.id===row.id}/>):<p className="roughcut-muted">{rows.length?'此分类没有片段。':'没有可安全删除的片段，已保留完整口播。'}</p>}</div></>}
   {copies[doc.id]&&<div className="roughcut-job"><span>原片副本已创建。</span><button type="button" onClick={()=>props.onOpenDocument(copies[doc.id])}>打开原片副本</button></div>}
   <details className="roughcut-copy"><summary>从原片新建粗剪副本</summary><p>已有镜头、素材或手动剪辑时，在独立副本中处理原始口播。当前工程保持原样。</p><button type="button" disabled={!!busy} onClick={copySource}>{ownBusy&&busy?.action==='copy'?'正在创建副本…':'新建并打开原片副本'}</button></details>
  </>}
 </section>;
}
