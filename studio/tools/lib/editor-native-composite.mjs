import {hasVisibleCaptions} from '../../templates/remotion-base/src/editor/captions.mjs';
import {planNativeVideo,runNativeVideo} from './editor-native-video.mjs';
import {realpathSync,statSync,rmSync,renameSync} from 'node:fs';
import {resolve,relative,isAbsolute,join,dirname} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
// Only a proven opaque, full-canvas, untransformed video can hide every source pixel.
export function planNativeComposite(document,item,{publicRoot,probe}={}){
 try{
  if(document.instances.some(i=>i.props?.presenterLayer==='behind'))return null;
  if(document.audioClips?.length||document.tracks?.some(t=>t.disabled)||document.instances.some(i=>i.disabled))return null;
  if(hasVisibleCaptions(document,item.renderMode))return null;
  if(item.renderMode!=='full'||item.extension!=='mp4'||document.instances.length!==1)return null;
  const instance=document.instances[0];
  const picture=planNativeVideo(document,{...item,renderMode:'instances',instanceId:instance.id},{publicRoot,probe});
  if(!picture)return null;
  const source=document.source;
  if(!source)return {picture,audioPath:null};
  if(Object.keys(source).some(k=>!['path','publicPath','startFrame','cameraPlan','displaySize'].includes(k)))return null;
  if(typeof source.publicPath!=='string'||isAbsolute(source.publicPath)||/[\\?#\x00]/.test(source.publicPath)||source.publicPath.split('/').includes('..'))return null;
  if(!Number.isInteger(source.startFrame)||source.startFrame<0)return null;
  const root=realpathSync(publicRoot),audioPath=realpathSync(resolve(root,source.publicPath)),rel=relative(root,audioPath);
  if(!rel||rel.startsWith('..')||isAbsolute(rel)||!statSync(audioPath).isFile())return null;
  const data=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','a:0','-show_entries','stream=start_time','-of','json',audioPath],{encoding:'utf8'}));
  if(data.streams?.length&&Math.abs(Number(data.streams[0].start_time??0))>1e-4)return null;
  return {picture,audioPath:data.streams?.length?audioPath:null,audioStartSeconds:(source.startFrame+item.rangeStartFrame)/picture.fps};
 }catch{return null;}
}
export async function runNativeComposite(plan,{outputPath,onProgress=()=>{}}={}){
 const video=join(dirname(outputPath),`.composite-picture-${randomUUID()}.mp4`),merged=join(dirname(outputPath),`.composite-audio-${randomUUID()}.mp4`);
 try{
  await runNativeVideo(plan.picture,{outputPath:video,onProgress});
  if(!plan.audioPath){renameSync(video,outputPath);return {method:'reuse-picture',audio:false};}
  onProgress({stage:'encoding',detail:'合入对应口播音轨'});
  const args=['-v','error','-nostdin','-n','-i',video,'-ss',String(plan.audioStartSeconds),'-i',plan.audioPath,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-t',String(plan.picture.durationFrames/plan.picture.fps),'-movflags','+faststart',merged];
  await new Promise((done,fail)=>{const child=spawn('ffmpeg',args,{stdio:['ignore','ignore','pipe']});let error='';child.stderr.on('data',b=>{error=(error+b).slice(-4000);});child.once('error',fail);child.once('close',code=>code===0?done():fail(Error(error||`FFmpeg exit ${code}`)));});
  renameSync(merged,outputPath);return {method:'reuse-picture',audio:true};
 }finally{rmSync(video,{force:true});rmSync(merged,{force:true});}
}
