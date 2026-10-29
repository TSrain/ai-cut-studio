import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {stat,readFile,mkdir,writeFile,rename,rm,access,readdir,open} from 'node:fs/promises';
import {homedir} from 'node:os';
import {createPeakBuilder,PEAK_LEVELS,PCM_RATE,TILE_PEAKS,peakTile} from '../editor/waveform-levels.mjs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveEditorMedia,mediaMetadata} from './editor-media.mjs';
const ROOT=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const run=promisify(execFile),inflight=new Map(),VERSION='timeline-v1';
async function audioPeaks(path,duration) {
 const count=Math.min(1200,Math.max(1,Math.ceil(duration*20))),peaks=Array(count).fill(0),rate=4000;
 await new Promise((resolve,reject)=>{
  const child=spawn('ffmpeg',['-v','error','-nostdin','-threads','1','-i',path,'-map','0:a:0','-vn','-ac','1','-ar',String(rate),'-f','f32le','pipe:1'],{stdio:['ignore','pipe','pipe']});
  let pending=Buffer.alloc(0),sample=0,errors='';
  const timeout=setTimeout(()=>{child.kill();reject(Error('音频预览提取超时'));},180000);
  child.stdout.on('data',chunk=>{const data=pending.length?Buffer.concat([pending,chunk]):chunk,end=data.length-data.length%4;for(let offset=0;offset<end;offset+=4){const bucket=Math.floor(sample++/(rate*duration)*count),value=Math.abs(data.readFloatLE(offset));if(bucket<count&&Number.isFinite(value))peaks[bucket]=Math.max(peaks[bucket],Math.min(1,value));}pending=data.subarray(end);});
  child.stderr.on('data',chunk=>{errors=(errors+chunk).slice(-2000);});
  child.on('error',error=>{clearTimeout(timeout);reject(error);});
  child.on('close',code=>{clearTimeout(timeout);code===0?resolve():reject(Error(errors||'音频预览提取失败'));});
 });
 return peaks;
}
async function extract(actual,key,{root}) {
 const cache=join(root,'workspace/editor-timeline-media'),directory=join(cache,key),metadataPath=join(directory,'metadata.json');
 try {const saved=JSON.parse(await readFile(metadataPath,'utf8'));await Promise.all(saved.thumbnails.map(t=>access(join(root,t.url.slice(1)))));return saved;}catch{}
 await mkdir(cache,{recursive:true});const temporary=join(cache,`.${key}-${randomUUID()}`);await mkdir(temporary);
 try {
  const {stdout}=await run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',actual],{timeout:30000,maxBuffer:2*1024*1024});
  const raw=JSON.parse(stdout),durationSeconds=mediaMetadata(raw).durationSeconds;
  const count=Math.min(12,Math.max(1,Math.ceil(durationSeconds/5))),times=Array.from({length:count},(_,i)=>i*durationSeconds/count);
  const thumbnails=[];
  // Two async seek workers bound CPU use while avoiding a complete video decode.
  let next=0;
  await Promise.all([0,1].map(async()=>{while(next<count){const index=next++,time=times[index],name=`thumb-${index}.jpg`;await run('ffmpeg',['-v','error','-nostdin','-threads','1','-ss',String(time),'-i',actual,'-frames:v','1','-vf','scale=160:90:force_original_aspect_ratio=decrease,pad=160:90:(ow-iw)/2:(oh-ih)/2','-q:v','5',join(temporary,name)],{timeout:30000,maxBuffer:1024*1024});thumbnails[index]={time,url:`/workspace/editor-timeline-media/${key}/${name}`};}}));
  const peaks=raw.streams?.some(s=>s.codec_type==='audio')?await audioPeaks(actual,durationSeconds):[];
  const result={durationSeconds,thumbnails,peaks,sampleSeconds:peaks.length?durationSeconds/peaks.length:0};
  await writeFile(join(temporary,'metadata.json'),JSON.stringify(result));
  await rm(directory,{recursive:true,force:true});await rename(temporary,directory);return result;
 } finally {await rm(temporary,{recursive:true,force:true});}
}
/** Read-only document operation; canonical media confinement happens before cache lookup. */
export async function getTimelineMedia(path,{root=ROOT}={}) {
 const actual=resolveEditorMedia(path,root),info=await stat(actual);
 const key=createHash('sha256').update(`${VERSION}:${actual}:${info.size}:${info.mtimeMs}`).digest('hex').slice(0,32),jobKey=`${root}:${key}`;
 if(!inflight.has(jobKey))inflight.set(jobKey,extract(actual,key,{root}).finally(()=>inflight.delete(jobKey)));
 return inflight.get(jobKey);
}

// ---- Multi-resolution peaks (lazy, per media identity, viewport tiles) ----
const PEAKS_VERSION='peaks-v1',peakJobs=new Map();
const workflowRoot=()=>process.env.EDITOR_WORKFLOW_ROOT??resolve(ROOT,'../workflow');
export function roughcutAudioCacheRoot(){return process.env.ROUGHCUT_AUDIO_CACHE??join(workflowRoot(),'workspace/roughcut-audio-cache/v1');}
/** Reuse the rough-cut 16 kHz PCM (decoded once by the analysis) when it is for this exact file. */
export async function findCachedPcm(actual,{cacheRoot=roughcutAudioCacheRoot()}={}){
 let entries;try{entries=await readdir(cacheRoot,{withFileTypes:true});}catch{return null;}
 const info=await stat(actual,{bigint:true});
 // Nanosecond fields exceed 2^53; compare the raw JSON digits instead of parsed numbers.
 const want={dev:String(info.dev),ino:String(info.ino),size:String(info.size),mtimeNs:String(info.mtimeNs),ctimeNs:String(info.ctimeNs)};
 for(const entry of entries){
  if(!entry.isDirectory()||entry.name==='locks'||entry.name.endsWith('.part'))continue;
  const dir=join(cacheRoot,entry.name);let text;
  try{text=await readFile(join(dir,'meta.json'),'utf8');}catch{continue;}
  let meta;try{meta=JSON.parse(text);}catch{continue;}
  if(meta?.source?.path!==actual||meta.sampleRate!==PCM_RATE||meta.channels!==1)continue;
  const raw=key=>text.match(new RegExp('"'+key+'"\\s*:\\s*(\\d+)'))?.[1];
  if(Object.entries(want).some(([key,value])=>raw(key)!==value))continue;
  if(!(Math.abs(Number(meta.audioStartOffsetSeconds??NaN))<1e-3))continue;
  return {path:join(dir,'audio.wav'),durationSeconds:meta.durationSeconds};
 }
 return null;
}
async function wavDataRange(path){
 const handle=await open(path,'r');
 try{
  const head=Buffer.alloc(12);await handle.read(head,0,12,0);
  if(head.toString('ascii',0,4)!=='RIFF'||head.toString('ascii',8,12)!=='WAVE')throw Error('不是 WAV');
  let offset=12;const chunk=Buffer.alloc(8);
  for(let guard=0;guard<64;guard++){
   const {bytesRead}=await handle.read(chunk,0,8,offset);if(bytesRead<8)break;
   const id=chunk.toString('ascii',0,4),size=chunk.readUInt32LE(4);
   if(id==='fmt '){const fmt=Buffer.alloc(16);await handle.read(fmt,0,16,offset+8);if(fmt.readUInt16LE(0)!==1||fmt.readUInt16LE(2)!==1||fmt.readUInt32LE(4)!==PCM_RATE||fmt.readUInt16LE(14)!==16)throw Error('WAV 格式不符');}
   if(id==='data')return {start:offset+8,end:offset+8+size};
   offset+=8+size+(size%2);
  }
  throw Error('WAV 缺少数据块');
 }finally{await handle.close();}
}
function feedPcm(stream,builder){
 return new Promise((resolve,reject)=>{
  let carry=null,samples=0;
  stream.on('data',chunk=>{let data=carry?Buffer.concat([carry,chunk]):chunk;const even=data.length-(data.length%2);carry=even<data.length?data.subarray(even):null;
   const view=new Int16Array(even/2);for(let i=0;i<view.length;i++)view[i]=data.readInt16LE(i*2);builder.push(view);samples+=view.length;});
  stream.on('error',reject);stream.on('end',()=>resolve(samples));
 });
}
async function decodePeaks(actual,{cacheRoot}){
 const builder=createPeakBuilder(),cached=await findCachedPcm(actual,{cacheRoot});
 if(cached){
  try{const {createReadStream}=await import('node:fs');const range=await wavDataRange(cached.path);
   const samples=await feedPcm(createReadStream(cached.path,{start:range.start,end:range.end-1}),builder);
   return {levels:builder.finish(),samples,source:'roughcut-pcm'};}
  catch{/* fall through to a fresh decode with a fresh builder */}
 }
 const fresh=createPeakBuilder();
 const child=spawn('ffmpeg',['-v','error','-nostdin','-threads','1','-i',actual,'-map','0:a:0','-vn','-ac','1','-ar',String(PCM_RATE),'-f','s16le','pipe:1'],{stdio:['ignore','pipe','pipe']});
 let errors='';child.stderr.on('data',chunk=>{errors=(errors+chunk).slice(-2000);});
 const timeout=setTimeout(()=>child.kill(),300000);
 try{
  const [samples,code]=await Promise.all([feedPcm(child.stdout,fresh),new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);})]);
  if(code!==0)throw Error(errors||'音频波形提取失败');
  return {levels:fresh.finish(),samples,source:'ffmpeg'};
 }finally{clearTimeout(timeout);}
}
async function buildPeaks(actual,key,{root,cacheRoot}){
 const cache=join(root,'workspace/editor-timeline-media'),directory=join(cache,`peaks-${key}`),metaPath=join(directory,'meta.json');
 try{const meta=JSON.parse(await readFile(metaPath,'utf8'));const levels=await Promise.all(PEAK_LEVELS.map(l=>readFile(join(directory,`L${l.level}.u8`))));return {...meta,levels:levels.map(b=>new Uint8Array(b.buffer,b.byteOffset,b.byteLength))};}catch{}
 await mkdir(cache,{recursive:true});const temporary=join(cache,`.peaks-${key}-${randomUUID()}`);await mkdir(temporary);
 try{
  const {levels,samples,source}=await decodePeaks(actual,{cacheRoot});
  const meta={version:PEAKS_VERSION,durationSeconds:samples/PCM_RATE,source,lengths:levels.map(l=>l.length)};
  await Promise.all(levels.map((l,i)=>writeFile(join(temporary,`L${i}.u8`),l)));
  await writeFile(join(temporary,'meta.json'),JSON.stringify(meta));
  await rm(directory,{recursive:true,force:true});await rename(temporary,directory);
  return {...meta,levels};
 }finally{await rm(temporary,{recursive:true,force:true});}
}
/** One tile of one peak level; the whole level set is built lazily on first request. */
export async function getTimelinePeaks(path,{level=0,tile=0,root=ROOT,cacheRoot}={}){
 level=Number(level);tile=Number(tile);
 if(!Number.isInteger(level)||!PEAK_LEVELS[level])throw Object.assign(Error('波形精度无效'),{status:400});
 if(!Number.isInteger(tile)||tile<0||tile>1e6)throw Object.assign(Error('波形分块无效'),{status:400});
 const actual=resolveEditorMedia(path,root),info=await stat(actual);
 const key=createHash('sha256').update(`${PEAKS_VERSION}:${actual}:${info.size}:${info.mtimeMs}`).digest('hex').slice(0,32),jobKey=`${root}:${key}`;
 if(!peakJobs.has(jobKey))peakJobs.set(jobKey,buildPeaks(actual,key,{root,cacheRoot}).catch(error=>{peakJobs.delete(jobKey);throw error;}));
 const built=await peakJobs.get(jobKey);
 // Keep only recent identities in memory (each is a few hundred KB).
 if(peakJobs.size>16)peakJobs.delete(peakJobs.keys().next().value);
 return {level,tile,perSecond:PEAK_LEVELS[level].perSecond,tilePeaks:TILE_PEAKS,durationSeconds:built.durationSeconds,source:built.source,peaks:peakTile(built.levels[level],tile)};
}
