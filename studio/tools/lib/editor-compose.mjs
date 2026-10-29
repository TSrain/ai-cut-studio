import {createHash} from 'node:crypto';
const id=v=>{if(typeof v!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(v))throw new Error('Invalid composition ID');return v;};
const finite=(v,min=0,max=1e9)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw new Error('Invalid composition number');return v;};
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const compositionHash=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const instanceHash=instance=>{const x=structuredClone(instance);delete x.props._broll;return compositionHash(x);};
const missing=instance=>['media-stack','media-split'].includes(instance.assetId)?(instance.props.items??[]).some(i=>!i.media):instance.assetId==='source-pip'&&instance.props.sourceMode==='media'&&!instance.props.media;
export function validateComposition(data){
 if(data.version!==1||data.approval?.status!=='approved')throw new Error('Composition requires an approved version 1 manifest');
 id(data.id);if(typeof data.name!=='string'||!data.name.trim())throw new Error('Missing composition name');
 const c=data.canvas;
 for(const v of [c?.width,c?.height,c?.durationFrames,c?.fps?.num,c?.fps?.den])if(!Number.isInteger(finite(v,1)))throw new Error('Canvas values must be integers');
 if(c.width%2||c.height%2)throw new Error('Canvas must have even dimensions');
 if(!Array.isArray(data.shots)||!data.shots.length)throw new Error('Missing shots');
 const duration=c.durationFrames*c.fps.den/c.fps.num,seen=new Set(),spans=[];
 for(const shot of data.shots){
  id(shot.id);if(seen.has(shot.id))throw new Error('Duplicate shot');seen.add(shot.id);
  const start=finite(shot.startSeconds,0,duration),end=finite(shot.endSeconds,0,duration);
  if(end<=start)throw new Error('Invalid shot duration');spans.push([start,end]);
  if(!Array.isArray(shot.options)||!shot.options.length)throw new Error('Missing options');
  const ids=new Set();
  for(const option of shot.options){id(option.id);id(option.assetId);if(ids.has(option.id))throw new Error('Duplicate option');ids.add(option.id);
   if(!['animation','media'].includes(option.route)||!option.props||typeof option.props!=='object'||Array.isArray(option.props))throw new Error('Invalid route or props');
  }
  if(!ids.has(shot.recommended))throw new Error('Missing recommended option');
 }
 spans.sort((a,b)=>a[0]-b[0]);if(spans.some((v,i)=>i&&v[0]<spans[i-1][1]-1e-6))throw new Error('Shots overlap');
 return data;
}
export function composeDocument(input,{existing=null}={}){
 const data=validateComposition(structuredClone(input));
 if(existing&&(existing.id!==data.id||compositionHash(existing.canvas)!==compositionHash(data.canvas)))throw new Error('Existing project identity/canvas differs; use a new project ID');
 const prior=existing?.styleReference?.allowedOverrides?.brollComposition;
 if(existing&&prior?.manifestId!==data.id)throw new Error('Existing document is not managed by this composition; use a new ID');
 const document=existing?structuredClone(existing):{schemaVersion:1,id:data.id,name:data.name,revision:0,canvas:data.canvas,source:data.source??null,styleReference:{contractPath:null,styleframePath:null,allowedOverrides:{}},instances:[]};
 const sourceInput=data.source??null;
 const priorSource=prior?.sourceInput??null;
 if(existing&&compositionHash(priorSource)!==compositionHash(sourceInput)){
  if(priorSource===null&&existing.source===null)document.source=sourceInput;
  else throw new Error('Manifest source changed; use a new project ID to avoid wrong main-track synchronization');
 }
 const oldIds=new Set(prior?.managedIds??[]),newIds=new Set(),protectedEdits=[],selections=[];
 const fps=data.canvas.fps.num/data.canvas.fps.den;
 for(const [index,shot] of data.shots.entries()){
  const option=shot.options.find(o=>o.id===shot.recommended),instanceId=`broll-${shot.id}`;newIds.add(instanceId);
  if(option.route==='animation'&&!['ready','rendered'].includes(option.status))throw new Error(`Animation ${shot.id} has no ready native template`);
  const startFrame=Math.round(shot.startSeconds*fps),endFrame=Math.round(shot.endSeconds*fps);
  if(endFrame<=startFrame)throw new Error('Shot shorter than one frame');
  const props=structuredClone(option.props);
  props.durationSeconds=(endFrame-startFrame)/fps;props.canvas=`${data.canvas.width}x${data.canvas.height}`;
  const instance={id:instanceId,assetId:option.assetId,assetVersion:option.assetVersion??1,startFrame,durationFrames:endFrame-startFrame,zIndex:index,props};
  instance.props._broll={manifestId:data.id,shotId:shot.id,optionId:option.id,baselineHash:instanceHash(instance)};
  const pos=document.instances.findIndex(i=>i.id===instanceId),old=pos<0?null:document.instances[pos];
  if(old){
   if(old.props._broll?.manifestId!==data.id||old.props._broll?.baselineHash!==instanceHash(old))protectedEdits.push(`${shot.id}: 保留手动修改`);
   else document.instances[pos]=instance;
  }else if(oldIds.has(instanceId))protectedEdits.push(`${shot.id}: 保留手动删除`);
  else document.instances.push(instance);
  const installed=document.instances.find(i=>i.id===instanceId);
  selections.push({shotId:shot.id,recommended:option.id,installed:installed?.props._broll?.optionId??null,instanceId:installed?.id??null});
 }
 document.instances=document.instances.filter(instance=>{
  if(!oldIds.has(instance.id)||newIds.has(instance.id))return true;
  if(instance.props._broll?.baselineHash===instanceHash(instance)){oldIds.delete(instance.id);return false;}
  protectedEdits.push(`${instance.id}: 已移除方案，但保留手动修改`);return true;
 });
 // Tombstones retain user deletions across repeated runs.
 document.styleReference.allowedOverrides.brollComposition={manifestId:data.id,sourceInput,managedIds:[...new Set([...oldIds,...newIds])].sort()};
 const pending=document.instances.filter(missing).map(i=>({instanceId:i.id,shotId:i.props._broll?.shotId??null,reason:'待素材'}));
 return {document,pending,protectedEdits,selections,status:pending.length?'pending-media':protectedEdits.length?'protected-edits':'ready'};
}
