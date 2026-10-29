import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,statSync,realpathSync,existsSync,mkdirSync,renameSync,rmSync} from 'node:fs';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';

// Only an opaque, CFR, SDR clip displayed without cropping can use this path.
export function renderMediaSize(instance,canvas,stream){
 const p=instance.props,s=p?.slots,v=p?.variant??{};
 if(instance.assetId!=='media-stage'||!s?.clip||(v.fit&&v.fit!=='contain')||(v.ratio&&v.ratio!=='auto'))return null;
 if((stream.sample_aspect_ratio&& !['1:1','N/A'].includes(stream.sample_aspect_ratio))||stream.pix_fmt!=='yuv420p'||!['bt709',undefined].includes(stream.color_transfer)||stream.side_data_list?.some(x=>x.rotation))return null;
 const zoom=Math.max(1,Number(p.tune?.scale??1)*Number(s.mediaScale??1));
 const factor=Math.max(canvas.width/stream.width,canvas.height/stream.height)*zoom;
 if(!Number.isFinite(factor)||factor>=.75)return null;
 return {width:Math.ceil(stream.width*factor/2)*2,height:Math.ceil(stream.height*factor/2)*2};
}
const ratio=s=>{const [n,d=1]=String(s).split('/').map(Number);return n/d};
export async function prepareRenderMedia(props,{publicRoot,onProgress=()=>{}}){
 const result=structuredClone(props);let prepared=0,hits=0;
 for(const instance of result.document.instances){
  if(instance.assetId!=='media-stage'||!instance.props?.slots?.clip)continue;
  const original=instance.props.slots.clip;
  try{
   const path=realpathSync(resolve(publicRoot,original.includes('/')?original:'footage/'+original));
   const rel=relative(realpathSync(publicRoot),path);
   if(rel.startsWith('..')||isAbsolute(rel))continue;
   const st=statSync(path);if(st.size>512*1024*1024)continue;
   const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_streams','-show_frames','-show_entries','stream:frame=best_effort_timestamp_time','-of','json',path],{encoding:'utf8',maxBuffer:8*1024*1024,timeout:30000}));
   const stream=probe.streams[0],size=renderMediaSize(instance,result.document.canvas,stream);
   const fps=ratio(stream.r_frame_rate),frames=probe.frames??[];
   if(!size||!Number.isFinite(fps)||fps<=0||fps>60||Number(stream.duration)>60||frames.length<2||frames.length>3600||frames.length/fps>60)continue;
   // Keep frame-for-frame timing; VFR and nonzero timestamps use original rendering.
   if(Math.abs(Number(frames[0].best_effort_timestamp_time))>1e-5||frames.some((f,i)=>Math.abs(Number(f.best_effort_timestamp_time)-i/fps)>1e-4))continue;
   const key=createHash('sha256').update('render-media-v1').update(readFileSync(path)).update(JSON.stringify(size)).digest('hex');
   const cacheDir=join(publicRoot,'editor-render-cache');mkdirSync(cacheDir,{recursive:true});
   const output=join(cacheDir,key+'.mp4');
   if(existsSync(output)){hits++;}else{
    onProgress({stage:'preparing',detail:'准备目标画幅视频缓存'});
    const tmp=join(cacheDir,key+'.'+randomUUID()+'.mp4');
    try{
     await new Promise((res,rej)=>{
      const child=spawn('ffmpeg',['-v','error','-nostdin','-i',path,'-map','0:v:0','-map','0:a?','-vf',`scale=${size.width}:${size.height}:flags=lanczos`,'-c:v','libx264','-preset','ultrafast','-crf','0','-pix_fmt','yuv420p','-fps_mode','passthrough','-c:a','copy','-movflags','+faststart',tmp],{stdio:['ignore','ignore','pipe']});
      let error='';child.stderr.on('data',b=>{error=(error+b).slice(-2000)});child.on('error',rej);child.on('close',code=>code===0?res():rej(Error(error||'准备视频失败')));
     });
     renameSync(tmp,output);
    }finally{rmSync(tmp,{force:true});}
   }
   instance.props.slots.clip='editor-render-cache/'+key+'.mp4';prepared++;
  }catch(e){onProgress({stage:'preparing',detail:'使用原视频渲染：'+e.message});}
 }
 return {props:result,prepared,hits};
}
