import test from 'node:test';import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,utimesSync,readFileSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {captureBuildInfo,createBuildStatus,buildStatus} from '../lib/build-info.mjs';
import {backendBanner,BACKEND_STALE_TEXT} from '../editor/backend-version.mjs';
import {createRoughcutService,STALE_JOB_ERROR} from '../lib/roughcut-jobs.mjs';
function repo(t){const root=mkdtempSync(join(tmpdir(),'build-info-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const git=(...a)=>execFileSync('git',['-c','user.email=t@t','-c','user.name=t','-c','core.hooksPath=/dev/null',...a],{cwd:root,stdio:'pipe'});
 mkdirSync(join(root,'tools/lib'),{recursive:true});writeFileSync(join(root,'tools/lib/a.mjs'),'1');git('init','-q');git('add','.');git('commit','-qm','one');return {root,git};}
test('fresh server is current; edited source and new HEAD make it stale with reasons',t=>{
 const {root,git}=repo(t);let clock=1000;const info=captureBuildInfo(root,{now:()=>clock});
 assert.match(info.buildId,/^[0-9a-f]{12}-clean-nobundle$/);
 const status=createBuildStatus(root,info,{ttl:0});assert.equal(status().stale,false);assert.equal(backendBanner(status()),null);
 const later=new Date(Date.now()+5000);writeFileSync(join(root,'tools/lib/a.mjs'),'2');utimesSync(join(root,'tools/lib/a.mjs'),later,later);
 let s=status();assert.equal(s.stale,true);assert.deepEqual(s.reasons.map(r=>r.kind),['source']);
 git('commit','-qam','two');s=status();assert.deepEqual(s.reasons.map(r=>r.kind).sort(),['head','source']);
 assert.equal(backendBanner(s).text,BACKEND_STALE_TEXT);assert.match(backendBanner(s).detail,/代码已切换/);
});
test('dirty flag and bundle hash are part of the build id',t=>{
 const {root}=repo(t);writeFileSync(join(root,'tools/lib/a.mjs'),'dirty');mkdirSync(join(root,'workspace/editor-app'),{recursive:true});writeFileSync(join(root,'workspace/editor-app/main.js'),'bundle');
 const info=captureBuildInfo(root);assert.equal(info.dirty,true);assert.match(info.buildId,/-dirty-[0-9a-f]{16}$/);
 assert.equal(buildStatus(info,{head:info.head,newestSource:info.sourceBaseline}).stale,false);
});
function jobRoot(t,job){const root=mkdtempSync(join(tmpdir(),'stale-job-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'public'));mkdirSync(join(root,'workspace/roughcut-jobs',job.id),{recursive:true});writeFileSync(join(root,'workspace/roughcut-jobs',job.id,'job.json'),JSON.stringify(job));return root;}
const running=extra=>({id:'00000000-0000-4000-8000-000000000001',documentId:'d',sourceKey:'k',startedAt:Date.now()-5000,status:'running',stage:'aligning',...extra});
test('a persisted running job whose process is gone is reported stale, not running',t=>{
 const root=jobRoot(t,running({pid:999999,ownerPid:999998}));const s=createRoughcutService({root,publicRoot:join(root,'public'),alive:()=>false});
 const job=s.get('00000000-0000-4000-8000-000000000001');assert.equal(job.status,'failed');assert.equal(job.stage,'stale');assert.equal(job.stale,true);assert.match(job.error,/进度已过期/);
 assert.equal(JSON.parse(readFileSync(join(root,'workspace/roughcut-jobs/00000000-0000-4000-8000-000000000001/job.json'),'utf8')).stage,'stale');
});
test('a job still owned by another live panel process keeps its real progress',t=>{
 const root=jobRoot(t,running({pid:4242,ownerPid:4343}));const s=createRoughcutService({root,publicRoot:join(root,'public'),alive:pid=>pid===4242||pid===4343});
 const job=s.get('00000000-0000-4000-8000-000000000001');assert.equal(job.status,'running');assert.equal(job.stage,'aligning');
 assert.ok(STALE_JOB_ERROR.includes('不是仍在运行'));
});
