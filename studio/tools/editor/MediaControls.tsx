import {useProjectMedia} from './ProjectMediaContext';
import {stackFrontItems,moveStackLayer} from '../../templates/remotion-base/src/editor/immersive-stack.mjs';
import {MediaPresetPicker} from './MediaPresetPicker';
import {applyMediaPreset,resolveMediaTarget} from './media-presets.mjs';
import {setMediaCount,setMediaMode,moveMediaItem,mediaEntryBounds,setMediaEntry} from './media-count.mjs';
import {planMediaBatch} from './media-batch.mjs';
import React,{useState} from 'react';
import {FilePicker} from './FilePicker';
import {Slider,ColorSwatches} from './Controls';
import {SourceCropEditor} from './SourceCropEditor';
import {replaceMediaItem} from '../../templates/remotion-base/src/editor/media-layout.mjs';
export function MediaControls({props:p,onProp,onPatch,canvas,assetId,selectedItemId,onSelectItem}:any){
 const projectMedia=useProjectMedia();
 const [selected,setSelected]=useState(p.items?.[0]?.id),[drag,setDrag]=useState<string|null>(null);
 const [batchBusy,setBatchBusy]=useState(false),[batchMessages,setBatchMessages]=useState<string[]>([]);
 const items=p.items??[],item=resolveMediaTarget(p,selectedItemId??selected),split=assetId==='media-split',sequence=split&&p.mode==='sequence',limit=split?(sequence?4:2):9;
 const displayItems=split?items:stackFrontItems(p);
 const fps=canvas.fps.num/canvas.fps.den,actual=(latest:any)=>({...latest,durationSeconds:p.durationSeconds??6});
 const entryBounds=sequence&&item?mediaEntryBounds(p,items.indexOf(item),fps):{min:0,max:3600};
 const canCount=(n:number)=>{try{setMediaCount(assetId,p,n,{fps});return true;}catch{return false;}};
 const motions=[['slide','滑入与轻缩放'],['fade','淡入淡出'],['none','直接切换'],['zoom','缩放'],['pop','弹性缩放'],['flip','翻转'],['drop','落下与旋转'],['wipe','擦除揭示']];
 const patch=(id:string,values:any)=>onPatch((latest:any)=>({...latest,items:latest.items.map((i:any)=>i.id===id?{...i,...values}:i)}));
 const move=(id:string,to:number)=>onPatch((latest:any)=>split?moveMediaItem(latest,id,to):moveStackLayer(latest,id,to));
 const count=(n:number)=>onPatch((latest:any)=>setMediaCount(assetId,actual(latest),n,{fps}));
 const imported=(meta:any,kind:string)=>{const id=item.id,media={kind,publicPath:meta.publicPath,width:meta.canvas?.width??meta.width,height:meta.canvas?.height??meta.height,...(kind==='video'?{durationSeconds:meta.durationSeconds,startSeconds:0}:{})};onPatch((latest:any)=>({...latest,items:latest.items.map((i:any)=>i.id===id?replaceMediaItem(i,media):i)}));};
 async function importBatch(files:File[]){
  const projectId=projectMedia.projectId;
  const plan=planMediaBatch(p,files.map(f=>f.name),limit,{fps});
  const messages:string[]=plan.overflow?[`超出容量：${plan.overflow} 个文件未导入（最多 ${limit} 项）；请先删除或清空素材位置。`]:[];
  setBatchMessages([...messages]);if(!plan.targets.length)return;
  setBatchBusy(true);onProp('items',plan.props.items);
  try {await projectMedia.prepareImport();for(const target of plan.targets){
   const file=files[target.fileIndex];
   try {
    const kind=/\.(mp4|mov|m4v|webm)$/i.test(file.name)?'video':/\.(png|jpe?g|webp)$/i.test(file.name)?'image':null;
    if(!kind)throw Error('不支持的文件类型');
    const response=await fetch('/api/editor/import?kind='+kind+'&projectId='+encodeURIComponent(projectId),{method:'POST',headers:{'x-editor-import':'1','x-filename':encodeURIComponent(file.name)},body:file});
    const meta=await response.json();if(!response.ok)throw Error(meta.error||'导入失败');
    const media={kind,publicPath:meta.publicPath,width:meta.canvas?.width??meta.width,height:meta.canvas?.height??meta.height,...(kind==='video'?{durationSeconds:meta.durationSeconds,startSeconds:0}:{})};
    if(projectMedia.getProjectId()!==projectId)break;
    projectMedia.onImported();
    onPatch((latest:any)=>({...latest,items:latest.items.map((i:any)=>i.id===target.id?replaceMediaItem(i,media):i)}));
    messages.push(`${file.name}：已导入`);
   }catch(error:any){messages.push(`${file.name}：${error.message}（保留空位，可单独重试）`);}
   setBatchMessages([...messages]);
  }}catch(error:any){setBatchMessages([...messages,error.message]);}finally{setBatchBusy(false);}
 }
 return <section aria-label="媒体组合设置"><label>批量导入图片 / 视频<input type="file" multiple accept=".png,.jpg,.jpeg,.webp,.mp4,.mov,.m4v,.webm" aria-label="批量导入素材文件" disabled={batchBusy} onChange={e=>{const files=Array.from(e.currentTarget.files??[]);e.currentTarget.value='';if(files.length)void importBatch(files);}}/></label>
 {batchBusy&&<p role="status">按所选顺序导入中…</p>}{batchMessages.length>0&&<ul aria-live="polite">{batchMessages.map((text,index)=><li key={index}>{text}</li>)}</ul>}
 <fieldset disabled={batchBusy} style={{border:0,padding:0,margin:0}}>
 {split&&<label>视频编排<select aria-label="视频编排" value={sequence?'sequence':'simultaneous'} onChange={e=>onPatch((latest:any)=>setMediaMode(actual(latest),e.target.value,{fps}))}><option value="sequence">依次分屏替换</option><option value="simultaneous">普通双分屏</option></select></label>}
 {!split&&<><label>堆叠构图<select value={p.framing??'contained'} onChange={e=>onProp('framing',e.target.value)}><option value="immersive">沉浸式铺叠 · 允许遮挡越界</option><option value="contained">完整收纳 · 旧版</option></select></label>{p.framing==='immersive'&&<><p className="hint">自动层级时主图落稳后默认展示至少80%；手动层级、位置、角度、缩放可突破此范围。平铺网格保持规整展示。</p><Slider label="铺叠幅度" value={p.stackFill??1.15} defaultValue={1.15} min={.7} max={2} step={.05} unit="倍" onChange={(v:any)=>onProp('stackFill',v)}/></>}</>}
 <MediaPresetPicker props={p} split={split} onPick={(id:string)=>onPatch((latest:any)=>applyMediaPreset(latest,id))}/>
 {split&&<p className="hint">斜切与依次替换可同时使用；下面还能调整分隔位置与角度。</p>}
 <label>素材数量<select aria-label="素材数量" value={items.length} onChange={e=>count(Number(e.target.value))} disabled={split&&!sequence}>{Array.from({length:limit},(_,i)=><option key={i+1} value={i+1} disabled={!canCount(i+1)}>{i+1} 个</option>)}</select></label>
 <p className="hint">减少数量会移除末尾位置，可用撤销恢复。{sequence?'① 全屏 → ①｜② → ③｜② → ③｜④；时点相对当前组合。':''}</p>
 <p className="hint">选择素材后设置裁切和时点。{split?'列表从上到下为素材顺序；调整顺序保留各位置时点。':`列表顶部是画面最上层；↑ 升一层，↓ 降一层。${p.layerMode==='manual'?'当前为手动层级，不受入场时间影响。':'调整后切换为手动层级，入场时间不变。'}`}</p>
 {!split&&p.layerMode==='manual'&&<button onClick={()=>onProp('layerMode','automatic')}>恢复自动层级</button>}
 {displayItems.map((i:any,index:number)=><div key={i.id} draggable={!batchBusy} onDragStart={()=>setDrag(i.id)} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(drag)move(drag,index);setDrag(null);}} style={{display:'flex',gap:4,padding:4,border:i.id===item?.id?'1px solid #72a5fa':'1px solid #343943'}}>
 <button aria-pressed={i.id===item?.id} onClick={()=>{setSelected(i.id);onSelectItem?.(i.id);}} style={{flex:1,display:'flex',alignItems:'center',gap:6}}>{i.media?.kind==='image'?<img src={'/'+i.media.publicPath} alt="" style={{width:38,height:28,objectFit:'cover'}}/>:i.media?.kind==='video'?<video src={'/'+i.media.publicPath} muted preload="metadata" style={{width:38,height:28,objectFit:'cover'}}/>:<span>□ 待导入</span>}{i.label}</button>
 <button aria-label={`${i.label}${split?'上移顺序':'上移一层'}`} disabled={index===0} onClick={()=>move(i.id,index-1)}>↑</button><button aria-label={`${i.label}${split?'下移顺序':'下移一层'}`} disabled={index===displayItems.length-1} onClick={()=>move(i.id,index+1)}>↓</button>
 {!split&&<button aria-label={`删除${i.label}`} disabled={items.length<=1} onClick={()=>onProp('items',items.filter((x:any)=>x.id!==i.id))}>×</button>}</div>)}
 {(!split||sequence)&&<button disabled={items.length>=limit||!canCount(items.length+1)} onClick={()=>count(items.length+1)}>添加素材位置</button>}
 <label>默认入场动作<select value={p.motion} onChange={e=>onProp('motion',e.target.value)}>{motions.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
 <label>默认退场动作<select value={p.exitMotion??p.motion} onChange={e=>onProp('exitMotion',e.target.value)}>{motions.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
 <label>视频播放<select value={p.playback} onChange={e=>onProp('playback',e.target.value)}><option value="freeze">末帧停留</option><option value="loop">循环</option></select></label>
 {!p.sceneBackground&&p.editorBackground!=='transparent'&&<ColorSwatches label="组合背景" value={p.backgroundColor} onChange={(v:any)=>onProp('backgroundColor',v)}/>}
 {!split&&<><Slider label="倾斜幅度" value={p.tilt??7} min={0} max={45} step={1} unit="°" onChange={(v:any)=>onProp('tilt',v)}/><Slider label="阴影强度" value={p.shadow??30} min={0} max={100} step={1} onChange={(v:any)=>onProp('shadow',v)}/></>}
 <Slider label="排列间隔" value={p.gap} min={0} max={200} step={1} unit="px" onChange={(v:any)=>onProp('gap',v)}/>
 {split?<><Slider label="分隔位置" value={p.separatorPosition} min={10} max={90} step={1} unit="%" onChange={(v:any)=>onProp('separatorPosition',v)}/>{p.layout==='diagonal'&&<Slider label="分隔角度" value={p.separatorAngle} min={-45} max={45} step={1} unit="°" onChange={(v:any)=>onProp('separatorAngle',v)}/>}</>:<Slider label="排列种子" value={p.seed} min={0} max={1000} step={1} onChange={(v:any)=>onProp('seed',v)}/>}
 {item&&<div key={item.id}><h4>当前素材：{item.label}</h4><p className="hint">可在预览中点选并拖动这一张；以下设置仅作用于当前素材。</p><label>素材名称<input value={item.label} onChange={e=>patch(item.id,{label:e.target.value})}/></label>
 <Slider label="素材圆角" value={item.radius??(split?0:12)} defaultValue={split?0:12} min={0} max={300} unit="px" onChange={(v:number)=>patch(item.id,{radius:v})}/>
 <Slider label="边框粗细" value={item.borderWidth??0} defaultValue={0} min={0} max={80} unit="px" onChange={(v:number)=>patch(item.id,{borderWidth:v})}/>
 <ColorSwatches label="边框颜色" value={item.borderColor??'#ffffff'} onChange={(v:string)=>patch(item.id,{borderColor:v})}/>
 <label>本张入场动画<select value={item.motion??'inherit'} onChange={e=>patch(item.id,{motion:e.target.value==='inherit'?undefined:e.target.value})}><option value="inherit">跟随默认</option>{motions.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
 <label>本张退场动画<select value={item.exitMotion??'inherit'} onChange={e=>patch(item.id,{exitMotion:e.target.value==='inherit'?undefined:e.target.value})}><option value="inherit">跟随默认</option>{motions.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
 <label>素材入场方向<select value={item.entrance??'down'} onChange={e=>patch(item.id,{entrance:e.target.value})}><option value="left">从左进入</option><option value="right">从右进入</option><option value="up">从上进入</option><option value="down">从下进入</option></select></label>
 <FilePicker label="替换当前图片" kind="image" value={item.media?.kind==='image'?item.media.publicPath:''} onImported={(m:any)=>imported(m,'image')}/><FilePicker label="替换当前视频" kind="video" value={item.media?.kind==='video'?item.media.publicPath:''} onImported={(m:any)=>imported(m,'video')}/>
 <p className="hint">支持原图比例与 9:16 竖图。替换保留本张的时间、位置和动效。</p>
 <button disabled={!item.media} onClick={()=>patch(item.id,{crop:null})}>恢复整张原图</button>
 <button disabled={!item.media} onClick={()=>patch(item.id,{media:null})}>清空素材位置</button>
 <SourceCropEditor props={{...item,crop:item.crop??{x:0,y:0,width:1,height:1,sourceAspect:item.media?item.media.width/item.media.height:4/3}}} onProp={(k:string,v:any)=>patch(item.id,{[k]:v})} source={item.media?{...item.media,startFrame:Math.round((item.media.startSeconds??0)*canvas.fps.num/canvas.fps.den)}:null} canvas={canvas} startFrame={0}/>
 {item.enterSeconds>=(p.durationSeconds??6)&&<p role="alert" className="error">此素材入场超过组合时长，请调整。</p>}
 {sequence&&items.indexOf(item)===0?<p className="hint">第一段从组合开始时全屏播放。</p>:<Slider label="入场时间" value={item.enterSeconds} min={entryBounds.min} max={entryBounds.max} defaultValue={sequence?Math.max(entryBounds.min,Math.min(entryBounds.max,(p.durationSeconds??6)*items.indexOf(item)/items.length)):0} step={sequence?1/fps:.05} unit="秒" onChange={(v:any)=>sequence?onPatch((latest:any)=>setMediaEntry(actual(latest),item.id,v,fps)):patch(item.id,{enterSeconds:v})}/>}
 {([['transitionSeconds','过渡时长',0,5,.05,'秒'],['x','水平偏移',-100,100,1,'%'],['y','垂直偏移',-100,100,1,'%'],['scale','素材缩放',.1,4,.05,'倍'],['rotation','旋转角度',-180,180,1,'°']] as const).map(([k,l,min,max,step,unit])=><Slider key={k} label={l} value={item[k]} defaultValue={k==='scale'?1:k==='transitionSeconds'?.4:0} min={min} max={max} step={step} unit={unit} onChange={(v:any)=>patch(item.id,{[k]:v})}/>)}
 {!sequence&&<label>退场时间（空白跟随组合结束）<input type="number" step="0.05" min={item.enterSeconds+.05} value={item.exitSeconds??''} onChange={e=>patch(item.id,{exitSeconds:e.target.value===''?null:Number(e.target.value)})}/></label>}
 {item.media?.kind==='video'&&<Slider label="视频素材起点" value={item.media.startSeconds??0} min={0} max={Math.max(0,item.media.durationSeconds-.001)} step={.05} unit="秒" onChange={(v:any)=>patch(item.id,{media:{...item.media,startSeconds:v}})}/>}
 </div>}</fieldset></section>;
}
