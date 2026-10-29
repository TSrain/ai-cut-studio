import {createHash} from 'node:crypto';
import {openSync,closeSync,readSync,fstatSync,statSync,realpathSync} from 'node:fs';
// Cache only verified bytes belonging to one exact filesystem identity. File
// replacement, in-place writes, restored mtimes and symlink retargeting invalidate
// it. Small fixed read buffers avoid repeatedly allocating entire source videos.
const identity=stat=>[stat.dev,stat.ino,stat.mode,stat.size,stat.mtimeNs,stat.ctimeNs,stat.birthtimeNs].join(':');
export function createVerifiedFileDigest({maxEntries=4096,read=readSync}={}){
  if(!Number.isInteger(maxEntries)||maxEntries<1)throw new Error('Invalid digest cache size');
  const cache=new Map();
  return function verifiedFileDigest(path){
    const actual=realpathSync(path),before=statSync(actual,{bigint:true});
    if(!before.isFile())throw new Error('Digest requires a regular file');
    const signature=identity(before),cached=cache.get(actual);
    const current=()=>realpathSync(path)===actual&&identity(statSync(actual,{bigint:true}))===signature;
    if(cached?.signature===signature&&current()){
      cache.delete(actual);cache.set(actual,cached);return cached.digest;
    }
    cache.delete(actual);
    const fd=openSync(actual,'r'),hash=createHash('sha256'),buffer=Buffer.alloc(1024*1024);
    try{
      if(identity(fstatSync(fd,{bigint:true}))!==signature)throw new Error('File changed before digest verification');
      let bytes=0,count;
      while((count=read(fd,buffer,0,buffer.length,null))){bytes+=count;hash.update(buffer.subarray(0,count));}
      if(BigInt(bytes)!==before.size||identity(fstatSync(fd,{bigint:true}))!==signature||!current())throw new Error('File changed during digest verification');
      const digest=hash.digest('hex');cache.set(actual,{signature,digest});
      while(cache.size>maxEntries)cache.delete(cache.keys().next().value);
      return digest;
    }finally{closeSync(fd);}
  };
}
export const verifiedFileDigest=createVerifiedFileDigest();
