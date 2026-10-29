import {createReadStream,mkdirSync,writeFileSync,readFileSync,existsSync,cpSync,symlinkSync,renameSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {bundleFingerprint} from './editor-bundle-cache.mjs';
import {visualKey,hasEmbeddedAudio} from './editor-export-cache.mjs';
import {remixHybridAudio} from './editor-hybrid-audio.mjs';
import {renderDocument} from '../editor/render-document.mjs';
import {reviewProcess} from './editor-review-process.mjs';
async function fileHash(path){const hash=createHash('sha256');for await(const bytes of createReadStream(path))hash.update(bytes);return hash.digest('hex');}
const atomic=(path,v)=>{const temp=path+'.'+randomUUID()+'.tmp';writeFileSync(temp,JSON.stringify(v));renameSync(temp,path);};
export async function renderReviewMedia({root,document,frame,directory,signal,onData=()=>{}}){
 const template=join(root,'templates/remotion-base'),build=join(directory,'build');mkdirSync(directory,{recursive:true});
 if(!existsSync(build)){
  mkdirSync(build);cpSync(join(template,'src'),join(build,'src'),{recursive:true});
  for(const name of ['package.json','package-lock.json','tsconfig.json','remotion.config.ts'])if(existsSync(join(template,name)))cpSync(join(template,name),join(build,name));
  symlinkSync(join(template,'public'),join(build,'public'),'dir');symlinkSync(join(template,'node_modules'),join(build,'node_modules'),'dir');
 }
 const still=Number.isInteger(frame),id=still?'frame':'preview',extension=still?'png':'mp4',path=join(directory,id+'.'+extension);
 const scale=Math.min(1,1280/Math.max(document.canvas.width,document.canvas.height));
 const fullItem={id,renderMode:'full',extension,path,rangeStartFrame:still?frame:0,durationFrames:still?1:document.canvas.durationFrames,previewScale:still?1:scale};
 const fps=document.canvas.fps.num/document.canvas.fps.den,chunkFrames=Math.round(10*fps);
 const items=still||hasEmbeddedAudio(document,fullItem)||document.canvas.durationFrames<=chunkFrames?[fullItem]:Array.from({length:Math.ceil(document.canvas.durationFrames/chunkFrames)},(_,index)=>({ ...fullItem,id:'segment-'+index,path:join(directory,'segment-'+index+'.mp4'),rangeStartFrame:index*chunkFrames,durationFrames:Math.min(chunkFrames,document.canvas.durationFrames-index*chunkFrames)}));
 atomic(join(directory,'manifest.json'),{items});
 for(const item of items)atomic(join(directory,item.id+'.props.json'),{document,renderMode:'full',rangeStartFrame:item.rangeStartFrame,renderDurationFrames:item.durationFrames});
 const queue=join(directory,'queue.json');atomic(queue,items.map(item=>({id:item.id,cwd:build,command:[process.execPath,join(root,'tools/editor-export-worker.mjs'),directory,item.id,'--force-remotion','--original-media'],expectedOutput:item.path})));
 let completed=0,lines='';
 const progress=()=>{const item=items[Math.min(completed,items.length-1)];onData('EXPORT_PROGRESS '+JSON.stringify({stage:'rendering',completed,total:items.length,detail:still?'正在保存批注画面':completed>=items.length?'画面已生成，正在拼接声音':`正在准备 ${(item.rangeStartFrame/fps).toFixed(1)}–${((item.rangeStartFrame+item.durationFrames)/fps).toFixed(1)} 秒（${completed+1}/${items.length}）`})+'\n');};progress();
 await reviewProcess(process.execPath,[join(root,'tools/render-queue.mjs'),queue,'--concurrency','1'],{cwd:root,signal,timeout:1800000,onData:text=>{onData(text);lines+=text;const rows=lines.split('\n');lines=rows.pop();for(const line of rows)if(line.startsWith('[render-queue] PASS ')){completed++;progress();}}});
 if(items.length>1){
  // Visual segments keep absolute animation clocks. Mix once over the whole source
  // timeline, avoiding AAC encoder padding or a volume-envelope reset at joins.
  const listing=join(directory,'segments.txt'),silent=join(directory,'preview-silent.mp4');
  writeFileSync(listing,items.map(item=>"file '"+item.path.replaceAll("'","'\\''")+"'").join('\n'));
  await reviewProcess('ffmpeg',['-v','error','-nostdin','-y','-f','concat','-safe','0','-i',listing,'-map','0:v:0','-c:v','copy','-an',silent],{cwd:root,signal});
  await remixHybridAudio(silent,document,fullItem,{publicRoot:join(template,'public'),outputPath:path,workRoot:directory,signal,onProgress:event=>onData('EXPORT_PROGRESS '+JSON.stringify(event)+'\n')});
 }
 if(!existsSync(path)||!statSync(path).size)throw Error('没有生成审片画面');return path;
}
export function createReviewPreviewService({root,load,render=renderReviewMedia}){
 const jobs=new Map(),active=new Map();let queue=Promise.resolve();
 const keyFor=async document=>createHash('sha256').update(document.id).update(await visualKey({document:renderDocument(document)},{bundleKey:bundleFingerprint(join(root,'templates/remotion-base'))+'review-preview-v2',publicRoot:join(root,'templates/remotion-base/public'),extension:'mp4'})).digest('hex');
 const directory=(projectId,key)=>join(root,'workspace/editor-review-previews',projectId,key);
 async function request(document){
  const key=await keyFor(document),dir=directory(document.id,key),receipt=join(dir,'preview.json');
  for(const [other,entry] of active)if(entry.projectId===document.id&&other!==key)entry.controller.abort();
  if(jobs.has(key)&&['queued','running'].includes(jobs.get(key).status))return structuredClone(jobs.get(key));
  if(active.has(key))throw Error('预览正在停止，请稍后重试');
  if(existsSync(receipt)){const old=JSON.parse(readFileSync(receipt,'utf8'));if(old.status==='ready'&&old.sha256&&existsSync(join(dir,'preview.mp4'))&&await fileHash(join(dir,'preview.mp4'))===old.sha256){jobs.set(key,old);return old;}}
  const job={key,projectId:document.id,revision:document.revision,status:'queued',createdAt:Date.now()},controller=new AbortController();mkdirSync(dir,{recursive:true});atomic(receipt,job);jobs.set(key,job);active.set(key,{projectId:document.id,controller});
  queue=queue.catch(()=>{}).then(async()=>{try{
   if(controller.signal.aborted)throw Error('任务已被较新预览替代');job.status='running';atomic(receipt,job);
   await render({root,document:structuredClone(document),directory:dir,signal:controller.signal,onData:text=>{for(const line of text.split('\n'))if(line.startsWith('EXPORT_PROGRESS '))try{job.progress=JSON.parse(line.slice(16));}catch{}}});
   if(controller.signal.aborted)throw Error('任务已被较新预览替代');
   job.sha256=await fileHash(join(dir,'preview.mp4'));job.status='ready';job.url=`/api/editor/review/preview-file?projectId=${encodeURIComponent(document.id)}&key=${key}`;
  }catch(e){job.status=controller.signal.aborted?'cancelled':'failed';job.error=e.message;}finally{active.delete(key);atomic(receipt,job);}});
  return structuredClone(job);
 }
 function get(projectId,key){load(projectId);if(!/^[a-f0-9]{64}$/.test(key))throw Error('预览标识无效');let job=jobs.get(key);if(!job){const p=join(directory(projectId,key),'preview.json');if(!existsSync(p))throw Error('预览不存在');job=JSON.parse(readFileSync(p,'utf8'));if(['running','queued'].includes(job.status))job={...job,status:'failed',error:'服务已重启，请重新生成预览'};}if(job.projectId!==projectId)throw Error('预览不属于此工程');return structuredClone(job);}
 return {request,get,whenIdle:()=>queue,cancel:(projectId,key)=>{const job=get(projectId,key);if(!['queued','running'].includes(job.status))return job;active.get(key)?.controller.abort();job.status='cancelled';job.error='预览已停止';return job;},path:(projectId,key)=>{const j=get(projectId,key);if(j.status!=='ready')throw Error('预览尚未完成');return join(directory(projectId,key),'preview.mp4');}};
}
