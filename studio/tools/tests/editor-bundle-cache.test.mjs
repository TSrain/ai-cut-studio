import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {bundleFingerprint,ensureExportBundle} from '../lib/editor-bundle-cache.mjs';
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'editor-cache-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));mkdirSync(join(dir,'src'));mkdirSync(join(dir,'node_modules'));mkdirSync(join(dir,'public'));writeFileSync(join(dir,'src/index.ts'),'original');writeFileSync(join(dir,'package.json'),'{}');return dir;}
test('key follows source/config/dependency changes, not snapshot directory or props',t=>{
 const a=fixture(t),b=fixture(t);assert.equal(bundleFingerprint(a),bundleFingerprint(b));
 writeFileSync(join(a,'props.json'),'different copy');assert.equal(bundleFingerprint(a),bundleFingerprint(b));
 writeFileSync(join(a,'src/index.ts'),'changed');assert.notEqual(bundleFingerprint(a),bundleFingerprint(b));
 writeFileSync(join(a,'src/index.ts'),'original');writeFileSync(join(a,'remotion.config.ts'),'changed config');assert.notEqual(bundleFingerprint(a),bundleFingerprint(b));
 rmSync(join(a,'remotion.config.ts'));writeFileSync(join(a,'node_modules/.package-lock.json'),'changed dependency');assert.notEqual(bundleFingerprint(a),bundleFingerprint(b));
});
test('concurrent requests build once and publish only complete bundles',async t=>{
 const dir=fixture(t),cacheRoot=join(dir,'cache');let builds=0;
 const build=async out=>{builds++;await new Promise(r=>setTimeout(r,70));writeFileSync(join(out,'index.html'),'complete');};
 const results=await Promise.all([1,2].map(()=>ensureExportBundle({buildRoot:dir,cacheRoot,build})));
 assert.equal(builds,1);assert.equal(results[0].path,results[1].path);assert.equal(readFileSync(join(results[0].path,'index.html'),'utf8'),'complete');
 await ensureExportBundle({buildRoot:dir,cacheRoot,build});assert.equal(builds,1);
});
test('failed builds cannot poison the cache',async t=>{
 const dir=fixture(t),cacheRoot=join(dir,'cache');
 await assert.rejects(ensureExportBundle({buildRoot:dir,cacheRoot,build:async out=>{writeFileSync(join(out,'index.html'),'partial');throw Error('failed');}}),/failed/);
 const result=await ensureExportBundle({buildRoot:dir,cacheRoot,build:async out=>writeFileSync(join(out,'index.html'),'good')});
 assert.equal(result.hit,false);assert.equal(readFileSync(join(result.path,'index.html'),'utf8'),'good');assert.ok(existsSync(join(result.path,'.ready.json')));
});
