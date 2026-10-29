import {FilePicker} from './FilePicker';
import {assignPipMedia} from './pip-media.mjs';
import React from 'react';
import {Slider,ColorSwatches} from './Controls';
import {SourceCropEditor} from './SourceCropEditor';
import {PIP_DEFAULTS,pipFitSize,pipPosition,positionPip} from '../../templates/remotion-base/src/editor/source-pip.mjs';
const extra=[['slide-left','从左侧滑入','向左侧滑出'],['slide-right','从右侧滑入','向右侧滑出'],['slide-up','从上方滑入','向上方滑出'],['slide-down','从下方滑入','向下方滑出'],['pop','缩放弹入','缩放收起'],['flip','翻转进入','翻转退出']];
export function SourcePipControls({props,onProp,source,canvas,startFrame,onPatch}:any) {
 const p={...PIP_DEFAULTS,...props};
 const independent=p.sourceMode==='media',media=p.media;
 const position=pipPosition(canvas.width,canvas.height,p);
 const place=(value:{x:number;y:number})=>onPatch((latest:any)=>positionPip(canvas.width,canvas.height,latest,value));
 const cropSource=independent?(media?{...media,startFrame:Math.round((media.startSeconds??0)*canvas.fps.num/canvas.fps.den)}:null):source;
 const importMedia=(meta:any,kind:string)=>onPatch((latest:any)=>assignPipMedia(latest,meta,kind));
 // Imported media starts with zero transition time. Selecting motion must also
 // enable its duration, in the same history update, without resetting custom timing.
 const selectMotion=(key:'entrance'|'exit',mode:string)=>onPatch((latest:any)=>({
  [key]:mode,
  ...(mode!=='none'&&(latest.transitionSeconds??PIP_DEFAULTS.transitionSeconds)<=0
   ? {transitionSeconds:PIP_DEFAULTS.transitionSeconds}:{}),
 }));
 return <section aria-label="主轨同步小窗设置">
 <label>画面来源<select aria-label="小窗画面来源" value={independent?'media':'main'} onChange={e=>onPatch({sourceMode:e.target.value,crop:undefined})}><option value="main">跟随主轨</option><option value="media">独立视频 / 图片</option></select></label>
 <p className="hint">{independent?'此小窗独立播放素材，可与其他小窗叠放；素材默认静音。':'跟随主轨同一时刻；未导入主视频时留空，原声连续播放。'}</p>
 {independent&&<div>
  <FilePicker label="导入小窗视频" kind="video" value={media?.kind==='video'?media.publicPath:''} onImported={(meta:any)=>importMedia(meta,'video')}/>
  <FilePicker label="导入小窗图片" kind="image" value={media?.kind==='image'?media.publicPath:''} onImported={(meta:any)=>importMedia(meta,'image')}/>
  <p className="hint">也可在左侧素材库选择素材，点“放入选中小窗”。</p>
  {media?.kind==='video'&&<><Slider label="素材开始时间" value={media.startSeconds??0} min={0} max={Math.max(0,media.durationSeconds-.1)} step={.1} unit="秒" onChange={(v:number)=>onProp('media',{...media,startSeconds:v})}/><p className="hint">素材共 {media.durationSeconds.toFixed(1)} 秒；不足小窗时长时停留在末帧。</p></>}
 </div>}
 <h4>位置与外观</h4>
 <p className="hint">在预览画面中直接拖动素材；按住 Alt 点击可切换被遮挡的图层。</p>
 <Slider label="素材大小" value={p.size} defaultValue={PIP_DEFAULTS.size} min={10} max={300} step={1} unit="%" onChange={(v)=>onProp('size',v)}/>
 <button type="button" onClick={()=>onPatch({size:pipFitSize(canvas.width,canvas.height,p),x:50,y:50,offsetX:0,offsetY:0})}>适配画布</button>
 <button type="button" onClick={()=>onPatch({x:50,y:50,offsetX:0,offsetY:0})}>位置居中</button>
 <Slider label="素材水平位置" value={Math.round(position.x)} min={-canvas.width*3} max={canvas.width*3} unit="px" onChange={(x:number)=>place({...position,x})}/>
 <Slider label="素材垂直位置" value={Math.round(position.y)} min={-canvas.height*3} max={canvas.height*3} unit="px" onChange={(y:number)=>place({...position,y})}/>
 <Slider label="素材圆角" value={p.radius} defaultValue={0} min={0} max={300} unit="px" onChange={(v:number)=>onProp('radius',v)}/>
 <Slider label="边框粗细" value={p.borderWidth} defaultValue={0} min={0} max={80} unit="px" onChange={(v:number)=>onProp('borderWidth',v)}/>
 <ColorSwatches label="边框颜色" value={p.borderColor} onChange={(v)=>onProp('borderColor',v)} />
 <Slider label="素材阴影" value={p.shadow} defaultValue={0} min={0} max={100} unit="px" onChange={(v:number)=>onProp('shadow',v)}/>
 <SourceCropEditor props={props} onProp={onProp} source={cropSource} canvas={canvas} startFrame={independent?0:startFrame}/>
 <Slider label="进出场时长" value={p.transitionSeconds} defaultValue={PIP_DEFAULTS.transitionSeconds} min={0} max={2} step={.05} unit="秒" onChange={(v:number)=>onProp('transitionSeconds',v)}/>
 {p.transitionSeconds===0&&(p.entrance!=='none'||p.exit!=='none')&&<p className="hint">当前进出场时长为 0 秒，动画不会播放；增大时长或重新选择动画。</p>}
 <label>小窗入场<select aria-label="小窗入场" value={p.entrance} onChange={e=>selectMotion('entrance',e.target.value)}><option value="shrink">全屏缩入</option><option value="fade">淡入小窗</option><option value="none">直接出现</option>{extra.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
 <label>小窗退场<select aria-label="小窗退场" value={p.exit} onChange={e=>selectMotion('exit',e.target.value)}><option value="expand">展开回全屏</option><option value="fade">淡出小窗</option><option value="none">直接结束</option>{extra.map(([id,,label])=><option key={id} value={id}>{label}</option>)}</select></label>
 </section>;
}
