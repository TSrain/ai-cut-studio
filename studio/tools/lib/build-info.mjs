import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,readdirSync,statSync} from 'node:fs';
import {join,relative} from 'node:path';
// What a running panel server was built from, and whether the working tree has moved on.
// "Stale" = HEAD changed, or a watched source file is newer than the newest one at startup
// (startup itself regenerates catalogs/bundles, so those are part of the baseline).
export const WATCHED=['tools/build-asset-browser.mjs','tools/build-editor.mjs','tools/generate-editor-catalog.mjs','tools/lib','tools/editor','templates/remotion-base/src/editor'];
const SOURCE=/\.(mjs|js|ts|tsx|css|json|html)$/;
function git(root,args){const r=spawnSync('git',args,{cwd:root,encoding:'utf8',timeout:5000});return r.status===0?r.stdout.trim():null;}
export function newestSource(root,watched=WATCHED){
 let newest={mtimeMs:0,path:null};
 const visit=path=>{let s;try{s=statSync(path);}catch{return;}
  if(s.isDirectory()){for(const name of readdirSync(path)){if(name==='node_modules'||name.startsWith('.'))continue;visit(join(path,name));}return;}
  if(SOURCE.test(path)&&s.mtimeMs>newest.mtimeMs)newest={mtimeMs:s.mtimeMs,path:relative(root,path)};};
 for(const item of watched)visit(join(root,item));
 return newest;
}
export function captureBuildInfo(root,{bundle=join(root,'workspace/editor-app/main.js'),now=Date.now}={}){
 const head=git(root,['rev-parse','HEAD']),status=git(root,['status','--porcelain','--untracked-files=no']);
 let bundleInfo=null;
 if(existsSync(bundle)){const s=statSync(bundle);bundleInfo={path:relative(root,bundle),mtimeMs:s.mtimeMs,sha256:createHash('sha256').update(readFileSync(bundle)).digest('hex').slice(0,16)};}
 const baseline=newestSource(root);
 const info={head,dirty:status===null?null:status.length>0,startedAt:now(),pid:process.pid,bundle:bundleInfo,sourceBaseline:baseline};
 info.buildId=[head?.slice(0,12)??'nogit',info.dirty?'dirty':'clean',bundleInfo?.sha256??'nobundle'].join('-');
 return info;
}
export function buildStatus(info,current){
 const reasons=[];
 if(info.head&&current.head&&current.head!==info.head)reasons.push({kind:'head',message:`代码已切换到 ${current.head.slice(0,8)}（后台运行的是 ${info.head.slice(0,8)}）`});
 if(current.newestSource.mtimeMs>info.sourceBaseline.mtimeMs+1)reasons.push({kind:'source',message:`${current.newestSource.path} 在后台启动后有修改`});
 return {buildId:info.buildId,server:info,current,stale:reasons.length>0,reasons};
}
/** Cached checker for the lightweight endpoint (git + stat walk at most every ttl ms). */
export function createBuildStatus(root,info,{ttl=5000,now=Date.now}={}){
 let cached=null,at=0;
 return ()=>{if(!cached||now()-at>=ttl){cached=buildStatus(info,{head:git(root,['rev-parse','HEAD']),newestSource:newestSource(root)});at=now();}return cached;};
}
