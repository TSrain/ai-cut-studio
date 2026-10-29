import {audioVolumeAt} from '../../templates/remotion-base/src/editor/audio.mjs';
import {ProjectMediaUpload} from './ProjectMediaUpload';
import {ProductionPlanTrack} from './ProductionPlanTrack';
import {BgmPlanTrack} from './BgmPlan';
import {TrackHeader} from './TrackHeader';
import {organizeTracks} from './track-organization.mjs';
import {moveToNewTrack,trackInsertionAt} from './track-insertion.mjs';
import {AdaptiveTimelineRuler} from './AdaptiveTimelineRuler';
import {clampTimelineHeight,clipDensity,timelineSelection} from './timeline-view.mjs';
import {cameraEditReason} from './caption-camera-model.mjs';
import {TimelineContextActions} from './TimelineContextActions';
import {selectionForClick,reorderTrack} from './p1-model.mjs';
import {CaptionTrack} from './CaptionTrack';
import React,{useEffect,useLayoutEffect,useRef,useState,useMemo} from 'react';
import {CameraTrack} from './CameraTrack';
import {TimelinePlayhead} from './Playback';
import {TimelineHover} from './TimelineHover';
import {timelineSnapPoints} from './timeline-snap.mjs';
import {sourceTrimSnap,snapHintText,composeDragHint} from './roughcut-snap.mjs';
import {jsonEqual} from './production-plan-sync.mjs';
import {Icon,IconButton} from './Icon';
import {Tooltip} from './Tooltip';
import {frameAtClient} from './interaction.mjs';
import {timelineItems,linkedMoveKeys,moveSelection,trimClip,marqueeIds,selectionBounds,zoomAtPointer} from './timeline-model.mjs';
import {SourceStrip} from './SourceStrip';
const LABEL=132;
export function Timeline({planJobs,planResources,planSelected,onPlanSelect,onPlanAction,onPlanDrop,hoverPreview,hoverBlocked=false,onHoverPlay,showSourceWaveform=false,canUndo,canRedo,onUndo,onRedo,document:doc,getDocument,clock,selected,selection=[],zoom,setZoom,snap,setSnap,onSeek,onSelection,onPreview,onCommit,onCommand,nameOf,cameraSelected,cameraOccurrence,onCameraSelect,onCameraPreview,onExportClip,exportBusy,onChange,onDropTemplate,onDropMedia,onImportedMedia,onMediaImportStart,captionSelected,captionSelection=[],onCaptionSelect,follow,setFollow,looping,onPlaySelection,playing,coverThumbnail,onPreviewCover}:any){
 const scroll=useRef<HTMLDivElement>(null),section=useRef<HTMLElement>(null),gesture=useRef<null|(()=>void)>(null),zoomRef=useRef<any>();
 const importFrame=useRef(0);
 const pendingZoomScroll=useRef<number|null>(null);
 const [viewport,setViewport]=useState(1000),[height,setHeight]=useState(()=>{try{return clampTimelineHeight(Number(localStorage.getItem('editor-timeline-height'))||320,innerHeight);}catch{return 320;}}),[dragging,setDragging]=useState(false),[marquee,setMarquee]=useState<any>(null),[hint,setHint]=useState(''),[snapFrame,setSnapFrame]=useState<number|null>(null),[menu,setMenu]=useState<any>(null),[drop,setDrop]=useState<any>(null);
 const [previousView,setPreviousView]=useState<any>(null),[expandedTracks,setExpandedTracks]=useState<string[]>([]),[compact,setCompact]=useState(()=>localStorage.getItem('editor-timeline-compact')==='true');
 const [headersCollapsed,setHeadersCollapsed]=useState(false),[insertion,setInsertion]=useState<any>(null);
 // Quantized scroll offset: enough to request viewport-only waveform tiles without re-rendering per pixel.
 const [scrollX,setScrollX]=useState(0);
 const [hoverEnabled,setHoverEnabled]=useState(()=>{try{return localStorage.getItem('editor-timeline-hover')!=='false';}catch{return true;}});
 useEffect(()=>{try{localStorage.setItem('editor-timeline-hover',String(hoverEnabled));}catch{}},[hoverEnabled]);
 const dragTrackOccupancy=useRef<Set<string>|null>(null);
 const [renaming,setRenaming]=useState<any>(null);
 const finishRename=(name:string|null)=>{const target=renaming;setRenaming(null);if(name===null||!target)return;const key=target.kind==='audio'?'audioTracks':'tracks';const track=doc[key].find(t=>t.id===target.id);if(track&&!track.locked&&name.trim()&&name.trim()!==track.name)onChange({...doc,[key]:doc[key].map(t=>t.id===target.id?{...t,name:name.trim()}:t)});};
 const menuRef=useRef<HTMLDivElement>(null);
 const frame=clock.getSnapshot(),fps=doc.canvas.fps.num/doc.canvas.fps.den;
 const px=Math.max(.001,(viewport-LABEL-30)/doc.canvas.durationFrames)*zoom,width=Math.max(viewport-LABEL,doc.canvas.durationFrames*px+30);
 // Apply the anchor after the wider content is committed; an earlier RAF can
 // run before React's commit and have scrollLeft clamped to the old width.
 useLayoutEffect(()=>{if(pendingZoomScroll.current!==null&&scroll.current){scroll.current.scrollLeft=pendingZoomScroll.current;pendingZoomScroll.current=null;}},[px,width]);
 const hoverSnapPoints=useMemo(()=>timelineSnapPoints(doc),[doc]);
 const items=useMemo(()=>timelineItems(doc),[doc]),picked=items.filter(i=>selection.includes(i.key));
 useEffect(()=>{const el=scroll.current;if(!el)return;const r=new ResizeObserver(e=>setViewport(e[0].contentRect.width));r.observe(el);return()=>r.disconnect();},[]);
 useEffect(()=>()=>gesture.current?.(),[]);
 useEffect(()=>{if(!hint||dragging)return;const timer=setTimeout(()=>setHint(''),4000);return()=>clearTimeout(timer);},[hint,dragging]);
 useEffect(()=>{try{localStorage.setItem('editor-timeline-height',String(height));}catch{}},[height]);
 useEffect(()=>{const resizeWindow=()=>setHeight(h=>clampTimelineHeight(h,innerHeight));window.addEventListener('resize',resizeWindow);return()=>window.removeEventListener('resize',resizeWindow);},[]);
 useEffect(()=>{try{localStorage.setItem('editor-timeline-compact',String(compact));}catch{}},[compact]);
 useEffect(()=>{if(!follow||!playing)return;const update=()=>{const el=scroll.current;if(!el)return;const x=clock.getSnapshot()*px;if(x<el.scrollLeft||x>el.scrollLeft+viewport-LABEL-50)el.scrollLeft=Math.max(0,x-60);};update();return clock.subscribe(update);},[clock,follow,playing,px,viewport]);
 useLayoutEffect(()=>{const el=menuRef.current;if(!menu||!el)return;const place=()=>{const r=el.getBoundingClientRect();el.style.left=`${Math.max(8,Math.min(menu.x,innerWidth-r.width-8))}px`;el.style.top=`${Math.max(8,Math.min(menu.y,innerHeight-r.height-8))}px`;};place();const observer=new ResizeObserver(place);observer.observe(el);el.querySelector<HTMLElement>('button:not(:disabled),input:not(:disabled)')?.focus({preventScroll:true});const outside=(e:PointerEvent)=>{if(!el.contains(e.target as Node))setMenu(null);};const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();setMenu(null);section.current?.focus({preventScroll:true});}};window.addEventListener('pointerdown',outside,true);window.addEventListener('keydown',escape,true);return()=>{observer.disconnect();window.removeEventListener('pointerdown',outside,true);window.removeEventListener('keydown',escape,true);};},[menu]);
 const openContext=(e:React.MouseEvent,item?:any)=>{e.preventDefault();e.stopPropagation();if(item&&!selection.includes(item.key))onSelection(selectionForClick(doc,selection,item.key,false));setMenu({kind:'clips',x:e.clientX,y:e.clientY});};
 const changeZoom=(value:number,x?:number)=>{const el=scroll.current!;value=Math.max(1,Math.min(256,value));if(value===zoom)return;const rect=el.getBoundingClientRect();const anchor=x??rect.left+LABEL+clock.getSnapshot()*px-el.scrollLeft;pendingZoomScroll.current=zoomAtPointer({scrollLeft:el.scrollLeft,clientX:anchor,rectLeft:rect.left,labelWidth:LABEL,oldPx:px,newPx:px*value/zoom});setZoom(value);};
 zoomRef.current=changeZoom;
 useEffect(()=>{const el=scroll.current!;const wheel=(e:WheelEvent)=>{if(e.ctrlKey||e.metaKey||e.altKey){e.preventDefault();zoomRef.current(zoomRef.current.value*Math.exp(-e.deltaY*.008),e.clientX);}else {setFollow(false);if(e.shiftKey&&Math.abs(e.deltaX)<1){e.preventDefault();el.scrollLeft+=e.deltaY;}}};let scale=1,base=1;const start=(e:any)=>{e.preventDefault();scale=e.scale||1;base=zoomRef.current.value;};const change=(e:any)=>{e.preventDefault();zoomRef.current(base*(e.scale||1)/scale,e.clientX);};el.addEventListener('wheel',wheel,{passive:false});el.addEventListener('gesturestart',start);el.addEventListener('gesturechange',change);return()=>{el.removeEventListener('wheel',wheel);el.removeEventListener('gesturestart',start);el.removeEventListener('gesturechange',change);};},[]);
 zoomRef.current.value=zoom;
 const organize=()=>{const base=getDocument?.()??doc,result=organizeTracks(base);if(result.changed){onCommit(base,result.document);setHint(`已整理：移动 ${result.movedClips} 个片段，减少 ${result.removedTracks} 条轨道`);}else setHint('没有可合并的轨道；时间冲突、叠加顺序冲突和受保护轨道已保留');};
 const focus=()=>{(document.activeElement as HTMLElement)?.blur();section.current?.focus({preventScroll:true});setMenu(null);};
 const localFrame=(x:number)=>{const sc=scroll.current!;const raw=frameAtClient(x,sc.getBoundingClientRect().left,sc.scrollLeft,LABEL,px,doc.canvas.durationFrames);return hoverPreview.resolvePointerSeek(x,raw);};
 const insertionAt=(base:any,y:number,kind:'visual'|'audio')=>{
  const sc=scroll.current!,rect=sc.getBoundingClientRect();if(y<rect.top+29||y>rect.bottom)return null;
  const tracks=kind==='audio'?base.audioTracks:base.tracks;
  const rows=Array.from(sc.querySelectorAll<HTMLElement>('[data-track-id]')).filter(n=>tracks.some(t=>t.id===n.dataset.trackId)).map(n=>{const r=n.getBoundingClientRect();return {top:r.top,bottom:r.bottom,index:tracks.findIndex(t=>t.id===n.dataset.trackId)};});
  const hit=rows.length?trackInsertionAt(rows,y,kind):{index:0,top:rect.top+29-sc.scrollTop};return hit?{...hit,kind,top:hit.top-rect.top+sc.scrollTop}:null;
 };
 const dropAsset=(e:React.DragEvent,frame:number,target?:string|{newTrack:number})=>{const media=e.dataTransfer.getData('application/x-motion-media'),template=e.dataTransfer.getData('application/x-motion-template');if(media)onDropMedia?.(media,frame,target);else if(template)onDropTemplate(template,frame,target);};
 const templateInsertion=(e:React.DragEvent)=>!(e.target as HTMLElement).closest('.production-plan-track')&&(e.dataTransfer.types.includes('application/x-motion-template')||e.dataTransfer.types.includes('application/x-motion-media'))&&e.clientX>scroll.current!.getBoundingClientRect().left+(headersCollapsed?40:LABEL)?insertionAt(doc,e.clientY,'visual'):null;
 const begin=(e:React.PointerEvent,kind:string,item?:any)=>{
  if(e.button!==0)return;e.preventDefault();e.stopPropagation();focus();gesture.current?.();
  if(item?.locked){if(kind==='move')onSeek(localFrame(e.clientX));return;}
  const base=structuredClone(getDocument?.()??doc),sc=scroll.current!,startX=e.clientX,startY=e.clientY,startScroll=sc.scrollLeft,startTop=sc.scrollTop,rect=sc.getBoundingClientRect();
  dragTrackOccupancy.current=new Set(timelineItems(base).map(i=>i.trackId));
  if(item)item=timelineItems(base).find(i=>i.key===item.key)??item;
  let ids=selection,latest=base,changed=false,moved=false,last:any=e,raf=0;
  if(item){ids=e.shiftKey||e.metaKey?selectionForClick(doc,selection,item.key,true):selection.includes(item.key)?selection:selectionForClick(doc,selection,item.key,false);onSelection(ids);if(e.shiftKey||e.metaKey)return;}
  const origin={x:startX-rect.left+startScroll,y:startY-rect.top+startTop};
  const update=(ev:any)=>{
   if(kind==='seek'){onSeek(localFrame(ev.clientX));return;}
   if(!moved&&Math.hypot(ev.clientX-startX,ev.clientY-startY)<4)return;moved=true;setDragging(true);
   if(kind==='marquee'){
    const box={x:origin.x,y:origin.y,width:ev.clientX-rect.left+sc.scrollLeft-origin.x,height:ev.clientY-rect.top+sc.scrollTop-origin.y};setMarquee(box);
    const boxes=Array.from(sc.querySelectorAll<HTMLElement>('[data-clip-key]')).filter(n=>n.dataset.locked!=='true').map(n=>{const r=n.getBoundingClientRect();return{id:n.dataset.clipKey!,x:r.left-rect.left+sc.scrollLeft,y:r.top-rect.top+sc.scrollTop,width:r.width,height:r.height};});
    const hit=marqueeIds(box,boxes);onSelection(e.shiftKey?[...new Set([...selection,...hit])]:hit);return;
   }
   let delta=Math.round((ev.clientX-startX+sc.scrollLeft-startScroll)/px);setSnapFrame(null);
   const rawDelta=delta;let snapHint='';
   if(snap&&!ev.altKey){
    const edges=kind==='left'?[item.startFrame]:kind==='right'?[item.startFrame+item.durationFrames]:items.filter(i=>ids.includes(i.key)).flatMap(i=>[i.startFrame,i.startFrame+i.durationFrames]);
    const movingKeys=kind==='move'?linkedMoveKeys(base,ids):ids;
    const targets=[0,doc.canvas.durationFrames,clock.getSnapshot(),...items.filter(i=>!movingKeys.includes(i.key)).flatMap(i=>[i.startFrame,i.startFrame+i.durationFrames])];
    let nearest=7/px,correction=0,target=null;for(const edge of edges)for(const p of targets){const distance=Math.abs(p-edge-delta);if(distance<nearest){nearest=distance;correction=p-edge-delta;target=p;}}
    delta+=correction;setSnapFrame(target);
    // Rough-cut source trims also snap to word/character and silence boundaries (source time).
    if((kind==='left'||kind==='right')&&item?.kind==='source'&&base.roughcut){
     const edge=kind==='left'?item.sourceInFrame:item.sourceInFrame+item.durationFrames;
     const hit=sourceTrimSnap({roughcut:base.roughcut,edgeSourceFrame:edge,delta:rawDelta,pxPerFrame:px});
     if(hit&&(target===null||Math.abs(hit.delta-rawDelta)<Math.abs(correction))){delta=hit.delta;setSnapFrame((kind==='left'?item.startFrame:item.startFrame+item.durationFrames)+hit.delta);snapHint=snapHintText(hit.point);}
    }
   }
   try{
    let target:string|undefined;setInsertion(null);
    if(kind==='move'&&item.kind!=='source'&&Math.abs(ev.clientY-startY)>12){
     const hit=ev.clientX>rect.left+(sc.scrollLeft>8?40:LABEL)?insertionAt(base,ev.clientY,item.kind==='audio'?'audio':'visual'):null;
     if(hit){latest=moveToNewTrack(base,ids,delta,hit.index);changed=true;onPreview(base);setInsertion({...hit,frame:selectionBounds(latest,ids)?.start??0});setHint('松手新建'+(hit.kind==='audio'?'音频':'叠加')+'轨道');return;}
     const node=document.elementFromPoint(ev.clientX,ev.clientY)?.closest<HTMLElement>('[data-track-id]');if(node?.dataset.trackId&&!node.dataset.trackId.startsWith('__'))target=node.dataset.trackId;
    }
    latest=kind==='move'?moveSelection(base,ids,delta,target):trimClip(base,item.key,kind,delta);
    changed=!jsonEqual(latest,base);onPreview(latest);const bounds=selectionBounds(latest,ids);setHint(composeDragHint(snapHint,bounds?`${ids.length} 个片段 · ${(bounds.start/fps).toFixed(2)}—${(bounds.end/fps).toFixed(2)} 秒 · ${kind==='move'?'移动':item.kind==='source'?'主轨连动裁切':'裁切'} ${delta>=0?'+':''}${delta} 帧`:''));
   }catch(err:any){setInsertion(null);setHint(err.message);latest=base;changed=false;onPreview(base);}
  };
  const move=(ev:PointerEvent)=>{last=ev;update(ev);};
  const auto=()=>{if(moved){const box=sc.getBoundingClientRect();const old=sc.scrollLeft;const y=sc.scrollTop;if(last.clientX>box.right-28)sc.scrollLeft+=12;else if(last.clientX<box.left+(sc.scrollLeft>8?40:LABEL)+14)sc.scrollLeft-=12;if(kind==='marquee'||kind==='move'){if(last.clientY>box.bottom-18)sc.scrollTop+=10;else if(last.clientY<box.top+30)sc.scrollTop-=10;}if(old!==sc.scrollLeft||y!==sc.scrollTop)update(last);}raf=requestAnimationFrame(auto);};
  const cleanup=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',cancel);window.removeEventListener('blur',cancel);window.removeEventListener('keydown',escape);cancelAnimationFrame(raf);setDragging(false);setMarquee(null);setSnapFrame(null);setInsertion(null);gesture.current=null;};
  const end=()=>{cleanup();if(!moved){if(kind==='marquee')onSelection([]);if(kind==='marquee'||kind==='move')onSeek(localFrame(startX));}if(changed){onCommit(base,latest);if(latest.tracks.length>base.tracks.length||(latest.audioTracks?.length??0)>(base.audioTracks?.length??0))setHint('已新建轨道并移动片段');}};
  const cancel=()=>{if(changed)onPreview(base);changed=false;cleanup();setHint('已取消本次拖动');};
  const escape=(ev:KeyboardEvent)=>{if(ev.key==='Escape'){ev.preventDefault();ev.stopImmediatePropagation();cancel();}};
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',end,{once:true});window.addEventListener('pointercancel',cancel,{once:true});window.addEventListener('blur',cancel,{once:true});window.addEventListener('keydown',escape);gesture.current=cancel;if(kind==='seek')update(e);raf=requestAnimationFrame(auto);
 };
 const resize=(e:React.PointerEvent)=>{
  if(e.button!==0)return;e.preventDefault();e.stopPropagation();gesture.current?.();const y=e.clientY,h=height;
  const move=(ev:PointerEvent)=>setHeight(clampTimelineHeight(h+y-ev.clientY,innerHeight));
  const cleanup=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',cancel);window.removeEventListener('blur',cancel);window.removeEventListener('keydown',escape,true);gesture.current=null;};
  const end=()=>cleanup();const cancel=()=>{setHeight(clampTimelineHeight(h,innerHeight));cleanup();};const escape=(ev:KeyboardEvent)=>{if(ev.key==='Escape'){ev.preventDefault();ev.stopImmediatePropagation();cancel();}};
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',end);window.addEventListener('pointercancel',cancel);window.addEventListener('blur',cancel);window.addEventListener('keydown',escape,true);gesture.current=cancel;
 };
 const selectedRange=timelineSelection(doc,{keys:selection,captionId:captionSelected,captionIds:captionSelection,cameraId:cameraSelected,cameraRange:cameraOccurrence});
 const saveView=()=>setPreviousView({zoom,left:scroll.current?.scrollLeft??0});
 const fitRange=(b:any)=>{if(!b)return;saveView();setFollow(false);const value=Math.max(1,Math.min(256,doc.canvas.durationFrames/Math.max(1,b.end-b.start)*.85));setZoom(value);requestAnimationFrame(()=>{scroll.current!.scrollLeft=Math.max(0,b.start*(viewport-LABEL-30)/doc.canvas.durationFrames*value-25);});};
 const fitSelection=()=>fitRange(selectedRange);
 const fitAll=()=>{saveView();setZoom(1);setFollow(false);scroll.current!.scrollLeft=0;};
 const restoreView=()=>{if(!previousView)return;const old=previousView;saveView();setZoom(old.zoom);setFollow(false);requestAnimationFrame(()=>{scroll.current!.scrollLeft=old.left;});};
 const toggleTrack=(id:string)=>setExpandedTracks(ids=>ids.includes(id)?ids.filter(x=>x!==id):[...ids,id]);

 const sideMenu=(e:React.MouseEvent,kind:string,item:any)=>{e.preventDefault();e.stopPropagation();if(kind==='caption')onCaptionSelect(item.id,{preserve:true});else onCameraSelect(item.id,{startFrame:item.displayStart,endFrame:item.displayEnd});setMenu({kind,item,x:e.clientX,y:e.clientY});};

 const label=(i:any)=>i.name||i.props?.mediaName||i.props?.slots?.title||i.props?.slots?.label||i.props?.label||(i.kind==='source'?'主视频':i.kind==='audio'?'音频':nameOf(i.assetId));
 const trackMenu=(e:any,t:any,kind='visual')=>{e.stopPropagation();setMenu({track:t,kind,x:Math.min(e.clientX,innerWidth-240),y:Math.max(70,Math.min(e.clientY,innerHeight-300))});};
 const patchTrack=(patch:any)=>{if(!menu)return;const key=menu.kind==='audio'?'audioTracks':'tracks';onChange({...doc,[key]:doc[key].map(t=>t.id===menu.track.id?{...t,...patch}:t)});setMenu(null);};
 const hasSelected=selection.length>0||!!cameraSelected||!!captionSelected;
 // Visible part of a source clip in source seconds (plus one screen of margin), for waveform tiles.
 const sourceWindow=(i:any)=>{const margin=viewport/px,first=Math.max(i.startFrame,(scrollX/px)-margin),last=Math.min(i.startFrame+i.durationFrames,(scrollX+viewport)/px+margin);return last>first?{start:(i.sourceInFrame+first-i.startFrame)/fps,end:(i.sourceInFrame+last-i.startFrame)/fps}:null;};
 const clip=(i:any)=><div key={i.key} role="button" tabIndex={0} aria-label={`${label(i)}，${(i.startFrame/fps).toFixed(2)} 至 ${((i.startFrame+i.durationFrames)/fps).toFixed(2)} 秒`} aria-pressed={selection.includes(i.key)} data-clip-key={i.key} data-locked={i.locked} data-density={clipDensity(i.durationFrames*px)} className={`clip ${i.kind==='source'?'source-clip':i.kind==='audio'?'audio-clip':''} ${i.disabled?'disabled-clip':''} ${selection.includes(i.key)?'selected':''} ${i.locked?'locked':''}`} style={{left:LABEL+i.startFrame*px,width:Math.max(1,i.durationFrames*px)}} onPointerDown={e=>begin(e,'move',i)} onKeyDown={e=>{if(e.key==='Enter'){onSelection([i.key]);onSeek(i.startFrame);} }} onDoubleClick={()=>fitRange({start:i.startFrame,end:i.startFrame+i.durationFrames})} onContextMenu={e=>openContext(e,i)} title={`${label(i)} · ${i.kind==='source'?'源入点 '+(i.sourceInFrame/fps).toFixed(2)+' 秒':i.kind==='audio'?'声音':nameOf(i.assetId)} · ${(i.durationFrames/fps).toFixed(2)} 秒${i.locked?' · 已锁定':''}`}>
  {i.kind==='audio'&&<svg aria-hidden="true" viewBox="0 0 100 32" preserveAspectRatio="none" style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none',opacity:.55}}><polyline fill="none" stroke="currentColor" strokeWidth="1.3" vectorEffect="non-scaling-stroke" points={Array.from({length:65},(_,n)=>`${n/64*100},${29-25*(i.volume?audioVolumeAt(i,i.durationFrames*n/64)/i.volume:0)}`).join(' ')}/></svg>}
  {i.kind==='source'&&<SourceStrip source={doc.source} clip={i} fps={fps} width={i.durationFrames*px} showWaveform={showSourceWaveform} pxPerSecond={px*fps} visible={sourceWindow(i)}/>}
  {!i.locked&&(clipDensity(i.durationFrames*px)!=='compact'||i.kind==='source'&&selection.includes(i.key))&&<div className="handle left" title={i.kind==='source'?'拖拽补回或裁去原片开头，后续轨道跟随':'裁切开始'} role="separator" aria-label={`裁切开始 ${i.key}`} onPointerDown={e=>begin(e,'left',i)}/>}<span className="clip-name">{i.groupId?'▣ ':''}{String(label(i))}</span><small>{(i.durationFrames/fps).toFixed(1)}秒</small>{!i.locked&&(clipDensity(i.durationFrames*px)!=='compact'||i.kind==='source'&&selection.includes(i.key))&&<div className="handle right" title={i.kind==='source'?'拖拽补回或裁去原片结尾，后续轨道跟随':'裁切结束'} role="separator" aria-label={`裁切结束 ${i.key}`} onPointerDown={e=>begin(e,'right',i)}/>}
 </div>;
 return <section ref={section} tabIndex={0} className={'timeline timeline-p0 '+(dragging?'is-dragging ':'')+(headersCollapsed&&!renaming?'headers-collapsed ':'')+(compact?'is-compact':'')} style={{height}} aria-label="编辑时间轴" onKeyDown={e=>{if((e.target as HTMLElement).matches('input'))return;if(e.key==='+'||e.key==='='){e.preventDefault();changeZoom(zoom*1.3);}if(e.key==='-'){e.preventDefault();changeZoom(zoom/1.3);}}} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setMenu(null);}}>
  <div className="timeline-resize" role="separator" tabIndex={0} aria-label="调整时间轴高度" aria-orientation="horizontal" aria-valuemin={180} aria-valuemax={Math.max(180,innerHeight-258)} aria-valuenow={height} onPointerDown={resize} onDoubleClick={()=>setHeight(clampTimelineHeight(320,innerHeight))} onKeyDown={e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();e.stopPropagation();setHeight(h=>clampTimelineHeight(h+(e.key==='ArrowUp'?24:-24),innerHeight));}if(e.key==='Home'){e.preventDefault();e.stopPropagation();setHeight(clampTimelineHeight(320,innerHeight));}}} title="拖动或方向键调整高度 · 双击恢复默认"><span/></div>
  <ProjectMediaUpload key={doc.id} dropTargetRef={section} dropOnly analyzeAfterImport={false} onImported={()=>{}} onImportStart={()=>{importFrame.current=clock.getSnapshot();onMediaImportStart?.();}} onFilesImported={files=>onImportedMedia(files,importFrame.current)}/>
  <div className="timeline-toolbar" onContextMenu={e=>openContext(e)}>
   <IconButton tooltip="撤销上一步编辑（⌘Z）" icon="undo" label="撤销（⌘Z）" disabled={!canUndo} onClick={onUndo}/><IconButton tooltip="恢复刚才撤销的编辑（⇧⌘Z）" icon="redo" label="重做（⇧⌘Z）" disabled={!canRedo} onClick={onRedo}/><div className="tool-divider"/>
   <IconButton tooltip={cameraSelected?"镜头曲线暂不支持切分，请调整完整镜头块":"在播放头位置把选中片段分成两段（⌘B）"} icon="split" label={cameraSelected?"镜头曲线暂不支持切分，请调整完整镜头块":"在播放头分割（⌘B）"} disabled={!hasSelected||!!cameraSelected} onClick={()=>onCommand('split')}/><IconButton tooltip="删除时间轴中选中的片段，不删除原始素材" icon="trash" label="删除选中片段" disabled={!hasSelected} onClick={()=>onCommand('delete')}/>
   <IconButton tooltip="导出选中的单个动画模块或镜头时段" icon="download" label="导出选中模块" disabled={exportBusy||(!selected&&!cameraSelected)||selection.length>1||selected?.startsWith('source/')||selected?.startsWith('audio/')} onClick={()=>onExportClip(cameraSelected?{kind:'camera',id:cameraSelected}:{kind:'instance',id:selected})}/>
   {selectedRange&&<span className="timeline-summary">{selectedRange.kind==='caption'?`已选 ${selectedRange.count} 条字幕`:selectedRange.kind==='camera'?'镜头':`已选 ${selectedRange.count} 项`}</span>}
   <span className="spacer"/><IconButton tooltip="整理轨道：合并同类型且不重叠的片段，保留叠加顺序；支持撤销" icon="organize-tracks" label="整理轨道" disabled={dragging||exportBusy||!!renaming} onClick={organize}/><IconButton tooltip="鼠标划过时间轴预览画面；点击定位，空格从此处播放，移出恢复" icon="eye" label="悬停预览" active={hoverEnabled} onClick={()=>setHoverEnabled(!hoverEnabled)}/><IconButton tooltip="预览吸附到片段与字幕切点，移远后脱离；Option 临时取消预览吸附。拖动或裁切也可吸附" icon="magnet" label="吸附到边界" active={snap} onClick={()=>setSnap(!snap)}/><IconButton tooltip="放大选中范围，方便精细剪辑" icon="zoom-selection" label="放大选中范围" disabled={!selectedRange} onClick={fitSelection}/><IconButton tooltip="缩放时间轴，让整部作品完整显示" icon="timeline-fit" label="显示全片时间轴" onClick={fitAll}/><Tooltip text="拖动滑杆缩放时间轴；向右放大，向左显示更长时间"><input aria-label="时间轴缩放" type="range" min="0" max="8" step=".025" value={Math.log2(zoom)} onChange={e=>changeZoom(2**+e.target.value)}/></Tooltip>
  </div>
  <div className="timeline-scroll" ref={scroll} onScroll={e=>{setHeadersCollapsed(e.currentTarget.scrollLeft>8);const q=Math.floor(e.currentTarget.scrollLeft/128)*128;setScrollX(x=>x===q?x:q);}}><div className="timeline-content" style={{width:width+LABEL,minHeight:'100%'}} onDragOverCapture={e=>{const hit=templateInsertion(e);if(hit){e.preventDefault();e.stopPropagation();setDrop(null);setInsertion({...hit,frame:localFrame(e.clientX)});}else setInsertion(null);}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setInsertion(null);}} onDropCapture={e=>{const hit=templateInsertion(e);setInsertion(null);if(hit){e.preventDefault();e.stopPropagation();dropAsset(e,localFrame(e.clientX),{newTrack:hit.index});}}} onPointerDown={e=>begin(e,'marquee')} onContextMenu={e=>{if((e.target as HTMLElement).closest('button,input,[role=button]'))return;openContext(e);}}>
   <div className="timeline-ruler" onPointerDown={e=>begin(e,'seek')}><div className="timeline-label-head"><span className="track-title">轨道</span></div><AdaptiveTimelineRuler scrollRef={scroll} fps={fps} durationFrames={doc.canvas.durationFrames} px={px} viewport={viewport} labelWidth={LABEL} width={width}>{(doc.markers??[]).map(m=><button className="timeline-marker" key={m.id} style={{left:m.frame*px}} title={m.name} aria-label={`定位标记 ${m.name}`} onPointerDown={e=>e.stopPropagation()} onClick={()=>onSeek(m.frame)}>◆</button>)}</AdaptiveTimelineRuler></div>
   <ProductionPlanTrack jobs={planJobs} resources={planResources} document={doc} getDocument={getDocument} px={px} labelWidth={LABEL} selectedShot={planSelected} onSelect={onPlanSelect} onAction={onPlanAction} onDrop={onPlanDrop}/>
   {[...doc.tracks].reverse().map(t=><div className={"track "+(!(dragging&&dragTrackOccupancy.current?dragTrackOccupancy.current.has(t.id):items.some(i=>i.trackId===t.id))&&!expandedTracks.includes(t.id)&&drop?.trackId!==t.id?'is-empty-track':'')} data-track-id={t.id} key={t.id} onDragOver={e=>{if(t.locked||!e.dataTransfer.types.some(type=>['application/x-motion-template','application/x-motion-media'].includes(type)))return;e.preventDefault();setDrop({trackId:t.id,frame:localFrame(e.clientX)});}} onDragLeave={()=>setDrop(null)} onDrop={e=>{e.preventDefault();setDrop(null);if(!t.locked)dropAsset(e,localFrame(e.clientX),t.id);}}>
    <TrackHeader name={t.name} locked={t.locked} disabled={t.disabled} onMenu={e=>trackMenu(e,t)} renaming={renaming?.id===t.id&&renaming?.kind==='visual'} onRename={finishRename}/>{items.filter(i=>i.trackId===t.id).map(clip)}{drop?.trackId===t.id&&<div className="drop-ghost" style={{left:LABEL+drop.frame*px}}>放在 {(drop.frame/fps).toFixed(2)} 秒</div>}
   </div>)}
   <CaptionTrack onPointerSeek={(x:number)=>onSeek(localFrame(x))} onTrackMenu={(e:any)=>trackMenu(e,{name:"字幕"},"caption-track")} getDocument={getDocument} onContextMenu={(e:any,c:any)=>sideMenu(e,'caption',c)} onDoubleClick={(c:any)=>fitRange({start:c.startFrame,end:c.endFrame})} snap={snap} onSnap={setSnapFrame} doc={doc} px={px} labelWidth={LABEL} selected={captionSelected} selection={captionSelection} onSelect={onCaptionSelect} onSeek={onSeek} onPreview={onPreview} onCommit={onCommit}/>
   {doc.source?.cameraPlan&&<CameraTrack onPointerSeek={(x:number)=>onSeek(localFrame(x))} onTrackMenu={(e:any)=>trackMenu(e,{name:"镜头变化"},"camera-track")} getDocument={getDocument} selectedRange={cameraOccurrence} onContextMenu={(e:any,c:any)=>sideMenu(e,'camera',c)} snap={snap} onSnap={setSnapFrame} doc={doc} px={px} labelWidth={LABEL} selected={cameraSelected} onSelect={onCameraSelect} onSeek={onSeek} onPreviewClip={onCameraPreview} onPreview={onPreview} onCommit={onCommit}/>}
   {doc.source&&<div className={`track source-track ${showSourceWaveform?'has-waveform':''}`} data-track-id="__source"><TrackHeader name="主视频" subtitle="原声" locked={doc.source.locked} onMenu={e=>trackMenu(e,{name:'主视频'},'source-track')}>{coverThumbnail&&<button className="timeline-cover-thumb" aria-label="预览主视频封面" title="预览封面候选" onClick={onPreviewCover}><img src={coverThumbnail} alt="封面"/></button>}</TrackHeader>{items.filter(i=>i.kind==='source').map(clip)}</div>}
   {(doc.audioTracks??[]).map(t=><div className="track audio-track" data-track-id={t.id} key={t.id}><TrackHeader name={t.name} locked={t.locked} disabled={t.disabled} onMenu={e=>trackMenu(e,t,'audio')} renaming={renaming?.id===t.id&&renaming?.kind==='audio'} onRename={finishRename}/>{items.filter(i=>i.kind==='audio'&&i.trackId===t.id).map(clip)}</div>)}
   <BgmPlanTrack document={doc} px={px} labelWidth={LABEL} selectedShot={planSelected} onSelect={onPlanSelect}/>
   <div className="timeline-track-drop"/>
   {insertion&&<div className="track-insertion-guide" style={{top:insertion.top,left:LABEL,width}}><span style={{marginLeft:Math.max(0,insertion.frame*px)}}>松手新建{insertion.kind==='audio'?'音频':'叠加'}轨道</span></div>}
   <TimelinePlayhead clock={clock} labelWidth={LABEL} pxPerFrame={px} onPointerDown={e=>begin(e,'seek')}/>
   <TimelineHover snap={snap} snapPoints={hoverSnapPoints} controller={hoverPreview} scrollRef={scroll} enabled={hoverEnabled} blocked={hoverBlocked||playing||dragging||!!menu||!!renaming} px={px} labelWidth={LABEL} duration={doc.canvas.durationFrames} fps={fps} documentId={doc.id} onPlay={onHoverPlay}/>
   {snapFrame!==null&&<div className="snap-guide" style={{left:LABEL+snapFrame*px}}/>}{marquee&&<div className="timeline-marquee" style={{left:Math.min(marquee.x,marquee.x+marquee.width),top:Math.min(marquee.y,marquee.y+marquee.height),width:Math.abs(marquee.width),height:Math.abs(marquee.height)}}/>}
  </div></div>
  {(hint || looping) && <div className="timeline-footer" role="status"><span>{hint}</span>{looping&&<button onClick={()=>onPlaySelection(false)}>停止循环</button>}</div>}
  {menu&&<div ref={menuRef} className="timeline-menu" aria-label={menu.track?"轨道菜单":"时间轴右键菜单"} onKeyDown={e=>{e.stopPropagation();if(["ArrowDown","ArrowUp","Home","End"].includes(e.key)&&!(e.target as HTMLElement).matches("input")){e.preventDefault();const nodes=Array.from(e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled),summary")).filter(n=>n.offsetParent!==null),at=nodes.indexOf(document.activeElement as HTMLElement);nodes[e.key==="Home"?0:e.key==="End"?nodes.length-1:(at+(e.key==="ArrowUp"?-1:1)+nodes.length)%nodes.length]?.focus();}}} style={{left:menu.x,top:menu.y}} onPointerDown={e=>e.stopPropagation()}>{menu.kind==='caption'||menu.kind==='camera'?<><button onClick={()=>{fitSelection();setMenu(null);}}><Icon name="zoom-selection"/>放大选中范围</button>{menu.kind==='camera'&&<button onClick={()=>{onCameraPreview(menu.item);setMenu(null);}}><Icon name="play"/>预览镜头</button>}{[['copy','复制','⌘C'],['cut','剪切','⌘X'],['paste','粘贴到播放头','⌘V'],['duplicate','创建副本','⌘D'],['split','在播放头分割','⌘B'],['delete','删除','⌫']].filter(([cmd])=>menu.kind!=='camera'||cmd!=='split').map(([cmd,title,key])=><button key={cmd} disabled={menu.kind==='camera'&&!!cameraEditReason(doc)} title={menu.kind==='camera'?cameraEditReason(doc):undefined} onClick={()=>{onCommand(cmd);setMenu(null);}}>{title}<kbd>{key}</kbd></button>)}</>:menu.kind==='source-track'?<><button onClick={()=>{onChange({...doc,source:{...doc.source,locked:!doc.source.locked}});setMenu(null);}}><Icon name={doc.source.locked?'unlock':'lock'}/>{doc.source.locked?'解锁主视频':'锁定主视频'}</button>{coverThumbnail&&<button onClick={()=>{onPreviewCover();setMenu(null);}}><Icon name="eye"/>预览封面</button>}</>:menu.kind==='camera-track'?<><button onClick={()=>{onCameraSelect('');setMenu(null);}}><Icon name="sliders"/>调整镜头变化</button></>:menu.kind==='caption-track'?<><button onClick={()=>{onCaptionSelect(doc.captions.cues[0]?.id);setMenu(null);}}><Icon name="text"/>调整字幕</button></>:menu.track?<><button onClick={()=>patchTrack({locked:!menu.track.locked})}><Icon name={menu.track.locked?'unlock':'lock'}/>{menu.track.locked?'解锁轨道':'锁定轨道'}</button><button disabled={menu.track.locked} onClick={()=>{setRenaming({id:menu.track.id,kind:menu.kind});setMenu(null);}}><Icon name="pencil"/>重命名</button><button disabled={menu.track.locked} onClick={()=>patchTrack({disabled:!menu.track.disabled})}><Icon name={menu.kind==='audio'?(menu.track.disabled?'volume':'volume-off'):(menu.track.disabled?'eye':'eye-off')}/>{menu.track.disabled?(menu.kind==='audio'?'取消静音':'启用轨道'):menu.kind==='audio'?'静音轨道':'禁用轨道（包含导出）'}</button>{menu.kind==='visual'&&<><button disabled={menu.track.locked} onClick={()=>{onChange(reorderTrack(doc,menu.track.id,1));setMenu(null);}}><Icon name="arrow-up"/>上移一层</button><button disabled={menu.track.locked} onClick={()=>{onChange(reorderTrack(doc,menu.track.id,-1));setMenu(null);}}><Icon name="arrow-down"/>下移一层</button></>}{menu.kind==='visual'&&!items.some(i=>i.trackId===menu.track.id)&&<button onClick={()=>{toggleTrack(menu.track.id);setMenu(null);}}><Icon name={expandedTracks.includes(menu.track.id)?'collapse':'expand'}/>{expandedTracks.includes(menu.track.id)?'收起空轨道':'展开空轨道'}</button>}</>:<>{[['copy','复制','⌘C'],['cut','剪切','⌘X'],['paste','粘贴到播放头','⌘V'],['duplicate','创建副本','⌘D'],['split','在播放头分割','⌘B'],['delete','删除','⌫']].filter(([cmd])=>cmd==='paste'||picked.length).map(([cmd,title,key])=><button key={cmd} disabled={cmd!=='paste'&&picked.every(i=>i.locked)} onClick={()=>{setMenu(null);onCommand(cmd);}}>{title}<kbd>{key}</kbd></button>)}<TimelineContextActions doc={doc} frame={clock.getSnapshot()} picked={picked} onSeek={onSeek} onCommand={onCommand} onChange={onChange} onPlaySelection={onPlaySelection} looping={looping} onClose={()=>setMenu(null)}/></>}
   {!menu.track&&<details className="context-details"><summary>时间轴显示</summary>
    <button disabled={!previousView} onClick={()=>{restoreView();setMenu(null);}}>返回上一次缩放视图</button>
    <button aria-pressed={compact} onClick={()=>setCompact(!compact)}>紧凑轨道<span>{compact?'✓':''}</span></button>
    <button aria-pressed={follow} onClick={()=>setFollow(!follow)}>播放时跟随播放头<span>{follow?'✓':''}</span></button>
    <button onClick={()=>{setHeight(clampTimelineHeight(320,innerHeight));setMenu(null);}}>恢复默认高度</button>
   </details>}
  </div>}
 </section>;
}
