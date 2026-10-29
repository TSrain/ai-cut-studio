import React,{useEffect,useRef,useState} from 'react';
import {CAPTION_FONTS,DEFAULT_CAPTION_STYLE,cleanCaptionText,validateCaptionTrack} from '../../templates/remotion-base/src/editor/captions.mjs';
import './caption-inspector.css';

export {CaptionStyleControls} from './CaptionStyleEditor';
import {CaptionStyleEditor} from './CaptionStyleEditor';

export function CaptionInspector({document:doc,selected,selection=[],onChange,onSelect,onSeek}:any){
 const track=doc.captions??{version:1,enabled:true,style:{...DEFAULT_CAPTION_STYLE},cues:[]};
 const ids=selection.length?selection:selected?[selected]:[];
 const cue=ids.length===1?track.cues.find((item:any)=>item.id===ids[0]):null,fps=doc.canvas.fps.num/doc.canvas.fps.den;
 const [text,setText]=useState(''),[start,setStart]=useState(''),[end,setEnd]=useState(''),[error,setError]=useState('');
 const cancelText=useRef(false),cancelStart=useRef(false),cancelEnd=useRef(false);
 const commit=(next:any)=>{try{validateCaptionTrack(next,{durationFrames:doc.canvas.durationFrames});onChange(next);setError('');return true;}catch(reason:any){setError(reason.message);return false;}};
 useEffect(()=>{setText(cue?.text??'');setStart(cue?(cue.startFrame/fps).toFixed(3):'');setEnd(cue?(cue.endFrame/fps).toFixed(3):'');setError('');},[cue?.id,cue?.text,cue?.startFrame,cue?.endFrame,fps]);
 const styleEditor=<CaptionStyleEditor track={track} selection={ids} onChange={commit} onSelect={onSelect}/>;
 if(!cue)return <section className="caption-inspector" aria-label="字幕检查器"><div className="caption-inspector-heading"><strong>字幕 · 已选 {ids.length} 条</strong></div>{styleEditor}{error&&<p role="alert" className="caption-error">{error}</p>}</section>;
 const patchCue=(patch:any)=>commit({...track,cues:track.cues.map((item:any)=>item.id===cue.id?{...item,...patch}:item).sort((a:any,b:any)=>a.startFrame-b.startFrame)});
 const commitText=()=>{const cleaned=cleanCaptionText(text);setText(cleaned);if(cleaned===cue.text)return true;return patchCue({text:cleaned});};
 const commitTime=(kind:'startFrame'|'endFrame',value:string)=>{const frame=Math.round(Number(value)*fps);if(patchCue({[kind]:frame})){if(kind==='startFrame')onSeek(frame);return true;}return false;};
 const textKeyDown=(event:React.KeyboardEvent<HTMLTextAreaElement>)=>{if(event.nativeEvent.isComposing)return;if(event.key==='Escape'){event.preventDefault();cancelText.current=true;setText(cue.text);event.currentTarget.blur();}else if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();event.currentTarget.blur();}};
 const timeKeyDown=(event:React.KeyboardEvent<HTMLInputElement>,setValue:(value:string)=>void,kind:'startFrame'|'endFrame')=>{if(event.nativeEvent.isComposing)return;if(event.key==='Escape'){event.preventDefault();(kind==='startFrame'?cancelStart:cancelEnd).current=true;setValue(((kind==='startFrame'?cue.startFrame:cue.endFrame)/fps).toFixed(3));event.currentTarget.blur();}else if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur();}};
 return <section className="caption-inspector" aria-label="字幕检查器">
  <div className="caption-inspector-heading"><strong>字幕</strong><button onClick={()=>onSeek(cue.startFrame)}>定位到画面</button></div>
  <label className="caption-inspector-text">字幕文字<textarea aria-label="当前字幕文字" value={text} rows={Math.max(3,Math.ceil(text.length/14))} onChange={e=>setText(e.target.value)} onBlur={()=>{if(cancelText.current){cancelText.current=false;return;}commitText();}} onKeyDown={textKeyDown}/></label>
  <div className="caption-fields"><label>开始 / 秒<input aria-label="字幕开始时间" type="number" step={1/fps} value={start} onChange={e=>setStart(e.target.value)} onBlur={()=>{if(cancelStart.current){cancelStart.current=false;return;}if(!commitTime('startFrame',start))setStart((cue.startFrame/fps).toFixed(3));}} onKeyDown={e=>timeKeyDown(e,setStart,'startFrame')}/></label><label>结束 / 秒<input aria-label="字幕结束时间" type="number" step={1/fps} value={end} onChange={e=>setEnd(e.target.value)} onBlur={()=>{if(cancelEnd.current){cancelEnd.current=false;return;}if(!commitTime('endFrame',end))setEnd((cue.endFrame/fps).toFixed(3));}} onKeyDown={e=>timeKeyDown(e,setEnd,'endFrame')}/></label></div>
  {error&&<p role="alert" className="caption-error">{error}</p>}
  <details className="caption-original"><summary>对照原始转写</summary><p>{cue.originalText}</p>{cue.initialText&&<button disabled={cue.initialText===cue.text} onClick={()=>{setText(cue.initialText);patchCue({text:cue.initialText});}}>恢复这段识别结果</button>}</details>
  {styleEditor}
  <button className="caption-delete" onClick={()=>{if(commit({...track,cues:track.cues.filter((item:any)=>item.id!==cue.id)}))onSelect('');}}>删除这条字幕</button>
 </section>;
}
