import {projectSourceRange} from './clip-time.mjs';
export const CAPTION_FONTS = Object.freeze([
  {value:'Noto Sans SC',label:'思源黑体'},
  {value:'Noto Serif SC',label:'思源宋体'},
  {value:'LXGW WenKai',label:'霞鹜文楷'},
  {value:'Smiley Sans',label:'得意黑'},
  {value:'LXGW Neo XiHei',label:'霞鹜新晰黑'},
]);
export const DEFAULT_CAPTION_STYLE = Object.freeze({fontFamily:'Noto Sans SC',fontSize:52,color:'#ffffff',backgroundColor:'#000000',backgroundOpacity:0.45,positionXPercent:50,bottomPercent:8,maxWidthPercent:84,paddingX:24,paddingY:10,borderRadius:8});
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const fail=message=>{throw new Error(`字幕 / captions: ${message}`);};
const finiteRange=(value,min,max,label)=>{if(!Number.isFinite(value)||value<min||value>max)fail(`${label} 必须介于 ${min}–${max}`);};
const styleRanges={fontSize:[16,200],backgroundOpacity:[0,1],positionXPercent:[0,100],bottomPercent:[0,90],maxWidthPercent:[10,100],paddingX:[0,200],paddingY:[0,200],borderRadius:[0,200]};
function validateCaptionStyle(style,partial=false){
  if(!plain(style))fail('样式必须是对象');
  for(const key of Object.keys(style)){
    if(!Object.hasOwn(DEFAULT_CAPTION_STYLE,key))fail(`未知样式 ${key}`);
    const value=style[key];
    if(key==='fontFamily'){if(!CAPTION_FONTS.some(font=>font.value===value))fail('字体不受支持');}
    else if(key==='color'||key==='backgroundColor'){if(typeof value!=='string'||!/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value))fail(`${key} 必须是十六进制颜色`);}
    else finiteRange(value,...styleRanges[key],key);
  }
  // Horizontal position was added after version 1; older complete track styles omit it.
  if(!partial)for(const key of Object.keys(DEFAULT_CAPTION_STYLE))if(key!=='positionXPercent'&&!Object.hasOwn(style,key))fail(`缺少样式 ${key}`);
}
export function resolveCaptionStyle(track,cue){
  return {...DEFAULT_CAPTION_STYLE,...track?.style,...cue?.style};
}
/** Immutable scoped edits: validate the whole proposed track before exposing it. */
export function patchCaptionStyles(track,ids,patch,scope='selected'){
  if(scope!=='selected'&&scope!=='all')fail('样式修改范围无效');
  const selected=new Set(ids);
  if(scope==='selected'&&!track.cues.some(cue=>selected.has(cue.id)))return track;
  validateCaptionStyle(patch,true);
  if(!Object.keys(patch).length)return track;
  const next={...track,style:scope==='all'?{...track.style,...patch}:track.style,cues:track.cues.map(cue=>{
    if(scope==='selected')return selected.has(cue.id)?{...cue,style:{...cue.style,...patch}}:cue;
    if(!cue.style)return cue;
    const style={...cue.style};for(const key of Object.keys(patch))delete style[key];
    const result={...cue};if(Object.keys(style).length)result.style=style;else delete result.style;
    return result;
  })};
  validateCaptionTrack(next);return next;
}
export function resetCaptionStyles(track,ids){
  const selected=new Set(ids);
  if(!track.cues.some(cue=>selected.has(cue.id)&&Object.hasOwn(cue,'style')))return track;
  const next={...track,cues:track.cues.map(cue=>{if(!selected.has(cue.id))return cue;const result={...cue};delete result.style;return result;})};
  validateCaptionTrack(next);return next;
}
export function captionStyleValues(track,ids){
  const byId=new Map(track.cues.map(cue=>[cue.id,cue])),cues=[...ids].map(id=>byId.get(id)).filter(Boolean);
  const style=resolveCaptionStyle(track,cues[0]),others=cues.slice(1).map(cue=>resolveCaptionStyle(track,cue));
  return {style,mixed:Object.keys(DEFAULT_CAPTION_STYLE).filter(key=>others.some(other=>other[key]!==style[key]))};
}
/** Strictly validate stored edits; never silently normalize or remove a user's cue. */
export function validateCaptionTrack(track,options={}) {
  const durationFrames=typeof options==='number'?options:options.durationFrames;
  if(!plain(track)||track.version!==1||typeof track.enabled!=='boolean'||!plain(track.style)||!Array.isArray(track.cues))fail('轨道格式无效');
  validateCaptionStyle(track.style);
  if(durationFrames!==undefined&&(!Number.isInteger(durationFrames)||durationFrames<1))fail('时间轴时长无效');
  const ids=new Set();let previousEnd=0;
  for(const cue of track.cues){
    if(!plain(cue)||typeof cue.id!=='string'||!cue.id.trim()||ids.has(cue.id))fail('字幕 ID 为空或重复');
    ids.add(cue.id);
    if(Object.hasOwn(cue,'style'))validateCaptionStyle(cue.style,true);
    if(!Number.isInteger(cue.startFrame)||!Number.isInteger(cue.endFrame)||cue.startFrame<0||cue.endFrame<=cue.startFrame)fail('字幕时间必须是正长度的帧区间');
    if(durationFrames!==undefined&&cue.endFrame>durationFrames)fail('字幕超出时间轴，请先调整字幕结束位置');
    if(cue.startFrame<previousEnd)fail('字幕须按时间排序且不能重叠');previousEnd=cue.endFrame;
    if(cue.initialText!==undefined&&(typeof cue.initialText!=='string'||!cue.initialText.trim()))fail('initialText 不能为空');
    for(const key of ['text','originalText'])if(typeof cue[key]!=='string'||!cue[key].trim())fail(`${key} 不能为空`);
  }
  return true;
}

/** Source identity includes editing coordinates; captions and inspector styling do not invalidate it. */
export function captionSourceKey(document) {
  const source=document.source;
  return JSON.stringify({source:source?{path:source.path??null,publicPath:source.publicPath??null,startFrame:source.startFrame??0,clips:source.clips===undefined?null:source.clips.map(({id,startFrame,durationFrames,sourceInFrame})=>({id,startFrame,durationFrames,sourceInFrame}))}:null,fps:{num:document.canvas.fps.num,den:document.canvas.fps.den},durationFrames:document.canvas.durationFrames});
}
export function hasVisibleCaptions(document,renderMode='full') {
  return renderMode!=='instances'&&document.captions?.enabled===true&&Array.isArray(document.captions.cues)&&document.captions.cues.some(cue=>typeof cue.text==='string'&&cue.text.trim()&&cue.endFrame>cue.startFrame);
}
export function captionAtFrame(track,frame) {
  if(!track?.enabled)return null;
  return track.cues.find(cue=>frame>=cue.startFrame&&frame<cue.endFrame)??null;
}
const textUnits=text=>Array.from(text).reduce((sum,char)=>sum+(/[\x00-\x7f]/.test(char)?0.6:1),0);
/** Reference-height font sizes keep preview and export identical at any output resolution. */
export function captionLineCapacity(canvas,style=DEFAULT_CAPTION_STYLE) {
  const scale=canvas.height/1080;
  return Math.min(24,Math.max(1,Math.floor((canvas.width*style.maxWidthPercent/100-2*style.paddingX*scale)/(style.fontSize*scale)*0.94)));
}
export const cleanCaptionText=text=>text.trim().replace(/^[，。！？、；：,.!?;:…—]+|[，。！？、；：,.!?;:…—]+$/g,'').trim();
function splitCaption(text,capacity) {
  const raw=text.replace(/\s+/g,' ').trim();
  const cleaned=raw.replace(/(^|[，。！？、；：,.!?;:]\s*)[嗯呃额]+[，、,\s]+/g,'$1').trim()||raw;
  const chars=Array.from(cleaned),n=chars.length,ends=new Set([n]);let offset=0;
  for(const segment of new Intl.Segmenter('zh',{granularity:'word'}).segment(cleaned)){offset+=Array.from(segment.segment).length;ends.add(offset);}
  // Treat ranges, decimals, units and English identifiers as indivisible spans.
  const protectedPattern=/\d+(?:\.\d+)?(?:\s*(?:到|至|[-–—~～])\s*\d+(?:\.\d+)?)?\s*(?:毫秒|秒钟|分钟|小时|秒|分|天|年|个月|月|块钱|元|万元|%|％|[pPkKmMgG])?|提示词|关键帧|分镜|[A-Za-z][A-Za-z0-9.-]*(?:\s+\d+(?:\.\d+)?)?/g;
  for(const match of cleaned.matchAll(protectedPattern)){const start=Array.from(cleaned.slice(0,match.index)).length,end=start+Array.from(match[0]).length;for(let k=start+1;k<end;k++)ends.delete(k);}
  const punct=/[，。！？、；：,.!?;:]/;
  const boundaries=[0,...[...ends].filter(k=>{
    if(k===n)return true;
    const right=chars.slice(k).join('');
    if(punct.test(chars[k])||/^\s/.test(chars[k]))return false;
    // Chinese particles bind to the preceding phrase, even though Segmenter treats them as words.
    if(/^[的地得了着过吗吧呢啊]/.test(right))return false;
    return true;
  }).sort((a,b)=>a-b)];
  const best=new Map([[n,{cost:0,parts:[]}]]);
  for(let i=boundaries.length-2;i>=0;i--){const start=boundaries[i];let choice;
    for(let j=i+1;j<boundaries.length;j++){const end=boundaries[j],part=chars.slice(start,end).join('').trim(),units=textUnits(part),tail=best.get(end);if(!tail)continue;
      // Only an indivisible word may exceed available width; never chop identifiers to fit.
      if(units>capacity&&j>i+1)break;
      const shown=cleanCaptionText(part);if(!shown)continue;
      const phraseEnd=punct.test(part.at(-1));
      const dangling=!phraseEnd&&end<n&&/(?:的|地|得|把|被|给|去|在|和|或|与|及|让|向|为|对|从|到|我|你|它)$/.test(shown);
      const cost=tail.cost+12+Math.pow(Math.max(0,capacity-units),2)*.035+(phraseEnd||end===n?0:85)+(part.endsWith('、')?75:0)+(/[。！？!?].+/.test(shown)?60:0)+(dangling?90:0)+(textUnits(shown)<5?65:0)+Math.max(0,units-capacity)*30;
      if(!choice||cost<choice.cost)choice={cost,parts:[part,...tail.parts]};
    }
    if(choice)best.set(start,choice);
  }
  return best.get(0)?.parts??[cleaned];
}
/** Some ASR chunks stop mid-clause. Move only a clearly unfinished tail;
 * interpolate its boundary within that source chunk, not across the whole recording. */
function repairRecognitionBoundaries(cues) {
  const result=cues.map(cue=>({...cue}));
  for(let i=0;i<result.length-1;i++){
    const a=result[i],b=result[i+1];
    if(typeof a.text!=='string'||typeof b.text!=='string'||b.start<a.end||b.start-a.end>.75)continue;
    const match=a.text.match(/([，,。])((?:但|而且|所以)[^，,。！？!?]{0,16}(?:我|我们|我们计划|我们准备|我们希望))$/);
    if(!match||!a.text.slice(0,match.index).trim())continue;
    const tail=match[2],boundary=a.end-(a.end-a.start)*textUnits(tail)/textUnits(a.text);
    const originalA=a.originalText??a.text,originalB=b.originalText??b.text;
    a.originalText=originalA;b.originalText=originalA+' '+originalB;
    a.text=a.text.slice(0,-tail.length);a.end=boundary;b.text=tail+b.text;b.start=boundary;
  }
  return result;
}
/** Input cue start/end are seconds in the complete source audio, not the edited timeline. */
export function cuesToCaptionTrack(cues,document,style={}) {
  if(!Array.isArray(cues))fail('识别结果须为数组');
  const output={version:1,enabled:true,style:{...DEFAULT_CAPTION_STYLE,...style},cues:[]};
  validateCaptionTrack(output,{durationFrames:document.canvas.durationFrames});
  const fps=document.canvas.fps.num/document.canvas.fps.den;
  if(!Number.isFinite(fps)||fps<=0)fail('帧率无效');
  const capacity=captionLineCapacity(document.canvas,output.style);
  repairRecognitionBoundaries(cues).forEach((cue,index)=>{
    if(!plain(cue)||!Number.isFinite(cue.start)||!Number.isFinite(cue.end)||cue.start<0||cue.end<=cue.start||typeof cue.text!=='string'||!cue.text.trim())fail(`识别结果第 ${index+1} 条时间或文字无效`);
    const originalText=cue.originalText??cue.text;
    if(typeof originalText!=='string'||!originalText.trim())fail('原始转写不能为空');
    const start=Math.round(cue.start*fps),end=Math.max(start+1,Math.round(cue.end*fps));
    const parts=splitCaption(cue.text,capacity);
    // Preserve all text if there are fewer available frames than display segments.
    while(parts.length>end-start){const tail=parts.pop();parts[parts.length-1]+=tail;}
    const weights=parts.map(textUnits),total=weights.reduce((a,b)=>a+b,0);let weight=0,left=start;
    parts.forEach((text,partIndex)=>{
      weight+=weights[partIndex];
      const right=partIndex===parts.length-1?end:Math.max(left+1,Math.min(end-(parts.length-partIndex-1),start+Math.round((end-start)*weight/total)));
      const ranges=projectSourceRange(document.source,left,right,document.canvas.durationFrames);
      ranges.forEach((range,occurrence)=>output.cues.push({id:`caption-${index+1}-${partIndex+1}-${occurrence+1}`,startFrame:Math.max(0,range.startFrame),endFrame:Math.min(document.canvas.durationFrames,range.endFrame),text:cleanCaptionText(text),originalText,initialText:cleanCaptionText(text)}));
      left=right;
    });
  });
  output.cues=output.cues.filter(cue=>cue.endFrame>cue.startFrame).sort((a,b)=>a.startFrame-b.startFrame||a.endFrame-b.endFrame);
  validateCaptionTrack(output,{durationFrames:document.canvas.durationFrames});
  return output;
}
