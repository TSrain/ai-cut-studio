import React from 'react';
import {ColorSwatches,Slider} from './Controls';
import {SCENE_BACKGROUND_DEFAULTS,resolveSceneBackground} from '../../templates/remotion-base/src/editor/scene-background.mjs';
export function SceneBackgroundControls({props:p,onPatch,hasSource=false,defaultMode='original'}:any){
 const bg=resolveSceneBackground(p),choice=p.editorBackground==='transparent'?'transparent':bg?.type??p.editorBackground??defaultMode;
 const patch=(k:string,v:any)=>onPatch((latest:any)=>({...latest,sceneBackground:{...SCENE_BACKGROUND_DEFAULTS[choice],...latest.sceneBackground,[k]:v}}));
 return <section aria-label="动画背景"><label>动画背景<select aria-label="动画背景" value={choice} onChange={e=>{const type=e.target.value;onPatch((latest:any)=>({...latest,editorBackground:type==='transparent'?'transparent':'original',sceneBackground:SCENE_BACKGROUND_DEFAULTS[type]?{...SCENE_BACKGROUND_DEFAULTS[type],...(type!=='solid'&&latest.sceneBackground?.name?{name:latest.sceneBackground.name}:{})}:undefined}));}}>
 <option value="original">原模板背景</option><option value="transparent">透明叠加</option><option value="video-blur" disabled={!hasSource}>动态模糊视频</option><option value="solid">自定义纯色</option><option value="gradient">自定义渐变</option><option value="wall-a">大瑞 Keaton · 背景墙</option><option value="wall-b">B · 深墨斜向字墙</option>
 </select></label>{!hasSource&&<p className="hint">添加口播底片后可使用动态模糊视频背景。</p>}{bg&&<details key={bg.type} open={['solid','gradient','video-blur'].includes(bg.type)}><summary>背景颜色与参数</summary>{bg.type!=='video-blur'&&<ColorSwatches label="背景颜色" value={bg.color} onChange={(v:any)=>patch('color',v)}/>}{bg.type==='video-blur'&&<>
 <Slider label="背景模糊" value={bg.blur} min={0} max={80} step={1} defaultValue={20} onChange={(v:any)=>patch('blur',v)}/>
 <p className="hint">{hasSource?'口播视频同步铺满并虚化，前景动画保持清晰。背景不重复播放声音。':'请先添加口播底片，再使用动态模糊视频背景。'}</p>
 </>}{bg.type==='gradient'&&<>
 <div role="group" aria-label="渐变配色" style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:6,margin:'8px 0 14px'}}>
 {[['冷黑蓝','#10151C','#334E70'],['暗紫','#141121','#504470'],['墨绿','#0E1A1B','#315955'],['暖棕','#1A1513','#73513B'],['银灰','#20252D','#657181'],['浅雾','#D9E3EE','#FBF8F2']].map(([label,a,b])=><button key={label} type="button" aria-label={`渐变预设 ${label}`} title={label} onClick={()=>onPatch((latest:any)=>({...latest,sceneBackground:{...SCENE_BACKGROUND_DEFAULTS.gradient,...latest.sceneBackground,color:a,color2:b}}))} style={{height:48,border:'1px solid #526075',borderRadius:6,background:`linear-gradient(135deg,${a},${b})`,color:label==='浅雾'?'#20252D':'#FFFFFF',textShadow:label==='浅雾'?'none':'0 1px 3px #000'}}>{label}</button>)}
 </div>
 <ColorSwatches label="渐变结束颜色" value={bg.color2} onChange={(v:any)=>patch('color2',v)}/>
 <label>渐变方式<select aria-label="渐变方式" value={bg.gradientType} onChange={e=>patch('gradientType',e.target.value)}><option value="linear">线性渐变</option><option value="radial">中心渐变</option></select></label>
 {bg.gradientType==='linear'&&<Slider label="渐变方向" value={bg.angle} min={0} max={360} step={1} unit="°" defaultValue={135} onChange={(v:any)=>patch('angle',v)}/>}
 </>}
{['wall-a','wall-b'].includes(bg.type)&&<>
 <label>背景名字<input aria-label="背景名字" maxLength={60} value={bg.name} onChange={e=>patch('name',e.target.value)}/></label>
 <ColorSwatches label="背景文字颜色" value={bg.ink} onChange={(v:any)=>patch('ink',v)}/>
 <Slider label="文字显著度" value={bg.strength} min={0} max={1} step={.01} defaultValue={SCENE_BACKGROUND_DEFAULTS[choice].strength} onChange={(v:any)=>patch('strength',v)}/>
 <Slider label="背景模糊" value={bg.blur} min={0} max={20} step={.1} defaultValue={SCENE_BACKGROUND_DEFAULTS[choice].blur} onChange={(v:any)=>patch('blur',v)}/>
 <Slider label="背景速度" value={bg.speed} min={0} max={2} step={.05} defaultValue={SCENE_BACKGROUND_DEFAULTS[choice].speed} onChange={(v:any)=>patch('speed',v)}/>

 {bg.type==='wall-a'&&<>
 <details open><summary>中央内容区</summary>
 <Slider label="中心纹样保留强度" value={bg.centerStrength} min={0} max={1} step={.01} defaultValue={1/3} onChange={(v:any)=>patch('centerStrength',v)}/>
 <Slider label="内容区宽度" value={bg.contentWidth} min={10} max={100} step={1} unit="%" defaultValue={65} onChange={(v:any)=>patch('contentWidth',v)}/>
 <Slider label="内容区高度" value={bg.contentHeight} min={10} max={100} step={1} unit="%" defaultValue={60} onChange={(v:any)=>patch('contentHeight',v)}/>
 <Slider label="衰减柔和度" value={bg.feather} min={1} max={30} step={1} defaultValue={12} onChange={(v:any)=>patch('feather',v)}/>
 </details>
 <details open><summary>固定署名</summary>
 <label><input type="checkbox" aria-label="显示固定署名" checked={bg.signatureVisible} onChange={e=>patch('signatureVisible',e.target.checked)}/>显示固定署名</label>
 <ColorSwatches label="署名中文颜色" value={bg.signatureInk} onChange={(v:any)=>patch('signatureInk',v)}/>
 <ColorSwatches label="署名英文颜色" value={bg.signatureMuted} onChange={(v:any)=>patch('signatureMuted',v)}/>
 <ColorSwatches label="署名短线颜色" value={bg.accent} onChange={(v:any)=>patch('accent',v)}/>
 <Slider label="署名大小" value={bg.signatureScale} min={.5} max={1.5} step={.05} defaultValue={1} onChange={(v:any)=>patch('signatureScale',v)}/>
 <Slider label="署名左边距" value={bg.signatureX} min={0} max={30} step={.5} unit="%" defaultValue={4.5} onChange={(v:any)=>patch('signatureX',v)}/>
 <Slider label="署名上边距" value={bg.signatureY} min={0} max={30} step={.5} unit="%" defaultValue={4.5} onChange={(v:any)=>patch('signatureY',v)}/>
 </details>
 <p className="hint">三行同速平移；中央衰减和署名固定。短片不是10秒无缝循环，长内容请延长动画实例。</p>
 </>}
 <p className="hint">速度为0时静止。仅修改当前动画；不改变前景卡片和素材。</p>
 </>}</details>}</section>;
}
