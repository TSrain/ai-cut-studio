import React,{useEffect,useRef} from 'react';
import {REVIEW_SHORTCUTS} from './review-hotkeys.mjs';
import './review-ux.css';

/** "?" overlay. Lists only real bindings; review keys are active while the rough-cut panel is open. */
export function ShortcutHelp({onClose,review}:{onClose:()=>void;review:boolean}){
 const close=useRef<HTMLButtonElement>(null);
 useEffect(()=>{close.current?.focus({preventScroll:true});},[]);
 const groups=[...new Set(REVIEW_SHORTCUTS.map(s=>s.group))];
 return <div className="shortcut-help-backdrop" onPointerDown={e=>{if(e.target===e.currentTarget)onClose();}}>
  <div className="shortcut-help" role="dialog" aria-modal="true" aria-label="键盘快捷键">
   <header><h2>键盘快捷键</h2><button ref={close} type="button" onClick={onClose} aria-label="关闭快捷键说明">关闭</button></header>
   <div className="shortcut-help-groups">{groups.map(group=><section key={group}><h3>{group}{group==='粗剪审阅'&&<small>{review?'当前可用':'打开「口播粗剪」面板后可用'}</small>}</h3>
    <dl>{REVIEW_SHORTCUTS.filter(s=>s.group===group).map(s=><div key={s.keys.join('+')+s.label}><dt>{s.keys.map((k,i)=><React.Fragment key={k}>{i>0&&<span className="shortcut-plus">{s.keys.length===2&&s.group==='播放'?'+':' / '}</span>}<kbd>{k}</kbd></React.Fragment>)}</dt><dd>{s.label}</dd></div>)}</dl>
   </section>)}</div>
   <p className="shortcut-help-note">输入框、文本框中不会触发这些快捷键。按 ? 或 Esc 关闭。</p>
  </div>
 </div>;
}
export function TransportRateBadge({rate,playing}:{rate:number;playing:boolean}){
 if(!playing||rate===1)return null;
 return <div className="transport-rate" role="status" aria-live="polite">{rate<0?'◀◀':'▶▶'} {Math.abs(rate)}×</div>;
}
