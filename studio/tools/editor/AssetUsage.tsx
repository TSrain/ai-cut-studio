import React from 'react';
import type {StudioItem} from './StudioLibrary';
import './panel-resize.css';
type Usage={key:string;frame:number;name:string};
/** Exact full path/public path matches only: identical basenames are different media. */
export function assetUsages(document:any,item:StudioItem):Usage[]{
 const normalize=(value:string)=>value.replace(/\\/g,'/').replace(/^\.\//,'');
 const refs=new Set([item.path,item.publicPath,item.stagedPath].filter(Boolean).map(x=>normalize(x!)));
 const contains=(value:any):boolean=>typeof value==='string'?refs.has(normalize(value)):Array.isArray(value)?value.some(contains):!!value&&typeof value==='object'?Object.values(value).some(contains):false;
 const rows:Usage[]=[];
 if(document.source&&[document.source.path,document.source.publicPath].some(contains)){
  const clips=document.source.clips??[{id:'source-main',startFrame:0}];for(const c of clips)rows.push({key:`source/${c.id}`,frame:c.startFrame,name:c.name??'主视频'});
 }
 for(const c of document.instances??[])if(contains(c.props)||contains(c.assetReferences))rows.push({key:c.id,frame:c.startFrame,name:c.name??c.assetId??'画面素材'});
 for(const c of document.audioClips??[])if([c.path,c.publicPath,c.originalPath].some(contains))rows.push({key:`audio/${c.id}`,frame:c.startFrame,name:c.name??'音频'});
 return rows.sort((a,b)=>a.frame-b.frame||a.key.localeCompare(b.key));
}
export function AssetUsage({document,item,onLocate}:{document:any;item:StudioItem;onLocate:(key:string,frame:number)=>void}){
 const rows=assetUsages(document,item),fps=document.canvas.fps.num/document.canvas.fps.den;
 const time=(frame:number)=>{const seconds=Math.floor(frame/fps);return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')} · ${frame} 帧`;};
 return <section className="asset-usage" aria-label="素材使用位置"><h4>当前项目 · {rows.length} 处使用</h4>{rows.length?<ul>{rows.map(row=><li key={row.key}><button type="button" onClick={()=>onLocate(row.key,row.frame)} title={`${row.name} · ${time(row.frame)}`}><span>{row.name}</span><time>{time(row.frame)}</time></button></li>)}</ul>:<p>当前项目尚未使用此素材</p>}</section>;
}
