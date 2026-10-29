import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readSync,renameSync,unlinkSync,utimesSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const mod=await import('../lib/verified-file-digest.mjs').catch(()=>({}));
const sha=value=>createHash('sha256').update(value).digest('hex');
function fixture(){const dir=mkdtempSync(join(tmpdir(),'verified-digest-')),path=join(dir,'media.bin');writeFileSync(path,'AAAA');return {dir,path};}
test('unchanged file digest reuses verified bytes without rereading media',()=>{
 const {path}=fixture();let reads=0;const digest=mod.createVerifiedFileDigest({read:(...args)=>{reads++;return readSync(...args);}});assert.equal(digest(path),sha('AAAA'));const count=reads;assert.equal(digest(path),sha('AAAA'));assert.equal(reads,count);
});
test('same size same mtime replacement and in-place ctime change invalidate cached bytes',()=>{
 for(const [replacement,content] of [[true,'AAAA'],[true,'BBBB'],[false,'BBBB']]){const {dir,path}=fixture();let reads=0;const digest=mod.createVerifiedFileDigest({read:(...args)=>{reads++;return readSync(...args);}});assert.equal(digest(path),sha('AAAA'));const first=reads,old=statSync(path);if(replacement){const other=join(dir,'replacement');writeFileSync(other,content);utimesSync(other,old.atime,old.mtime);renameSync(other,path);}else{writeFileSync(path,content);utimesSync(path,old.atime,old.mtime);}assert.equal(digest(path),sha(content));assert.ok(reads>first);}
});
test('deletion fails closed and recreation never returns removed file digest',()=>{
 const {path}=fixture(),digest=mod.createVerifiedFileDigest();assert.equal(digest(path),sha('AAAA'));unlinkSync(path);assert.throws(()=>digest(path));writeFileSync(path,'CCCC');assert.equal(digest(path),sha('CCCC'));
});
test('mutation or atomic replacement while bytes are being read is rejected and never cached',()=>{
 for(const replacement of [true,false]){const {dir,path}=fixture();let mutate=true;const digest=mod.createVerifiedFileDigest({read:(...args)=>{const read=readSync(...args);if(mutate){mutate=false;if(replacement){const other=join(dir,'new');writeFileSync(other,'DDDD');renameSync(other,path);}else writeFileSync(path,'DDDD');}return read;}});assert.throws(()=>digest(path),/changed|变化/);assert.equal(digest(path),sha('DDDD'));}
});
test('bounded digest cache evicts old entries and re-verifies them',()=>{
 const {dir,path}=fixture();let reads=0;const digest=mod.createVerifiedFileDigest({maxEntries:1,read:(...args)=>{reads++;return readSync(...args);}});digest(path);const second=join(dir,'second');writeFileSync(second,'EEEE');digest(second);const before=reads;digest(path);assert.ok(reads>before);
});
