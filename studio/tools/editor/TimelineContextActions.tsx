import React,{useState} from 'react';
import {adjacentEdit} from './p1-model.mjs';
export function TimelineContextActions({doc,frame,picked,onSeek,onCommand,onChange,onPlaySelection,looping,onClose}:any){
 const [markerName,setMarkerName]=useState(''),[fields,setFields]=useState(['text','background']);
 const markers=doc.markers??[],editable=picked.filter(i=>!i.locked),templates=editable.filter(i=>i.kind==='instance');
 const run=(fn:()=>void)=>{onClose();fn();};
 return <>
 {editable.length>=2&&<button onClick={()=>run(()=>onCommand('group'))}>编组<kbd>⌘G</kbd></button>}
 {editable.some(i=>i.groupId)&&<button onClick={()=>run(()=>onCommand('ungroup'))}>取消编组<kbd>⇧⌘G</kbd></button>}
 {!!picked.length&&<><hr/><button onClick={()=>run(()=>onPlaySelection(false))}>播放选区</button><button onClick={()=>run(()=>onPlaySelection(!looping))}>{looping?'停止循环':'循环选区'}</button></>}
 {!!templates.length&&<><hr/><button onClick={()=>run(()=>onCommand('disable'))}>启用 / 禁用选中模板</button>{picked.length===1&&<button onClick={()=>run(()=>onCommand('copyProperties'))}>复制模板属性</button>}<details className="context-details"><summary>粘贴属性…</summary><div className="context-fields">{[['text','文本样式'],['position','整体位置'],['background','背景配色']].map(([id,label])=><label key={id}><input type="checkbox" checked={fields.includes(id)} onChange={e=>setFields(e.target.checked?[...fields,id]:fields.filter(x=>x!==id))}/>{label}</label>)}<button disabled={!fields.length} onClick={()=>run(()=>onCommand('pasteProperties',fields))}>应用到同类模板</button></div></details></>}
 <hr/>
 <details className="context-details"><summary>标记 · {markers.length}</summary><div className="context-fields"><label>标记名称<input aria-label="标记名称" value={markerName} onChange={e=>setMarkerName(e.target.value)}/></label><button onClick={()=>run(()=>onChange({...doc,markers:[...markers,{id:crypto.randomUUID(),name:markerName.trim()||`标记 ${markers.length+1}`,frame}].sort((a,b)=>a.frame-b.frame)}))}>在播放头添加标记</button>{markers.map(m=><div className="context-marker-row" key={m.id}><button onClick={()=>run(()=>onSeek(m.frame))}>{m.name} · {(m.frame/(doc.canvas.fps.num/doc.canvas.fps.den)).toFixed(2)}s</button><button aria-label={`删除标记 ${m.name}`} onClick={()=>run(()=>onChange({...doc,markers:markers.filter(x=>x.id!==m.id)}))}>×</button></div>)}</div></details>
 <details className="context-details"><summary>跳转剪辑点</summary><button onClick={()=>run(()=>onSeek(adjacentEdit(doc,frame,-1)))}>上一剪辑点<kbd>↑</kbd></button><button onClick={()=>run(()=>onSeek(adjacentEdit(doc,frame,1)))}>下一剪辑点<kbd>↓</kbd></button></details>
 </>;
}
