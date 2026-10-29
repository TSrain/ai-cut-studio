import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {stat,readFile,writeFile,mkdir,rename,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveEditorMedia} from './editor-media.mjs';
const ROOT=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const runFile=promisify(execFile),VERSION='preview-proxy-v2';
const fraction=value=>{const [n,d=1]=String(value??'0').split('/').map(Number);return n/d;};
const gcd=(a,b)=>b?gcd(b,a%b):a;
/** SDR preview only. Preserve source presentation timestamps and copied audio. */
export function previewProxySpec(meta) {
 const video=meta.streams?.find(s=>s.codec_type==='video'&&!s.disposition?.attached_pic);
 const unsupported=reason=>({supported:false,reason});
 if(!video)return unsupported('没有视频轨');
 const {width,height}=video,fps=fraction(video.avg_frame_rate),frames=Number(video.nb_frames),duration=Number(video.duration),timeBase=fraction(video.time_base);
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0)return unsupported('未知画幅');
 if(Math.max(width,height)<=1280)return unsupported('原片已适合预览');
 if(!['yuv420p','yuvj420p','yuv422p','yuv444p','nv12'].includes(video.pix_fmt)||String(video.tags?.alpha_mode)==='1')return unsupported('保留高位深或透明原片');
 if(['smpte2084','arib-std-b67'].includes(video.color_transfer)||String(video.color_primaries??'').includes('2020'))return unsupported('保留 HDR 原片');
 const rotation=Number(video.side_data_list?.find(s=>s.rotation!==undefined)?.rotation??video.tags?.rotate??0);
 if(![0,90,-90,180,-180,270,-270].includes(rotation)||!['1:1',undefined].includes(video.sample_aspect_ratio))return unsupported('保留旋转或非方形像素原片');
 if(!(fps>0&&fps<=60&&frames>0&&Number.isInteger(frames)&&duration>0&&duration<=7200&&timeBase>0))return unsupported('无法确认恒定帧率与帧数');
 if(Math.abs(Number(video.start_time??NaN))>timeBase||!Number.isFinite(Number(video.start_time)))return unsupported('保留非零时间起点原片');
 const audio=meta.streams?.filter(s=>s.codec_type==='audio')??[];
 if(audio.some(s=>!['aac','mp3'].includes(s.codec_name)||Math.abs(Number(s.start_time??NaN))>.001||!Number.isFinite(Number(s.start_time))))return unsupported('保留原音轨时间基准');
 const rotated=Math.abs(rotation)%180===90,displayWidth=rotated?height:width,displayHeight=rotated?width:height;
 const divisor=gcd(displayWidth,displayHeight),unitW=displayWidth/divisor,unitH=displayHeight/divisor;
 const step=unitW%2||unitH%2?2:1,multiple=Math.floor(1280/Math.max(unitW,unitH)/step)*step;
 if(!multiple)return unsupported('无法生成等比例偶数尺寸');
 return {supported:true,size:{width:unitW*multiple,height:unitH*multiple},fps,frames,duration,timeBase,audio};
}
export function validateProxyFrames(timestamps,{fps,frames,timeBase,timestamps:original}) {
 if(timestamps.length!==frames||timestamps.some(t=>!Number.isFinite(t)))return false;
 const sorted=[...timestamps].sort((a,b)=>a-b),epsilon=Math.max(timeBase*2,0.00001);
 if(original){const expected=[...original].sort((a,b)=>a-b);return expected.length===frames&&sorted.every((t,i)=>Math.abs(t-expected[i])<=.000002);}
 return sorted.every((t,i)=>Math.abs(t-i/fps)<=epsilon);
}
const identity=(actual,s)=>`${VERSION}:${actual}:${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
const fileStamp=s=>({size:s.size,mtimeMs:s.mtimeMs,ctimeMs:s.ctimeMs});
const equalStamp=(a,b)=>a?.size===b?.size&&a?.mtimeMs===b?.mtimeMs&&a?.ctimeMs===b?.ctimeMs;
async function contentHash(path) {
 const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');
}
/** One async encoder per server. POST and polling return immediately, never await the encode. */
export function createPreviewProxyService({root=ROOT,run=runFile}={}) {
 const jobs=new Map(),queue=[];let running=false;
 const probe=async path=>JSON.parse((await run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',path],{timeout:30000,maxBuffer:4*1024*1024})).stdout);
 const packets=async path=>(await run('ffprobe',['-v','error','-select_streams','v:0','-show_packets','-show_entries','packet=pts_time','-of','csv=p=0',path],{timeout:120000,maxBuffer:32*1024*1024})).stdout.trim().split('\n').filter(Boolean).map(line=>Number(line.trim()));
 const publicJob=job=>({key:job.key,status:job.status,...(job.url?{url:job.url,width:job.width,height:job.height}:{}),...(job.reason?{reason:job.reason}:{})});
 async function validOutput(directory,manifest) {
  const path=join(directory,'proxy.mp4'),current=fileStamp(await stat(path));
  if(equalStamp(manifest.file,current))return true;
  if(manifest.file?.size!==current.size||manifest.file?.mtimeMs!==current.mtimeMs||!manifest.sha256)return false;
  // macOS indexing/xattrs/permissions can change ctime without changing bytes.
  // Check the recorded hash before accepting that change, then refresh the stamp.
  if(await contentHash(path)!==manifest.sha256||!equalStamp(current,fileStamp(await stat(path))))return false;
  const metadata={identity:manifest.identity,url:manifest.url,width:manifest.width,height:manifest.height,file:current,sha256:manifest.sha256};
  const temporary=join(directory,`metadata.${randomUUID()}.tmp`);
  try{await writeFile(temporary,JSON.stringify(metadata));await rename(temporary,join(directory,'metadata.json'));}
  finally{await rm(temporary,{force:true});}
  manifest.file=current;return true;
 }
 async function cached(job) {
  try {
   const manifest=JSON.parse(await readFile(join(job.directory,'metadata.json'),'utf8'));
   if(manifest.identity!==job.identity||!await validOutput(job.directory,manifest))return false;
   Object.assign(job,{status:'ready',...manifest});return true;
  }catch{return false;}
 }
 async function prepare(job) {
  if(await cached(job))return;
  const original=await probe(job.actual),spec=previewProxySpec(original);
  if(!spec.supported){job.status='unsupported';job.reason=spec.reason;return;}
  const timestamps=(await packets(job.actual)).sort((a,b)=>a-b);
  if(timestamps.length!==spec.frames||timestamps.some((t,i)=>!Number.isFinite(t)||(i>0&&t<=timestamps[i-1]))||Math.abs(timestamps[0])>spec.timeBase||timestamps.at(-1)>spec.duration+spec.timeBase){job.status='unsupported';job.reason='无法确认原片逐帧时间基准';return;}
  spec.timestamps=timestamps;
  const temporary=`${job.directory}.${randomUUID()}.tmp`;await mkdir(temporary,{recursive:true});
  const output=join(temporary,'proxy.mp4');
  try {
   await run('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-threads','2','-copyts','-i',job.actual,'-map','0:v:0','-map','0:a?','-vf',`scale=${spec.size.width}:${spec.size.height}:flags=fast_bilinear`,'-filter_threads','1','-c:v','libx264','-threads','2','-preset','veryfast','-crf','23','-pix_fmt','yuv420p','-g',String(Math.max(1,Math.round(spec.fps))),'-keyint_min',String(Math.max(1,Math.round(spec.fps))),'-sc_threshold','0','-enc_time_base',String(spec.timeBase),'-fps_mode','passthrough','-video_track_timescale',String(Number(original.streams.find(s=>s.codec_type==='video'&&!s.disposition?.attached_pic).time_base.split('/')[1])||Math.round(1/spec.timeBase)),'-c:a','copy','-movflags','+faststart',output],{timeout:30*60*1000,maxBuffer:2*1024*1024});
   const result=await probe(output),video=result.streams?.find(s=>s.codec_type==='video');
   if(!video||video.width!==spec.size.width||video.height!==spec.size.height||video.codec_name!=='h264'||Number(video.side_data_list?.find(s=>s.rotation!==undefined)?.rotation??video.tags?.rotate??0)!==0||Number(video.nb_frames)!==spec.frames||Math.abs(Number(video.duration)-spec.duration)>Math.max(spec.timeBase*2,.001)||!validateProxyFrames(await packets(output),{...spec,timeBase:fraction(video.time_base)}))throw Error('预览代理帧数、画幅或时间基准校验失败');
   const audio=result.streams?.filter(s=>s.codec_type==='audio')??[];
   if(audio.length!==spec.audio.length||audio.some((s,i)=>s.codec_name!==spec.audio[i].codec_name||Math.abs(Number(s.start_time)-Number(spec.audio[i].start_time))>.001||Math.abs(Number(s.duration)-Number(spec.audio[i].duration))>.05))throw Error('预览代理音轨校验失败');
   if(identity(job.actual,await stat(job.actual))!==job.identity)throw Error('原片已变化，丢弃旧预览代理');
   const sha256=await contentHash(output);
   const manifest={identity:job.identity,url:`/workspace/editor-preview-proxy/${job.key}/proxy.mp4`,...spec.size,file:fileStamp(await stat(output)),sha256};
   await writeFile(join(temporary,'metadata.json'),JSON.stringify(manifest));
   // Completed cache is published only after every check; no partial media URL escapes.
   await rm(job.directory,{recursive:true,force:true});await rename(temporary,job.directory);
   Object.assign(job,{status:'ready',...manifest});
  }finally{await rm(temporary,{recursive:true,force:true});}
 }
 async function pump() {
  if(running)return;running=true;
  try{while(queue.length){const job=queue.shift();job.status='running';try{await prepare(job);}catch(error){job.status='failed';job.reason=error.message;}}}finally{running=false;}
 }
 return {async request(path) {
  const actual=resolveEditorMedia(path,root),sourceIdentity=identity(actual,await stat(actual));
  const key=createHash('sha256').update(sourceIdentity).digest('hex').slice(0,32);
  let job=jobs.get(key);
  if(job?.status==='ready'){
   const previous=job;
   try{if(!await validOutput(job.directory,job))job=null;}catch{job=null;}
   // Concurrent clients discovering invalid cache still share one replacement job.
   if(!job&&jobs.get(key)!==previous)job=jobs.get(key);
  }
  if(!job){
   // Keep completed status bounded; active jobs are never evicted.
   if(jobs.size>=128)for(const [oldKey,value] of jobs){if(!['queued','running'].includes(value.status)){jobs.delete(oldKey);break;}}
   if(queue.length>=16)return {key,status:'failed',reason:'预览队列繁忙，继续使用原片'};
   job={key,identity:sourceIdentity,actual,directory:join(root,'workspace/editor-preview-proxy',key),status:'queued'};
   jobs.set(key,job);queue.push(job);void pump();
  }
  return publicJob(job);
 }};
}
let service;
export function requestPreviewProxy(path){service??=createPreviewProxyService();return service.request(path);}
