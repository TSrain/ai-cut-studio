import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,stat,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {previewProxySpec,validateProxyFrames,createPreviewProxyService} from '../lib/editor-preview-proxy.mjs';
const metadata=()=>({streams:[{codec_type:'video',codec_name:'h264',width:2160,height:3840,pix_fmt:'yuv420p',sample_aspect_ratio:'1:1',avg_frame_rate:'30/1',r_frame_rate:'30/1',time_base:'1/15360',start_time:'0',duration:'1',nb_frames:'30'}],format:{duration:'1'}});
test('proxy conserves ratio and excludes HDR, alpha, nonzero clock and non-square pixels',()=>{
 assert.deepEqual(previewProxySpec(metadata()).size,{width:720,height:1280});
 for(const patch of [{color_transfer:'smpte2084'},{pix_fmt:'yuva420p'},{side_data_list:[{rotation:45}]},{start_time:'0.2'},{sample_aspect_ratio:'4:3'},{width:720,height:1280}])assert.equal(previewProxySpec({streams:[{...metadata().streams[0],...patch}]}).supported,false,JSON.stringify(patch));
});
test('actual packet timing must be CFR, including B frame ordering',()=>{
 const times=Array.from({length:30},(_,i)=>i/30);
 assert.equal(validateProxyFrames(times.slice().reverse(),{fps:30,frames:30,timeBase:1/15360}),true);
 assert.equal(validateProxyFrames(times.map((t,i)=>i===10?t+.01:t),{fps:30,frames:30,timeBase:1/15360}),false);
 assert.equal(validateProxyFrames(times.slice(1),{fps:30,frames:30,timeBase:1/15360}),false);
});
test('request returns before encoding; duplicate clients share one job, bounded queue, invalidation and reusable cache',async()=>{
 const root=await mkdtemp(join(tmpdir(),'preview-proxy-'));let active=0,peak=0,encodes=0;
 let release;const gate=new Promise(resolve=>release=resolve);
 const run=async(command,args)=>{
  if(command==='ffprobe'){
   if(args.includes('-show_packets'))return {stdout:Array.from({length:30},(_,i)=>String(i/30)).join('\n')};
   const meta=metadata();if(args.at(-1).endsWith('proxy.mp4')){meta.streams[0].width=720;meta.streams[0].height=1280;}
   return {stdout:JSON.stringify(meta)};
  }
  encodes++;peak=Math.max(peak,++active);await gate;await writeFile(args.at(-1),'proxy');active--;return {stdout:''};
 };
 const wait=async(service,path)=>{for(let i=0;i<100;i++){const job=await service.request(path);if(!['queued','running'].includes(job.status))return job;await new Promise(r=>setTimeout(r,5));}throw Error('job did not finish');};
 try {
  await writeFile(join(root,'source.mp4'),'source');await writeFile(join(root,'other.mp4'),'other');
  const service=createPreviewProxyService({root,run});
  const first=await service.request('source.mp4');assert.ok(['queued','running'].includes(first.status));
  const duplicate=await service.request('source.mp4');assert.equal(duplicate.key,first.key);
  await service.request('other.mp4');await new Promise(r=>setTimeout(r,25));assert.equal(encodes,1);
  release();const ready=await wait(service,'source.mp4');assert.equal(ready.status,'ready');assert.equal((await wait(service,'other.mp4')).status,'ready');assert.equal(peak,1);assert.equal(encodes,2);
  assert.equal(await readFile(join(root,ready.url.slice(1)),'utf8'),'proxy');
  const output=join(root,ready.url.slice(1)),stampBefore=await stat(output);
  await new Promise(r=>setTimeout(r,10));await chmod(output,0o600);
  const stampAfter=await stat(output);assert.equal(stampAfter.size,stampBefore.size);assert.equal(stampAfter.mtimeMs,stampBefore.mtimeMs);assert.notEqual(stampAfter.ctimeMs,stampBefore.ctimeMs);
  assert.equal((await wait(service,'source.mp4')).status,'ready');assert.equal(encodes,2,'ctime-only change must hash-verify and reuse in-memory cache');
  await new Promise(r=>setTimeout(r,10));await chmod(output,0o644);
  const restarted=createPreviewProxyService({root,run});assert.equal((await wait(restarted,'source.mp4')).status,'ready');assert.equal(encodes,2,'ctime-only change must also reuse disk cache after restart');
  // Simulate unchanged size/mtime with changed bytes; ctime still triggers a hash check.
  const manifestPath=join(root,'workspace/editor-preview-proxy',ready.key,'metadata.json');
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  await new Promise(r=>setTimeout(r,10));await writeFile(output,'pr0xy');
  manifest.file.mtimeMs=(await stat(output)).mtimeMs;
  await writeFile(manifestPath,JSON.stringify(manifest));
  const tamperCheck=createPreviewProxyService({root,run});assert.equal((await wait(tamperCheck,'source.mp4')).status,'ready');assert.equal(encodes,3,'same-size changed bytes must rebuild');
  await writeFile(join(root,'source.mp4'),'changed-source');const next=await wait(service,'source.mp4');assert.equal(next.status,'ready');assert.notEqual(next.key,ready.key);assert.equal(encodes,4);
  await assert.rejects(service.request('../escape.mp4'));
 }finally{await rm(root,{recursive:true,force:true});}
});

test('real FFmpeg proxy preserves video frames, audio bytes and source file',async t=>{
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util'),run=promisify(execFile);
 const root=await mkdtemp(join(tmpdir(),'preview-proxy-real-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const original=join(root,'source.mp4');
 await run('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=1920x1080:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1','-c:v','libx264','-threads','2','-pix_fmt','yuv420p','-c:a','aac',original]);
 const before=await readFile(original),service=createPreviewProxyService({root});let ready;
 for(let i=0;i<200;i++){ready=await service.request('source.mp4');if(!['queued','running'].includes(ready.status))break;await new Promise(r=>setTimeout(r,50));}
 assert.equal(ready.status,'ready',ready.reason);assert.deepEqual([ready.width,ready.height],[1280,720]);
 const output=join(root,ready.url.slice(1));
 await run('ffmpeg',['-v','error','-i',output,'-f','null','-']);
 const audioHash=async path=>(await run('ffmpeg',['-v','error','-i',path,'-map','0:a:0','-c','copy','-f','hash','-hash','sha256','-'])).stdout;
 assert.equal(await audioHash(output),await audioHash(original));
 assert.deepEqual(await readFile(original),before);
 // Damaged cache is regenerated before it can be exposed again.
 await writeFile(output,'broken');
 let repaired;
 for(let i=0;i<200;i++){repaired=await service.request('source.mp4');if(!['queued','running'].includes(repaired.status))break;await new Promise(r=>setTimeout(r,50));}
 assert.equal(repaired.status,'ready',repaired.reason);await run('ffmpeg',['-v','error','-i',output,'-f','null','-']);
});

test('rotated VFR preserves display ratio and validates every original PTS',()=>{
 const meta=metadata();Object.assign(meta.streams[0],{width:3840,height:2160,side_data_list:[{rotation:90}],avg_frame_rate:'29/1'});
 const spec=previewProxySpec(meta);assert.equal(spec.supported,true);assert.deepEqual(spec.size,{width:720,height:1280});
 const times=[0,.033,.071,.10];
 assert.equal(validateProxyFrames(times,{frames:4,timeBase:.00001,timestamps:times}),true);
 assert.equal(validateProxyFrames([0,.033,.07101,.10],{frames:4,timeBase:.00001,timestamps:times}),false);
 assert.equal(validateProxyFrames([0,.033,.066,.10],{frames:4,timeBase:.00001,timestamps:times}),false);
 assert.equal(validateProxyFrames([.01,.043,.081,.11],{frames:4,timeBase:.00001,timestamps:times}),false);
});

test('real rotated VFR proxy retains every PTS and copied audio',async t=>{
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util'),run=promisify(execFile);
 const root=await mkdtemp(join(tmpdir(),'preview-vfr-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await run('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=1920x1080:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1','-vf',"select='not(eq(mod(n,7),3))'",'-fps_mode','vfr','-c:v','libx264','-threads','2','-c:a','aac',join(root,'base.mp4')]);
 // Keep zero presentation origin; include deliberately irregular intervals.
 await run('ffmpeg',['-v','error','-display_rotation:v:0','90','-i',join(root,'base.mp4'),'-c','copy',join(root,'source.mp4')]);
 const service=createPreviewProxyService({root});let job;
 for(let i=0;i<200;i++){job=await service.request('source.mp4');if(!['queued','running'].includes(job.status))break;await new Promise(r=>setTimeout(r,50));}
 assert.equal(job.status,'ready',job.reason);assert.deepEqual([job.width,job.height],[720,1280]);
 const output=join(root,job.url.slice(1));
 const pts=async path=>(await run('ffprobe',['-v','error','-select_streams','v:0','-show_entries','packet=pts_time','-of','csv=p=0',path])).stdout.trim().split('\n').map(Number).sort((a,b)=>a-b);
 assert.deepEqual(await pts(output),await pts(join(root,'source.mp4')));
 const hash=async path=>(await run('ffmpeg',['-v','error','-i',path,'-map','0:a:0','-c','copy','-f','hash','-hash','sha256','-'])).stdout;
 assert.equal(await hash(output),await hash(join(root,'source.mp4')));
});

test('source player preloads only the adjacent cut and export always uses original',async()=>{
 const source=await readFile(new URL('../../templates/remotion-base/src/editor/SourcePip.tsx',import.meta.url),'utf8');
 // Actual wrapper identity and decoder count are exercised in source-preview-lifecycle.test.mjs.
 assert.match(source,/premountFor:previewPremount\(clip.id\)/);
 assert.match(source,/const proxy=isPlayer&&!isRendering/);
});
