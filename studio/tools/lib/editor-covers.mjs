import {existsSync,readdirSync,readFileSync,realpathSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,relative,resolve,isAbsolute,sep,dirname} from 'node:path';

const readJson=path=>JSON.parse(readFileSync(path,'utf8'));
const hashes=new Map();
function hashFile(path){
 const stat=statSync(path),key=`${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
 if(hashes.get(path)?.key===key)return hashes.get(path).hash;
 const hash=createHash('sha256').update(readFileSync(path)).digest('hex');
 if(hashes.size>500)hashes.clear();hashes.set(path,{key,hash});return hash;
}
function inside(root,path){
 const base=realpathSync(root),file=realpathSync(path),rel=relative(base,file);
 if(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw new Error('封面路径超出运行目录');
 return file;
}
function directories(path){return existsSync(path)?readdirSync(path,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>join(path,x.name)):[];}
export function coverEpisode(doc){
 const ids=new Set([doc.id,doc.name,doc.styleReference?.contractPath,doc.source?.path].flatMap(x=>typeof x==='string'?[...x.matchAll(/\bSC-\d+\b/g)].map(m=>m[0]):[]));
 return ids.size===1?[...ids][0]:null;
}
function readRun(coversRoot,run){
  try{
   inside(coversRoot,run);
   const manifestPath=inside(run,join(run,'manifest.json')),manifest=readJson(manifestPath);
   const report=readJson(inside(run,join(run,'validation.json'))),source=readJson(inside(run,join(run,'source.json')));
   if(manifest.schema_version!==2||manifest.status!=='awaiting_selection'||!report.candidate_ready||!report.machine_passed||!report.agent_visual_attestation_passed||!report.agent_semantic_attestation_passed||report.errors?.length||!manifest.groups?.length)return [];
   if(manifest.expected_groups!==manifest.groups.length)return [];
   const groups=manifest.groups.map(group=>{
    if(!group.visual_review?.passed||!group.semantic_review?.passed)throw new Error('封面尚未通过检查');
    const images=Object.fromEntries(['3:4','4:3'].map(ratio=>{
     const path=inside(run,resolve(run,group.images[ratio]));
     if(!path.endsWith('.png')||!statSync(path).isFile())throw new Error('封面文件缺失');
     return [ratio,path];
    }));
    return {id:group.id,title:group.title,hook:group.hook||'',images};
   });
   return [{id:createHash('sha256').update(relative(coversRoot,run)).digest('hex').slice(0,24),name:relative(coversRoot,run),updatedAt:statSync(manifestPath).mtimeMs,status:'awaiting_selection',source,groups}];
  }catch{return [];}
}
function readRuns(coversRoot){
 return directories(coversRoot).flatMap(directories).flatMap(run=>readRun(coversRoot,run)).sort((a,b)=>b.updatedAt-a.updatedAt||b.name.localeCompare(a.name));
}

// Package candidates reuse the validated complete cover workflow, not loose PNG files.
function readPackageCovers(doc,artifactRoot,coversRoot){
 try{
  const binding=doc.projectBinding;
  if(binding?.projectId!==doc.id||binding.version!==1||!isAbsolute(binding.projectRoot)||!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(doc.id))return [];
  const projectRoot=inside(artifactRoot,binding.projectRoot);
  if(projectRoot===realpathSync(artifactRoot))return [];
  const jobs=join(projectRoot,'.制作资料','剪辑工程',doc.id,'任务'),validated=readRuns(coversRoot);
  return directories(jobs).flatMap(job=>{
   try{
    inside(projectRoot,job);
    const output=inside(job,join(job,'output'));
    const receipt=readJson(inside(output,join(output,'production','cover-receipt.json')));
    if(receipt.schemaVersion!==1||receipt.branch!=='cover'||receipt.projectId!==doc.id||receipt.runId!==job.split(sep).pop()||receipt.status!=='executed'||(receipt.acceptance&&(receipt.acceptance.technical!=='passed'||receipt.acceptance.visual!=='passed'))||!receipt.coverCandidateManifestPath)return [];
    // v2 cover workers write into their own attempt, outside the legacy cover library.
    let manifestPath,local=false;
    try{manifestPath=inside(output,receipt.coverCandidateManifestPath);local=true;}
    catch{manifestPath=inside(coversRoot,receipt.coverCandidateManifestPath);}
    const boundFiles=new Map((receipt.files||[]).map(file=>[realpathSync(file.path),file.sha256]));
    if(boundFiles.get(manifestPath)!==hashFile(manifestPath))return [];
    const name=relative(coversRoot,manifestPath).slice(0,-'/manifest.json'.length);
    const run=local?readRun(output,dirname(manifestPath))[0]:validated.find(run=>run.name===name);
    if(!run||run.groups.length<3||run.groups.length>5)return [];
    if(local){
     const files=[manifestPath,join(dirname(manifestPath),'source.json'),join(dirname(manifestPath),'validation.json'),...run.groups.flatMap(group=>Object.values(group.images))];
     if(files.some(path=>boundFiles.get(path)!==hashFile(path)))return [];
     run.id=createHash('sha256').update(manifestPath).digest('hex').slice(0,24);
     run.name=relative(projectRoot,dirname(manifestPath));
    }
    return [run];
   }catch{return [];}
  });
 }catch{return [];}
}
export function listProjectCovers(doc,{coversRoot,artifactRoot,source:explicitSource}={}){
 const episode=coverEpisode(doc),runs=readRuns(coversRoot);
 let deliveredHashes;
 const matchesDelivery=run=>{
  if(!episode)return false;
  const directory=join(artifactRoot,episode,'封面');
  if(!existsSync(directory))return false;
  if(!deliveredHashes){deliveredHashes=new Set(readdirSync(directory).filter(x=>x.toLowerCase().endsWith('.png')).flatMap(x=>{try{return [hashFile(inside(directory,join(directory,x)))];}catch{return [];} }));}
  return run.groups.every(group=>Object.values(group.images).every(path=>deliveredHashes.has(hashFile(path))));
 };
 const matching=runs.filter(run=>explicitSource
  ? (/^SC-\d+$/.test(explicitSource)?run.source.source_id===explicitSource:run.source.source_type==='file'&&run.source.original_path===explicitSource)
  : (episode&&run.source.source_id===episode)||(!run.source.source_id&&matchesDelivery(run)));
 const candidates=[...new Map([...matching,...readPackageCovers(doc,artifactRoot,coversRoot)].map(run=>[run.id,run])).values()].sort((a,b)=>b.updatedAt-a.updatedAt);
 return {episode,source:explicitSource||(matching[0]?.source.source_type==='file'?matching[0].source.original_path:episode)||'',runs:candidates};
}
export function resolveCoverImage(doc,{runId,groupId,ratio},options){
 const listing=listProjectCovers(doc,options),run=listing.runs.find(x=>x.id===runId),group=run?.groups.find(x=>x.id===groupId);
 const path=['3:4','4:3'].includes(ratio)&&group?.images[ratio];
 if(!path)throw new Error('封面不存在或不属于当前项目，请刷新后重试');
 return path;
}
