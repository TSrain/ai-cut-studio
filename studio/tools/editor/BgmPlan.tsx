import React from 'react';
import {bgmDetail,getBgmRows,safeMusicUrl} from '../lib/bgm-plan-model.mjs';
import './bgm-plan.css';

function MusicRecommendations({rows=[],gaps=[]}:any){
 return <section className="bgm-recommendations" aria-label="推荐配乐曲目"><h4>推荐曲目</h4>
  {rows.filter((r:any)=>safeMusicUrl(r.url)).map((r:any)=><article className="bgm-music-card" key={r.id}>
   <a href={safeMusicUrl(r.url)!} target="_blank" rel="noopener noreferrer">{r.title} <span aria-hidden="true">↗</span></a><small>{r.artist}</small><p>{r.reason}</p>
   <div className="bgm-evidence"><span>{r.audition==='listened'?'已试听':'未试听'}</span>{r.licenseStatus==='verified'&&safeMusicUrl(r.licenseUrl)?<a href={safeMusicUrl(r.licenseUrl)!} target="_blank" rel="noopener noreferrer">查看许可条件</a>:<span>使用许可待核实</span>}</div>
  </article>)}
  {!rows.length&&<p className="plan-note">暂无已核实来源的曲目推荐。</p>}
  {gaps.map((gap:string,index:number)=><small className="plan-note" key={index}>{gap}</small>)}
 </section>;
}

export function BgmPlanDetails({document:doc,shot}:any){
 const b=bgmDetail(doc,shot);if(!b)return null;
 const linked=(doc.styleReference?.allowedOverrides?.bgmApplication?.clips??[]).filter((c:any)=>c.shotIds?.includes(shot.id)).map((c:any)=>(doc.audioClips??[]).find((a:any)=>a.id===c.clipId)).filter(Boolean);
 const active=linked.some((c:any)=>!c.muted&&!doc.audioTracks?.some((t:any)=>t.id===c.trackId&&t.disabled));
 if(b.status==='stale')return <section className="bgm-plan-details" aria-label="当前段 BGM 计划"><h4>BGM 计划待更新</h4><p>这段内容已变化，请在下次 package 中重新规划。</p></section>;
 if(b.status==='silence')return <section className="bgm-plan-details" aria-label="当前段 BGM 留白"><h4>这段不铺 BGM</h4><p>{b.reason}</p></section>;
 return <section className="bgm-plan-details" aria-label="当前段 BGM 计划"><div className="bgm-heading"><h4>{b.musicType}</h4><span>{linked.length?(active?'已入轨 · 待听审':'已入轨 · 已静音'):'BGM 计划'}</span></div>
  {!!linked.length&&<small className="plan-note">已关联 {linked.length} 个音乐片段；点击下方 BGM 音轨可调整选段、音量和淡化。</small>}
  <p>{b.reason}</p><dl><dt>音色与节奏</dt><dd>{b.texture}</dd><dt>衔接与收束</dt><dd>{b.transition}</dd></dl>
  {!['aligned','manual'].includes(shot.timing?.status)&&<p className="plan-note">尚无可靠时间定位，轨道暂不显示。</p>}
  <MusicRecommendations rows={b.recommendations} gaps={b.gaps}/>
 </section>;
}

export function BgmPlanOverview({document:doc,onSelect}:any){
 const p=doc.productionPlan;if(p?.bgmPlanVersion!==1)return null;
 const shots=p.shots.filter((s:any)=>!s.cancelled&&s.bgmDesign),music=shots.filter((s:any)=>bgmDetail(doc,s)?.status==='music'),silence=shots.filter((s:any)=>bgmDetail(doc,s)?.status==='silence'),stale=shots.length-music.length-silence.length;
 return <section className="bgm-overview" aria-label="BGM 计划总览"><h3>BGM 计划</h3><p>{music.length} 段配乐 · {silence.length} 段留白{stale?` · ${stale} 段待更新`:''}</p>
  {p.bgmExecution&&<p className="plan-note">{({applied:'配乐已应用，可在音乐轨道编辑；待听审。',partial:'配乐部分完成，仍有缺口；待听审。',protected:'已保护现有配乐，本轮没有覆盖。'} as any)[p.bgmExecution.status]}</p>}
  {(p.bgmExecution?.gaps??[]).map((gap:string,index:number)=><small className="plan-note" key={'execution-'+index}>{gap}</small>)}
  <div className="bgm-section-list">{music.map((s:any)=><button key={s.id} onClick={()=>onSelect(s.id)}><strong>{s.title}</strong><small>{s.bgmDesign.musicType}</small></button>)}</div>
  {!!silence.length&&<details><summary>查看留白理由</summary>{silence.map((s:any)=><p key={s.id}><strong>{s.title}：</strong>{s.bgmDesign.reason}</p>)}</details>}
  {!!stale&&<details><summary>待更新的配乐计划</summary>{shots.filter((s:any)=>bgmDetail(doc,s)?.status==='stale').map((s:any)=><button key={s.id} onClick={()=>onSelect(s.id)}>{s.title}</button>)}</details>}
  <MusicRecommendations rows={p.bgmRecommendations??[]} gaps={p.bgmRecommendationGaps??[]}/>
 </section>;
}

export function BgmPlanTrack({document:doc,px,labelWidth,selectedShot,onSelect}:any){
 if(doc.productionPlan?.bgmPlanVersion!==1)return null;
 const rows=getBgmRows(doc),fps=doc.canvas.fps.num/doc.canvas.fps.den;
 return <div className="track bgm-plan-track" data-track-id="__bgm-plan" aria-label="BGM 计划轨道" onPointerDown={e=>e.stopPropagation()} onContextMenu={e=>{e.preventDefault();e.stopPropagation();}}>
  <div className="track-label"><span className="track-title">BGM 计划<small>配乐区间建议</small></span></div>
  {rows.map(row=><button key={row.id} className={'bgm-plan-block'+(selectedShot===row.shotId?' selected':'')} style={{left:labelWidth+row.startFrame*px,width:Math.max(1,row.durationFrames*px)}} aria-label={`BGM：${row.title}，${row.musicType}`} title={`${row.title} · ${row.musicType} · ${(row.startFrame/fps).toFixed(1)}–${((row.startFrame+row.durationFrames)/fps).toFixed(1)} 秒`} onClick={e=>{e.stopPropagation();onSelect(row.shotId,row.startFrame);}}>{row.musicType}</button>)}
  {!rows.length&&<span className="bgm-track-empty" style={{left:labelWidth+12}}>当前没有可定位的配乐区间</span>}
 </div>;
}
