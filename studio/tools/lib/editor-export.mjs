import {resolveSceneBackground} from '../../templates/remotion-base/src/editor/scene-background.mjs';
import {validatePresenterAssets} from './presenter-foreground.mjs';
import {validateCoverAsset} from './editor-cover-selection.mjs';
import {stageEditorSource} from './editor-media.mjs';
import {projectSourceRange} from '../../templates/remotion-base/src/editor/clip-time.mjs';
import {editorDeliveryDirectory} from './editor-delivery.mjs';
import {readExportProgress} from './editor-export-progress.mjs';
import {homedir} from 'node:os';
import {cameraClips,clipEnd} from '../../templates/remotion-base/src/editor/camera-clips.mjs';
import {constants as fsConstants} from 'node:fs';
import {validateEditorProps} from './editor-props.mjs';
import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  readdirSync,
  renameSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  cpSync,
  copyFileSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {editorAssetBackgroundMode} from './preset-catalog.mjs';
const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const TPL = join(ROOT, "templates/remotion-base");
const safeId = (id) => {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(id))
    throw new Error("无效的实例或项目 ID");
  return id;
};
export function planEditorExport(document, mode, target) {
  if (!["full", "layer", "instances", "clip", "single-layer"].includes(mode))
    throw new Error("未知导出方式");
  const fps = document.canvas.fps.num / document.canvas.fps.den;
  if (!(fps > 0)) throw new Error("帧率无效");
  if(mode==='single-layer'){
    if(target?.kind!=='instance')throw Error('镜头效果作用于底片，请选择该时段全部图层');
    safeId(target.id);
    const instance=document.instances.find(i=>i.id===target.id);
    if(!instance)throw Error('模块不存在');
    const [item]=planEditorExport({...document,instances:[instance]},'instances');
    return [{...item,title:String(instance.props?.label??instance.assetId)}];
  }
  if(mode==='clip'){
    if(!target||!['instance','camera'].includes(target.kind))throw Error('请选择要导出的模块');
    safeId(target.id);
    let start,end,title;
    if(target.kind==='instance'){
      const item=document.instances.find(i=>i.id===target.id);if(!item)throw Error('模块不存在');
      start=item.startFrame;end=start+item.durationFrames;title=item.props?.label??item.assetId;
    }else{
      const item=cameraClips(document.source?.cameraPlan).find(i=>i.id===target.id);if(!item)throw Error('镜头块不存在');
      const source=document.source,offset=source?.startFrame??0;
      const ranges=projectSourceRange(source,offset+Math.round(item.start*fps),offset+Math.round(clipEnd(item)*fps),document.canvas.durationFrames);
      const explicit=target.rangeStartFrame!==undefined||target.durationFrames!==undefined;
      let range;
      if(explicit){
        if(!Number.isInteger(target.rangeStartFrame)||!Number.isInteger(target.durationFrames)||target.durationFrames<=0)throw Error('镜头片段时间范围无效');
        range=ranges.find(r=>r.startFrame===target.rangeStartFrame&&r.endFrame-r.startFrame===target.durationFrames);
        if(!range)throw Error('镜头片段范围与当前源视频映射不符，请重新选择');
      }else{
        if(ranges.length!==1)throw Error(ranges.length?'镜头有多个片段，请选择具体片段导出':'镜头在当前时间轴没有可导出片段');
        range=ranges[0];
      }
      start=range.startFrame;end=range.endFrame;title=item.name;
    }
    end=Math.min(end,document.canvas.durationFrames);
    if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start)throw Error('模块时间范围无效');
    return [{id:safeId(target.id),title:String(title??target.id),filename:`${safeId(target.id)}.mp4`,extension:'mp4',renderMode:'full',rangeStartFrame:start,durationFrames:end-start,sourceStartSeconds:start/fps,sourceEndSeconds:end/fps,canvas:document.canvas,status:'pending'}];
  }
  const rows =
    mode === "instances"
      ? document.instances.map((i) => ({
          id: safeId(i.id),
          instanceId: i.id,
          assetId: i.assetId,
          assetVersion: i.assetVersion,
          rangeStartFrame: i.startFrame,
          durationFrames: i.durationFrames,
          extension: editorAssetBackgroundMode(i.assetId, i.props) === 'transparent' ? 'mov' : 'mp4',
        }))
      : [
          {
            id: mode,
            rangeStartFrame: 0,
            durationFrames: document.canvas.durationFrames,
            extension: mode === "full" ? "mp4" : "mov",
          },
        ];
  return rows.map((row) => ({
    ...row,
    filename: `${row.id}.${row.extension}`,
    renderMode: mode,
    sourceStartSeconds:
      (row.rangeStartFrame * document.canvas.fps.den) / document.canvas.fps.num,
    sourceEndSeconds:
      ((row.rangeStartFrame + row.durationFrames) * document.canvas.fps.den) /
      document.canvas.fps.num,
    canvas: document.canvas,
    status: "pending",
  }));
}
export function exportDocumentForItem(document,item){
  const end=item.rangeStartFrame+item.durationFrames;
  const overlaps=c=>c.startFrame<end&&c.startFrame+c.durationFrames>item.rangeStartFrame;
  const instances=document.instances.filter(i=>!i.disabled&&!document.tracks?.some(t=>t.id===i.trackId&&t.disabled)&&(item.instanceId?i.id===item.instanceId:overlaps(i)));
  const audioClips=(document.audioClips??[]).filter(a=>item.renderMode==='full'&&!a.muted&&!document.audioTracks?.some(t=>t.id===a.trackId&&t.disabled)&&overlaps(a));
  const videoBackground=instances.some(i=>resolveSceneBackground(i.props??{})?.type==='video-blur');
  if(videoBackground&&!document.source)throw Error('动态模糊视频背景需要先添加口播底片');
  const needsSource=videoBackground||item.renderMode==='full'||instances.some(i=>i.assetId==='source-pip'&&i.props?.sourceMode!=='media');
  return {...document,instances,...(document.audioClips?{audioClips}:{}),source:needsSource?document.source:null};
}
// Trim only an export snapshot; disabled or unrelated media stays in the saved project.
export function prepareExportDocument(document,mode,target){
  const snapshots=planEditorExport(document,mode,target).map(item=>exportDocumentForItem(document,item));
  const instances=new Set(snapshots.flatMap(d=>d.instances.map(i=>i.id)));
  const audio=new Set(snapshots.flatMap(d=>(d.audioClips??[]).map(a=>a.id)));
  // Roughcut restoration is editor-only; export the current editable timeline and captions.
  const {roughcut: _roughcut, ...renderDocument}=document;
  return {...renderDocument,instances:document.instances.filter(i=>instances.has(i.id)),source:snapshots.some(d=>d.source)?document.source:null,...(document.audioClips?{audioClips:document.audioClips.filter(a=>audio.has(a.id))}:{})};
}
const jobs = new Map();
const activeProcesses = new Map();
export function cancelEditorExport(id){
  const job=jobs.get(id);
  if(!job)throw Error('找不到导出任务');
  if(!['running','cancelling'].includes(job.status))return structuredClone(job);
  if(job.status==='cancelling')return structuredClone(job);
  const queued=waiting.findIndex(x=>x.job.id===id);
  if(queued>=0)waiting.splice(queued,1);
  const child=activeProcesses.get(id);
  job.status=child?'cancelling':'cancelled';
  for(const item of job.items)if(!['complete','failed'].includes(item.status))item.status=job.status;
  saveJob(job);
  if(child){
    const signal=(sig)=>{try{process.kill(-child.pid,sig);}catch(e){if(e.code!=='ESRCH')throw e;}};
    signal('SIGTERM');
    // Only this export owns the detached process group; never touch UI browsers.
    const timer=setTimeout(()=>{signal('SIGKILL');},2000);timer.unref();
  }
  return structuredClone(job);
}
const saveJob = (job) => {
  const path=join(job.directory,'manifest.json'),temporary=path+'.tmp';
  writeFileSync(temporary,JSON.stringify({...job,process:undefined},null,2));renameSync(temporary,path);
};
function restoreJob(id){
 safeId(id);const projects=join(ROOT,'workspace/editor-projects');
 if(!existsSync(projects))return null;
 for(const entry of readdirSync(projects,{withFileTypes:true})){
  if(!entry.isDirectory())continue;
  const path=join(projects,entry.name,'exports',id,'manifest.json');
  if(!existsSync(path))continue;
  const job=JSON.parse(readFileSync(path));if(job.id!==id)throw Error('导出任务身份不符');
  jobs.set(id,job);return job;
 }return null;
}
export async function getEditorJob(id) {
  let job = jobs.get(id)??restoreJob(id);
  if (!job) throw new Error("找不到导出任务；请重新发起导出");
  if(!activeProcesses.has(id)&&existsSync(join(job.directory,'manifest.json')))job=JSON.parse(readFileSync(join(job.directory,'manifest.json')));
  if(job.status==='running'&&job.workerPid&&!activeProcesses.has(id)){
   let live=true;try{process.kill(job.workerPid,0);}catch(e){if(e.code==='ESRCH')live=false;}
   if(!live){
    let rows=[];try{rows=JSON.parse(readFileSync(join(job.directory,'queue.results.json'))).results;}catch{}
    for(const item of job.items){if(item.status==='complete')continue;
     if(rows.some(r=>r.id===item.id&&r.status==='passed')){try{item.verified=verifyOutput(item);if(item.deliveryPath&&!existsSync(item.deliveryPath)){mkdirSync(resolve(item.deliveryPath,'..'),{recursive:true});copyFileSync(item.path,item.deliveryPath,fsConstants.COPYFILE_EXCL|fsConstants.COPYFILE_FICLONE);}item.status='complete';item.progress=1;}catch(e){item.status='failed';item.error=e.message;}}
     else{item.status='failed';item.error='导出进程已中断；未完成文件不会交付';}
    }job.status=job.items.every(i=>i.status==='complete')?'complete':'failed';saveJob(job);
   }
  }
  jobs.set(id,job);
  const snapshot = structuredClone(job);
  if (snapshot.status === 'running') await Promise.all(snapshot.items.map(async item => {
    if (['complete','failed'].includes(item.status)) return;
    const logPath = join(job.directory, 'queue.logs', item.id + '.log');
    const active = job.startedAt && existsSync(logPath) && statSync(logPath).mtimeMs >= job.startedAt;
    if (!active) { item.status='pending'; item.telemetry={stage:'queued',elapsedSeconds:0}; return; }
    item.status='rendering';
    item.telemetry=await readExportProgress(logPath,{startedAt:Math.max(job.startedAt,statSync(logPath).birthtimeMs),durationFrames:item.durationFrames});
  }));
  return snapshot;
}
export function startEditorExport(document, mode, { root = ROOT, target, artifactRoot=process.env.PRODUCTION_PLAN_ARTIFACT_ROOT||join(ROOT, "../output") } = {}) {
  document=prepareExportDocument(document,mode,target);
  if(document.audioClips?.length)document=stageEditorSource(document,{root});
  // Guard every caller before copying the project or launching the render queue.
  const fps=document.canvas.fps.num/document.canvas.fps.den;
  const items=planEditorExport(document,mode,target);
  for(const item of items)validatePresenterAssets(exportDocumentForItem(document,item),{publicRoot:join(TPL,'public'),renderMode:item.renderMode});
  if(items.some(item=>item.renderMode==='full'&&item.rangeStartFrame===0))validateCoverAsset(document.cover,join(TPL,'public'));
  const relevant=[...new Map(items.flatMap(item=>exportDocumentForItem(document,item).instances).map(i=>[i.id,i])).values()];
  for(const instance of relevant) validateEditorProps({...instance,durationFrames:instance.sourceDurationFrames??instance.durationFrames},document.canvas.durationFrames,{requireAssets:true,fps,publicRoot:join(TPL,'public')});
  const id = randomUUID();
  const directory = join(
    root,
    "workspace/editor-projects",
    safeId(document.id),
    "exports",
    id,
  );
  mkdirSync(directory, { recursive: true });
  const build = join(directory, "build");
  mkdirSync(build);
  cpSync(join(TPL, "src"), join(build, "src"), { recursive: true });
  for (const name of ["package.json", "tsconfig.json", "remotion.config.ts"])
    copyFileSync(join(TPL, name), join(build, name));
  symlinkSync(join(TPL, "node_modules"), join(build, "node_modules"), "dir");
  symlinkSync(join(TPL, "public"), join(build, "public"), "dir");
  const job = {
    createdAt: Date.now(),
    id,
    documentId: document.id,
    revision: document.revision,
    mode,
    directory,
    status: "running",
    items,
  };
  writeFileSync(
    join(directory, "document.json"),
    JSON.stringify(document, null, 2),
  );
  for (const item of job.items) {
    item.path = join(directory, item.filename);
    item.url =
      "/" +
      item.path
        .slice(root.length + 1)
        .split("\\")
        .join("/");
    {
      const deliveryDirectory=editorDeliveryDirectory(document,mode,artifactRoot);
      const label=String(item.title??document.name??item.id).replace(/[\/\\:*?"<>|\x00-\x1f]/g,'-').slice(0,40);
      const seconds=Math.floor(item.sourceStartSeconds);
      const stamp=`${String(Math.floor(seconds/60)).padStart(2,'0')}分${String(seconds%60).padStart(2,'0')}秒`;
      item.deliveryPath=join(deliveryDirectory,`${stamp}-${label}-${item.instanceId?'单层':'合成'}-${item.id.slice(0,32)}-${id.slice(0,8)}.${item.extension}`);
    }
    const props = {
      document: exportDocumentForItem(document,item),
      renderMode: item.renderMode,
      instanceId: item.instanceId,
      rangeStartFrame: item.rangeStartFrame,
      renderDurationFrames: item.durationFrames,
    };
    writeFileSync(
      join(directory, `${item.id}.props.json`),
      JSON.stringify(props),
    );
  }
  if (existsSync(join(TPL,"package-lock.json"))) copyFileSync(join(TPL,"package-lock.json"),join(build,"package-lock.json"));
  jobs.set(id, job);
  saveJob(job);
  run(job, root);
  return structuredClone(job);
}
export function retryEditorExport(id, { root = ROOT } = {}) {
  const job = jobs.get(id);
  if (!job) throw new Error("任务不存在");
  if (["running","cancelling"].includes(job.status)) throw new Error("任务仍在导出");
  if (!job.items.some((i) => i.status === "failed"))
    throw new Error("没有失败项");
  job.items
    .filter((i) => i.status === "failed")
    .forEach((i) => {
      i.status = "pending";
      delete i.error;
      delete i.progress;
      delete i.telemetry;
      rmSync(join(job.directory,"queue.logs",i.id+".log"),{force:true});
    });
  job.status = "running";
  delete job.startedAt;
  saveJob(job);
  run(job, root);
  return structuredClone(job);
}
function verifyOutput(item) {
  const data = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,pix_fmt,duration,nb_frames:format=duration",
        "-of",
        "json",
        item.path,
      ],
      { encoding: "utf8", timeout: 30000 },
    ),
  );
  const stream = data.streams?.[0];
  if (
    !stream ||
    stream.width !== item.canvas.width ||
    stream.height !== item.canvas.height
  )
    throw new Error("导出画幅不符合编辑文档");
  const fps = item.canvas.fps.num / item.canvas.fps.den;
  const duration = Number(stream.duration ?? data.format?.duration);
  if (
    !Number.isFinite(duration) ||
    Math.abs(duration - item.durationFrames / fps) > 1.1 / fps
  )
    throw new Error("导出时长不符合实例区间");
  if (
    item.extension === "mov" &&
    !/^(yuva|rgba|argb|bgra|abgr|gbrap)/.test(stream.pix_fmt)
  )
    throw new Error("透明导出没有 alpha 通道");
  return {
    width: stream.width,
    height: stream.height,
    pixelFormat: stream.pix_fmt,
    durationSeconds: duration,
  };
}
const waiting = [];
let rendering = false;
function run(job, root) {
  waiting.push({ job, root });
  pump();
}
function pump() {
  if (rendering || !waiting.length) return;
  rendering = true;
  const { job, root } = waiting.shift();
  execute(job, root);
}
function execute(job, root) {
  job.startedAt=Date.now();
  saveJob(job);
  const pending = job.items.filter((i) => i.status === "pending");
  const queue = pending.map((item) => ({
    id: item.id,
    cwd: join(job.directory, "build"),
    command: [process.execPath,join(root,'tools/editor-export-worker.mjs'),job.directory,item.id],
    expectedOutput: item.path,
  }));
  const queuePath = join(job.directory, "queue.json");
  writeFileSync(queuePath, JSON.stringify(queue, null, 2));
  const child = spawn(
    process.execPath,
    [join(root, "tools/render-queue.mjs"), queuePath, "--concurrency", "2"],
    { cwd: root, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  activeProcesses.set(job.id,child);job.workerPid=child.pid;job.ownerPid=process.pid;saveJob(job);
  let log = "";
  const capture = (buf) => {
    log = (log + buf.toString()).slice(-20000);
    for (const item of pending) {
      if (job.status!=="running")continue;
      if (existsSync(item.path) && statSync(item.path).size > 0)
        item.status = "rendering";
    }
    saveJob(job);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  let finished = false;
  const finish = async (error) => {
    if (finished) return;
    finished = true;
    if(job.status==='cancelling'){
      for(const item of pending){item.status='cancelled';rmSync(item.path,{force:true});}
      job.status='cancelled';activeProcesses.delete(job.id);saveJob(job);rendering=false;pump();return;
    }
    const resultsPath = join(job.directory, "queue.results.json");
    let results = [];
    try {
      results = JSON.parse(readFileSync(resultsPath, "utf8")).results;
    } catch {}
    for (const item of pending) {
      const logPath = `${queuePath.slice(0, -5)}.logs/${item.id}.log`;
      const itemLog = existsSync(logPath) ? readFileSync(logPath, "utf8") : log;
      // The queue's per-item result, not an intermediate partial video, is authoritative.
      const ok =
        !error &&
        results.some((r) => r.id === item.id && r.status === "passed");
      item.telemetry=await readExportProgress(logPath,{startedAt:job.startedAt,durationFrames:item.durationFrames});
      if(job.status==='cancelling'){item.status='cancelled';rmSync(item.path,{force:true});continue;}
      item.status = ok ? "complete" : "failed";
      if (ok) {
        try {
          item.verified = verifyOutput(item);
          if(item.deliveryPath){mkdirSync(resolve(item.deliveryPath,'..'),{recursive:true});copyFileSync(item.path,item.deliveryPath,fsConstants.COPYFILE_EXCL|fsConstants.COPYFILE_FICLONE);}
          item.progress = 1;
          item.telemetry={...item.telemetry,stage:"complete"};
        } catch (e) {
          item.status = "failed";
          item.error = e.message;
        }
      } else item.error = itemLog.slice(-3000) || String(error || "导出未完成");
    }
    activeProcesses.delete(job.id);
    job.status = job.status==='cancelling' ? 'cancelled' : job.items.every((i) => i.status === "complete")
      ? "complete"
      : "failed";
    writeFileSync(join(job.directory, "queue.log"), log);
    saveJob(job);
    rendering = false;
    pump();
  };
  child.on("error", finish);
  child.on("close", () => finish(null));
}
