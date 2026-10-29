import React,{useEffect,useMemo,useRef,useState} from 'react';
import {transcriptWords,transcriptEdit,wordAtFrame,transcriptKeyCommand} from './transcript-model.mjs';
import './transcript-view.css';

type Props={document:any;getDocument:()=>any;getFrame?:()=>number;onSeek:(frame:number)=>void;onEdit:(result:any)=>void;active:boolean};
type Selection={anchor:number;focus:number}|null;
const errorText=(e:unknown)=>e instanceof Error?e.message:String(e);

/** Delete/restore-only transcript: select words, ⌫ removes them from the cut, ⇧⌫ / R restores. */
export function TranscriptView({document:doc,getDocument,getFrame,onSeek,onEdit,active}:Props){
 const {words,groups}=useMemo(()=>{try{return transcriptWords(doc);}catch{return {words:[],groups:[]};}},[doc]);
 const [selection,setSelection]=useState<Selection>(null),[follow,setFollow]=useState(true);
 const [notice,setNotice]=useState(''),[error,setError]=useState('');
 const box=useRef<HTMLDivElement>(null),dragging=useRef(false),playheadWord=useRef(-1),live=useRef({words,selection,follow});
 live.current={words,selection,follow};
 useEffect(()=>{setSelection(null);setNotice('');setError('');playheadWord.current=-1;},[doc.id]);
 const [lo,hi]=selection?[Math.min(selection.anchor,selection.focus),Math.max(selection.anchor,selection.focus)]:[-1,-2];
 const selectedKept=selection?words.slice(lo,hi+1).filter(w=>w.kept).length:0,selectedCut=selection?hi-lo+1-selectedKept:0;
 const keptCount=useMemo(()=>words.filter(w=>w.kept).length,[words]);

 // Playhead follow: move one class between spans instead of re-rendering 2–3k words per tick.
 const mark=(index:number)=>{
  const root=box.current;if(!root||index===playheadWord.current)return;
  root.querySelector('.transcript-word.is-playhead')?.classList.remove('is-playhead');
  playheadWord.current=index;
  if(index<0)return;
  const span=root.querySelector(`[data-word="${index}"]`) as HTMLElement|null;
  span?.classList.add('is-playhead');
  if(span&&live.current.follow&&!dragging.current){
   const r=span.getBoundingClientRect(),view=root.getBoundingClientRect();
   if(r.top<view.top+24||r.bottom>view.bottom-24)root.scrollTop+=r.top-view.top-view.height/3;
  }
 };
 useEffect(()=>{
  if(!active||!getFrame)return;
  playheadWord.current=-1;mark(wordAtFrame(live.current.words,getFrame()));
  const timer=setInterval(()=>mark(wordAtFrame(live.current.words,getFrame())),120);
  return()=>clearInterval(timer);
 },[active,words]);
 // React rewrites className on re-render; keep the playhead mark on its span.
 useEffect(()=>{const i=playheadWord.current;if(i>=0)box.current?.querySelector(`[data-word="${i}"]`)?.classList.add('is-playhead');});
 useEffect(()=>{const up=()=>{dragging.current=false;};window.addEventListener('pointerup',up);return()=>window.removeEventListener('pointerup',up);},[]);

 const run=(kind:'cut'|'restore'|'toggle')=>{
  const sel=live.current.selection;if(!sel)return;
  const a=Math.min(sel.anchor,sel.focus),b=Math.max(sel.anchor,sel.focus);
  const resolved=kind==='toggle'?(live.current.words.slice(a,b+1).some(w=>w.kept)?'cut':'restore'):kind;
  try{
   const result:any=transcriptEdit(getDocument(),a,b,resolved);
   if(result.blocked){setError(result.blocked);setNotice('');return;}
   onEdit(result);setError('');setNotice(result.message);
  }catch(e){setError(errorText(e));setNotice('');}
 };
 const seekWord=(index:number)=>{const w=live.current.words[index];if(w)onSeek(w.projectFrame);};
 const onKeyDown=(e:React.KeyboardEvent)=>{
  const command=transcriptKeyCommand(e.nativeEvent,{hasSelection:!!live.current.selection});
  if(!command)return; // J/K/L, Space, N/P, ?, ⌘Z … reach the global handlers.
  e.preventDefault();e.stopPropagation();
  const sel=live.current.selection,last=live.current.words.length-1,clamp=(n:number)=>Math.max(0,Math.min(last,n));
  if(command==='noop')return;
  if(command==='select-all'){setSelection({anchor:0,focus:last});return;}
  if(command==='clear'){setSelection(null);return;}
  if(command==='left'||command==='right'){const at=clamp((sel?(command==='left'?Math.min(sel.anchor,sel.focus)-1:Math.max(sel.anchor,sel.focus)+1):Math.max(0,playheadWord.current)));setSelection({anchor:at,focus:at});seekWord(at);return;}
  if(command==='extend-left'||command==='extend-right'){const base=sel??{anchor:Math.max(0,playheadWord.current),focus:Math.max(0,playheadWord.current)};setSelection({anchor:base.anchor,focus:clamp(base.focus+(command==='extend-left'?-1:1))});return;}
  run(command as 'cut'|'restore'|'toggle');
 };
 const indexOf=(e:React.PointerEvent)=>{const t=(e.target as HTMLElement).closest('[data-word]');return t?Number(t.getAttribute('data-word')):null;};
 const onPointerDown=(e:React.PointerEvent)=>{
  const i=indexOf(e);if(i===null||e.button!==0)return;
  e.preventDefault();box.current?.focus({preventScroll:true});
  const sel=live.current.selection;
  if(e.shiftKey&&sel)setSelection({anchor:sel.anchor,focus:i});
  else{setSelection({anchor:i,focus:i});seekWord(i);}
  dragging.current=true;
 };
 const onPointerOver=(e:React.PointerEvent)=>{if(!dragging.current||!(e.buttons&1))return;const i=indexOf(e);if(i!==null)setSelection(s=>s&&s.focus!==i?{anchor:s.anchor,focus:i}:s);};

 if(!words.length)return <p className="roughcut-muted">当前粗剪没有逐字时间，无法使用文稿剪辑。</p>;
 return <div className="transcript-view">
  <div className="transcript-toolbar">
   <span className="transcript-count">保留 {keptCount}/{words.length} 字</span>
   <button type="button" disabled={!selectedKept} onClick={()=>run('cut')} title="Backspace / Delete / A">删除所选</button>
   <button type="button" disabled={!selectedCut} onClick={()=>run('restore')} title="⇧⌫ / R">恢复所选</button>
   <label className="transcript-follow"><input type="checkbox" checked={follow} onChange={e=>setFollow(e.currentTarget.checked)}/>跟随播放</label>
  </div>
  <div ref={box} className="transcript-text" tabIndex={0} role="listbox" aria-multiselectable="true" aria-label="文稿剪辑：拖选文字后按退格删除，Shift+退格或 R 恢复"
   onKeyDown={onKeyDown} onPointerDown={onPointerDown} onPointerOver={onPointerOver}>
   {groups.map(g=><p key={g.id} className="transcript-para">{words.slice(g.start,g.end).map(w=><span key={w.id} data-word={w.index}
    className={`transcript-word${w.kept?'':' is-cut'}${!w.kept&&w.cutEnabled?' by-take':''}${w.index>=lo&&w.index<=hi?' is-selected':''}${w.locked?' is-locked':''}${w.missing?' is-uncertain':''}`}
    title={w.locked?'明确保护的原话':w.missing?'附近可能缺字':undefined}>{w.text}</span>)}</p>)}
  </div>
  {error&&<p role="alert" className="roughcut-error">{error}</p>}
  {notice&&<p role="status" className="roughcut-muted transcript-notice">{notice}</p>}
  <p className="roughcut-muted transcript-hint">单击跳转 · 拖选或 ⇧单击扩选 · ⌫ 删除 · ⇧⌫ / R 恢复 · X 切换 · ←/→ 逐字 · ⌘A 全选 · Esc 取消。删除按整字计算并对齐到前后停顿的中点；连续删除合并为一步撤销。</p>
 </div>;
}
