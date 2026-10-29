import {sourceFrameAt,sourceClipAt} from '../../templates/remotion-base/src/editor/clip-time.mjs';
import {resolveCaptionStyle} from '../../templates/remotion-base/src/editor/captions.mjs';
import {editAudioFades} from '../../templates/remotion-base/src/editor/audio.mjs';
import {withCameraClips} from '../../templates/remotion-base/src/editor/camera-clips.mjs';
import {validateDocument} from './editor-store.mjs';
import {validateEditorProps} from './editor-props.mjs';
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const clone=v=>structuredClone(v);
const forbidden=/(?:path|url|src|file|identity|reference|delivery|footage|^id$|^_)/i;
const primitive=v=>typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v);
const contains=(o,f)=>f>=o.startFrame&&f<(o.endFrame??o.startFrame+o.durationFrames);
const sourceClock=d=>({canvas:d.canvas,path:d.source?.path,publicPath:d.source?.publicPath,startFrame:d.source?.startFrame,clips:d.source?.clips});
const fadeFields=['fadeInFrames','fadeOutFrames','envelopeOffsetFrames','envelopeDurationFrames'];
const isFade=e=>e.entity==='audio'&&['fadeInFrames','fadeOutFrames'].includes(e.field);
function storedField(object,field){
 const keys=field.split('.'),absentContainers=[];let cursor=object;
 for(let i=0;i<keys.length-1;i++){
  if(!cursor||!Object.hasOwn(cursor,keys[i]))absentContainers.push(keys.slice(0,i+1).join('.'));
  cursor=cursor?.[keys[i]];
 }
 const exists=!!cursor&&Object.hasOwn(cursor,keys.at(-1));
 return {exists,...(exists?{value:clone(cursor[keys.at(-1)])}:{}),absentContainers};
}
const sameStored=(a,b)=>a.exists===b.exists&&(!a.exists||equal(a.value,b.value));
function restoreField(object,field,stored){
 if(stored.exists){setField(object,field,stored.value);return;}
 const keys=field.split('.');let cursor=object;
 for(const key of keys.slice(0,-1))cursor=cursor?.[key];
 if(cursor)delete cursor[keys.at(-1)];
 // Remove only containers created by this edit, preserving pre-existing empties and sibling edits.
 for(const path of [...stored.absentContainers].reverse()){
  const parts=path.split('.');let parent=object;for(const key of parts.slice(0,-1))parent=parent?.[key];
  const value=parent?.[parts.at(-1)];if(value&&Object.keys(value).length===0)delete parent[parts.at(-1)];
 }
}
function leaves(value,prefix='',out=[]){
 for(const [key,v] of Object.entries(value??{})){
  if(forbidden.test(key)||key.includes('.')||['__proto__','constructor','prototype'].includes(key))continue;
  const field=prefix?prefix+'.'+key:key;
  if(primitive(v))out.push({field,value:v});
  else if(v&&typeof v==='object'&&!Array.isArray(v))leaves(v,field,out);
 }return out;
}
export function reviewContext(document,frame){
 if(!Number.isInteger(frame)||frame<0||frame>=document.canvas.durationFrames)throw Error('批注时间超出工程');
 const d=clone(document),editable=[],fps=d.canvas.fps.num/d.canvas.fps.den;
 const add=(entity,o,field,value,label,position)=>editable.push({key:`${entity}/${o.id}/${field}`,entity,id:o.id,field,before:value,stored:storedField(o,field),label,position});
 const clip=sourceClipAt(d.source,frame,d.canvas.durationFrames);
 const shot=d.productionPlan?.shots?.find(s=>!s.cancelled&&s.timing?.ranges?.some(r=>contains(r,frame)));
 for(const c of d.captions?.cues??[])if(contains(c,frame)&&!d.captions.locked&&!c.locked){
  const pos=[c.startFrame,c.endFrame];add('caption',c,'text',c.text,'字幕文字',pos);
  for(const {field,value} of leaves(resolveCaptionStyle(d.captions,c)))add('caption',c,'style.'+field,value,'字幕样式 · '+field,pos);
 }
 for(const i of d.instances??[])if(contains(i,frame)&&!i.disabled&&!i.locked&&!d.tracks?.some(t=>t.id===i.trackId&&(t.locked||t.disabled))){
  for(const {field,value} of leaves(i.props))add('instance',i,'props.'+field,value,(i.name??i.assetId)+' · '+field,[i.startFrame,i.durationFrames,i.trackId,i.assetId]);
 }
 for(const a of d.audioClips??[])if(contains(a,frame)&&!a.locked&&!d.audioTracks?.some(t=>t.id===a.trackId&&(t.locked||t.disabled))){
  for(const field of ['volume','muted','fadeInFrames','fadeOutFrames'])add('audio',a,field,a[field]??(field==='volume'?1:field==='muted'?false:0),(a.name??'音轨')+' · '+field,[a.startFrame,a.durationFrames,a.trackId,a.publicPath??a.path]);
 }
 const sourceFrame=sourceFrameAt(d.source,frame,d.canvas.durationFrames);
 for(const c of d.source?.cameraPlan?.clipGroups??[])if(!d.source.locked&&sourceFrame!==null){
  const t=(sourceFrame-(d.source.startFrame??0))/fps;
  if(t>=c.start&&t<c.start+c.in+c.hold+c.out)for(const field of ['zoom','enabled'])add('camera',c,field,c[field]??(field==='zoom'?1:true),'镜头 · '+field,[c.start,c.in,c.hold,c.out]);
 }
 return {document:d,anchor:{frame,sourceFrame,sourcePath:d.source?.path??null,clipId:clip?.id??null,shotId:shot?.id??null,rangeId:shot?.timing?.ranges?.find(r=>contains(r,frame))?.id??null,revision:d.revision,projectId:d.id,fps,caption:d.captions?.cues?.find(c=>contains(c,frame))?.text??''},editable};
}
function setField(object,field,value){const keys=field.split('.');let cursor=object;for(const key of keys.slice(0,-1))cursor=cursor[key]??=( {} );cursor[keys.at(-1)]=clone(value);}
function locate(d,e){return e.entity==='caption'?d.captions?.cues?.find(x=>x.id===e.id):e.entity==='instance'?d.instances.find(x=>x.id===e.id):e.entity==='audio'?d.audioClips?.find(x=>x.id===e.id):d.source?.cameraPlan?.clipGroups?.find(x=>x.id===e.id);}
export function applyReviewResult(snapshot,result,current,{reverse=false}={}){
 if(!result||typeof result.summary!=='string'||!Array.isArray(result.patches)||result.patches.length>100||!Array.isArray(result.gaps)||!result.gaps.every(x=>typeof x==='string'))throw Error('审片修改结果格式无效');
 if(current.id!==snapshot.anchor.projectId||!equal(sourceClock(current),sourceClock(snapshot.document)))throw Error('源视频或时间线已变化，请基于当前画面重新提交');
 const before=new Map(snapshot.editable.map(e=>[e.key,e])),now=new Map(reviewContext(current,snapshot.anchor.frame).editable.map(e=>[e.key,e]));
 const next=clone(current),seen=new Set(),changed=new Set(),fades=new Map();
 for(const p of result.patches){
  const base=before.get(p.key),present=now.get(p.key);
  if(!base||!present||seen.has(p.key)||!equal(base.position,present.position))throw Error('修改目标已删除、锁定或超出当前画面');seen.add(p.key);
  if(typeof p.value!==typeof base.before||!primitive(p.value)||typeof p.value==='string'&&p.value.length>12000)throw Error('修改值类型无效');
  if(!equal(present.before,reverse?p.value:base.before))throw Error('这处内容已被修改，已保留当前版本');
  const value=reverse?base.before:p.value,object=locate(next,base);
  if(base.entity==='audio'&&base.field==='volume'&&(value<0||value>2))throw Error('音量应在0–2之间');
  if(isFade(base)){
   if(!Number.isInteger(p.value)||p.value<0||p.value>object.durationFrames)throw Error('淡入淡出超出片段');
   if(!fades.has(base.id))fades.set(base.id,{base,patch:{}});
   fades.get(base.id).patch[base.field]=p.value;continue;
  }
  if(base.entity==='caption'&&base.field.startsWith('style.')){
   const stored=base.stored??storedField(locate(snapshot.document,base),base.field);
   const expected=reverse?{exists:true,value:p.value}:stored;
   if(!sameStored(storedField(locate(current,base),base.field),expected))throw Error('这处内容已被修改，已保留当前版本');
   if(reverse)restoreField(object,base.field,stored);else setField(object,base.field,value);
  }else setField(object,base.field,value);
  if(base.entity==='instance')changed.add(base.id);
 }
 for(const {base,patch} of fades.values()){
  const original=locate(snapshot.document,base),present=locate(current,base),object=locate(next,base);
  const applied={...original,...editAudioFades(original,patch)},expected=reverse?applied:original;
  // Rebase and clamp as one edit; all fields the fade control writes are conflict dependencies.
  for(const field of fadeFields)if(!sameStored(storedField(present,field),storedField(expected,field)))throw Error('这处内容已被修改，已保留当前版本');
  if(reverse)for(const field of fadeFields)restoreField(object,field,storedField(original,field));
  else Object.assign(object,editAudioFades(object,patch));
 }
 if(result.patches.some(p=>before.get(p.key)?.entity==='camera'))next.source.cameraPlan=withCameraClips(next.source.cameraPlan,next.source.cameraPlan.clipGroups);
 validateDocument(next);
 for(const id of changed)validateEditorProps(next.instances.find(i=>i.id===id),next.canvas.durationFrames,{fps:next.canvas.fps.num/next.canvas.fps.den});
 return next;
}
