import {parseSrtCaptions,checkedCaptions} from './caption-camera-model.mjs';
import React,{useState,useEffect,useRef} from 'react';
import {DEFAULT_CAPTION_STYLE,cleanCaptionText,validateCaptionTrack} from '../../templates/remotion-base/src/editor/captions.mjs';
import {CaptionStyleEditor} from './CaptionStyleEditor';
import './captions.css';
const stages:any={preparing:'读取底片',uploading:'上传至飞书',recognizing:'飞书正在识别',reusing:'复用已有转写',formatting:'精简长句与排版',complete:'识别完成',failed:'识别失败'};
export function CaptionPanel({document:doc,selected,selection=[],onSelect,onChange,onSeek,onStart,job,pending,onApplyPending,onChooseSource,getFrame=()=>0}:any){
 const [srt,setSrt]=useState(''),[replaceImport,setReplaceImport]=useState(false);
 const [replace,setReplace]=useState(false),[message,setMessage]=useState(''),[polish,setPolish]=useState(false);
 const panelRef=useRef<HTMLElement>(null),rowRefs=useRef(new Map<string,HTMLDivElement>());
 const track=doc.captions??{version:1,enabled:true,style:{...DEFAULT_CAPTION_STYLE},cues:[]};
 const style={...DEFAULT_CAPTION_STYLE,...track.style},fps=doc.canvas.fps.num/doc.canvas.fps.den;
 const running=job?.status==='running';
 const commit=(next:any)=>{try{validateCaptionTrack(next,{durationFrames:doc.canvas.durationFrames});onChange(next);setMessage('');return true;}catch(e:any){setMessage(e.message);return false;}};

 const editCue=(patch:any,id:string)=>commit({...track,cues:track.cues.map((c:any)=>c.id===id?{...c,...patch}:c).sort((a:any,b:any)=>a.startFrame-b.startFrame)});
 useEffect(()=>{
  const panel=panelRef.current,row=selected?rowRefs.current.get(selected):null,active=document.activeElement;
  if(!panel||!row||(active instanceof HTMLTextAreaElement&&panel.contains(active)))return;
  const panelBox=panel.getBoundingClientRect(),rowBox=row.getBoundingClientRect();
  if(rowBox.top<panelBox.top)panel.scrollTo({top:panel.scrollTop-(panelBox.top-rowBox.top)-8,behavior:'smooth'});
  else if(rowBox.bottom>panelBox.bottom)panel.scrollTo({top:panel.scrollTop+(rowBox.bottom-panelBox.bottom)+8,behavior:'smooth'});
 },[selected]);
 const generationTools=<>
  {!doc.source?<button onClick={onChooseSource}>先选择视频</button>:<>
   {track.cues.length>0&&<label className="caption-check"><input type="checkbox" checked={replace} onChange={e=>setReplace(e.target.checked)}/>重新识别时替换当前字幕</label>}
   <label className="caption-check"><input type="checkbox" checked={polish} disabled={running} onChange={e=>setPolish(e.target.checked)}/>本次用 Codex 精简长句（发送转写文字）</label>
   <button className="caption-primary" disabled={running||(track.cues.length>0&&!replace)} onClick={()=>{onStart(polish);setReplace(false);}}>{running?'正在识别…':track.cues.length?'重新识别并替换':'识别并添加字幕'}</button>
  </>}
  <details><summary>本地 SRT / 手动字幕</summary>
   <input type="file" accept=".srt,text/plain" aria-label="导入本地 SRT" onChange={async e=>{const file=e.currentTarget.files?.[0];if(file)try{setSrt(await file.text());}catch{setMessage('无法读取字幕文件');}}}/>
   <textarea aria-label="粘贴 SRT" value={srt} onChange={e=>setSrt(e.target.value)} rows={5}/>
   <label><input type="checkbox" checked={replaceImport} onChange={e=>setReplaceImport(e.target.checked)}/>替换现有字幕</label>
   <button onClick={()=>{try{const cues=parseSrtCaptions(srt,fps,()=>crypto.randomUUID());const next=checkedCaptions(doc,[...(replaceImport?[]:track.cues),...cues]);onChange(next.captions);setMessage('');setSrt('');setReplaceImport(false);onSelect(cues[0]?.id??'');}catch(e:any){setMessage(e.message);}}}>添加 SRT 字幕</button>
   <button onClick={()=>{try{const start=Math.max(0,Math.round(getFrame())),next=track.cues.find((c:any)=>c.startFrame>=start),cue={id:crypto.randomUUID(),startFrame:start,endFrame:Math.min(doc.canvas.durationFrames,start+Math.round(fps*2),next?.startFrame??Infinity),text:'新字幕',originalText:'新字幕'};const result=checkedCaptions(doc,[...track.cues,cue]);onChange(result.captions);onSelect(cue.id);onSeek(start);setMessage('');}catch(e:any){setMessage(e.message);}}}>在播放位置添加字幕</button>
  </details>
 </>;
 return <section ref={panelRef} className="caption-panel" aria-label="识别与编辑字幕">
  <h3>字幕</h3>
  {track.cues.length>0?<details className="caption-generation"><summary>识别、导入或添加字幕</summary>{generationTools}</details>:generationTools}
  {job&&<div role="status" className={'caption-job '+(job.status==='failed'?'caption-error':'')}><strong>{job.stage==='complete'&&job.reusedTranscript?'已复用已有转写':(stages[job.stage]??'处理中')}</strong>{running&&<progress aria-label={stages[job.stage]??'识别进度'}/>}<span>{job.error??job.note??(running?'完成后自动添加到字幕轨，可继续编辑画面。':'')}</span>{Number.isFinite(job.elapsedSeconds)&&<small>已用 {Math.floor(job.elapsedSeconds/60)} 分 {job.elapsedSeconds%60} 秒</small>}</div>}
  {pending&&<div className="caption-job"><p>识别完成，但你已修改当前字幕。要使用识别结果，请明确替换。</p><button onClick={onApplyPending}>用识别结果替换当前字幕</button></div>}
  {message&&<p role="alert" className="caption-error">{message}</p>}
  {track.cues.length>0&&<>
   <label className="caption-check"><input type="checkbox" checked={track.enabled} onChange={e=>commit({...track,enabled:e.target.checked})}/>在预览和导出中显示字幕 <span>{track.cues.length} 条</span></label>
   <CaptionStyleEditor track={track} selection={selection} onChange={commit} onSelect={onSelect}/>
   <div className="caption-list" aria-label="字幕列表">{track.cues.map((c:any,i:number)=><div ref={node=>{if(node)rowRefs.current.set(c.id,node);else rowRefs.current.delete(c.id);}} className={'caption-row'+(selection.includes(c.id)?' is-selected':'')} key={c.id}>
    <div className="caption-row-main"><input type="checkbox" aria-label={`选择字幕 ${i+1}`} checked={selection.includes(c.id)} onChange={()=>onSelect(c.id,{toggle:true})}/><button className="caption-time" aria-label={`定位字幕 ${i+1}`} onClick={e=>{onSelect(c.id,{toggle:e.metaKey||e.ctrlKey,range:e.shiftKey});onSeek(c.startFrame);}}><time>{String(Math.floor(c.startFrame/fps/60)).padStart(2,'0')}:{String(Math.floor(c.startFrame/fps)%60).padStart(2,'0')}</time></button>
    <textarea key={c.text} aria-label={`字幕 ${i+1} 文字`} defaultValue={c.text} rows={Math.max(2,Math.ceil(c.text.length/18))} onFocus={()=>{onSelect(c.id);onSeek(c.startFrame);}} onBlur={e=>{const text=cleanCaptionText(e.target.value);if(!text){e.target.value=c.text;setMessage('字幕文字不能为空');return;}e.target.value=text;if(text!==c.text)editCue({text},c.id);}} onKeyDown={e=>{if(e.nativeEvent.isComposing)return;if(e.key==='Escape'){e.preventDefault();e.currentTarget.value=c.text;e.currentTarget.blur();}else if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();e.currentTarget.blur();}}}/></div>
   </div>)}</div>
  </>}
 </section>;
}
