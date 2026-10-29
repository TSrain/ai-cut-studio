import {readFileSync,existsSync,realpathSync,openSync,readSync,closeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,relative,isAbsolute,join} from 'node:path';
import {validatePresenterLayer} from '../../templates/remotion-base/src/editor/presenter-layer.mjs';
export function sourceDigest(path){const hash=createHash('sha256'),fd=openSync(path,'r'),buffer=Buffer.alloc(1024*1024);try{let n;while((n=readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,n));return hash.digest('hex');}finally{closeSync(fd);}}
export function validatePresenterAssets(document,{publicRoot,renderMode='full'}={}){
 for(const i of document.instances.filter(i=>!i.disabled && !document.tracks?.find(t=>t.id===i.trackId)?.disabled && i.props?.presenterLayer==='behind')){
  if(renderMode!=='full')throw Error('人物背后层依赖原底片，只支持完整视频导出');
  validatePresenterLayer(document,i);
  const m=i.props.presenterForeground,root=realpathSync(publicRoot);
  const safe=p=>{const path=realpathSync(resolve(root,p)),rel=relative(root,path);if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('人物前景资源必须位于 public');return path;};
  if(sourceDigest(safe(document.source.publicPath))!==m.sourceSha256)throw Error('底片内容已经变更，人物前景失效，请重新准备');
  const dir=safe(m.framesPublicPath);
  for(let n=0;n<m.frameCount;n++){
   const path=join(dir,`${String(n).padStart(6,'0')}.png`);
   if(!existsSync(path))throw Error(`人物前景缺帧 ${n}`);
   const bytes=readFileSync(path);if(bytes.length<33||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.readUInt32BE(16)!==m.width||bytes.readUInt32BE(20)!==m.height||bytes[25]!==6)throw Error(`人物前景 PNG 尺寸/Alpha 无效 ${n}`);
  }
 }
 return true;
}

/** Prove the frame clock from decoded presentation timestamps, not rate headers. */
export function validatePresenterSourceClock(data,fps,{sourceStartFrame=0,frameCount=1}={}){
 const stream=data.streams?.[0],rate=value=>{const [n,d=1]=String(value).split('/').map(Number);return n/d;};
 if(!stream||!Number.isFinite(fps)||fps<=0||!['avg_frame_rate','r_frame_rate'].every(key=>Number.isFinite(rate(stream[key]))&&Math.abs(rate(stream[key])-fps)<=1e-6)||!['1:1',undefined].includes(stream.sample_aspect_ratio))throw Error('人物前景需要与工程 fps 一致的 CFR 方形像素底片');
 const timeBase=rate(stream.time_base),tolerance=1e-5;
 if(!Number.isFinite(timeBase)||timeBase<=0||timeBase>1/fps)throw Error('底片 time_base 无法证明工程帧时钟');
 // best_effort_timestamp_time is in display order. Missing, duplicate, offset or irregular timestamps fail closed.
 const frames=data.frames;
 if(!Array.isArray(frames)||!frames.length||frames.some((frame,index)=>typeof frame.best_effort_timestamp_time!=='string'||!frame.best_effort_timestamp_time.trim()||!Number.isFinite(Number(frame.best_effort_timestamp_time))||Math.abs(Number(frame.best_effort_timestamp_time)-Math.round(index/fps/timeBase)*timeBase)>tolerance))throw Error('底片实际帧时间戳不是零起点均匀 CFR，无法保证人物前景源帧对齐');
 if(!Number.isInteger(sourceStartFrame)||sourceStartFrame<0||!Number.isInteger(frameCount)||frameCount<1||sourceStartFrame+frameCount>frames.length)throw Error('所需人物源帧超出实际底片帧数');
 return {frameCount:frames.length,tolerance};
}
