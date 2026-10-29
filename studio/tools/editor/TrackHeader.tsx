import React,{useRef} from 'react';
import {Icon} from './Icon';
export function TrackHeader({name,locked=false,disabled=false,onMenu,children,subtitle,renaming=false,onRename}:{name:string;locked?:boolean;disabled?:boolean;onMenu:(e:React.MouseEvent)=>void;children?:React.ReactNode;subtitle?:string;renaming?:boolean;onRename?:(name:string|null)=>void}){
 return <div className={'track-label'+(disabled?' is-disabled':'')} onPointerDown={e=>e.stopPropagation()}>
  {children}{renaming?<TrackNameInput name={name} onDone={onRename!}/>:<span className="track-title">{name}{subtitle&&<small>{subtitle}</small>}</span>}
  {locked&&<span className="track-lock-badge" title="已锁定" aria-label="已锁定"><Icon name="lock" size={12}/></span>}
  <button className="track-options" aria-label={`轨道选项 ${name}`} title={`${name} · 更多`} onClick={onMenu}><Icon name="more" size={16}/></button>
 </div>;
}

function TrackNameInput({name,onDone}:{name:string;onDone:(value:string|null)=>void}){
 const finished=useRef(false);
 const finish=(value:string|null)=>{if(finished.current)return;finished.current=true;onDone(value);};
 return <input className="track-name-input" aria-label="轨道名称" defaultValue={name} autoFocus onFocus={e=>e.currentTarget.select()} onBlur={e=>finish(e.currentTarget.value)} onKeyDown={e=>{e.stopPropagation();if(e.key==='Enter'){e.preventDefault();finish(e.currentTarget.value);}if(e.key==='Escape'){e.preventDefault();finish(null);}}}/>;
}
