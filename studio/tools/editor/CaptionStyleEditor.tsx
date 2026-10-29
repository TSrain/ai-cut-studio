import React,{useContext,useEffect,useRef,useState} from 'react';
import {CAPTION_FONTS,DEFAULT_CAPTION_STYLE,captionStyleValues,patchCaptionStyles,resetCaptionStyles} from '../../templates/remotion-base/src/editor/captions.mjs';
import {ControlGestures} from './Controls';
import './caption-inspector.css';

export function CaptionStyleControls({style:inputStyle,onPatch,mixed=[]}:any){
 const style={...DEFAULT_CAPTION_STYLE,...inputStyle};
 const gesture=useContext(ControlGestures),cleanup=useRef<(()=>void)|undefined>();
 useEffect(()=>()=>cleanup.current?.(),[]);
 const begin=()=>{cleanup.current?.();gesture.start();const end=()=>{window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',end);gesture.end();cleanup.current=undefined;};window.addEventListener('pointerup',end,{once:true});window.addEventListener('pointercancel',end,{once:true});cleanup.current=end;};
 const hint=(key:string)=>mixed.includes(key)?<small className="caption-mixed">多个值</small>:null;
 const number=(key:string,label:string,min:number,max:number,step=1)=><label key={key}>{label}<input aria-label={`字幕${label}`} type="number" min={min} max={max} step={step} key={`${style[key]}-${mixed.includes(key)}`} placeholder={mixed.includes(key)?'多个值':undefined} defaultValue={mixed.includes(key)?'':style[key]} onBlur={e=>{const value=e.target.value;if(value.trim()!==''&&(mixed.includes(key)||Number(value)!==style[key]))onPatch({[key]:Number(value)});}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();if(e.key==='Escape'){e.currentTarget.value=mixed.includes(key)?'':String(style[key]);e.currentTarget.blur();}}}/></label>;
 const color=(key:string,label:string)=><label>{label}<input aria-label={`字幕${label}`} type="color" value={style[key].length===4?'#'+style[key].slice(1).split('').map((x:string)=>x+x).join(''):style[key]} onChange={e=>onPatch({[key]:e.target.value})}/>{hint(key)}{mixed.includes(key)&&<button type="button" onClick={()=>onPatch({[key]:style[key]})}>统一为此颜色</button>}</label>;
 return <div className="caption-style-controls">
  <label>字体<select aria-label="字幕字体" value={mixed.includes('fontFamily')?'':style.fontFamily} onChange={e=>onPatch({fontFamily:e.target.value})}>{mixed.includes('fontFamily')&&<option value="" disabled>多个值</option>}{CAPTION_FONTS.map((font:any)=><option key={font.value} value={font.value}>{font.label}</option>)}</select></label>
  <div className="caption-fields">{number('fontSize','字号',16,200)}{color('color','文字颜色')}</div>
  <div className="caption-fields">{color('backgroundColor','背景颜色')}<label>背景不透明度<input aria-label="字幕背景不透明度" aria-valuetext={mixed.includes('backgroundOpacity')?'多个值':`${Math.round(style.backgroundOpacity*100)}%`} type="range" min="0" max="1" step=".05" value={style.backgroundOpacity} onPointerDown={begin} onChange={e=>onPatch({backgroundOpacity:Number(e.target.value)})}/><small>{mixed.includes('backgroundOpacity')?'多个值':`${Math.round(style.backgroundOpacity*100)}%`}</small>{mixed.includes('backgroundOpacity')&&<button type="button" onClick={()=>onPatch({backgroundOpacity:style.backgroundOpacity})}>统一为 {Math.round(style.backgroundOpacity*100)}%</button>}</label></div>
  <div className="caption-fields">{number('positionXPercent','水平位置 %',0,100,.1)}{number('bottomPercent','距底部',0,90,.1)}</div>
  <div className="caption-fields">{number('maxWidthPercent','最大宽度 %',10,100)}{number('borderRadius','背景圆角',0,200)}</div>
  <div className="caption-fields">{number('paddingX','左右内边距',0,200)}{number('paddingY','上下内边距',0,200)}</div>
 </div>;
}

export function CaptionStyleEditor({track,selection=[],onChange,onSelect}:any){
 const ids=track.cues.filter((c:any)=>selection.includes(c.id)).map((c:any)=>c.id),selectionKey=ids.join('|');
 const [scope,setScope]=useState<'selected'|'all'>(ids.length?'selected':'all'),[error,setError]=useState('');
 useEffect(()=>{setScope(ids.length?'selected':'all');setError('');},[selectionKey]);
 const effectiveScope=ids.length?scope:'all';
 const {style,mixed}=captionStyleValues(track,effectiveScope==='all'?track.cues.map((c:any)=>c.id):ids);
 const commit=(make:()=>any)=>{try{onChange(make());setError('');}catch(e:any){setError(e.message);}};
 return <section className="caption-scoped-style" aria-label="字幕样式设置">
  <div className="caption-selection-actions"><span>已选 {ids.length} / {track.cues.length} 条</span><button onClick={()=>onSelect(track.cues.map((c:any)=>c.id))}>选择全部字幕</button><button disabled={!ids.length} onClick={()=>onSelect([])}>清除选择</button></div>
  <div className="caption-style-scope" role="group" aria-label="字幕修改范围"><button aria-pressed={effectiveScope==='selected'} disabled={!ids.length} onClick={()=>setScope('selected')}>仅选中 {ids.length} 条</button><button aria-pressed={effectiveScope==='all'} onClick={()=>setScope('all')}>全部字幕</button></div>
  <p className="caption-scope-note">{effectiveScope==='all'?'本次修改的属性会应用到全部字幕，其他局部设置保留。':'只修改选中字幕；多个值表示当前设置不同。'}</p>
  <CaptionStyleControls key={effectiveScope+selectionKey} style={style} mixed={mixed} onPatch={(patch:any)=>commit(()=>patchCaptionStyles(track,ids,patch,effectiveScope))}/>
  {ids.length>0&&<button disabled={!track.cues.some((c:any)=>ids.includes(c.id)&&Object.keys(c.style??{}).length)} onClick={()=>commit(()=>resetCaptionStyles(track,ids))}>恢复选中字幕的全局样式</button>}
  {error&&<p role="alert" className="caption-error">{error}</p>}
 </section>;
}
