import React,{useEffect,useState} from 'react';

export type CoverGroup={id:string;title:string;hook:string;images:Record<string,string>};
export type CoverRun={id:string;name:string;updatedAt:number;status:string;groups:CoverGroup[]};
export type CoverListing={source:string;episode:string|null;runs:CoverRun[];job?:{id:string;status:string;stage:string;error?:string}};
export async function coverApi(path:string,body?:any){
 const response=await fetch('/api/editor/'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 const value=await response.json();if(!response.ok)throw new Error(value.error||'无法读取封面');return value;
}

export function CoverPanel({documentId,listing,onRefresh,defaultRatio,selectedCover,onSelect}:{documentId:string;listing:CoverListing|null;onRefresh:()=>Promise<void>;defaultRatio:string;selectedCover?:any;onSelect:(cover:any)=>Promise<void>}){
 const [runId,setRunId]=useState(selectedCover?.runId||''),[groupId,setGroupId]=useState(selectedCover?.groupId||''),[ratio,setRatio]=useState(defaultRatio);
 const [source,setSource]=useState(listing?.source||''),[editingSource,setEditingSource]=useState(false);
 const [pending,setPending]=useState(false),[error,setError]=useState('');
 const running=listing?.job?.status==='running';
 useEffect(()=>setRatio(defaultRatio),[defaultRatio]);
 useEffect(()=>{if(!editingSource)setSource(listing?.source||'');},[listing?.source,editingSource]);
 const run=listing?.runs.find(x=>x.id===runId)||listing?.runs[0];
 const group=run?.groups.find(x=>x.id===groupId)||run?.groups[0];
 const availableRatios=Object.keys(group?.images||{});
 const effectiveRatio=group?.images[ratio]?ratio:group?.images[defaultRatio]?defaultRatio:availableRatios[0];
 async function perform(action:()=>Promise<void>){setPending(true);setError('');try{await action();}catch(e){setError(e.message);}finally{setPending(false);}}
 return <div className="cover-panel">
  <div className="cover-toolbar"><div><strong>{run?`${run.groups.length} 组封面候选`:'制作封面'}</strong><p>{run?'选定一张作为视频首帧，原封面文件完整保留。':'使用原有封面流程，完成后在这里查看候选。'}</p></div><button className="primary" disabled={pending||running||editingSource||!source} onClick={()=>perform(async()=>{await coverApi('covers/start',{documentId});await onRefresh();})}>{running?'正在制作…':run?'重新生成封面':'生成封面'}</button><button disabled={pending} onClick={()=>perform(onRefresh)}>刷新封面</button></div>
  <div className="cover-source"><span>内容来源</span>{editingSource?<><input aria-label="封面原稿路径或 SC 编号" placeholder="SC-0032 或原稿完整路径" value={source} onChange={e=>setSource(e.target.value)}/><button disabled={pending||!source.trim()} onClick={()=>perform(async()=>{await coverApi('covers/source',{documentId,source});await onRefresh();setEditingSource(false);})}>保存</button><button onClick={()=>setEditingSource(false)}>取消</button></>:<><span className="cover-source-value" title={source}>{source.split('/').pop()||'尚未关联原稿'}</span><button disabled={running} onClick={()=>setEditingSource(true)}>{source?'更改':'关联原稿'}</button></>}</div>
  {listing?.job&&<div className="cover-job" role="status">{running?`${listing.job.stage} · 可关闭窗口，后台继续制作`:listing.job.status==='failed'?listing.job.error:'制作完成 · 候选待选择'}</div>}
  {selectedCover&&<div className="cover-selected"><span>视频首帧：{selectedCover.title} · {selectedCover.ratio}</span><button disabled={pending} onClick={()=>perform(()=>onSelect(null))}>移除首帧封面</button></div>}
  {error&&<p className="cover-error" role="alert">{error}</p>}
  {run&&group?<>
   {listing.runs.length>1&&<label className="cover-version">制作记录<select value={run.id} onChange={e=>{setRunId(e.target.value);setGroupId('');}}>{listing.runs.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
   <div className="cover-viewer"><div className="cover-stage"><img src={group.images[effectiveRatio]} alt={`候选 ${group.id} · ${group.title} · ${effectiveRatio}`}/></div><aside className="cover-candidates" aria-label="封面候选">{run.groups.map(item=><button key={item.id} className={item.id===group.id?'active':''} aria-pressed={item.id===group.id} onClick={()=>setGroupId(item.id)}><img src={item.images[defaultRatio]||Object.values(item.images)[0]} alt=""/><span><b>候选 {item.id}</b><span>{item.title}</span></span></button>)}</aside></div>
   <div className="cover-footer"><div><strong>{group.title}</strong><p>{group.hook||'待选择的封面候选'}</p></div><div className="cover-ratios" aria-label="封面比例">{availableRatios.map(value=><button key={value} aria-pressed={effectiveRatio===value} onClick={()=>setRatio(value)}>{value}</button>)}</div><button disabled={pending} onClick={()=>perform(async()=>{await coverApi('covers/reveal',{documentId,runId:run.id,groupId:group.id,ratio:effectiveRatio});})}>在 Finder 中显示原图</button><button className="primary" disabled={pending||(selectedCover?.runId===run.id&&selectedCover?.groupId===group.id&&selectedCover?.ratio===effectiveRatio)} onClick={()=>perform(async()=>{const result=await coverApi('covers/select',{documentId,runId:run.id,groupId:group.id,ratio:effectiveRatio});await onSelect(result.cover);})}>{selectedCover?.runId===run.id&&selectedCover?.groupId===group.id&&selectedCover?.ratio===effectiveRatio?'已设为首帧':'设为视频首帧'}</button></div>
  </>:<div className="cover-empty"><span>暂无封面</span><p>关联原稿后，按原流程制作。通过检查的候选会自动出现在这里。</p></div>}
 </div>;
}
