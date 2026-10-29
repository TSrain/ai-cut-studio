import {hasVisibleCaptions} from '../../templates/remotion-base/src/editor/captions.mjs';
import {execFileSync,spawn} from 'node:child_process';
import {realpathSync,statSync,existsSync,renameSync,rmSync} from 'node:fs';
import {resolve,relative,isAbsolute,dirname,basename,join,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
const ratio=s=>{const [n,d=1]=String(s).split('/').map(Number);return n/d;};
// Only the source-only full composition is equivalent; all overlays keep Remotion.
export function planNativeSource(document,item,{publicRoot,camera}={}) {
 try {
  if(document.instances.some(i=>i.props?.presenterLayer==='behind'))return null;
  if(document.audioClips?.length||document.tracks?.some(t=>t.disabled)||document.instances.some(i=>i.disabled))return null;
  if(hasVisibleCaptions(document,item.renderMode))return null;
  const c=document.canvas,s=document.source,fps=c.fps.num/c.fps.den;
  if(item.renderMode!=='full'||item.extension!=='mp4'||!s||document.instances.length)return null;
  if(Object.keys(s).some(k=>!['path','publicPath','startFrame','cameraPlan','displaySize'].includes(k)))return null;
  if(![c.width,c.height].every(n=>Number.isInteger(n)&&n>0&&n%2===0)||!(fps>0)||fps>30||Math.max(c.width,c.height)>1920||c.width*c.height>1920*1080)return null;
  if(![s.startFrame,item.rangeStartFrame,item.durationFrames].every(Number.isInteger)||s.startFrame<0||item.rangeStartFrame<0||item.durationFrames<1)return null;
  if(typeof s.publicPath!=='string'||isAbsolute(s.publicPath)||/[\\?#\x00]/.test(s.publicPath)||s.publicPath.split('/').includes('..'))return null;
  const root=realpathSync(publicRoot),inputPath=realpathSync(resolve(root,s.publicPath)),rel=relative(root,inputPath);
  if(!rel||rel.startsWith('..')||isAbsolute(rel)||!statSync(inputPath).isFile())return null;
  const data=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_streams','-show_packets','-show_entries','packet=pts_time,duration_time:stream','-of','json',inputPath],{encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024}));
  const stream=data.streams?.[0];
  if(!stream||!['yuv420p','yuvj420p'].includes(stream.pix_fmt)||stream.side_data_list?.length||stream.tags?.rotate!==undefined)return null;
  if(![undefined,'1:1'].includes(stream.sample_aspect_ratio)||!['progressive','unknown',undefined].includes(stream.field_order))return null;
  if(['color_transfer','color_primaries','color_space'].some(k=>![undefined,'unknown','bt709'].includes(stream[k])))return null;
  if(Math.abs(ratio(stream.avg_frame_rate)-fps)>1e-6||Math.abs(ratio(stream.r_frame_rate)-fps)>1e-6)return null;
  const pts=data.packets.map(p=>Number(p.pts_time)).sort((a,b)=>a-b),tol=Math.max(1e-5,ratio(stream.time_base)*1.1);
  if(!pts.length||pts.some((v,i)=>!Number.isFinite(v)||Math.abs(v-i/fps)>tol))return null;
  const startFrame=s.startFrame+item.rangeStartFrame;
  if(startFrame+item.durationFrames>pts.length+1)return null;
  let filters=`scale=${c.width}:${c.height}:force_original_aspect_ratio=increase:flags=bicubic,crop=${c.width}:${c.height},setsar=1`;
  if(s.cameraPlan){
   if(!camera)return null;
   const segments=camera.compileShotPlan(s.cameraPlan),anchor=s.cameraPlan.anchor??{x:.5,y:.5};
   if(![anchor.x,anchor.y].every(n=>Number.isFinite(n)&&n>=0&&n<=1)||segments.some(x=>Math.min(x.zoomFrom,x.zoomTo)<1))return null;
   // SourcePip samples document time, not the source trim offset.
   const local=segments.filter(x=>x.to>=item.rangeStartFrame/fps && x.from<(item.rangeStartFrame+item.durationFrames)/fps).map(x=>({...x,from:x.from-item.rangeStartFrame/fps,to:x.to-item.rangeStartFrame/fps}));
   const active=local.filter(x=>x.zoomFrom!==1||x.zoomTo!==1).map(x=>`between(t,${x.from},${x.to})`).join('+');
   if(active)filters+=','+camera.buildCameraFilter(local,{width:c.width,height:c.height,fps,anchor}).replace(':interpolation=cubic',`:interpolation=cubic:enable='${active}'`);
  }
  return {inputPath,startSeconds:startFrame/fps,durationFrames:item.durationFrames,fps,width:c.width,height:c.height,filters};
 }catch{return null;}
}
export async function runNativeSource(plan,{outputPath,onProgress=()=>{},hardwareAcceleration='disable'}={}){
 if(extname(outputPath)!=='.mp4'||resolve(outputPath)===resolve(plan.inputPath)||(existsSync(outputPath)&&realpathSync(outputPath)===realpathSync(plan.inputPath)))throw Error('Unsafe native source output');
 const temporary=join(dirname(outputPath),`.${basename(outputPath)}.${randomUUID()}.mp4`);
 const emit=n=>onProgress({stage:'encoding',completed:Math.min(n,plan.durationFrames),total:plan.durationFrames});
 const hardware=hardwareAcceleration==='if-possible';
 const args=['-v','error','-filter_threads','2','-threads','2','-nostdin','-n',...(hardware?['-hwaccel','videotoolbox']:[]),'-ss',String(plan.startSeconds),'-i',plan.inputPath,'-map','0:v:0','-map','0:a:0?','-vf',plan.filters+',tpad=stop_mode=clone:stop=1','-frames:v',String(plan.durationFrames),'-t',String(plan.durationFrames/plan.fps),...(hardware?['-c:v','h264_videotoolbox','-b:v','20M','-allow_sw','0']:['-c:v','libx264','-preset','fast','-threads','2','-crf','18']),'-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart','-progress','pipe:1','-nostats',temporary];
 emit(0);
 try{

 await new Promise((done,fail)=>{const child=spawn('ffmpeg',args,{stdio:['ignore','pipe','pipe']});let pending='',errors='';child.stdout.on('data',b=>{pending+=b;const lines=pending.split('\n');pending=lines.pop();for(const line of lines){const m=/^frame=(\d+)/.exec(line);if(m)emit(Number(m[1]));}});child.stderr.on('data',b=>{errors=(errors+b).slice(-6000);});child.on('error',fail);child.on('close',code=>code===0?done():fail(Error(errors||`FFmpeg exit ${code}`)));});
 renameSync(temporary,outputPath);emit(plan.durationFrames);return {codec:hardware?'h264_videotoolbox':'libx264',method:'native-source'};
 }catch(error){
  if(!hardware)throw error;
  onProgress({stage:'preparing',detail:'硬件合成不可用，使用软件合成'});
  return {...await runNativeSource(plan,{outputPath,onProgress,hardwareAcceleration:'disable'}),hardwareFallback:true};
 }finally{rmSync(temporary,{force:true});}
}
