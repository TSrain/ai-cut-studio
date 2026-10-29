import {cameraEditReason} from './caption-camera-model.mjs';
import {cameraDisplayClips} from './timeline-view.mjs';
import React,{useEffect,useRef,useState} from 'react';
import {CAMERA_PRESETS,cameraClips,clipEnd,withCameraClips,duplicateCameraClip,applyCameraPreset} from '../../templates/remotion-base/src/editor/camera-clips.mjs';
import {validateShotPlan} from '../lib/aroll-shot-plan.mjs';
import './camera-controls.css';

const time=(seconds:number)=>`${String(Math.floor(seconds/60)).padStart(2,'0')}:${(seconds%60).toFixed(1).padStart(4,'0')}`;
const effectName=(clip:any)=>clip.holdToEnd?'推近后保持至片尾':CAMERA_PRESETS.find(p=>p.id===clip.preset)?.name||'推近后拉回';
export function CameraControls({plan,duration,getFrame,fps,onSeek,onChange,selected,selectedRange,onSelect,onPreviewClip,onExport,exportBusy,document:doc}:any){
 const [error,setError]=useState('');const panel=useRef<HTMLElement>(null);
 useEffect(()=>{setError('');const scroller=panel.current?.closest('.inspector');if(scroller)scroller.scrollTop=0;},[selected,selectedRange?.startFrame]);
 const readOnly=doc?cameraEditReason(doc):'';
 let clips:any[]=[],display:any[]=[];
 try{clips=cameraClips(plan);display=doc?cameraDisplayClips(doc):clips.map(c=>({...c,displayStart:Math.round(c.start*fps),displayEnd:Math.round(clipEnd(c)*fps),displayKey:c.id}));}catch(e){return <p role="alert">{String(e)}</p>;}
 const chosen=display.find(c=>c.id===selected&&(!selectedRange||(c.displayStart===selectedRange.startFrame&&c.displayEnd===selectedRange.endFrame)))??display.find(c=>c.id===selected);
 const select=(c:any)=>{onSelect(c.id,{startFrame:c.displayStart,endFrame:c.displayEnd});onSeek(c.displayStart);};
 const base=()=>({version:2,duration,levels:{A:1,B:1.12,C:1.18},anchor:{x:.5,y:.2},events:[{at:0,to:'A',transition:'cut',purpose:'hook',cue:'开场',reason:'保留基础构图'}]});
 const change=(fn:any)=>{if(readOnly){setError(readOnly);return false;}try{const next=withCameraClips(plan??base(),fn(structuredClone(clips)));const report=validateShotPlan(next);if(report.errors.length)throw Error(report.errors.join(';'));setError('');if(JSON.stringify(next)!==JSON.stringify(plan))onChange(next);return true;}catch{setError('请检查镜头是否重叠或超出片尾；推近和拉回各需至少 0.2 秒。');return false;}};
 const patch=(data:any)=>change((all:any[])=>all.map(c=>c.id===selected?{...c,...data,...(c.holdToEnd?{hold:duration-(data.start??c.start)-(data.in??c.in),out:0}:{}),...(Object.keys(data).some(k=>k!=='enabled')?{preset:data.preset??'custom'}:{})}:c));
 const field=(label:string,v:number,min:number,max:number,step:number,run:any)=><label className="camera-field"><span>{label}</span><input aria-label={label} key={`${selected}:${label}:${v}`} type="number" defaultValue={Number(v.toFixed(3))} min={min} max={max} step={step} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}} onBlur={e=>{const n=Number(e.currentTarget.value);if(e.currentTarget.value&&Number.isFinite(n)&&n>=min&&n<=max)run(n);else e.currentTarget.value=String(v);}}/></label>;
 const add=()=>{let n=1;while(clips.some(c=>c.id===`camera-new-${n}`))n++;const c={id:`camera-new-${n}`,name:'手动强调',start:getFrame()/fps,in:.35,hold:2,out:.7,zoom:1.1,enabled:true,preset:'quick',inEasing:'linear',outEasing:'ramped'};if(change((all:any[])=>[...all,c].sort((a,b)=>a.start-b.start)))onSelect(c.id);};
 const anchor=<><p className="camera-note">构图中心 · 影响全片镜头</p>{field('横向位置',plan?.anchor?.x??.5,0,1,.01,v=>onChange({...(plan??base()),anchor:{...(plan?.anchor??{x:.5,y:.2}),x:v}}))}{field('纵向位置',plan?.anchor?.y??.2,0,1,.01,v=>onChange({...(plan??base()),anchor:{...(plan?.anchor??{x:.5,y:.2}),y:v}}))}</>;
 return <section ref={panel} className="camera-controls" aria-label={chosen?'单段口播镜头':'口播镜头列表'}>
 {readOnly&&<p className="camera-note" role="status">{doc?.source?.locked?'主视频已锁定，可预览，解锁后可调整。':'主视频已剪辑，可预览；镜头时段随主视频片段调整。'}</p>}
 {chosen?<div key={chosen.displayKey}>
  <button className="camera-back" onClick={()=>onSelect('')}>← 全部镜头（{display.length}）</button>
  <div className="camera-heading"><span className="camera-eyebrow">镜头 {display.indexOf(chosen)+1}</span><h3>{chosen.name||'口播强调'}</h3><p>{time(chosen.displayStart/fps)} — {time(chosen.displayEnd/fps)} · {((chosen.displayEnd-chosen.displayStart)/fps).toFixed(1)} 秒</p></div>
  <button className="camera-preview primary" onClick={()=>onPreviewClip(chosen)}>▶ 预览本段</button>
  <fieldset disabled={!!readOnly}>
   <label className="camera-effect">镜头效果<select aria-label="镜头效果" value={chosen.preset??'custom'} onChange={e=>change((all:any[])=>all.map(c=>c.id===selected?applyCameraPreset(c,e.target.value):c))}><option value="custom" disabled>保留原有效果</option>{CAMERA_PRESETS.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
   <div className="camera-actions"><button aria-pressed={chosen.enabled} onClick={()=>patch({enabled:!chosen.enabled})}>{chosen.enabled?'关闭效果':'启用效果'}</button><button className="camera-delete" onClick={()=>{if(change((all:any[])=>all.filter(c=>c.id!==selected)))onSelect('');}}>删除本段</button></div>
  </fieldset>
  {!chosen.enabled&&<p className="camera-note">效果已关闭，预览时显示原画面。</p>}
  <details className="camera-advanced"><summary>高级调整</summary><fieldset disabled={!!readOnly}>
   {field('开始时间（秒）',chosen.start,0,duration,.05,v=>patch({start:v}))}
   {field('推近倍率',chosen.zoom,1.01,1.35,.01,v=>patch({zoom:v}))}
   {field('推近时长（秒）',chosen.in,.2,10,.05,v=>patch({in:v}))}
   {chosen.holdToEnd?<p className="camera-note">推近后保持至片尾，不拉回。</p>:<>{field('保持时长（秒）',chosen.hold,0,duration,.1,v=>patch({hold:v}))}{field('拉回时长（秒）',chosen.out,.2,10,.05,v=>patch({out:v}))}</>}
   {(chosen.holdToEnd?['inEasing']:['inEasing','outEasing']).map((key,index)=><label key={key} className="camera-field"><span>{index?'拉回方式':'推近方式'}</span><select aria-label={index?'拉回方式':'推近方式'} value={chosen[key]} onChange={e=>patch({[key]:e.target.value})}><option value="linear">匀速</option><option value="ramped">短加减速</option><option value="smoothstep">平滑加减速</option></select></label>)}
   {anchor}
  </fieldset></details>
  <details className="camera-advanced"><summary>更多操作</summary><div className="camera-actions"><button disabled={!!readOnly} onClick={()=>change((all:any[])=>duplicateCameraClip(all,selected,duration))}>复制本段</button><button disabled={exportBusy} onClick={()=>onExport({kind:'camera',id:chosen.id})}>导出此时段</button></div><p className="camera-note">导出包含此时段的全部画面与声音。</p></details>
 </div>:<>
  <div className="camera-overview"><strong>{display.length?'已添加 '+display.length+' 段镜头':'还没有镜头变化'}</strong><p className="camera-note">{display.length?'先预览，点击一段即可调整效果。':'在需要强调的位置，添加一次推近和拉回。'}</p></div>
  <button className="camera-add" disabled={!!readOnly} onClick={add}>＋ 在播放位置添加</button>
  <div className="camera-list">{display.map((c,index)=><div className="camera-card" key={c.displayKey}>
   <button className="camera-card-select" aria-label={`调整镜头 ${index+1}：${c.name}`} onClick={()=>select(c)}><span className="camera-card-meta"><span>镜头 {index+1}</span><span>{time(c.displayStart/fps)} — {time(c.displayEnd/fps)}</span></span><strong>{c.name||'口播强调'}</strong></button>
   <div className="camera-card-footer"><span>{c.enabled?effectName(c):'已关闭'}</span><button aria-label={`预览镜头 ${index+1}`} onClick={()=>onPreviewClip(c)}>▶ 预览</button></div>
  </div>)}</div>
  <details className="camera-advanced" key="overview"><summary>高级调整</summary><fieldset disabled={!!readOnly}>{anchor}</fieldset></details>
 </>}
 {error&&<p role="alert" className="camera-error">{error}</p>}
 </section>;
}
