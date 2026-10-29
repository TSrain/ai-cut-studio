import {execFileSync, spawn} from 'node:child_process';
import {realpathSync, statSync, renameSync, rmSync, existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {resolve, relative, isAbsolute, extname, dirname, basename, join} from 'node:path';
import {pipGeometry, pipMediaTiming} from '../../templates/remotion-base/src/editor/source-pip.mjs';

const close = (a,b,tolerance=1e-6) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b)<=tolerance;
const ratio = value => {const [n,d=1]=String(value).split('/').map(Number);return n/d;};
const propsAllowed = new Set(['id','label','origin','sourceMode','media','size','x','y','crop','cropX','cropY','radius','borderWidth','borderColor','shadow','entrance','exit','transitionSeconds','editorBackground','durationSeconds','canvas','_broll']);
const onlyKeys = (object, keys) => Object.keys(object).every(key=>keys.has(key));

// Inspect every presentation timestamp: avg_frame_rate === r_frame_rate alone does not prove CFR.
export function probeNativeVideo(inputPath) {
  return JSON.parse(execFileSync('ffprobe',['-v','error','-threads','0','-select_streams','v:0','-show_streams','-show_format','-show_frames','-show_entries','frame=best_effort_timestamp_time,pkt_duration_time:stream:format=format_name','-of','json',inputPath],{encoding:'utf8',timeout:120000,maxBuffer:32*1024*1024}));
}

/** A null plan deliberately falls back to the browser renderer. No document mutation. */
export function planNativeVideo(document,item,{publicRoot,probe=probeNativeVideo}={}) {
  try {
  if(document.instances.some(i=>i.props?.presenterLayer==='behind'))return null;
    if(document.tracks?.some(t=>t.disabled)||document.instances.some(i=>i.disabled))return null;
    if(item.renderMode!=='instances'||!item.instanceId||!['mp4','mov'].includes(item.extension))return null;
    const selected=document.instances.filter(instance=>instance.id===item.instanceId);
    if(selected.length!==1)return null;
    const instance=selected[0],p=instance.props,canvas=document.canvas;
    if(instance.assetId!=='source-pip'||p?.sourceMode!=='media'||!onlyKeys(p,propsAllowed))return null;
    if(!onlyKeys(instance,new Set(['id','assetId','assetVersion','startFrame','durationFrames','zIndex','props'])))return null;
    if(item.rangeStartFrame!==instance.startFrame||item.durationFrames!==instance.durationFrames||!Number.isInteger(item.durationFrames)||item.durationFrames<1)return null;
    if(!Number.isInteger(instance.startFrame)||instance.startFrame<0)return null;
    const fps=canvas.fps.num/canvas.fps.den;
    if(!(fps>0)||!Number.isFinite(fps)||![canvas.width,canvas.height].every(n=>Number.isInteger(n)&&n>0&&n%2===0))return null;
    if(item.canvas&&(item.canvas.width!==canvas.width||item.canvas.height!==canvas.height||item.canvas.fps.num/item.canvas.fps.den!==fps))return null;
    if(p.editorBackground!==undefined&&p.editorBackground!=='transparent')return null;
    if(p.radius!==0||p.borderWidth!==0||p.shadow!==0||p.entrance!=='none'||p.exit!=='none'||p.transitionSeconds!==0)return null;
    const media=p.media,crop=p.crop;
    if(media?.kind!=='video'||!onlyKeys(media,new Set(['kind','publicPath','width','height','durationSeconds','startSeconds'])))return null;
    if(!crop||!onlyKeys(crop,new Set(['x','y','width','height','sourceAspect']))||crop.x!==0||crop.y!==0||crop.width!==1||crop.height!==1||!close(crop.sourceAspect,canvas.width/canvas.height))return null;
    if(media.width!==canvas.width||media.height!==canvas.height||!Number.isFinite(media.durationSeconds)||media.durationSeconds<=0)return null;
    if(!Number.isFinite(media.startSeconds??0)||(media.startSeconds??0)<0)return null;
    const geometry=pipGeometry(canvas.width,canvas.height,instance.durationFrames,0,fps,p);
    if(!close(geometry.left,0)||!close(geometry.top,0)||!close(geometry.width,canvas.width)||!close(geometry.height,canvas.height))return null;
    if(typeof media.publicPath!=='string'||isAbsolute(media.publicPath)||/[\\?#\x00]/.test(media.publicPath)||media.publicPath.split('/').includes('..'))return null;
    const root=realpathSync(publicRoot),inputPath=realpathSync(resolve(root,media.publicPath)),rel=relative(root,inputPath);
    if(!rel||rel.startsWith('..')||isAbsolute(rel)||!statSync(inputPath).isFile())return null;
    const data=probe(inputPath),s=data.streams?.[0],frames=data.frames;
    if(!s||s.codec_type!=='video'||s.width!==canvas.width||s.height!==canvas.height)return null;
    if(![undefined,'1:1'].includes(s.sample_aspect_ratio)||!['progressive','unknown',undefined].includes(s.field_order))return null;
    if(s.tags?.rotate!==undefined||s.side_data_list?.length)return null;
    // Stay in the common SDR opaque 8-bit path. HDR, alpha, and wider-gamut inputs use Remotion.
    if(!['yuv420p','yuvj420p'].includes(s.pix_fmt)||!['unknown','bt709',undefined].includes(s.color_transfer)||!['unknown','bt709',undefined].includes(s.color_primaries)||!['unknown','bt709',undefined].includes(s.color_space))return null;
    if(!close(ratio(s.avg_frame_rate),fps,1e-8)||!close(ratio(s.r_frame_rate),fps,1e-8))return null;
    if(!Array.isArray(frames)||!frames.length||!close(Number(s.start_time),0))return null;
    const tolerance=Math.max(1e-6,ratio(s.time_base)*1.1);
    if(!Number.isFinite(tolerance)||frames.some((f,i)=>!close(Number(f.best_effort_timestamp_time),i/fps,tolerance)||(f.pkt_duration_time!==undefined&&!close(Number(f.pkt_duration_time),1/fps,tolerance))))return null;
    if(s.nb_frames!==undefined&&Number(s.nb_frames)!==frames.length)return null;
    const {trim,available}=pipMediaTiming(media,0,fps);
    if(trim!==Math.round((media.startSeconds??0)*fps)||item.durationFrames>available||trim+item.durationFrames>frames.length)return null;
    const copy=item.extension==='mp4'&&extname(inputPath).toLowerCase()==='.mp4'&&s.codec_name==='h264'&&s.pix_fmt==='yuv420p'&&trim===0&&item.durationFrames===frames.length;
    return {inputPath,extension:item.extension,method:copy?'copy':'transcode',startFrame:trim,durationFrames:item.durationFrames,width:canvas.width,height:canvas.height,fps,fpsExpression:`${canvas.fps.num}/${canvas.fps.den}`,muted:true};
  } catch {return null;}
}

export async function runNativeVideo(plan,{outputPath,onProgress=()=>{},hardwareAcceleration='disable'}={}) {
  if(!['disable','if-possible'].includes(hardwareAcceleration))throw Error('Unsupported hardware acceleration policy');
  if(extname(outputPath).toLowerCase()!==`.${plan.extension}`)throw Error('Native output extension must match the export contract');
  if(resolve(outputPath)===resolve(plan.inputPath)||(existsSync(outputPath)&&realpathSync(outputPath)===realpathSync(plan.inputPath)))throw Error('Native export cannot overwrite its source');
  const temporaryPath=join(dirname(outputPath),`.${basename(outputPath,extname(outputPath))}.native-${randomUUID()}${extname(outputPath)}`);
  const softwareCodec=plan.method==='copy'?'copy':plan.extension==='mov'?'prores_ks':'libx264';
  let codec=hardwareAcceleration==='if-possible'&&plan.extension==='mov'&&plan.method!=='copy'?'prores_videotoolbox':softwareCodec;
  let fallbackReason;
  const emit=encodedFrames=>onProgress({stage:'encoding',encodedFrames:Math.min(plan.durationFrames,encodedFrames),totalFrames:plan.durationFrames,progress:Math.min(1,encodedFrames/plan.durationFrames),codec,hardwareFallback:Boolean(fallbackReason)});
  const encode=async()=>{
    const args=['-hide_banner','-loglevel','error','-n','-i',plan.inputPath,'-map','0:v:0','-an','-sn','-dn','-map_metadata','-1'];
    if(codec==='copy')args.push('-c:v','copy');
    else {
      args.push('-vf',`trim=start_frame=${plan.startFrame}:end_frame=${plan.startFrame+plan.durationFrames},setpts=PTS-STARTPTS`,'-frames:v',String(plan.durationFrames),'-r',plan.fpsExpression);
      if(codec==='prores_videotoolbox')args.push('-c:v',codec,'-profile:v','4','-pix_fmt','ayuv64le','-allow_sw','0');
      else if(codec==='prores_ks')args.push('-c:v',codec,'-profile:v','4','-pix_fmt','yuva444p10le','-alpha_bits','16');
      else args.push('-c:v','libx264','-crf','18','-pix_fmt','yuv420p');
    }
    args.push('-movflags','+faststart','-progress','pipe:1','-nostats',temporaryPath);
    // Reset the attempt's progress explicitly when falling back from hardware.
    emit(0);
    await new Promise((done,fail)=>{
      const child=spawn('ffmpeg',args,{stdio:['ignore','pipe','pipe']});let buffer='',errors='';
      child.stdout.on('data',chunk=>{buffer+=chunk;const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines){const match=/^frame=(\d+)\s*$/.exec(line);if(match)emit(Number(match[1]));}});
      child.stderr.on('data',chunk=>{errors=(errors+chunk).slice(-6000);});
      child.on('error',fail);child.on('close',code=>code===0?done():fail(Error(`Native ffmpeg failed (${code}): ${errors}`)));
    });
  };
  try {
    try {await encode();}
    catch(error){
      if(codec!=='prores_videotoolbox')throw error;
      rmSync(temporaryPath,{force:true});
      fallbackReason=error.message;codec=softwareCodec;
      await encode();
    }
    renameSync(temporaryPath,outputPath);
  } finally {rmSync(temporaryPath,{force:true});}
  emit(plan.durationFrames);
  return {outputPath,method:plan.method,codec:codec==='copy'?'h264':codec,...(fallbackReason?{hardwareFallback:true,fallbackReason}:{})};
}
