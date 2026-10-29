import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,appendFileSync,renameSync,realpathSync,statSync} from 'node:fs';
import {join,resolve,relative,isAbsolute,dirname} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {roughcutSourceKey} from '../editor/roughcut-model.mjs';
import {cachedFileSha256} from './media-digest-cache.mjs';
const ROOT=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const WORKFLOW=process.env.EDITOR_WORKFLOW_ROOT??resolve(ROOT,'../workflow');
const atomic=(path,data)=>{const tmp=path+'.'+randomUUID()+'.tmp';writeFileSync(tmp,JSON.stringify(data,null,2));renameSync(tmp,path);};
export const processAlive=pid=>{if(!Number.isInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}};
export const STALE_JOB_ERROR='后台分析进程已不在，进度已过期（不是仍在运行），请重新开始粗剪；共享转写仍可复用';
const identity=p=>{const s=statSync(p);return `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;};
function sourcePath(document,publicRoot){
 const path=document.source?.publicPath;
 if(typeof path!=='string'||!path||isAbsolute(path)||path.split(/[\\/]/).some(x=>x==='..'||!x))throw Error('底片路径无效，请先导入原始口播');
 const base=realpathSync(publicRoot),actual=realpathSync(resolve(base,path)),rel=relative(base,actual);
 if(!rel||rel==='..'||rel.startsWith('../')||isAbsolute(rel)||!statSync(actual).isFile())throw Error('底片路径必须位于项目素材目录内');
 return actual;
}
function checkAnalysis(raw,key){
 if(raw?.version!==1||raw.sourceKey!==key)throw Error('粗剪分析的来源身份不匹配');
 if(!Number.isFinite(raw.sourceDurationSeconds)||raw.sourceDurationSeconds<=0||!Array.isArray(raw.units)||!raw.units.length)throw Error('粗剪没有可用的真实转写与时间');
 const seen=new Set();let last=-1;
 for(const u of raw.units){if(typeof u.id!=='string'||!u.id||seen.has(u.id)||typeof u.text!=='string'||!u.text.trim()||!Number.isFinite(u.startSeconds)||!Number.isFinite(u.endSeconds)||u.startSeconds<0||u.startSeconds<last||u.endSeconds<=u.startSeconds||u.endSeconds>raw.sourceDurationSeconds+.05||!['word','segment'].includes(u.timing))throw Error('粗剪分析包含无效字词时间');seen.add(u.id);last=u.startSeconds;}
 if(!Array.isArray(raw.silences)||!Array.isArray(raw.decisions)||!Array.isArray(raw.warnings))throw Error('粗剪分析缺少决定或音频检查记录');
 for(const s of raw.silences)if(!Number.isFinite(s.startSeconds)||!Number.isFinite(s.endSeconds)||s.startSeconds<0||s.endSeconds<=s.startSeconds||s.endSeconds>raw.sourceDurationSeconds+.05)throw Error('停顿分析时间越界');
 for(const d of raw.decisions)if(!['delete','review'].includes(d.action)||!Array.isArray(d.unitIds)||!d.unitIds.length||d.unitIds.some(id=>!seen.has(id))||(d.keepUnitIds??[]).some(id=>!seen.has(id))||typeof d.reason!=='string')throw Error('粗剪决定引用了不存在的原话');
 return raw;
}
export function roughcutSourceCopy(document){
 if(!document.source)throw Error('请先导入口播原片');
 const duration=document.source.durationFrames;
 if(!Number.isInteger(duration)||duration<=0)throw Error('缺少原片完整时长，请重新导入原片');
 const source=structuredClone(document.source);delete source.clips;delete source.cameraPlan;source.startFrame=0;source.locked=false;
 return {schemaVersion:1,timelineVersion:2,id:randomUUID(),name:`${document.name} · 粗剪`,revision:0,canvas:{...structuredClone(document.canvas),durationFrames:duration},source,instances:[],tracks:[],audioTracks:[],audioClips:[],styleReference:{contractPath:null,styleframePath:null,allowedOverrides:{}}};
}
export function roughcutProcess({inputPath,directory,sourceKey,onProgress,onSpawn=()=>{},onExit=()=>{},workflowRoot=WORKFLOW,signal}){
 return new Promise((done,fail)=>{
  const script=join(workflowRoot,'tools/roughcut_analyze.py'),output=join(directory,'analysis.json');
  if(!existsSync(script)){fail(Error('粗剪分析程序未安装'));return;}
  const runtime=join(workflowRoot,'workspace/roughcut-runtime'),alignPython=join(runtime,'.venv/bin/python'),model=join(runtime,'Qwen3-ForcedAligner-0.6B');
  const env={...process.env,PYTHONUNBUFFERED:'1',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'};
  if(existsSync(alignPython)&&existsSync(model)){env.ROUGHCUT_ALIGN_PYTHON??=alignPython;env.ROUGHCUT_ALIGN_MODEL??=model;}
  const child=spawn(process.env.EDITOR_ROUGHCUT_PYTHON??'python3',[script,'--audio',inputPath,'--out',output,'--work-dir',directory,'--source-key',sourceKey],{cwd:workflowRoot,env,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
  let tail='',buffer='',settled=false;const log=join(directory,'worker.log');if(child.pid)onSpawn(child.pid);
  const stop=()=>{try{process.kill(-child.pid,'SIGTERM');}catch{child.kill('SIGTERM');}};
  const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error){fail(error);return;}try{done(JSON.parse(readFileSync(output,'utf8')));}catch{fail(Error('粗剪进程结束但没有有效分析结果'));}};
  const abort=()=>{stop();finish(Error('粗剪分析已取消'));};
  const timer=setTimeout(()=>{stop();finish(Error('粗剪分析超时，已有转写缓存会保留，请重试'));},1800000);
  signal?.addEventListener('abort',abort,{once:true});
  child.stdout.on('data',b=>{const text=b.toString();appendFileSync(log,text);tail=(tail+text).slice(-5000);buffer+=text;const lines=buffer.split('\n');buffer=lines.pop()??'';for(const line of lines){try{const event=JSON.parse(line);if(typeof event.stage==='string')onProgress(event);}catch{}}});
  child.stderr.on('data',b=>{appendFileSync(log,b);tail=(tail+b.toString()).slice(-5000);});
  child.on('error',e=>finish(Error(`无法启动粗剪分析：${e.message}`)));
  child.on('close',code=>{onExit(code);}); child.on('close',code=>finish(code===0?null:Error(tail.trim().slice(-1200)||`粗剪进程退出 ${code}`)));
  if(signal?.aborted)abort();
 });
}
export function createRoughcutService({root=ROOT,publicRoot=join(root,'templates/remotion-base/public'),runner=roughcutProcess,alive=processAlive,digestCache=join(root,'workspace/media-digest-cache'),digest=path=>cachedFileSha256(path,{cacheDir:digestCache})}={}){
 const jobs=new Map(),base=join(root,'workspace/roughcut-jobs');
 function get(id){if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw Error('无效粗剪任务');let job=jobs.get(id);
  const stale=(j,reason)=>{j.status='failed';j.stage='stale';j.stale=true;j.error=reason;j.finishedAt=Date.now();atomic(join(base,id,'job.json'),j);return j;};
  if(!job&&existsSync(join(base,id,'job.json'))){job=JSON.parse(readFileSync(join(base,id,'job.json'),'utf8'));
   // Another live panel process may still own it: report its real persisted progress. Otherwise it is stale, not running.
   if(job.status==='running'&&!(job.ownerPid&&job.ownerPid!==process.pid&&alive(job.ownerPid)&&job.pid&&alive(job.pid)))stale(job,'服务已重启，'+STALE_JOB_ERROR);}
  else if(job?.status==='running'&&job.pid&&!alive(job.pid))stale(job,STALE_JOB_ERROR);
  if(!job)throw Error('找不到粗剪任务');return {...structuredClone(job),elapsedSeconds:Math.round(((job.finishedAt??Date.now())-job.startedAt)/1000)};}
 function start(document){
  const doc=structuredClone(document);if(!doc.source)throw Error('请先导入口播原片');if(doc.source.locked)throw Error('底片已锁定，请从原片新建粗剪副本');if(doc.roughcut)throw Error('已有粗剪结果，请先恢复原片或新建粗剪副本');
  if(doc.instances?.length||doc.audioClips?.length||doc.markers?.length||doc.source.cameraPlan||doc.productionPlan)throw Error('当前工程已有制作内容，请从原片新建粗剪副本');
  const clips=doc.source.clips;if(doc.source.startFrame!==0||(clips&&(clips.length!==1||clips[0].startFrame!==0||clips[0].sourceInFrame!==0||clips[0].durationFrames!==doc.canvas.durationFrames)))throw Error('当前底片已有剪辑，请从原片新建粗剪副本');
  const inputPath=sourcePath(doc,publicRoot),key=roughcutSourceKey(doc),before=identity(inputPath);
  const inputKey=JSON.stringify([key,doc.canvas,doc.captions??null,doc.instances??[],doc.tracks??[],doc.audioClips??[],doc.audioTracks??[],doc.markers??[]]);
  const active=[...jobs.values()].find(j=>j.status==='running');if(active){if(active.documentId===doc.id&&active.sourceKey===key&&active.identity===before&&active.inputKey===inputKey)return get(active.id);throw Error('已有口播正在分析，请完成后再开始');}
  const id=randomUUID(),directory=join(base,id);mkdirSync(directory,{recursive:true});const job={id,documentId:doc.id,baseRevision:doc.revision,sourceKey:key,inputKey,identity:before,startedAt:Date.now(),status:'running',stage:'preparing'};jobs.set(id,job);const persist=()=>atomic(join(directory,'job.json'),job);persist();atomic(join(directory,'source-document.json'),doc);
  setImmediate(async()=>{try{if(identity(inputPath)!==before)throw Error('原片在分析前发生变化，请重新导入');
   // Provenance hash runs alongside analysis (cached by exact file identity); both must finish on the unchanged file.
   const hashing=(async()=>digest(inputPath))();hashing.catch(()=>{});const result=await runner({inputPath,directory,sourceKey:key,onSpawn:pid=>{job.pid=pid;job.ownerPid=process.pid;persist();},onExit:()=>{delete job.pid;},onProgress:event=>{job.stage=event.stage;job.message=typeof event.message==='string'?event.message:undefined;persist();}});const mediaSha256=await hashing;checkAnalysis(result,key);if(Math.abs(result.sourceDurationSeconds-doc.canvas.durationFrames*doc.canvas.fps.den/doc.canvas.fps.num)>.15)throw Error('原片时长与当前工程不匹配，请从原片新建粗剪副本');if(identity(inputPath)!==before)throw Error('原片在分析期间发生变化，未应用粗剪');job.analysis={...result,mediaSha256};job.status='complete';job.stage='complete';}catch(e){job.status='failed';job.stage='failed';job.error=e.message;delete job.analysis;}finally{job.finishedAt=Date.now();persist();}});
  return get(id);
 }
 return {start,get};
}
const service=createRoughcutService();
export const startRoughcutAnalysis=doc=>service.start(doc);
export const getRoughcutAnalysis=id=>service.get(id);
