import React, {useEffect, useRef, useState} from 'react';
import {Icon} from './Icon';

type Props = {busy:boolean; onNew:()=>void; onOpen:()=>void; onDuplicate:()=>void; onSettings:()=>void};
export function ProjectMenu({busy,onNew,onOpen,onDuplicate,onSettings}:Props) {
  const [open,setOpen]=useState(false);
  const root=useRef<HTMLDivElement>(null), trigger=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    if(!open)return;
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};
    document.addEventListener('pointerdown',outside);
    return()=>document.removeEventListener('pointerdown',outside);
  },[open]);
  const close=()=>{setOpen(false);trigger.current?.focus();};
  const items=[['plus','新建项目',onNew],['folder','项目列表',onOpen],['copy','创建副本',onDuplicate],['sliders','设置',onSettings]] as const;
  return <div className="project-menu" ref={root} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setOpen(false);}} onKeyDown={e=>{
    if(e.key==='Escape'&&open){e.preventDefault();e.stopPropagation();close();}
  }}>
    <button ref={trigger} className="studio-brand project-menu-trigger" aria-label="Motion Studio 项目菜单" aria-haspopup="menu" aria-expanded={open} aria-controls="studio-project-menu" onClick={()=>setOpen(v=>!v)} onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setOpen(true);}}}>
      <span className="studio-mark"><Icon name="layers" size={19}/></span><strong>Motion Studio</strong><Icon name="chevron" size={14}/>
    </button>
    {open&&<div id="studio-project-menu" role="menu" aria-label="项目" className="project-menu-popover" onKeyDown={e=>{
      if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;
      e.preventDefault();e.stopPropagation();
      const buttons=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
      const index=buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;
      buttons[next]?.focus();
    }}>
      {items.map(([icon,label,action])=><button key={label} role="menuitem" disabled={busy} onClick={()=>{close();action();}}><Icon name={icon}/><span>{label}</span></button>)}
    </div>}
  </div>;
}
