import {createHash,randomUUID} from 'node:crypto';
import {existsSync,readFileSync,readdirSync,statSync,mkdirSync,writeFileSync,renameSync,rmSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
const CACHE_VERSION='editor-bundle-v1';
export function bundleFingerprint(buildRoot){
 const hash=createHash('sha256').update(CACHE_VERSION);
 const add=(label,path)=>{if(existsSync(path)){hash.update(label+'\0');hash.update(readFileSync(path));hash.update('\0');}};
 const walk=(dir,rel='')=>{for(const name of readdirSync(dir).sort()){const path=join(dir,name),key=join(rel,name);if(statSync(path).isDirectory())walk(path,key);else add('src/'+key,path);}};
 walk(join(buildRoot,'src'));
 for(const name of ['package.json','package-lock.json','tsconfig.json','remotion.config.ts','remotion.config.js'])add(name,join(buildRoot,name));
 const modules=join(buildRoot,'node_modules');add('installed-lock',join(modules,'.package-lock.json'));
 const pkg=JSON.parse(readFileSync(join(buildRoot,'package.json'),'utf8'));
 for(const name of Object.keys({...pkg.dependencies,...pkg.devDependencies}).sort())add('installed/'+name,join(modules,name,'package.json'));
 return hash.digest('hex');
}
const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}};
export async function ensureExportBundle({buildRoot,cacheRoot,build,onWait=()=>{}}){
 // Assets stay local and live via a symlink; never reuse a stale public-folder copy.
 const publicRoot=realpathSync(join(buildRoot,'public'));
 const key=createHash('sha256').update(bundleFingerprint(buildRoot)).update(publicRoot).digest('hex');
 mkdirSync(cacheRoot,{recursive:true});
 const path=join(cacheRoot,key),lock=path+'.lock';
 const ready=()=>existsSync(join(path,'.ready.json'))&&existsSync(join(path,'index.html'));
 const started=Date.now();
 while(true){
  if(ready())return {path,key,hit:true};
  try{mkdirSync(lock);writeFileSync(join(lock,'owner.json'),JSON.stringify({pid:process.pid}));break;}
  catch(e){
   if(e.code!=='EEXIST')throw e;
   try{const owner=JSON.parse(readFileSync(join(lock,'owner.json'),'utf8'));if(!alive(owner.pid)){rmSync(lock,{recursive:true,force:true});continue;}}
   catch{if(existsSync(lock)&&Date.now()-statSync(lock).mtimeMs>10000){rmSync(lock,{recursive:true,force:true});continue;}}
   if(Date.now()-started>300000)throw Error('等待编译缓存超过 5 分钟');
   onWait();await new Promise(r=>setTimeout(r,100));
  }
 }
 const staging=path+'.tmp-'+randomUUID();
 try{
  if(ready())return {path,key,hit:true};
  mkdirSync(staging);
  await build(staging,publicRoot);
  if(!existsSync(join(staging,'index.html')))throw Error('编译未生成 index.html');
  writeFileSync(join(staging,'.ready.json'),JSON.stringify({key,publicRoot}));
  if(existsSync(path))rmSync(path,{recursive:true,force:true});
  renameSync(staging,path);
  return {path,key,hit:false};
 }finally{rmSync(staging,{recursive:true,force:true});rmSync(lock,{recursive:true,force:true});}
}
