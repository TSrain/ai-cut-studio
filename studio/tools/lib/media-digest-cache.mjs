import {createHash,randomUUID} from 'node:crypto';
import {createReadStream,mkdirSync,readFileSync,writeFileSync,renameSync,realpathSync,statSync} from 'node:fs';
import {join} from 'node:path';
// Full-content SHA-256 of a source file, persisted across restarts. The cache key is the exact
// filesystem identity (realpath, device, inode, size, mtime ns, ctime ns): replacing the file,
// writing in place or restoring an old mtime all change ctime/inode and force a full re-hash.
// The digest itself is always a full hash, never a partial one, because callers use it as a
// content address (caption cache directory) and as analysis provenance (mediaSha256).
export const fileIdentity=path=>{const s=statSync(path,{bigint:true});return [s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');};
const memory=new Map();
async function streamSha256(path){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
export function digestCacheEntry(cacheDir,actual,identity){
 const key=createHash('sha256').update(JSON.stringify([actual,identity])).digest('hex');
 return join(cacheDir,key.slice(0,2),key+'.json');
}
export async function cachedFileSha256(path,{cacheDir,hash=streamSha256}={}){
 if(!cacheDir)throw Error('cacheDir required');
 const actual=realpathSync(path),identity=fileIdentity(actual),entry=digestCacheEntry(cacheDir,actual,identity);
 const remembered=memory.get(entry);if(remembered)return remembered;
 try{const saved=JSON.parse(readFileSync(entry,'utf8'));if(saved.path===actual&&saved.identity===identity&&/^[a-f0-9]{64}$/.test(saved.sha256)&&fileIdentity(actual)===identity){memory.set(entry,saved.sha256);return saved.sha256;}}catch{}
 const sha256=await hash(actual);
 if(realpathSync(path)!==actual||fileIdentity(actual)!==identity)throw Error('原片在计算校验值期间发生变化，请重新导入');
 try{mkdirSync(join(entry,'..'),{recursive:true});const tmp=entry+'.'+randomUUID()+'.tmp';writeFileSync(tmp,JSON.stringify({path:actual,identity,sha256,computedAt:Date.now()}));renameSync(tmp,entry);}catch{}
 memory.set(entry,sha256);if(memory.size>4096)memory.delete(memory.keys().next().value);
 return sha256;
}
