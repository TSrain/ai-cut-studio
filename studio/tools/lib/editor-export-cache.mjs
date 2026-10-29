import {createHash,randomUUID} from 'node:crypto';
import {createReadStream,existsSync,mkdirSync,writeFileSync,readFileSync,renameSync,rmSync,readdirSync,statSync,realpathSync} from 'node:fs';
import {join,resolve,relative,isAbsolute,extname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {totalmem,cpus} from 'node:os';

export function exportPolicy(canvas,{transparent=false}={}){
 const pixels=canvas.width*canvas.height,capacity=Math.floor(totalmem()/1024**3);
 return {concurrency:Math.max(1,Math.min(4,Math.floor(cpus().length/2),Math.floor(capacity/(pixels>4e6?7:4)))),hardwareAcceleration:'if-possible',codec:transparent?'prores':'h264',videoBitrate:transparent?undefined:`${Math.max(8_000_000,Math.round(pixels*canvas.fps.num/canvas.fps.den*.14))/1000}k`};
}
const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}};
const digests=new Map();
async function digest(path){const st=statSync(path),signature=`${st.size}:${st.mtimeMs}:${st.ctimeMs}`;if(digests.get(path)?.signature===signature)return digests.get(path).value;const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);const value=h.digest('hex');digests.set(path,{signature,value});return value;}
// Chrome screenshot pixels round upward; Remotion also rounds its encoder size
// and may shrink composition dimensions for
// odd H.264 pixels. Pick a nearby lower scale whose rounded dimensions are even,
// so layout always uses the original canvas, including unusual aspect ratios.
export function exportRasterGeometry(canvas,requested=1,extension='mp4'){
 if(!Number.isFinite(requested)||requested<=0||requested>1)throw Error('previewScale 必须在 0–1 之间');
 let scale=requested;
 if(extension==='mp4'&&requested<1){
  while([canvas.width,canvas.height].some(n=>Math.round(n*scale)%2||Math.ceil(n*scale)%2)){
   const bounds=[canvas.width,canvas.height].filter(n=>Math.round(n*scale)%2||Math.ceil(n*scale)%2).map(n=>(Math.floor(n*scale/2)*2-.000000001)/n);
   scale=Math.min(scale,...bounds);if(!(scale>0))throw Error('预览缩放后的画面过小');
  }
 }
 const width=Math.ceil(canvas.width*scale),height=Math.ceil(canvas.height*scale);
 if(width<1||height<1)throw Error('预览缩放后的画面过小');
 return {width,height,scale};
}
export function hasEmbeddedAudio(document,item){
 const start=item.rangeStartFrame??0,end=start+(item.durationFrames??item.renderDurationFrames??document.canvas.durationFrames);
 return document.instances.some(i=>!i.disabled&&!document.tracks?.some(t=>t.id===i.trackId&&t.disabled)&&i.startFrame<end&&i.startFrame+i.durationFrames>start&&(i.props?.variant?.sound==='keep'||i.props?.sfx?.file));
}
export function silentVisualProps(props){
 const p=structuredClone(props);p.document.audioClips=[];p.document.audioTracks=[];if(p.document.source){p.document.source.muted=true;delete p.document.source.volume;}return p;
}
export function cacheVisualProps(props){
 const p=structuredClone(props),d=p.document;
 delete p.previewSource;
 if(d.source)delete d.source.previewPublicPath;
 for(const i of d.instances??[]){if(i.props?.media)delete i.props.media.previewPublicPath;}
 delete d.id;delete d.name;delete d.revision;delete d.assetSourceHash;delete d.projectBinding;delete d.productionPlan;delete d.markers;
 delete d.roughcut;delete d.review;delete d.reviewState;delete d.reviewAppliedIds;
 const start=p.rangeStartFrame??0,end=start+(p.renderDurationFrames??d.canvas.durationFrames);
 // Keep original instance bounds and source offsets: exits and semantic animation
 // clocks depend on them, even when only a portion of the instance is rendered.
 d.instances=(d.instances??[]).filter(i=>i.startFrame<end&&i.startFrame+i.durationFrames>start&&(!p.instanceId||i.id===p.instanceId));
 if(d.source){delete d.source.locked;if(d.source.muted)delete d.source.volume;
  if(d.source.clips)d.source.clips=d.source.clips.filter(c=>c.startFrame<end&&c.startFrame+c.durationFrames>start).map(({name,...c})=>c);
 }
 if(d.captions?.cues)d.captions.cues=d.captions.cues.filter(c=>c.startFrame<end&&c.endFrame>start);
 if(d.tracks)d.tracks=d.tracks.map(({name,locked,autoPlacement,...track})=>track);
 if(d.audioTracks)d.audioTracks=d.audioTracks.map(({name,locked,...track})=>track);
 return p;
}
export async function visualKey(props,{bundleKey,publicRoot,extension}){
 const visual=cacheVisualProps(props);
 const h=createHash('sha256').update('editor-raster-cache-v4').update(bundleKey).update(extension).update(JSON.stringify(visual)),paths=new Set(),root=realpathSync(publicRoot);
 const add=path=>{try{const candidate=realpathSync(resolve(root,path)),rel=relative(root,candidate);if(!rel.startsWith('..')&&!isAbsolute(rel)&&statSync(candidate).isFile())paths.add(candidate);}catch{}};
 const visit=value=>{if(typeof value==='string'&&/\.(png|jpe?g|webp|svg|mp4|mov|webm|m4v|mp3|wav|m4a|woff2?|ttf|otf)$/i.test(value)){add(value);add('footage/'+value);add('images/'+value);}else if(value&&typeof value==='object')Object.values(value).forEach(visit);};
 visit(visual);
 const fonts=join(root,'fonts');
 if(existsSync(fonts)){const walk=p=>{for(const name of readdirSync(p)){const q=join(p,name);if(statSync(q).isDirectory())walk(q);else paths.add(q);}};walk(fonts);}
 for(const path of [...paths].sort()){h.update(relative(root,path)).update(await digest(path));}
 return h.digest('hex');
}
export function verifyRaster(path,props,extension){
 const meta=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',path],{encoding:'utf8',timeout:30000})),v=meta.streams?.find(s=>s.codec_type==='video'),c=props.document.canvas;
 const expected=exportRasterGeometry(c,props.previewScale??1,extension);
 if(!v||v.width!==expected.width||v.height!==expected.height)throw Error('栅格缓存画幅不符');
 if(extension==='png')return;
 const wanted=(props.renderDurationFrames??c.durationFrames)*c.fps.den/c.fps.num,actual=Number(v.duration??meta.format.duration);
 if(!Number.isFinite(actual)||Math.abs(actual-wanted)>1.1*c.fps.den/c.fps.num)throw Error('栅格缓存时长不符');
 if(extension==='mov'&&!/^(yuva|rgba|argb|bgra|abgr|gbrap)/.test(v.pix_fmt))throw Error('透明缓存没有 Alpha');
}
export async function cachedRaster(props,extension,{root,bundleKey,publicRoot,render,onProgress=()=>{},verify=verifyRaster,signal}){
 const key=await visualKey(props,{bundleKey,publicRoot,extension}),path=join(root,key+'.'+extension),receipt=path+'.ready.json',lock=path+'.lock';mkdirSync(root,{recursive:true});
 const ready=()=>existsSync(path)&&existsSync(receipt);
 while(true){
  signal?.throwIfAborted();
  if(ready()){const record=JSON.parse(readFileSync(receipt));if(record.sha256&&await digest(path)!==record.sha256)throw Error('视觉缓存内容损坏');verify(path,props,extension);onProgress({stage:'preparing',detail:`复用已验收视觉缓存 · ${props.rangeStartFrame??0}–${(props.rangeStartFrame??0)+(props.renderDurationFrames??props.document.canvas.durationFrames)} 帧`});return {path,key,hit:true};}
  try{mkdirSync(lock);writeFileSync(join(lock,'owner.json'),JSON.stringify({pid:process.pid}));break;}
  catch(e){if(e.code!=='EEXIST')throw e;try{if(!alive(JSON.parse(readFileSync(join(lock,'owner.json'))).pid)){rmSync(lock,{recursive:true,force:true});continue;}}catch{if(existsSync(lock)&&Date.now()-statSync(lock).mtimeMs>10000){rmSync(lock,{recursive:true,force:true});continue;}}
   await new Promise(r=>setTimeout(r,200));}
 }
 const temporary=join(root,`.${key}-${randomUUID()}.${extension}`);
 try{signal?.throwIfAborted();await render(props,extension,temporary);signal?.throwIfAborted();verify(temporary,props,extension);renameSync(temporary,path);writeFileSync(receipt,JSON.stringify({key,bytes:statSync(path).size,sha256:await digest(path)}));return {path,key,hit:false};}
 finally{rmSync(temporary,{force:true});rmSync(lock,{recursive:true,force:true});}
}
