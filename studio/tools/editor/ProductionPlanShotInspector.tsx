import {AiVideoCandidateCard} from './AiVideoCandidateCard';
import {BgmPlanDetails,BgmPlanOverview} from './BgmPlan';
import {Icon} from './Icon';
import {PlanVisualBadge,PlanVisualBadges} from './PlanVisualBadges';
import {PlanCandidatePreview,candidatePreviewKey} from './PlanCandidatePreview';
import {planRevisionStatus} from './plan-revision-status.mjs';
import {RevisionDiffCards} from './RevisionDiff';
import React,{useEffect,useRef,useState} from 'react';
import {getPlanPreviewView} from './production-plan-view-model.mjs';
const activeStates=['queued','running','cancelling'];
function ShotInspector({document:doc,shot,controller,resources,onSelect,onCandidatePlay,annotationsVisible=false,onRevertRevision}:any){
 const view=getPlanPreviewView(doc,shot,controller.jobs,resources),key='motion-plan-feedback/'+doc.id+'/'+shot.id;
 const [feedback,setFeedback]=useState(()=>{try{return localStorage.getItem(key)||'';}catch{return '';}});
 const [rangeId,setRangeId]=useState(view.ranges.length===1?view.ranges[0].id:'');
 const [deleting,setDeleting]=useState(false);
 const deleteTrigger=useRef<HTMLButtonElement>(null),cancelDelete=useRef<HTMLButtonElement>(null),wasRemoving=useRef(false);
 const [error,setError]=useState(''),[submitted,setSubmitted]=useState(false),[removing,setRemoving]=useState(false),[submitting,setSubmitting]=useState(false),[feedbackOpen,setFeedbackOpen]=useState(false);
 useEffect(()=>{if(removing)cancelDelete.current?.focus();else if(wasRemoving.current)deleteTrigger.current?.focus();wasRemoving.current=removing;},[removing]);
 const job=controller.jobs.find((j:any)=>j.kind==='revise'&&j.shotId===shot.id),running=activeStates.includes(job?.status)||activeStates.includes(job?.executionStatus);
 const revisionStatus=planRevisionStatus(job,submitting);
 const origin=useRef(true);useEffect(()=>()=>{origin.current=false;},[]);
 useEffect(()=>{try{if(feedback)localStorage.setItem(key,feedback);else localStorage.removeItem(key);}catch{}},[feedback,key]);
 useEffect(()=>{if(rangeId&&!view.ranges.some(r=>r.id===rangeId))setRangeId('');},[JSON.stringify(view.ranges),rangeId]);
 const submit=async()=>{
  if(!feedback.trim()||running||submitting)return;
  setError('');setSubmitted(false);setSubmitting(true);
  try{await controller.startJob('revise',{shotId:shot.id,...(rangeId?{rangeId}:{}),instructions:feedback.trim()});if(origin.current){setSubmitted(true);setFeedbackOpen(false);}}
  catch(e:any){if(origin.current)setError(e.message);}
  finally{if(origin.current)setSubmitting(false);}
 };
 const retry=async()=>{if(submitting||controller.busy||running||!job)return;setError('');setSubmitting(true);try{await controller.jobAction(job.id,'retry');}catch(e:any){if(origin.current)setError(e.message);}finally{if(origin.current)setSubmitting(false);}};
 const remove=async()=>{if(deleting)return;setError('');setDeleting(true);try{await controller.action({type:'cancel-shot',shotId:shot.id});onSelect('');}catch(e:any){if(origin.current)setError(e.message);}finally{if(origin.current)setDeleting(false);}};
 return <section className="plan-current-shot" aria-label="当前段计划操作" data-current-plan-shot={shot.id}>
  <button className="plan-back-overview" onClick={()=>onSelect('')}><span aria-hidden="true">‹</span> 全部计划</button>
  <div className="plan-current-title"><h3><PlanVisualBadges kinds={view.visualKinds}/>{shot.title}</h3></div>
  {(shot.narration||shot.footageIntent?.description)&&<details className="plan-shot-evidence"><summary>这一段要表达什么</summary>{shot.narration&&<p><strong>口播</strong><br/>{shot.narration}</p>}{shot.footageIntent?.description&&<p><strong>素材用途</strong><br/>{shot.footageIntent.description}</p>}{view.ranges.map((r:any)=><small key={r.id}>{(r.startFrame/(doc.canvas.fps.num/doc.canvas.fps.den)).toFixed(2)}–{((r.startFrame+r.durationFrames)/(doc.canvas.fps.num/doc.canvas.fps.den)).toFixed(2)} 秒 </small>)}</details>}
  <BgmPlanDetails document={doc} shot={shot}/>
  {resources.loading&&<small role="status">正在读取制作报告…</small>}
  {(resources.analysisError||resources.footageError)&&<small role="status">{resources.analysisError||resources.footageError}</small>}
  <details className="plan-feedback-section" aria-label="修改意见" open={feedbackOpen} onToggle={e=>setFeedbackOpen(e.currentTarget.open)}>
   <summary>修改意见</summary>
   <textarea aria-label="这一段的修改意见" rows={2} value={feedback} onChange={e=>{setFeedback(e.target.value);setSubmitted(false);}} onKeyDown={e=>{e.stopPropagation();if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();void submit();}}}/>
   {view.ranges.length>1&&<label>修改区间<select aria-label="当前段修改区间" value={rangeId} onChange={e=>setRangeId(e.target.value)}><option value="">选择一个区间</option>{view.ranges.map(r=><option key={r.id} value={r.id}>{(r.startFrame/(doc.canvas.fps.num/doc.canvas.fps.den)).toFixed(2)}–{((r.startFrame+r.durationFrames)/(doc.canvas.fps.num/doc.canvas.fps.den)).toFixed(2)} 秒</option>)}</select></label>}
   <button className="plan-submit-feedback primary" disabled={controller.busy||running||submitting||!feedback.trim()||!view.ranges.length||(view.ranges.length>1&&!rangeId)} onClick={()=>void submit()}>{running||submitting?'修改中…':'确定'}</button>
  </details>
  {!view.ranges.length&&feedbackOpen&&<small role="status">需要先定位这一段</small>}
   {submitted&&!job&&<small role="status">修改任务已提交</small>}
   {revisionStatus&&<div className={"plan-revision-status state-"+revisionStatus.state} role="status"><strong>{revisionStatus.label}</strong>
    {(job?.executionError||job?.error)&&<p className="error">{job.executionError||job.error}</p>}
    {['failed','partial'].includes(revisionStatus.state)&&(job?.results??[]).filter((r:any)=>r.kind==='shot-revision').flatMap((r:any)=>r.gaps??[]).map((gap:string)=><small key={gap}>{gap}</small>)}
    <div className="plan-actions">{running?<button disabled={controller.busy} onClick={()=>void controller.jobAction(job.id,'cancel').catch((e:any)=>setError(e.message))}>停止修改</button>:(['failed','partial','interrupted','cancelled'].includes(job?.status)||['failed','partial','interrupted','cancelled'].includes(job?.executionStatus)||(job?.results??[]).some((r:any)=>r.kind==='shot-revision'&&['stale','conflict','pending','failed'].includes(r.state)))&&<button disabled={controller.busy||submitting} onClick={()=>void retry()}>基于当前版本重试</button>}</div>
   </div>}
  <RevisionDiffCards job={job} document={doc} onRevert={onRevertRevision}/>
  {!annotationsVisible&&view.animationSection&&<section className="plan-shot-animation" aria-label="当前段动画安排"><h4><PlanVisualBadge kind="animation"/>{view.animationSection.title}</h4>{view.animationSection.items.map((item:any,index:number)=><p key={index}>{item.text}</p>)}</section>}

  {view.visualKinds.includes('footage')&&(!annotationsVisible||view.candidates.length>0)&&<section className="plan-shot-candidates" aria-label="当前段候选网络素材"><h4><PlanVisualBadge kind="footage"/>{view.candidates.length?<>候选网络素材 <span>{view.candidates.length}</span></>:<>网络素材</>}</h4>
   {!view.candidates.length&&view.networkItems.map((item:any)=><p key={item.instanceId}>{item.text}<small className="plan-item-status">{item.status} · {item.time}</small></p>)}
   {view.candidates.map((c:any)=><PlanCandidatePreview key={candidatePreviewKey(c,doc.id,shot.id)} candidate={c} projectId={doc.id} shotId={shot.id} rangeId={rangeId||undefined} onPlay={onCandidatePlay} onDownload={controller.downloadCandidate} disabled={controller.busy||running}/>)}
  </section>}
  {!!shot.aiVideoCandidates?.length&&<section className="plan-shot-ai-videos" aria-label="当前段AI视频"><h4><PlanVisualBadge kind="aiVideo"/>AI 视频</h4>{shot.aiVideoCandidates.map((candidate:any)=><AiVideoCandidateCard key={doc.id+'/'+shot.id+'/'+candidate.id+'/'+candidate.promptVersion} document={doc} shot={shot} candidate={candidate} controller={controller} rangeId={rangeId||undefined} showDescription={!annotationsVisible}/>)}</section>}
  <div className="plan-delete-section">{removing?<div className="plan-delete-confirm" role="group" aria-label="删除计划确认" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setRemoving(false);}}}><p>删除这一段的制作计划？口播和已入轨内容保留，可撤销。</p><div className="plan-actions"><button type="button" className="danger" disabled={controller.busy||running||deleting} onClick={()=>void remove()}>{deleting?'删除中…':'删除计划'}</button><button type="button" ref={cancelDelete} disabled={deleting} onClick={()=>setRemoving(false)}>保留</button></div></div>:<button type="button" ref={deleteTrigger} className="plan-delete-button" aria-expanded={false} disabled={controller.busy||running} onClick={()=>setRemoving(true)}><Icon name="trash" size={15}/><span>删除这一段计划</span></button>}</div>
  {error&&<p className="error" role="alert">{error}</p>}
 </section>;
}
export function ProductionPlanQuickView({document:doc,controller,resources={},selectedShot,onSelect,onCandidatePlay,annotationsVisible=false,onRevertRevision}:any){
 const shots=[...(doc.productionPlan?.shots??[])].sort((a,b)=>a.order-b.order),shot=shots.find(s=>s.id===selectedShot&&!s.cancelled);
 if(shot)return <ShotInspector key={doc.id+'/'+shot.id} document={doc} shot={shot} controller={controller} resources={resources} onSelect={onSelect} onCandidatePlay={onCandidatePlay} annotationsVisible={annotationsVisible} onRevertRevision={onRevertRevision}/>;
 const views=shots.filter(s=>!s.cancelled).map(s=>({shot:s,view:getPlanPreviewView(doc,s,controller.jobs,resources)})),work=views.filter(v=>v.view.visible),pending=controller.jobs.filter((j:any)=>activeStates.includes(j.status));
 return <section className="plan-quick-overview" aria-label="制作计划总览">
  <BgmPlanOverview document={doc} onSelect={onSelect}/>
  <div className="plan-quick-count"><strong>{work.length} 段制作安排</strong><span>{pending.length?`${pending.length} 个任务进行中`:'点击一段查看和修改'}</span></div>
  {!doc.productionPlan&&<p className="plan-note">尚无计划，可在下方更多中生成 package。</p>}
  {resources.loading&&<small role="status">正在读取制作报告…</small>}
  <div className="plan-quick-list">{work.map(({shot,view})=><button key={shot.id} className="plan-quick-row" onClick={()=>onSelect(shot.id)}><strong><PlanVisualBadges kinds={view.visualKinds}/>{shots.indexOf(shot)+1}. {shot.title}</strong><small>{view.time}</small>{view.candidates.length>0&&<small>{view.candidates.length} 个候选素材</small>}</button>)}</div>
  {views.length>work.length&&<details className="plan-untouched"><summary>保留原片 {views.length-work.length} 段</summary>{views.filter(v=>!v.view.visible).map(({shot,view})=><button key={shot.id} className="plan-quick-row" onClick={()=>onSelect(shot.id)}><strong>{shot.title}</strong><small>{view.time}</small></button>)}</details>}
  {shots.some(s=>s.cancelled)&&<details><summary>已删除的计划</summary>{shots.filter(s=>s.cancelled).map(s=><div className="plan-deleted-row" key={s.id}><span>{s.title}</span><button disabled={controller.busy} onClick={()=>void controller.action({type:'restore-shot',shotId:s.id}).catch(()=>{})}>恢复计划</button></div>)}</details>}
 </section>;
}
