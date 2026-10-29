import {execFileSync,spawn} from 'node:child_process';
import {join,relative} from 'node:path';
import {cachedRaster} from './editor-export-cache.mjs';

// Lossless at the original display resolution, never a preview proxy. Normalize
// from timestamp zero BEFORE seeking so fractional/VFR clocks retain held frames.
export async function normalizeHybridSource(plan,document,{onProgress=()=>{},signal}={}){
 const v=plan.sourceMeta.streams.find(s=>s.codec_type==='video');
 const rotation=Number(v.side_data_list?.find(x=>x.rotation!==undefined)?.rotation??v.tags?.rotate??0);
 const swapped=Math.abs(Math.round(rotation/90))%2===1;
 const width=swapped?v.height:v.width,height=swapped?v.width:v.height,fps=document.canvas.fps;
 const props={document:{canvas:{width,height,fps,durationFrames:Math.max(1,Math.round(Number(v.duration??plan.sourceMeta.format.duration)*fps.num/fps.den))},source:{publicPath:relative(plan.publicRoot,plan.source)},instances:[]}};
 const verify=path=>{
  const m=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',path]));const out=m.streams.find(s=>s.codec_type==='video');
  const [n,d]=String(out?.avg_frame_rate).split('/').map(Number);
  if(out?.width!==width||out?.height!==height||Math.abs(n/d-fps.num/fps.den)>1e-5||out?.side_data_list?.some(s=>s.rotation))throw Error('源时钟标准化校验失败');
 };
 const normalized=await cachedRaster(props,'mp4',{root:join(plan.publicRoot,'editor-source-clock-cache'),bundleKey:'source-clock-lossless-v1',publicRoot:plan.publicRoot,signal,verify,onProgress,
  render:async(_props,_extension,path)=>{
   onProgress({stage:'preparing',detail:'标准化原片时间钟（保留原画幅、无损像素和原音轨）'});
   const color=['color_primaries','color_transfer','color_space'].flatMap(k=>v[k]&&v[k]!=='unknown'?[{color_primaries:'-color_primaries',color_transfer:'-color_trc',color_space:'-colorspace'}[k],v[k]]:[]);
   const x264Color=['color_primaries','color_transfer','color_space'].filter(k=>v[k]&&v[k]!=='unknown').map(k=>`${{color_primaries:'colorprim',color_transfer:'transfer',color_space:'colormatrix'}[k]}=${v[k]}`).join(':');
   await new Promise((res,rej)=>{
    const child=spawn('ffmpeg',['-v','error','-nostdin','-n','-threads','2','-i',plan.source,'-map','0:v:0','-map','0:a?','-vf',`fps=${fps.num}/${fps.den}:start_time=0,setsar=1`,'-c:v','libx264','-preset','fast','-crf','0','-pix_fmt','yuv420p','-threads','2',...color,...(x264Color?['-x264-params',x264Color]:[]),'-c:a','copy','-metadata:s:v:0','rotate=0','-movflags','+faststart',path],{signal,stdio:['ignore','ignore','pipe']});
    let error='',spawnError;child.stderr.on('data',b=>error=(error+b).slice(-3000));child.on('error',e=>{spawnError=e;});child.on('close',code=>code===0&&!spawnError?res():rej(spawnError??Error(error||`源时钟标准化退出 ${code}`)));
   });
  }});
 const sourceMeta=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',normalized.path]));
 const next=structuredClone(document);next.source.publicPath=relative(plan.publicRoot,normalized.path);next.source.path=next.source.publicPath;
 return {plan:{...plan,source:normalized.path,sourceMeta,sourceClockIsCfr:true,requiresNormalization:false},document:next,hit:normalized.hit};
}
