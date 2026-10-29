import {spawn,execFileSync} from 'node:child_process';
import {realpathSync,statSync,writeFileSync,renameSync,rmSync} from 'node:fs';
import {join,resolve,relative,isAbsolute,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {sourceSegments} from '../../templates/remotion-base/src/editor/clip-time.mjs';
import {audioVolumeExpression} from '../../templates/remotion-base/src/editor/audio.mjs';

function mediaPath(root,path){
 if(typeof path!=='string'||isAbsolute(path))throw Error('音频必须使用 public 相对路径');
 const base=realpathSync(root),file=realpathSync(resolve(base,path)),rel=relative(base,file);
 if(rel.startsWith('..')||isAbsolute(rel)||!statSync(file).isFile())throw Error('音频素材越界');return file;
}
export async function remixHybridAudio(visual,document,item,{publicRoot,outputPath,workRoot,onProgress=()=>{},signal}={}){
 signal?.throwIfAborted();
 const fps=document.canvas.fps.num/document.canvas.fps.den,start=item.rangeStartFrame,end=start+item.durationFrames,duration=item.durationFrames/fps;
 const args=['-v','error','-nostdin','-n','-i',visual],filters=[],audio=[];let inputs=1;
 const add=path=>{const index=inputs++;args.push('-i',path);return index;};
 const source=item.renderMode==='full'&&document.source?.publicPath&&!document.source.muted?mediaPath(publicRoot,document.source.publicPath):null;
 if(source){
  const meta=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','a:0','-show_streams','-of','json',source]));
  const clips=sourceSegments(document.source,document.canvas.durationFrames).map(c=>{const a=Math.max(start,c.startFrame),b=Math.min(end,c.startFrame+c.durationFrames);return {...c,a,b,inFrame:c.sourceInFrame+a-c.startFrame};}).filter(c=>c.b>c.a);
  if(meta.streams.length&&clips.length){
   const index=add(source);filters.push(`[${index}:a]aresample=48000:first_pts=0,asplit=${clips.length}${clips.map((_,n)=>`[s${n}]`).join('')}`);
   clips.forEach((c,n)=>{const label=`sourceAudio${n}`;filters.push(`[s${n}]atrim=start_sample=${Math.round(c.inFrame/fps*48000)}:end_sample=${Math.round((c.inFrame+c.b-c.a)/fps*48000)},asetpts=PTS-STARTPTS,volume=${document.source.volume??1},adelay=${Math.round((c.a-start)/fps*48000)}S:all=1[${label}]`);audio.push(label);});
  }
 }
 for(const c of item.renderMode==='full'?document.audioClips??[]:[]){
  if(c.muted||document.audioTracks?.some(t=>t.id===c.trackId&&t.disabled))continue;
  const a=Math.max(start,c.startFrame),b=Math.min(end,c.startFrame+c.durationFrames);if(b<=a)continue;
  const index=add(mediaPath(publicRoot,c.publicPath??c.path.replace(/^templates\/remotion-base\/public\//,''))),label=`audio${index}`,from=(c.sourceInFrame+a-c.startFrame)/fps;
  filters.push(`[${index}:a]aresample=48000:first_pts=0,atrim=start_sample=${Math.round(from*48000)}:end_sample=${Math.round((from+(b-a)/fps)*48000)},asetpts=PTS-STARTPTS,volume='${audioVolumeExpression(c,fps,a-c.startFrame)}':eval=frame,adelay=${Math.round((a-start)/fps*48000)}S:all=1[${label}]`);audio.push(label);
 }
 const temporary=join(dirname(outputPath),`.remix-${randomUUID()}.${item.extension}`),script=join(workRoot,`audio-remix-${randomUUID()}.ffgraph`);
 try{
  if(audio.length){filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${duration}[silence]`);filters.push(`[silence]${audio.map(x=>`[${x}]`).join('')}amix=inputs=${audio.length+1}:normalize=0:duration=first:dropout_transition=0[finalAudio]`);writeFileSync(script,filters.join(';\n'));args.push('-filter_complex_script',script,'-map','0:v:0','-map','[finalAudio]','-c:a','aac','-b:a','192k');}
  else args.push('-map','0:v:0','-an');
  args.push('-c:v','copy','-t',String(duration),'-movflags','+faststart',temporary);
  onProgress({stage:'preparing',detail:'复用静音终画面，按当前音轨重混（无需重绘画面）'});
  await new Promise((res,rej)=>{const child=spawn('ffmpeg',args,{signal,stdio:['ignore','ignore','pipe']});let error='',spawnError;child.stderr.on('data',b=>error=(error+b).slice(-3000));child.on('error',e=>{spawnError=e;});child.on('close',code=>code===0&&!spawnError?res():rej(spawnError??Error(error||`音频重混退出 ${code}`)));});
  signal?.throwIfAborted();renameSync(temporary,outputPath);return {audioTracks:audio.length};
 }finally{rmSync(temporary,{force:true});rmSync(script,{force:true});}
}
