import React,{useState} from 'react';
import {groupProjects,type ProjectSummary} from './project-list.mjs';
import './project-list.css';
export function ProjectList({documents,currentId,busy,onOpen}:{documents:ProjectSummary[];currentId:string;busy:boolean;onOpen:(project:ProjectSummary)=>void}) {
  const [query,setQuery]=useState('');
  const groups=groupProjects(documents,query);
  return <div className="project-list">
    <input type="search" aria-label="搜索项目" placeholder="搜索项目名称" value={query} onChange={e=>setQuery(e.target.value)}/>
    <p className="project-list-hint">最近编辑优先 · 按最后保存日期分组</p>
    {groups.map(group=><section key={group.key} aria-label={group.label}>
      <h3>{group.label}<span>{group.projects.length} 个项目</span></h3>
      {group.projects.map(project=>{
        const date=new Date(project.updatedAt||''),valid=Number.isFinite(date.getTime());
        return <button key={project.id} className="project-list-item" disabled={busy} onClick={()=>onOpen(project)}>
          <span className="project-list-name">{project.name}{project.id===currentId&&<small>当前项目</small>}</span>
          <span className="project-list-meta"><time dateTime={valid?project.updatedAt:undefined} title={valid?date.toLocaleString('zh-CN'):undefined}>{valid?`${date.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false})} 编辑`:'编辑时间未知'}</time><span>第 {project.revision} 版</span></span>
        </button>;
      })}
    </section>)}
    {!groups.length&&<p>{documents.length?'没有匹配的项目':'还没有保存过的项目'}</p>}
  </div>;
}
