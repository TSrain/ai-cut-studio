import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync,writeFileSync,renameSync,mkdirSync,lstatSync,realpathSync} from 'node:fs';
import {join,relative} from 'node:path';
import {randomUUID} from 'node:crypto';

const exec=promisify(execFile), states=new Map();
function cachePath(root,create=false){
  // Do not follow workspace/cache symlinks or recreate a removed test/project root.
  if(!lstatSync(root).isDirectory())throw Error('Invalid cache root');
  let dir=root;
  for(const part of ['workspace','.cache']){
    dir=join(dir,part);
    try {const s=lstatSync(dir);if(s.isSymbolicLink()||!s.isDirectory())throw Error('Invalid cache directory');}
    catch(e){if(e.code!=='ENOENT'||!create)throw e;mkdirSync(dir);}
  }
  const path=join(dir,'studio-audio-durations.json');
  try {if(lstatSync(path).isSymbolicLink())throw Error('Invalid cache file');}catch(e){if(e.code!=='ENOENT')throw e;}
  return path;
}
function stateFor(root){
  if(states.has(root))return states.get(root);
  let entries={};
  try {const data=JSON.parse(readFileSync(cachePath(root),'utf8'));if(data.version===1)entries=data.entries??{};}catch{}
  const state={root,entries,jobs:new Map(),queue:[],active:0,dirty:false};
  states.set(root,state);
  return state;
}
function persist(state){
  if(!state.dirty)return;
  try {
    const path=cachePath(state.root,true),temp=path+'.'+randomUUID()+'.tmp';
    writeFileSync(temp,JSON.stringify({version:1,entries:state.entries}),{flag:'wx'});
    renameSync(temp,path);state.dirty=false;
  }catch{} // Cache failure must never prevent browsing assets.
}
function pump(state){
  while(state.active<4&&state.queue.length){
    const task=state.queue.shift();state.active++;
    void (async()=>{
      let duration=null;
      try {
        const {stdout}=await exec('ffprobe',['-v','error','-select_streams','a:0','-show_entries','stream=duration:format=duration','-of','json',task.absolute],{timeout:10000,maxBuffer:1024*1024});
        const data=JSON.parse(stdout),value=Number(data.streams?.[0]?.duration??data.format?.duration);
        if(data.streams?.length&&Number.isFinite(value)&&value>0)duration=value;
      }catch{}
      // The listing validates this fingerprint again if a file changes during probing.
      state.entries[task.key]={stamp:task.stamp,duration};state.dirty=true;
      state.jobs.delete(task.jobKey);state.active--;task.resolve();
      pump(state);
      if(state.active===0)persist(state);
    })();
  }
}
/** File existence and allowed path boundaries are checked by the caller. Never probes synchronously. */
export function cachedAudioDuration(root,absolute,stat){
  const state=stateFor(root),key=relative(root,absolute),stamp=`${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  const cached=state.entries[key];
  if(cached?.stamp===stamp&&(cached.duration===null||Number.isFinite(cached.duration)))return {duration:cached.duration??undefined,pending:false};
  const jobKey=key+':'+stamp;
  if(!state.jobs.has(jobKey)){
    let resolveJob;const promise=new Promise(resolve=>{resolveJob=resolve;});
    state.jobs.set(jobKey,promise);
    state.queue.push({key,stamp,absolute,jobKey,resolve:resolveJob});pump(state);
  }
  return {duration:undefined,pending:true};
}
/** Used by indexing/verification jobs, never by the interactive list endpoint. */
export async function waitForAudioDurations(root){
  root=realpathSync(root);
  const state=states.get(root);if(!state)return;
  while(state.jobs.size)await Promise.all([...state.jobs.values()]);
  persist(state);
}
