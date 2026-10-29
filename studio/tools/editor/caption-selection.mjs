import {checkedCaptions} from './caption-camera-model.mjs';
export function captionSelectionForClick(cues,ids,anchor,id,{toggle=false,range=false,preserve=false}={}){
 const valid=new Set(cues.map(c=>c.id));ids=ids.filter(x=>valid.has(x));
 if(!valid.has(id))return {ids:[],anchor:'',active:''};
 let next;
 if(range&&valid.has(anchor)){const a=cues.findIndex(c=>c.id===anchor),b=cues.findIndex(c=>c.id===id);next=cues.slice(Math.min(a,b),Math.max(a,b)+1).map(c=>c.id);if(toggle)next=[...new Set([...ids,...next])];}
 else if(toggle)next=ids.includes(id)?ids.filter(x=>x!==id):[...ids,id];
 else next=preserve&&ids.includes(id)?ids:[id];
 next=cues.filter(c=>next.includes(c.id)).map(c=>c.id);
 return {ids:next,anchor:range&&valid.has(anchor)?anchor:id,active:next.includes(id)?id:next.at(-1)??''};
}
export function moveCaptionSelection(document,ids,delta){
 const cues=document.captions?.cues??[],selected=cues.filter(c=>ids.includes(c.id)),others=cues.filter(c=>!ids.includes(c.id));
 if(!selected.length)return document;
 let low=-Infinity,high=Infinity;
 for(const c of selected){low=Math.max(low,-c.startFrame,...others.filter(o=>o.endFrame<=c.startFrame).map(o=>o.endFrame-c.startFrame));high=Math.min(high,document.canvas.durationFrames-c.endFrame,...others.filter(o=>o.startFrame>=c.endFrame).map(o=>o.startFrame-c.endFrame));}
 const offset=Math.max(low,Math.min(high,Math.round(delta)));
 return checkedCaptions(document,cues.map(c=>ids.includes(c.id)?{...c,startFrame:c.startFrame+offset,endFrame:c.endFrame+offset}:c));
}
export function captionSelectionCommand(document,ids,command,frame,payload,idFactory){
 ids=Array.isArray(ids)?ids:ids?[ids]:[];
 const cues=document.captions?.cues??[],selected=cues.filter(c=>ids.includes(c.id)),fps=document.canvas.fps.num/document.canvas.fps.den;
 const result=(doc,chosen,extra={})=>({document:doc,ids:chosen,selected:chosen.at(-1)??'',...extra});
 if(command==='paste'){
  const copied=payload?.cues??(payload?.cue?[payload.cue]:[]);
  if(payload?.kind!=='caption'||payload.fps!==fps||!copied.length)throw Error('请复制同帧率项目的字幕');
  const origin=Math.min(...copied.map(c=>c.startFrame));
  const added=copied.map(c=>({...structuredClone(c),id:idFactory(),startFrame:Math.round(frame)+c.startFrame-origin,endFrame:Math.round(frame)+c.endFrame-origin}));
  return result(checkedCaptions(document,[...cues,...added]),added.map(c=>c.id));
 }
 if(!selected.length)throw Error('请先选择字幕');
 const copied={kind:'caption',fps,cues:structuredClone(selected),cue:structuredClone(selected[0])};
 if(command==='copy')return result(document,ids,{payload:copied});
 if(command==='delete'||command==='cut')return result(checkedCaptions(document,cues.filter(c=>!ids.includes(c.id))),[],command==='cut'?{payload:copied}:{});
 if(command==='split'){
  frame=Math.round(frame);const cue=selected.find(c=>frame>c.startFrame&&frame<c.endFrame);if(!cue)throw Error('播放位置须在选中字幕内部');
  const right={...structuredClone(cue),id:idFactory(),startFrame:frame};
  return result(checkedCaptions(document,[...cues.map(c=>c.id===cue.id?{...c,endFrame:frame}:c),right]),[...ids,right.id]);
 }
 if(command==='duplicate'){
  let start=Math.max(...selected.map(c=>c.endFrame));const length=start-Math.min(...selected.map(c=>c.startFrame));
  for(const c of cues){if(c.endFrame<=start)continue;if(c.startFrame>=start+length)break;start=c.endFrame;}
  return captionSelectionCommand(document,[],'paste',start,copied,idFactory);
 }
 throw Error('不支持的字幕命令');
}
