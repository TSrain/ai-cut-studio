export const CAMERA_PRESETS=[{id:'quick',name:'快推强调',in:.35,out:.7},{id:'slow',name:'慢推深入',in:2.3,out:1.2},{id:'slow-fast',name:'慢推快拉',in:2.3,out:.35},{id:'gentle',name:'缓推缓回',in:2,out:2}];
export const clipEnd=c=>c.start+c.in+c.hold+c.out;
export function cameraClips(plan){
 if(!plan)return [];
 if(plan.clipGroups)return structuredClone(plan.clipGroups);
 const events=plan.events??[],result=[];
 for(let i=1;i<events.length;i+=2){const a=events[i],b=events[i+1];
  if(!b&&a.transition==='slow'&&a.to!=='A'&&typeof plan.endCloseException==='string'&&plan.endCloseException.trim()){
   result.push({id:`camera-${i}`,start:a.from,in:a.toTime-a.from,hold:plan.duration-a.toTime,out:0,holdToEnd:true,zoom:a.zoom??plan.levels[a.to],enabled:true,name:a.cue,preset:'custom',inEasing:a.easing??'smoothstep',push:a});continue;
  }
  if(!b||a.transition!=='slow'||b.transition!=='slow'||a.to==='A'||b.to!=='A')throw Error('此旧计划含非成组镜头，请先保留原计划并人工整理');
  result.push({id:`camera-${i}`,start:a.from,in:a.toTime-a.from,hold:b.from-a.toTime,out:b.toTime-b.from,zoom:a.zoom??plan.levels[a.to],enabled:true,name:a.cue,preset:'custom',inEasing:a.easing??'smoothstep',outEasing:b.easing??'smoothstep',push:a,pull:b});
 }return result;
}
export function cameraEvents(plan,clips){
 if(!Array.isArray(clips))throw Error('clips must be an array');
 const sorted=[...clips].sort((a,b)=>a.start-b.start),ids=new Set();let end=0;
 const events=[plan.events?.[0]??{at:0,to:'A',transition:'cut',purpose:'hook',cue:'开场',reason:'基础构图'}];
 for(const c of sorted){
  if(!c.id||ids.has(c.id))throw Error('duplicate clip id');ids.add(c.id);
  if(![c.start,c.in,c.hold,c.out,c.zoom].every(Number.isFinite))throw Error('clip values must be finite');
  if(c.holdToEnd&&(c.out!==0||Math.abs(clipEnd(c)-plan.duration)>1e-7))throw Error('保持镜头必须延续到片尾且不包含拉回');
  if(c.in<.2-1e-8||(!c.holdToEnd&&c.out<.2-1e-8)||c.hold<0||c.start<0||clipEnd(c)>plan.duration+.00001)throw Error('clip timing out of range');
  if(c.zoom<=1||c.zoom>1.35)throw Error('clip zoom out of range');
  if(c.start<end-1e-7)throw Error('camera clips overlap');end=clipEnd(c);
  if(typeof c.enabled!=='boolean')throw Error('enabled must be boolean');
  if(!c.enabled)continue;
  events.push({...c.push,from:c.start,toTime:c.start+c.in,to:'B',zoom:c.zoom,transition:'slow',easing:c.inEasing??'ramped',purpose:c.push?.purpose??'emphasis',cue:c.name||'手动选点',reason:c.push?.reason??'用户选择镜头模板'});
  if(!c.holdToEnd)events.push({...c.pull,from:c.start+c.in+c.hold,toTime:clipEnd(c),to:'A',zoom:1,transition:'slow',easing:c.outEasing??'ramped',purpose:c.pull?.purpose??'tension-release',cue:c.pull?.cue??c.name??'回归',reason:c.pull?.reason??'重点后恢复原构图'});
 }return events;
}
export function withCameraClips(plan,clips){return {...plan,clipGroups:structuredClone(clips),events:cameraEvents(plan,clips)};}
export function retimeCameraClip(c,kind,delta,duration){
 if(c.holdToEnd){
  const start=kind==='right'?c.start:Math.max(0,Math.min(duration-.2,c.start+delta));
  const push=Math.min(c.in,duration-start);
  return {...c,start,in:push,hold:Math.max(0,duration-start-push),out:0};
 }
 if(kind==='move')return {...c,start:Math.max(0,Math.min(duration-(clipEnd(c)-c.start),c.start+delta))};
 // Keep the motion timings until the hold has been fully consumed.
 const min=.4;
 const start=kind==='left'?Math.max(0,Math.min(clipEnd(c)-min,c.start+delta)):c.start;
 const end=kind==='right'?Math.min(duration,Math.max(start+min,clipEnd(c)+delta)):clipEnd(c);
 const length=Math.max(min,end-start),motion=c.in+c.out;
 if(length>=motion)return {...c,start,hold:length-motion};
 // Preserve the motion ratio until one side reaches its 0.2 second floor.
 const push=Math.max(.2,Math.min(length-.2,length*c.in/motion));
 return {...c,start,in:push,hold:0,out:length-push};
}
export function duplicateCameraClip(clips,id,duration){
 const c=clips.find(c=>c.id===id);if(!c)throw Error('clip missing');
 const length=clipEnd(c)-c.start,sorted=[...clips].sort((a,b)=>a.start-b.start);
 let start=clipEnd(c);for(const other of sorted){if(clipEnd(other)<=start)continue;if(other.start>=start+length)break;start=clipEnd(other);}
 if(c.holdToEnd)throw Error('片尾保持镜头不能复制到片中');
 if(start+length>duration)throw Error('片尾没有足够空位，请先移动镜头');
 let n=1;while(clips.some(c=>c.id===`${id}-copy-${n}`))n++;
 return [...clips,{...structuredClone(c),id:`${id}-copy-${n}`,start,name:c.name+' · 副本'}].sort((a,b)=>a.start-b.start);
}
export function applyCameraPreset(c,id){
 const p=CAMERA_PRESETS.find(p=>p.id===id);if(!p)throw Error('unknown preset');
 const length=clipEnd(c)-c.start;
 if(c.holdToEnd){const push=Math.min(p.in,length);return {...c,preset:id,in:push,hold:length-push,out:0,inEasing:p.in<1?'linear':'ramped'};}
 const scale=Math.min(1,length/(p.in+p.out));
 return {...c,preset:id,in:p.in*scale,out:p.out*scale,hold:Math.max(0,length-(p.in+p.out)*scale),inEasing:p.in<1?'linear':'ramped',outEasing:p.out<1?'linear':'ramped'};
}
