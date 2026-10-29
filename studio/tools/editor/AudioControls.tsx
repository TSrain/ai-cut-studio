import React from 'react';
import type {AudioClip} from '../../templates/remotion-base/src/editor/types';
import {editAudioFades} from '../../templates/remotion-base/src/editor/audio.mjs';
export const AudioControls:React.FC<{clip:AudioClip;fps:number;onChange:(patch:Partial<AudioClip>)=>void;locked?:boolean}>=({clip,fps,onChange,locked=false})=><fieldset disabled={locked} style={{border:0,padding:0,display:'grid',gap:12}}>
 <legend>音频设置</legend>
 <label>音量 {Math.round(clip.volume*100)}% <input aria-label="音量" type="range" min="0" max="2" step="0.01" value={clip.volume} onChange={e=>onChange({volume:Number(e.target.value)})}/></label>
 <label><input type="checkbox" checked={!!clip.muted} onChange={e=>onChange({muted:e.target.checked})}/> 静音</label>
 <label>音乐选段起点（秒）<input aria-label="音乐选段起点（秒）" type="number" min="0" max={(clip.sourceDurationFrames-clip.durationFrames)/fps} step={1/fps} value={Number((clip.sourceInFrame/fps).toFixed(3))} onChange={e=>{const v=e.target.valueAsNumber;if(Number.isFinite(v))onChange({sourceInFrame:Math.max(0,Math.min(clip.sourceDurationFrames-clip.durationFrames,Math.round(v*fps)))});}}/></label>
 {(['fadeInFrames','fadeOutFrames'] as const).map(k=>{const label=k==='fadeInFrames'?'淡入':'淡出',curve=k==='fadeInFrames'?'fadeInCurve':'fadeOutCurve';return <div key={k} style={{display:'grid',gap:6}}>
 <label>{label}（秒）<input aria-label={`${label}（秒）`} type="number" min="0" max={clip.durationFrames/fps} step={1/fps} value={Number((clip[k]/fps).toFixed(3))} onChange={e=>{const v=e.target.valueAsNumber;if(Number.isFinite(v))onChange(editAudioFades(clip,{[k]:Math.round(v*fps)}));}}/></label>
 <label>{label}曲线 <select aria-label={`${label}曲线`} value={clip[curve]??'linear'} onChange={e=>onChange(editAudioFades(clip,{[curve]:e.target.value}))}><option value="linear">直线</option><option value="smooth">柔和 S 形</option><option value="equalPower">等功率</option></select></label>
 </div>;})}
 <small>选段起点只移动音乐内容，不移动时间轴位置。淡化设为 0 可直接交接；重叠换曲请将两段放在不同音轨。</small>
 {!!clip.envelopeOffsetFrames&&<small>此片段继承了分割前的淡化。修改淡化后将按当前片段重新计算。</small>}
 <small>{clip.name} · 片段 {(clip.durationFrames/fps).toFixed(2)} 秒 · 素材 {(clip.sourceDurationFrames/fps).toFixed(2)} 秒</small>
</fieldset>;
