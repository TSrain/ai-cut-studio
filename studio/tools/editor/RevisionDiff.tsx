import React,{useMemo,useState} from 'react';
import {revisionDiff,reviewableRevisions,formatDurationDelta} from './revision-diff.mjs';
import './review-ux.css';

const storageKey=(documentId:string)=>`motion-revision-accepted/${documentId}`;
function loadAccepted(documentId:string):string[]{try{const v=JSON.parse(localStorage.getItem(storageKey(documentId))??'[]');return Array.isArray(v)?v.filter(x=>typeof x==='string'):[];}catch{return [];}}
function saveAccepted(documentId:string,ids:string[]){try{localStorage.setItem(storageKey(documentId),JSON.stringify(ids.slice(-200)));}catch{}}
const stateText:Record<string,string>={applied:'',reverted:'已撤回（可撤销）',diverged:'修改后又被编辑过',mixed:'部分已撤回',missing:'目标已不存在'};

/** Compact before/after for each applied AI revision of this shot, with accept / revert. */
export function RevisionDiffCards({job,document:doc,onRevert}:{job:any;document:any;onRevert?:(result:any)=>void}){
 const [accepted,setAccepted]=useState<string[]>(()=>loadAccepted(doc.id)),[error,setError]=useState('');
 const diffs=useMemo(()=>reviewableRevisions(job).map((result:any)=>({result,diff:revisionDiff(result,doc)})).filter(({result,diff}:any)=>diff.rows.length&&!accepted.includes(result.id)),[job,doc,accepted]);
 if(!diffs.length)return null;
 const accept=(id:string)=>{const next=[...accepted,id];setAccepted(next);saveAccepted(doc.id,next);setError('');};
 return <div className="revision-diffs">{diffs.map(({result,diff}:any)=><section key={result.id} className="revision-diff" aria-label="AI 修改前后对比">
  <header><strong>AI 修改对比</strong>{formatDurationDelta(diff.durationDelta)&&<span className="revision-diff-delta" title="镜头时长变化">时长 {formatDurationDelta(diff.durationDelta)}</span>}{stateText[diff.state]&&<span className="revision-diff-state">{stateText[diff.state]}</span>}</header>
  {diff.reason&&<p className="revision-diff-reason">{diff.reason}</p>}
  {diff.rows.map((row:any)=><div key={row.key} className="revision-diff-row"><span className="revision-diff-label">{row.label}</span>
   {row.kind==='text'?<span className="revision-diff-text">{row.segments.map((seg:any,i:number)=>seg.op==='delete'?<del key={i}>{seg.text}</del>:seg.op==='insert'?<ins key={i}>{seg.text}</ins>:<span key={i}>{seg.text}</span>)}</span>
   :<span className="revision-diff-value"><del>{row.before}</del> → <ins>{row.after}</ins>{formatDurationDelta(row.durationDelta)&&<small> （{formatDurationDelta(row.durationDelta)}）</small>}</span>}
  </div>)}
  <div className="revision-diff-actions">
   <button type="button" onClick={()=>accept(result.id)}>{diff.state==='reverted'?'收起':'接受'}</button>
   {onRevert&&diff.state!=='reverted'&&<button type="button" disabled={diff.state!=='applied'} title={diff.state==='applied'?'恢复这段修改前的内容，可用 ⌘Z 撤销':'内容已在修改后变化，不能自动撤回'} onClick={()=>{try{onRevert(result);setError('');}catch(e:any){setError(e?.message||String(e));}}}>撤回这段修改</button>}
  </div>
 </section>)}{error&&<p className="error" role="alert">{error}</p>}</div>;
}
