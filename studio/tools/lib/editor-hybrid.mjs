import {hasEmbeddedAudio} from './editor-export-cache.mjs';
import {normalizeHybridSource} from './editor-source-normalization.mjs';
import {audioVolumeExpression} from '../../templates/remotion-base/src/editor/audio.mjs';
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync,writeFileSync,realpathSync,statSync,renameSync,rmSync} from 'node:fs';
import {resolve,relative,isAbsolute,join,dirname,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {pipGeometry,PIP_DEFAULTS} from '../../templates/remotion-base/src/editor/source-pip.mjs';
import {captionAtFrame,cleanCaptionText,resolveCaptionStyle} from '../../templates/remotion-base/src/editor/captions.mjs';
import {instanceTiming,sourceSegments} from '../../templates/remotion-base/src/editor/clip-time.mjs';
import {compileShotPlan,buildCameraFilter} from '../../templates/remotion-base/src/editor/aroll-shot-plan.mjs';

const close=(a,b)=>Math.abs(a-b)<1e-5;
export function captionSpans(track,start,length){
 const end=start+length,bounds=[...new Set([start,end,...(track?.enabled?track.cues:[]).flatMap(c=>[Math.max(start,c.startFrame),Math.min(end,c.endFrame)]).filter(n=>n>=start&&n<=end)])].sort((a,b)=>a-b),out=[];
 for(let n=0;n<bounds.length-1;n++){
  const cue=captionAtFrame(track,bounds[n]),text=cue?cleanCaptionText(cue.text):'';
  const key=JSON.stringify([text,text?resolveCaptionStyle(track,cue):null]),previous=out.at(-1);
  if(previous?.key===key)previous.end=bounds[n+1];else out.push({start:bounds[n],end:bounds[n+1],text,cue,key});
 }
 return out;
}
export function isDirectMedia(i,canvas){
 const p=i.props??{},m=p.media,g=pipGeometry(canvas.width,canvas.height,instanceTiming(i).duration,0,canvas.fps.num/canvas.fps.den,p);
 const allowed=new Set(['id','label','origin','sourceMode','media','size','x','y','crop','cropX','cropY','radius','borderWidth','borderColor','shadow','entrance','exit','transitionSeconds','editorBackground','durationSeconds','canvas','_broll','deliveryIdentity','footageIdentity']);
 if(i.assetId!=='source-pip'||p.sourceMode!=='media'||m?.kind!=='video'||Object.keys(p).some(k=>!allowed.has(k)))return false;
 if(p.editorBackground&&p.editorBackground!=='transparent')return false;
 if((p.radius??PIP_DEFAULTS.radius)!==0||(p.borderWidth??PIP_DEFAULTS.borderWidth)!==0||(p.shadow??PIP_DEFAULTS.shadow)!==0||p.entrance!=='none'||p.exit!=='none'||p.transitionSeconds!==0)return false;
 const c=p.crop;
 return !!c&&c.x===0&&c.y===0&&c.width===1&&c.height===1&&close(c.sourceAspect,canvas.width/canvas.height)&&Number.isInteger(m.width)&&m.width>0&&Number.isInteger(m.height)&&m.height>0&&close(m.width/m.height,canvas.width/canvas.height)&&close(g.left,0)&&close(g.top,0)&&close(g.width,canvas.width)&&close(g.height,canvas.height);
}
export function visualGroups(document,start,length,nativeIds,{maxFrames=Infinity}={}){
 if(!(maxFrames>0)||!(Number.isInteger(maxFrames)||maxFrames===Infinity))throw Error('分块帧数必须是正整数');
 const end=start+length,intervals=document.instances.filter(i=>!i.disabled&&!document.tracks?.some(t=>t.id===i.trackId&&t.disabled)&&(!isDirectMedia(i,document.canvas)||(nativeIds&&!nativeIds.has(i.id)))).map(i=>[Math.max(start,i.startFrame),Math.min(end,i.startFrame+i.durationFrames)]).filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0]);
 const result=[];
 for(const pair of intervals){if(result.length&&pair[0]<=result.at(-1)[1])result.at(-1)[1]=Math.max(result.at(-1)[1],pair[1]);else result.push(pair);}
 return result.flatMap(([a,b])=>{const chunks=[];for(let n=a;n<b;n+=maxFrames)chunks.push([n,Math.min(b,n+maxFrames)]);return chunks;});
}
function mediaPath(root,path){
 if(typeof path!=='string'||isAbsolute(path))throw Error('媒体必须使用 public 相对路径');
 const base=realpathSync(root),file=realpathSync(resolve(base,path)),rel=relative(base,file);
 if(rel.startsWith('..')||isAbsolute(rel)||!statSync(file).isFile())throw Error('素材越界');
 return file;
}
function probe(path){return JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',path],{encoding:'utf8',timeout:30000}));}
function compatibleVideo(meta,canvas){
 const v=meta.streams?.find(x=>x.codec_type==='video'),fps=canvas.fps.num/canvas.fps.den;
 if(!v||!v.width||!v.height||v.side_data_list?.some(x=>x.rotation)||v.tags?.rotate!==undefined||!['1:1',undefined,'N/A'].includes(v.sample_aspect_ratio))return false;
 if(['color_transfer','color_primaries','color_space'].some(k=>!['bt709','unknown',undefined].includes(v[k])))return false;
 const ratio=s=>{const [n,d]=String(s).split('/').map(Number);return n/d;};
 return close(ratio(v.avg_frame_rate),fps)&&close(ratio(v.r_frame_rate),fps);
}
// Only the main source may normalize its clock and display rotation. Native delivery
// media still require the original strict CFR/geometry contract below.
function compatibleSourceVideo(meta){
 const v=meta.streams?.find(x=>x.codec_type==='video');
 if(!v||!v.width||!v.height||!['yuv420p','yuvj420p'].includes(v.pix_fmt)||!['1:1',undefined,'N/A'].includes(v.sample_aspect_ratio)||!['progressive','unknown',undefined].includes(v.field_order))return false;
 if(['color_transfer','color_primaries','color_space'].some(k=>!['bt709','unknown',undefined].includes(v[k])))return false;
 const rotations=[...(v.side_data_list??[]).map(x=>x.rotation),...(v.tags?.rotate===undefined?[]:[Number(v.tags.rotate)])];
 if(v.side_data_list?.some(x=>x.side_data_type!=='Display Matrix')||rotations.some(n=>!Number.isFinite(n)||!close(n/90,Math.round(n/90))))return false;
 const ratio=s=>{const [n,d]=String(s).split('/').map(Number);return n/d;};
 if(![v.avg_frame_rate,v.r_frame_rate].map(ratio).every(n=>Number.isFinite(n)&&n>0&&n<=240))return false;
 // A zero media origin is required so sourceInFrame/fps also addresses exact audio samples.
 return meta.streams.filter(s=>['video','audio'].includes(s.codec_type)).every(s=>Math.abs(Number(s.start_time??0))<1e-4);
}
function localSourceSegments(document,start,end){
 return sourceSegments(document.source,document.canvas.durationFrames).map(c=>{const a=Math.max(start,c.startFrame),b=Math.min(end,c.startFrame+c.durationFrames);return {...c,a,b,inFrame:c.sourceInFrame+a-c.startFrame};}).filter(c=>c.b>c.a);
}
function compactSourceSequence(document,localSources,start,end,sourceClockIsCfr){
 if(!localSources.length)return false;
 if(localSources[0].a!==start||localSources.at(-1).b!==end)return false;
 if(localSources.some((c,n)=>n>0&&(c.a!==localSources[n-1].b||c.inFrame<localSources[n-1].inFrame+localSources[n-1].b-localSources[n-1].a)))return false;
 const span=localSources.at(-1).inFrame+localSources.at(-1).b-localSources.at(-1).a-localSources[0].inFrame;
 // VFR must retain the absolute fps clock: seeking directly to a cut can discard
 // a preceding frame that should still be displayed. Only verified CFR may seek.
 // Large roughcuts never create one 4K decoder per cut or split/buffer video.
 return !sourceClockIsCfr||localSources.length>=8||(localSources.length>=2&&span<=(end-start)*4);
}
// AVExpr limits expression-tree depth; a flat '+' chain over many cuts can
// fail parsing with ENOMEM. Balanced parentheses keep the same sum at O(log n) depth.
function balancedSum(terms){
 if(terms.length<2)return terms[0]??'0';
 const middle=Math.floor(terms.length/2);
 return `(${balancedSum(terms.slice(0,middle))}+${balancedSum(terms.slice(middle))})`;
}
export function planHybrid(document,item,{publicRoot}={}){
 if(hasEmbeddedAudio(document,item))return null;
 if(!['full','layer','instances'].includes(item.renderMode)||!['mp4','mov'].includes(item.extension))return null;
 const canvas=document.canvas;
 if(item.renderMode==='full'&&document.source&&Object.keys(document.source).some(k=>!['path','publicPath','startFrame','durationFrames','displaySize','clips','cameraPlan','volume','muted','locked'].includes(k)))return null;
 if(![canvas.width,canvas.height].every(x=>Number.isInteger(x)&&x>0&&x%2===0))return null;
 try{
  const source=item.renderMode==='full'&&document.source?.publicPath?mediaPath(publicRoot,document.source.publicPath):null,meta=source?probe(source):null;
  const normalizeSource=source&&compatibleSourceVideo(meta);
  if(source&&!normalizeSource&&!compatibleVideo(meta,canvas))return null;
  const clocks=new Map();
  const cfr=path=>{if(clocks.has(path))return clocks.get(path);
   const data=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_packets','-show_entries','packet=pts_time','-of','json',path],{encoding:'utf8',maxBuffer:32*1024*1024,timeout:60000}));
   const fps=canvas.fps.num/canvas.fps.den,pts=data.packets.map(p=>Number(p.pts_time)).sort((a,b)=>a-b);
   const valid=pts.length>0&&!pts.some((v,n)=>!Number.isFinite(v)||Math.abs(v-n/fps)>1e-4);clocks.set(path,valid);return valid;
  };
  const sourceClockIsCfr=source?cfr(source):false;
  if(source&&!normalizeSource&&!sourceClockIsCfr)return null;
  const requiresNormalization=Boolean(source&&normalizeSource&&!sourceClockIsCfr&&(document.instances.length||document.audioClips?.length||document.source.cameraPlan||!compactSourceSequence(document,localSourceSegments(document,item.rangeStartFrame,item.rangeStartFrame+item.durationFrames),item.rangeStartFrame,item.rangeStartFrame+item.durationFrames,false)));
  const direct=document.instances.filter(i=>!i.disabled&&!document.tracks?.some(t=>t.id===i.trackId&&t.disabled)&&isDirectMedia(i,canvas)).filter(i=>{
   const file=mediaPath(publicRoot,i.props.media.publicPath),meta=probe(file),video=meta.streams?.find(s=>s.codec_type==='video');
   return video?.width===i.props.media.width&&video?.height===i.props.media.height&&compatibleVideo(meta,canvas)&&cfr(file);
  });
  return {source,sourceMeta:meta,sourceClockIsCfr,requiresNormalization,direct,groups:visualGroups(document,item.rangeStartFrame,item.durationFrames,new Set(direct.map(i=>i.id)),{maxFrames:Math.max(1,Math.floor(canvas.fps.num/canvas.fps.den*10))}),publicRoot};
 }catch{return null;}
}
export async function runHybrid(plan,document,item,{outputPath,workRoot,renderVisual,renderPlate,onProgress=()=>{},hardware=true,signal}={}){
 signal?.throwIfAborted();
 let normalizedSource=false,normalizationCacheHit=false;
 if(plan.requiresNormalization){const normalized=await normalizeHybridSource(plan,document,{onProgress,signal});plan=normalized.plan;document=normalized.document;normalizedSource=true;normalizationCacheHit=normalized.hit;}
 const fps=document.canvas.fps.num/document.canvas.fps.den,start=item.rangeStartFrame,end=start+item.durationFrames,duration=item.durationFrames/fps,W=document.canvas.width,H=document.canvas.height;
 const visualDoc=structuredClone(document);delete visualDoc.captions;delete visualDoc.cover;visualDoc.audioClips=[];visualDoc.source=visualDoc.source?{...visualDoc.source,muted:true}:null;
 const groups=[];
 for(const [n,[a,b]] of plan.groups.entries()){onProgress({stage:'preparing',detail:`复杂区间 ${n+1}/${plan.groups.length} · ${a}–${b} 帧（最多 10 秒/段）`});const path=await renderVisual({document:visualDoc,renderMode:item.renderMode,rangeStartFrame:a,renderDurationFrames:b-a},item.extension);groups.push({start:a,end:b,path});}
 const spans=captionSpans(item.renderMode==='instances'?null:document.captions,start,item.durationFrames),hasCaptions=spans.some(s=>s.text);
 let captionList=null,captionBand=null;
 if(hasCaptions){
  const plates=new Map();
  for(const span of spans){if(plates.has(span.key))continue;
   const doc={...document,instances:[],source:null,audioClips:[],cover:undefined,captions:span.text?{...document.captions,cues:[{...span.cue,id:'plate',text:span.text,startFrame:0,endFrame:1}]}:undefined};
   const path=await renderPlate({document:doc,renderMode:'layer',rangeStartFrame:0,renderDurationFrames:1});plates.set(span.key,path);
   onProgress({stage:'preparing',detail:'复用/绘制字幕图版',completed:plates.size,total:new Set(spans.map(s=>s.key)).size});
  }
  const list=join(workRoot,'caption-images.json');writeFileSync(list,JSON.stringify([...plates.values()]));
  captionBand=JSON.parse(execFileSync('/usr/bin/python3',[join(dirname(new URL(import.meta.url).pathname),'../export-caption-plates.py'),list,workRoot],{encoding:'utf8'}));
  const byPath=new Map(captionBand.files.map(x=>[x.original,x.cropped]));
  const lines=[];const escape=p=>p.replaceAll("'","'\\''");
  for(const span of spans){lines.push(`file '${escape(byPath.get(plates.get(span.key)))}'`,`option framerate ${fps}`,`duration ${(span.end-span.start)/fps}`);}
  lines.push(`file '${escape(byPath.get(plates.get(spans.at(-1).key)))}'`,`option framerate ${fps}`);
  captionList=join(workRoot,'captions.ffconcat');writeFileSync(captionList,lines.join('\n')+'\n');
 }
 let cover=null;
 if(item.renderMode==='full'&&start===0&&document.cover?.publicPath){const doc={...document,instances:[],source:null,audioClips:[],captions:undefined};cover=await renderPlate({document:doc,renderMode:'full',rangeStartFrame:0,renderDurationFrames:1});}
 const args=['-v','error','-nostdin','-n','-filter_complex_threads','2'],filters=[],audio=[],inputList=[];
 const add=(path,options=[])=>{const n=inputList.length;inputList.push(path);args.push(...options,'-i',path);return n;};
 const localSources=plan.source?localSourceSegments(document,start,end):[];
 let base='base0',count=0;
 filters.push(`color=c=0x111318${item.extension==='mov'?'@0':''}:s=${W}x${H}:r=${fps}:d=${duration}${item.extension==='mov'?',format=rgba':''}[${base}]`);
 const segments=plan.source&&document.source?.cameraPlan?compileShotPlan(document.source.cameraPlan):[];
 const singleSource=plan.source&&compatibleSourceVideo(plan.sourceMeta)&&compactSourceSequence(document,localSources,start,end,plan.sourceClockIsCfr);
 if(singleSource){
  const last=localSources.at(-1),sourceEnd=last.inFrame+last.b-last.a;
  const index=add(plan.source,['-threads','2','-t',String(sourceEnd/fps)]),name=`source${count}`,next=`base${++count}`;
  const selected=balancedSum(localSources.map(c=>`gte(n,${c.inFrame})*lt(n,${c.inFrame+c.b-c.a})`));
  const mapped=segments.map(s=>({...s,from:s.from+(document.source.startFrame??0)/fps,to:s.to+(document.source.startFrame??0)/fps}));
  const active=mapped.filter(s=>s.zoomFrom!==1||s.zoomTo!==1).map(s=>`between(t,${Math.max(0,s.from)},${s.to})`).join('+');
  const camera=active?','+buildCameraFilter(mapped,{width:W,height:H,fps,anchor:document.source.cameraPlan.anchor??{x:.5,y:.5}}).replace(':interpolation=cubic',`:interpolation=cubic:enable='${active}'`):'';
  filters.push(`[${index}:v]fps=${fps}:start_time=0,tpad=stop_mode=clone:stop=1,scale=${W}:${H}:force_original_aspect_ratio=increase:flags=bicubic,crop=${W}:${H},setsar=1${camera},select='${selected}',setpts=N/(${fps}*TB)[${name}]`);
  filters.push(`[${base}][${name}]overlay=0:0:eof_action=pass:repeatlast=0[${next}]`);base=next;
  if(!document.source.muted&&plan.sourceMeta.streams.some(s=>s.codec_type==='audio')){
   const labels=localSources.map((_,n)=>`sourceSplit${n}`),pieces=localSources.map((_,n)=>`sourcePart${n}`);
   filters.push(`[${index}:a]aresample=48000:first_pts=0,asplit=${labels.length}${labels.map(x=>`[${x}]`).join('')}`);
   for(const [n,c] of localSources.entries())filters.push(`[${labels[n]}]atrim=start_sample=${Math.round(c.inFrame/fps*48000)}:end_sample=${Math.round((c.inFrame+c.b-c.a)/fps*48000)},asetpts=PTS-STARTPTS[${pieces[n]}]`);
   filters.push(`${pieces.map(x=>`[${x}]`).join('')}concat=n=${pieces.length}:v=0:a=1,volume=${document.source.volume??1}[sourceAudioLinear]`);audio.push('sourceAudioLinear');
  }
 }
 for(const c of singleSource?[]:localSources){
  const index=add(plan.source,['-threads','2','-ss',String(c.inFrame/fps),'-t',String((c.b-c.a)/fps)]),name=`source${count}`,next=`base${++count}`;
  let chain=`[${index}:v]fps=${fps}:start_time=0,trim=end_frame=${c.b-c.a},setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=increase:flags=bicubic,crop=${W}:${H},setsar=1`;
  if(segments.length){
   const offset=(c.inFrame-(document.source.startFrame??0))/fps;
   const mapped=segments.filter(s=>s.to>offset&&s.from<offset+(c.b-c.a)/fps).map(s=>({...s,from:s.from-offset,to:s.to-offset}));
   const active=mapped.filter(s=>s.zoomFrom!==1||s.zoomTo!==1).map(s=>`between(t,${Math.max(0,s.from)},${s.to})`).join('+');
   if(active)chain+=','+buildCameraFilter(mapped,{width:W,height:H,fps,anchor:document.source.cameraPlan.anchor??{x:.5,y:.5}}).replace(':interpolation=cubic',`:interpolation=cubic:enable='${active}'`);
  }
  filters.push(chain+`,setpts=PTS+${(c.a-start)/fps}/TB[${name}]`);
  filters.push(`[${base}][${name}]overlay=x=0:y=0:eof_action=pass:repeatlast=0:enable='gte(n,${c.a-start})*lt(n,${c.b-start})'[${next}]`);base=next;
  if(!document.source.muted&&plan.sourceMeta.streams.some(s=>s.codec_type==='audio')){
   const label=`sourceAudio${index}`;
   filters.push(`[${index}:a]atrim=duration=${(c.b-c.a)/fps},asetpts=PTS-STARTPTS,volume=${document.source.volume??1},adelay=${Math.round((c.a-start)/fps*48000)}S:all=1[${label}]`);audio.push(label);
  }
 }
 const groupEnable=groups.map(g=>`gte(n,${g.start-start})*lt(n,${g.end-start})`).join('+');
 for(const i of [...plan.direct].sort((a,b)=>a.zIndex-b.zIndex)){
  const a=Math.max(start,i.startFrame),b=Math.min(end,i.startFrame+i.durationFrames);if(b<=a)continue;
  const offset=(instanceTiming(i).offset+a-i.startFrame)/fps+(i.props.media.startSeconds??0),index=add(mediaPath(plan.publicRoot,i.props.media.publicPath),['-ss',String(offset)]);
  const label=`media${index}`,next=`base${++count}`;
  // Match the browser's full-frame fit while retaining the original Alpha plane.
  const scale=i.props.media.width===W&&i.props.media.height===H?'':`scale=${W}:${H}:flags=bicubic,`;
  filters.push(`[${index}:v]${scale}fps=${fps},tpad=stop_mode=clone:stop_duration=${(b-a)/fps},trim=end_frame=${b-a},setpts=PTS-STARTPTS+${(a-start)/fps}/TB,setsar=1[${label}]`);
  const enabled=`gte(n,${a-start})*lt(n,${b-start})${groupEnable?`*not(${groupEnable})`:''}`;
  filters.push(`[${base}][${label}]overlay=x=0:y=0:eof_action=pass:repeatlast=0:format=auto:enable='${enabled}'[${next}]`);base=next;
 }
 for(const g of groups){const index=add(g.path),label=`visual${index}`,next=`base${++count}`;filters.push(`[${index}:v]setpts=PTS-STARTPTS+${(g.start-start)/fps}/TB[${label}]`);filters.push(`[${base}][${label}]overlay=0:0:eof_action=pass:repeatlast=0:format=auto:enable='gte(n,${g.start-start})*lt(n,${g.end-start})'[${next}]`);base=next;}
 if(captionList){const index=add(captionList,['-f','concat','-safe','0']),next=`base${++count}`;filters.push(`[${index}:v]fps=${fps},setpts=PTS-STARTPTS[caption]`);filters.push(`[${base}][caption]overlay=0:${captionBand.top}:eof_action=pass:repeatlast=0:format=auto[${next}]`);base=next;}
 if(cover){const index=add(cover,['-loop','1','-framerate',String(fps)]),next=`base${++count}`;filters.push(`[${base}][${index}:v]overlay=0:0:enable='eq(n,0)'[${next}]`);base=next;}
 for(const c of item.renderMode==='full'?document.audioClips??[]:[]){
  if(c.muted||document.audioTracks?.some(t=>t.id===c.trackId&&t.disabled))continue;
  const a=Math.max(start,c.startFrame),b=Math.min(end,c.startFrame+c.durationFrames);if(b<=a)continue;
  const index=add(mediaPath(plan.publicRoot,c.publicPath??c.path.replace(/^templates\/remotion-base\/public\//,'')),['-ss',String((c.sourceInFrame+a-c.startFrame)/fps)]),label=`audio${index}`;
  filters.push(`[${index}:a]atrim=duration=${(b-a)/fps},asetpts=PTS-STARTPTS,volume='${audioVolumeExpression(c,fps,a-c.startFrame)}':eval=frame,adelay=${Math.round((a-start)/fps*48000)}S:all=1[${label}]`);audio.push(label);
 }
 filters.push(`[${base}]trim=end_frame=${item.durationFrames},format=${item.extension==='mov'?'yuva444p10le':'yuv420p'}[video]`);
 if(audio.length){filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${duration}[silence]`);filters.push(`[silence]${audio.map(x=>`[${x}]`).join('')}amix=inputs=${audio.length+1}:normalize=0:duration=first:dropout_transition=0[finalAudio]`);}
 const script=join(workRoot,'hybrid.ffgraph');writeFileSync(script,filters.join(';\n'));
 const temp=join(dirname(outputPath),`.hybrid-${randomUUID()}.${item.extension}`);
 const targetBitrate=Math.max(8_000_000,Math.round(W*H*fps*.14));
 const outputArgs=['-filter_complex_script',script,'-map','[video]',...(audio.length?['-map','[finalAudio]','-c:a','aac','-b:a','192k']:['-an']),'-frames:v',String(item.durationFrames),'-r',String(fps),'-t',String(duration),'-pix_fmt',item.extension==='mov'?'yuva444p10le':'yuv420p','-movflags','+faststart','-progress','pipe:1','-nostats'];
 const encode=async accelerated=>{
  const command=[...args,...outputArgs,...(item.extension==='mov'?(accelerated?['-c:v','prores_videotoolbox','-profile:v','4','-pix_fmt','ayuv64le','-allow_sw','0']:['-c:v','prores_ks','-profile:v','4','-pix_fmt','yuva444p10le','-threads','2']):(accelerated?['-c:v','h264_videotoolbox','-b:v',String(targetBitrate),'-allow_sw','0']:['-c:v','libx264','-preset','fast','-crf','18','-threads','2'])),temp];
  writeFileSync(join(workRoot,'hybrid-command.json'),JSON.stringify(command));
  await new Promise((done,fail)=>{const child=spawn('ffmpeg',command,{signal,stdio:['ignore','pipe','pipe']});let pending='',errors='',spawnError;child.stdout.on('data',b=>{pending+=b;const lines=pending.split('\n');pending=lines.pop();for(const line of lines){const m=/^frame=(\d+)/.exec(line);if(m)onProgress({stage:'encoding',completed:Number(m[1]),total:item.durationFrames});}});child.stderr.on('data',b=>errors=(errors+b).slice(-6000));child.on('error',e=>{spawnError=e;});child.on('close',code=>code===0&&!spawnError?done():fail(spawnError??Error(errors||`FFmpeg exit ${code}`)));});
 };
 let used=hardware;
 try{try{await encode(hardware);}catch(e){if(!hardware||!/videotoolbox|encoder|hardware|cannot.*encode/i.test(e.message))throw e;rmSync(temp,{force:true});onProgress({stage:'preparing',detail:'硬件编码不可用，回退软件编码'});used=false;await encode(false);}signal?.throwIfAborted();renameSync(temp,outputPath);}
 finally{rmSync(temp,{force:true});}
 return {engine:'hybrid',normalizedSource,normalizationCacheHit,sourceDecoders:plan.source?(singleSource?1:localSources.length):0,hardwareAcceleration:used?'videotoolbox':'software',nativeVideos:plan.direct.length,complexRanges:groups.length,captionPlates:new Set(spans.map(s=>s.key)).size,audioTracks:audio.length};
}
