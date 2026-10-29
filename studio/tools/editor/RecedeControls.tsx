import React, {useEffect, useRef, useState} from 'react';
import {Slider} from './Controls';
import {markRecedeRange, rangeRuns, recedeRanges, updateRecedeText, type RecedeSlots} from '../../templates/remotion-base/src/presets/recede-controls.mjs';

type Props = {instance: any; canvas?: any; onPatchProps?: (patch: any) => void; onPatchSlots: (slots: any) => void};
const effects = [{value:'none',label:'无'},{value:'fade',label:'淡入 / 淡出'},{value:'rise',label:'上移'},{value:'fall',label:'下移'},{value:'zoom',label:'缩放'}];

/** All content edits are a single history transaction, including mark relocation. */
export function RecedeControls({instance, canvas, onPatchProps, onPatchSlots}: Props) {
  const slots: RecedeSlots = instance.props.slots;
  const input = useRef<HTMLTextAreaElement>(null);
  const [selection, setSelection] = useState({start:0,end:0});
  useEffect(() => setSelection({start:0,end:0}), [instance.id, slots.line]);
  const ranges = recedeRanges(slots);
  const chosen = slots.line.slice(selection.start, selection.end);
  const fontSize = instance.props.elements?.line?.fontSize ?? slots.fontSize ?? (canvas?.width > canvas?.height ? 120 : 94);
  const ratio = slots.emphasisRatio ?? 1.6;
  const mark = (enlarged: boolean) => onPatchSlots({hero:'', emphasisRanges:markRecedeRange(slots,selection.start,selection.end,enlarged)});
  const setSize = (value: number) => {
    if (!onPatchProps) {onPatchSlots({fontSize:value}); return;}
    onPatchProps((props: any) => {
      const line = {...props.elements?.line};
      delete line.fontSize;
      return {slots:{...props.slots,fontSize:value}, elements:{...props.elements,line}};
    });
  };
  return <div className="recede-controls">
    <label className="content-control">整句话
      <textarea ref={input} aria-label="退让镜整句话" rows={3} value={slots.line}
        onSelect={e=>setSelection({start:e.currentTarget.selectionStart,end:e.currentTarget.selectionEnd})}
        onChange={e=>onPatchSlots(updateRecedeText(slots,e.target.value))}/>
    </label>
    <div className="recede-selection-note">{chosen ? `已选「${chosen}」` : '在上方拖选文字，再设置大小。可选多处。'}</div>
    <div className="recede-actions">
      <button type="button" disabled={!chosen} onMouseDown={e=>e.preventDefault()} onClick={()=>mark(true)}>放大选中文字</button>
      <button type="button" disabled={!chosen} onMouseDown={e=>e.preventDefault()} onClick={()=>mark(false)}>恢复普通</button>
    </div>
    <div className="recede-mark-preview" aria-label="文字大小标记预览">
      {rangeRuns(slots.line,ranges).map((run,index)=><span key={index} className={run.em?'enlarged':''}>{run.text}</span>)}
    </div>
    <div className="recede-actions secondary">
      <button type="button" onClick={()=>onPatchSlots({hero:'',emphasisRanges:[]})}>全部普通</button>
      <button type="button" disabled={!slots.line.length} onClick={()=>onPatchSlots({hero:'',emphasisRanges:[{start:0,end:slots.line.length}]})}>全部放大</button>
    </div>
    <p className="hint">高亮文字使用放大字号，其余使用普通字号。</p>
    <Slider label="普通字号" min={8} max={400} step={1} unit="px" defaultValue={canvas?.width > canvas?.height ? 120 : 94} value={fontSize} onChange={setSize}/>
    <Slider label="放大倍数" min={1} max={3} step={.05} unit="×" defaultValue={1.6} value={ratio} onChange={(v:number)=>onPatchSlots({emphasisRatio:v})}/>
    <p className="hint">放大字号 {Math.round(fontSize*ratio)} px。长句会按画面等比缩小；整体大小仍可在「画面」调整。</p>
    {(['enter','exit'] as const).map(direction=>{
      const entering = direction==='enter';
      const fxKey = entering?'enterFx':'exitFx', secondsKey = entering?'enterSeconds':'exitSeconds';
      const label = entering?'出场':'退场';
      const fx = slots[fxKey] ?? 'legacy';
      return <div className="recede-motion-control" key={direction}>
        <label>{label}方式<select aria-label={`${label}方式`} value={fx} onChange={e=>onPatchSlots({[fxKey]:e.target.value})}>
          {fx==='legacy' && <option value="legacy">{entering?'沿用旧版：上浮淡入':'沿用旧版：整镜淡出'}</option>}
          {effects.map(effect=><option value={effect.value} key={effect.value}>{effect.value==='fade'?(entering?'淡入':'淡出'):effect.label}</option>)}
        </select></label>
        {fx!=='none' && fx!=='legacy' && <Slider label={`${label}时长`} min={.05} max={2} step={.05} unit="s" defaultValue={entering ? .5 : .35} value={slots[secondsKey]??(entering?.5:.35)} onChange={(v:number)=>onPatchSlots({[secondsKey]:v})}/>}
      </div>;
    })}
  </div>;
}
