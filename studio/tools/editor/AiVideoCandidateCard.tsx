import {copyAiVideoPrompt} from './ai-video-copy.mjs';
import React,{useRef,useState} from 'react';
import {ProjectMediaUpload} from './ProjectMediaUpload';
import {useProjectMedia} from './ProjectMediaContext';
import {planMediaUrl} from './production-plan-sync.mjs';
import {aiVideoPromptText,aiVideoCandidateState,recognizeAiVideoImport} from './ai-video-candidates.mjs';
export function AiVideoCandidateCard({document:doc,shot,candidate,controller,rangeId,showDescription=true}:any){
 const context=useProjectMedia(),latest=useRef(doc);latest.current=doc;
 const [error,setError]=useState(''),[copyNotice,setCopyNotice]=useState(''),[missing,setMissing]=useState<string[]>([]);
 const promptDetails=useRef<HTMLDetailsElement>(null),promptSource=useRef<HTMLTextAreaElement>(null);
 const promptText=aiVideoPromptText(candidate);
 const selectManual=()=>{if(promptDetails.current)promptDetails.current.open=true;const source=promptSource.current;source?.focus();source?.select();source?.setSelectionRange(0,promptText.length);setCopyNotice('已全选全文，请按 ⌘C 或 Ctrl+C');};
 const copy=()=>{setError('');if(copyAiVideoPrompt(promptText))setCopyNotice('复制已执行，请粘贴核对');else selectManual();};
 const status=aiVideoCandidateState(doc,shot,candidate,controller.jobs);
 const expected={projectId:doc.id,shotId:shot.id,candidate:structuredClone(candidate)};
 const canImport=!shot.cancelled&&!shot.locked&&!candidate.ignored&&candidate.requirementVersion===shot.requirementVersion;
 return <article className="plan-ai-video-card" data-ai-video-candidate={candidate.id}>
  <h5>{candidate.title}</h5>
  <p role="status">{missing.length?'待参考素材 · 有参考图无法读取':status.label}</p>
  {showDescription&&<p>{candidate.reason}</p>}
  {status.detail&&<small role="status">{status.detail}</small>}
  <div className="plan-actions"><button type="button" onClick={copy}>复制提示词</button><button type="button" onClick={selectManual}>全选手动复制</button>
   {canImport&&<ProjectMediaUpload videoOnly label="导入生成结果" analyzeAfterImport={false} onImported={()=>{}} onFilesImported={files=>recognizeAiVideoImport({expected,files,getDocument:()=>context.getDocument?.()??latest.current,getProjectId:context.getProjectId,startJob:controller.startJob,rangeId})}/>}
  </div>
  {copyNotice&&<small role="status">{copyNotice}</small>}
  <details ref={promptDetails}><summary>提示词与参考图</summary><textarea ref={promptSource} aria-label="完整AI视频提示词" readOnly value={promptText} rows={7} style={{width:'100%',boxSizing:'border-box',resize:'vertical'}} onKeyDown={event=>event.stopPropagation()}/><small>{candidate.aspectRatio} · 建议生成 {candidate.durationSeconds} 秒 · 提示词 v{candidate.promptVersion}</small>
   {!!candidate.references.length&&<ol className="plan-ai-video-references">{candidate.references.map((ref:any,i:number)=><li key={i}><a href={planMediaUrl(ref.path,doc.id)} target="_blank" rel="noreferrer"><strong>图{i+1}：{ref.label}</strong><img src={planMediaUrl(ref.path,doc.id)} alt={`图${i+1}：${ref.label}`} style={{display:'block',maxWidth:'100%',maxHeight:120}} onError={()=>setMissing(rows=>rows.includes(ref.path)?rows:[...rows,ref.path])}/></a><small>{ref.purpose}</small></li>)}</ol>}
  </details>
  {error&&<p role="alert" className="error">{error}</p>}
 </article>;
}
