import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,renameSync,utimesSync,statSync,readdirSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {cachedFileSha256,digestCacheEntry,fileIdentity} from '../lib/media-digest-cache.mjs';
import {createRoughcutService} from '../lib/roughcut-jobs.mjs';
const sha=text=>createHash('sha256').update(text).digest('hex');
function setup(t){const root=realpathSync(mkdtempSync(join(tmpdir(),'digest-cache-')));t.after(()=>rmSync(root,{recursive:true,force:true}));return {root,cacheDir:join(root,'cache')};}
const counting=()=>{const calls=[];return {calls,hash:async path=>{calls.push(path);const {readFileSync}=await import('node:fs');return sha(readFileSync(path));}};};

test('full hash is persisted and reused for the identical file identity',async t=>{
 const {root,cacheDir}=setup(t),file=join(root,'a.mp4');writeFileSync(file,'media-v1');const c=counting();
 assert.equal(await cachedFileSha256(file,{cacheDir,hash:c.hash}),sha('media-v1'));
 // A fresh process has no memory cache: emulate by using a new cache file read path.
 const entry=digestCacheEntry(cacheDir,file,fileIdentity(file));assert.ok(statSync(entry).isFile());
 assert.equal(await cachedFileSha256(file,{cacheDir,hash:c.hash}),sha('media-v1'));assert.equal(c.calls.length,1);
});

test('rewrite with restored mtime, replacement and rename all force a full re-hash',async t=>{
 const {root,cacheDir}=setup(t),file=join(root,'a.mp4');writeFileSync(file,'media-v1');const c=counting();
 await cachedFileSha256(file,{cacheDir,hash:c.hash});const old=statSync(file);
 await new Promise(r=>setTimeout(r,15));writeFileSync(file,'media-v2');utimesSync(file,old.atime,old.mtime);   // same size + mtime, new ctime
 assert.equal(await cachedFileSha256(file,{cacheDir,hash:c.hash}),sha('media-v2'));
 const other=join(root,'b.mp4');writeFileSync(other,'media-v3');renameSync(other,file);                       // new inode
 assert.equal(await cachedFileSha256(file,{cacheDir,hash:c.hash}),sha('media-v3'));
 const moved=join(root,'moved.mp4');renameSync(file,moved);                                                    // new path
 assert.equal(await cachedFileSha256(moved,{cacheDir,hash:c.hash}),sha('media-v3'));assert.equal(c.calls.length,4);
});

test('a forged or corrupt cache entry is ignored',async t=>{
 const {root,cacheDir}=setup(t),file=join(root,'a.mp4');writeFileSync(file,'media');const entry=digestCacheEntry(cacheDir,file,fileIdentity(file));
 mkdirSync(join(entry,'..'),{recursive:true});writeFileSync(entry,JSON.stringify({path:file,identity:'0:0:0:0:0',sha256:'f'.repeat(64)}));
 assert.equal(await cachedFileSha256(file,{cacheDir}),sha('media'));
});

test('change during hashing is rejected and not cached',async t=>{
 const {root,cacheDir}=setup(t),file=join(root,'a.mp4');writeFileSync(file,'media');
 await assert.rejects(cachedFileSha256(file,{cacheDir,hash:async()=>{await new Promise(r=>setTimeout(r,15));writeFileSync(file,'changed!');return 'a'.repeat(64);}}),/变化/);
 assert.deepEqual(readdirSync(root).includes('cache')?readdirSync(join(root,'cache')):[],[]);
});

test('roughcut provenance hash overlaps analysis instead of delaying it',async t=>{
 const {root}=setup(t),publicRoot=join(root,'public');mkdirSync(publicRoot);writeFileSync(join(publicRoot,'source.mp4'),'media');
 const doc={schemaVersion:1,id:'test',name:'原片',revision:0,canvas:{width:640,height:360,fps:{num:30,den:1},durationFrames:300},source:{path:'templates/remotion-base/public/source.mp4',publicPath:'source.mp4',startFrame:0,durationFrames:300},instances:[],styleReference:{contractPath:null,styleframePath:null,allowedOverrides:{}}};
 let release,hashDone=false;const gate=new Promise(r=>release=r);const order=[];
 const s=createRoughcutService({root,publicRoot,digest:async()=>{order.push('hash-start');await gate;hashDone=true;order.push('hash-end');return 'a'.repeat(64);},
  runner:async args=>{order.push(hashDone?'runner-after-hash':'runner-during-hash');release();return {version:1,sourceKey:args.sourceKey,sourceDurationSeconds:10,timing:'segment',units:[{id:'u1',text:'完整表达。',startSeconds:1,endSeconds:3,timing:'segment'}],silences:[],decisions:[],warnings:[]};}});
 const id=s.start(doc).id;let job;for(let i=0;i<200;i++){job=s.get(id);if(job.status!=='running')break;await new Promise(r=>setTimeout(r,5));}
 assert.equal(job.status,'complete',job.error);assert.equal(job.analysis.mediaSha256,'a'.repeat(64));
 assert.deepEqual(order,['hash-start','runner-during-hash','hash-end']);
});
