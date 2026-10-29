import test from 'node:test';import assert from 'node:assert/strict';
import {exportPolicy,cacheVisualProps,visualKey} from '../lib/editor-export-cache.mjs';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
const props={document:{id:'p',revision:4,canvas:{width:2160,height:3840,fps:{num:30,den:1},durationFrames:30},instances:[],source:{publicPath:'a.mp4'}}};
test('raster keys reuse identical content across saved revisions',()=>{assert.deepEqual(cacheVisualProps(props),cacheVisualProps({document:{...props.document,revision:5,id:'q'}}));});
test('actual referenced media bytes invalidate caches',async()=>{const root=mkdtempSync(join(tmpdir(),'export-key-'));try{writeFileSync(join(root,'a.mp4'),'one');const a=await visualKey(props,{bundleKey:'b',publicRoot:root,extension:'mp4'});writeFileSync(join(root,'a.mp4'),'two');assert.notEqual(a,await visualKey(props,{bundleKey:'b',publicRoot:root,extension:'mp4'}));}finally{rmSync(root,{recursive:true,force:true});}});
test('hardware paths and alpha format do not reduce resolution',()=>{const p=exportPolicy(props.document.canvas,{transparent:true});assert.equal(p.codec,'prores');assert.equal(p.hardwareAcceleration,'if-possible');assert.ok(p.concurrency>=1&&p.concurrency<=4);});

import {createRequire} from 'node:module';
const requireRemotion=createRequire(new URL('../../templates/remotion-base/package.json',import.meta.url));
const {validateBitrate}=requireRemotion('@remotion/renderer').RenderInternals;
test('opaque export bitrate satisfies the installed Remotion API without changing the target rate',()=>{
 for(const canvas of [props.document.canvas,{width:1920,height:1080,fps:{num:30000,den:1001}},{width:640,height:360,fps:{num:30,den:1}}]){
  const policy=exportPolicy(canvas);
  assert.doesNotThrow(()=>validateBitrate(policy.videoBitrate,'videoBitrate'));
  const multiplier=/[kK]$/.test(policy.videoBitrate)?1000:1000000;
  const expected=Math.max(8_000_000,Math.round(canvas.width*canvas.height*canvas.fps.num/canvas.fps.den*.14));
  assert.equal(Math.round(parseFloat(policy.videoBitrate)*multiplier),expected);
 }
 assert.equal(exportPolicy(props.document.canvas,{transparent:true}).videoBitrate,undefined);
});


test('workflow attachments and preview-only assets cannot invalidate render caches',async()=>{
 const root=mkdtempSync(join(tmpdir(),'visual-semantic-key-'));
 try{
  writeFileSync(join(root,'a.mp4'),'source');writeFileSync(join(root,'reference.png'),'reference-one');writeFileSync(join(root,'proxy.mp4'),'proxy-one');
  const d=structuredClone(props);d.document.productionPlan={reference:'reference.png'};
  d.document.source.previewPublicPath='proxy.mp4';
  const options={bundleKey:'b',publicRoot:root,extension:'mp4'};
  const first=await visualKey(d,options);
  writeFileSync(join(root,'reference.png'),'reference-two');writeFileSync(join(root,'proxy.mp4'),'proxy-two');
  assert.equal(await visualKey(d,options),first);
  writeFileSync(join(root,'a.mp4'),'source-two');assert.notEqual(await visualKey(d,options),first);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('range keys ignore review, roughcut and track display metadata but retain render props',async()=>{
 const root=mkdtempSync(join(tmpdir(),'visual-range-'));
 try{
  writeFileSync(join(root,'a.mp4'),'source');const options={bundleKey:'b',publicRoot:root,extension:'mp4'};
  const p={...structuredClone(props),rangeStartFrame:30,renderDurationFrames:30};
  p.document.canvas.durationFrames=120;p.document.source.muted=true;p.document.source.volume=.3;
  p.document.roughcut={analysis:{confidence:.4}};p.document.review={items:[]};p.document.tracks=[{id:'t',name:'one',locked:false}];
  p.document.instances=[{id:'in',trackId:'t',assetId:'number-beat',startFrame:20,durationFrames:60,sourceOffsetFrames:7,sourceDurationFrames:90,props:{text:'A'}},{id:'out',assetId:'number-beat',startFrame:70,durationFrames:30,props:{text:'B',media:{publicPath:'outside.png'}}}];
  const first=await visualKey(p,options),next=structuredClone(p);
  next.document.roughcut.analysis.confidence=.8;next.document.review.items.push({text:'note'});next.document.tracks[0].name='two';next.document.tracks[0].locked=true;next.document.source.volume=.9;next.document.instances[1].props.text='C';
  assert.equal(await visualKey(next,options),first);
  next.document.instances[0].props.text='actual change';assert.notEqual(await visualKey(next,options),first);
  next.document.instances[0].props.text='A';next.document.instances[0].sourceOffsetFrames=8;assert.notEqual(await visualKey(next,options),first);
  next.document.instances[0].sourceOffsetFrames=7;next.document.instances[0].durationFrames=61;assert.notEqual(await visualKey(next,options),first,'exit timing remains in the key');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('silent final visuals reuse across audio edits and remix publishes fresh audio',async()=>{
 const {cachedRaster,silentVisualProps}=await import('../lib/editor-export-cache.mjs');const {remixHybridAudio}=await import('../lib/editor-hybrid-audio.mjs');const {execFileSync}=await import('node:child_process');
 const root=mkdtempSync(join(tmpdir(),'visual-remix-'));
 try{
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=64x36:r=30:d=0.4','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=0.4','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',join(root,'source.mp4')]);
  const p={document:{canvas:{width:64,height:36,fps:{num:30,den:1},durationFrames:12},source:{publicPath:'source.mp4',startFrame:0,volume:1},instances:[],audioClips:[]},rangeStartFrame:0,renderDurationFrames:12,renderMode:'full'};
  let renders=0;const options={root:join(root,'cache'),publicRoot:root,bundleKey:'b',render:async(_p,_e,out)=>{renders++;execFileSync('ffmpeg',['-v','error','-i',join(root,'source.mp4'),'-an','-c:v','copy',out]);}};
  const a=await cachedRaster(silentVisualProps(p),'mp4',options);p.document.source.volume=0;
  const b=await cachedRaster(silentVisualProps(p),'mp4',options);assert.equal(a.path,b.path);assert.equal(renders,1);
  const item={extension:'mp4',renderMode:'full',rangeStartFrame:0,durationFrames:12};
  await remixHybridAudio(a.path,{...p.document,source:{...p.document.source,volume:1}},item,{publicRoot:root,outputPath:join(root,'audible.mp4'),workRoot:root});
  await remixHybridAudio(b.path,p.document,item,{publicRoot:root,outputPath:join(root,'silent.mp4'),workRoot:root});
  const samples=path=>execFileSync('ffmpeg',['-v','error','-i',path,'-vn','-ac','1','-ar','48000','-f','f32le','-']);
  const rms=raw=>{let sum=0;for(let n=0;n<raw.length;n+=4)sum+=raw.readFloatLE(n)**2;return Math.sqrt(sum/(raw.length/4));};
  assert.ok(rms(samples(join(root,'audible.mp4')))>.05);assert.ok(rms(samples(join(root,'silent.mp4')))<.0001);
  const video=path=>execFileSync('ffmpeg',['-v','error','-i',path,'-map','0:v','-c','copy','-f','hash','-']);assert.deepEqual(video(join(root,'audible.mp4')),video(join(root,'silent.mp4')));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('review preview scale is explicit, cache-distinct and validated without changing canvas',async()=>{
 const {verifyRaster}=await import('../lib/editor-export-cache.mjs');const {execFileSync}=await import('node:child_process');
 const root=mkdtempSync(join(tmpdir(),'visual-scale-'));
 try{
  const p={document:{canvas:{width:64,height:36,fps:{num:30,den:1},durationFrames:6},instances:[]},previewScale:.5,renderDurationFrames:6};
  const file=join(root,'preview.mp4');execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=32x18:r=30:d=0.2','-c:v','libx264','-pix_fmt','yuv420p',file]);
  assert.doesNotThrow(()=>verifyRaster(file,p,'mp4'));assert.throws(()=>verifyRaster(file,{...p,previewScale:1},'mp4'));
  assert.notEqual(await visualKey(p,{publicRoot:root,bundleKey:'b',extension:'mp4'}),await visualKey({...p,previewScale:1},{publicRoot:root,bundleKey:'b',extension:'mp4'}));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('cancelled silent render removes staging and lock without publishing a cache',async()=>{
 const {cachedRaster,silentVisualProps}=await import('../lib/editor-export-cache.mjs');const {readdirSync}=await import('node:fs');
 const root=mkdtempSync(join(tmpdir(),'visual-abort-')),controller=new AbortController();
 try{
  const p={document:{canvas:{width:64,height:36,fps:{num:30,den:1},durationFrames:6},instances:[]}};
  await assert.rejects(cachedRaster(silentVisualProps(p),'mp4',{root,publicRoot:root,bundleKey:'b',signal:controller.signal,verify:()=>{},render:async(_p,_e,out)=>{writeFileSync(out,'partial');controller.abort(Error('cancel'));}}),/cancel/);
  assert.deepEqual(readdirSync(root),[]);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('cancelled remix removes staging and preserves the previous output',async()=>{
 const {remixHybridAudio}=await import('../lib/editor-hybrid-audio.mjs');const {execFileSync}=await import('node:child_process');const {readFileSync,readdirSync}=await import('node:fs');
 const root=mkdtempSync(join(tmpdir(),'audio-abort-')),controller=new AbortController();
 try{
  const visual=join(root,'visual.mp4'),out=join(root,'output.mp4');execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=64x36:r=30:d=0.2','-c:v','libx264',visual]);writeFileSync(out,'previous');
  await assert.rejects(remixHybridAudio(visual,{canvas:{fps:{num:30,den:1}},source:null,instances:[]},{renderMode:'full',extension:'mp4',rangeStartFrame:0,durationFrames:6},{publicRoot:root,outputPath:out,workRoot:root,signal:controller.signal,onProgress:()=>controller.abort(Error('cancel'))}));
  assert.equal(readFileSync(out,'utf8'),'previous');assert.deepEqual(readdirSync(root).sort(),['output.mp4','visual.mp4']);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('media dependency hashes are local to the rendered interval',async()=>{
 const root=mkdtempSync(join(tmpdir(),'local-media-key-'));
 try{
  writeFileSync(join(root,'inside.png'),'inside-one');writeFileSync(join(root,'outside.png'),'outside-one');
  const p={rangeStartFrame:30,renderDurationFrames:30,document:{canvas:{width:64,height:36,fps:{num:30,den:1},durationFrames:120},source:null,instances:[{id:'in',assetId:'source-pip',startFrame:20,durationFrames:60,props:{sourceMode:'media',media:{kind:'image',publicPath:'inside.png'}}},{id:'out',assetId:'source-pip',startFrame:70,durationFrames:30,props:{sourceMode:'media',media:{kind:'image',publicPath:'outside.png'}}}]}},options={bundleKey:'b',publicRoot:root,extension:'mp4'};
  const key=await visualKey(p,options);writeFileSync(join(root,'outside.png'),'outside-two');assert.equal(await visualKey(p,options),key);
  writeFileSync(join(root,'inside.png'),'inside-two');assert.notEqual(await visualKey(p,options),key);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('preview geometry finds even rounded pixels without changing composition layout',async()=>{
 const {exportRasterGeometry}=await import('../lib/editor-export-cache.mjs');
 for(const [width,height,scale] of [[3840,2160,.333],[1920,1082,.333],[2160,3840,1/3],[1987,1117,.625]]){
  const g=exportRasterGeometry({width,height},scale,'mp4');assert.ok(g.scale<=scale&&g.scale>0);assert.equal(Math.round(width*g.scale),g.width);assert.equal(Math.round(height*g.scale),g.height);assert.equal(g.width%2,0);assert.equal(g.height%2,0);assert.equal(Math.ceil(width*g.scale),g.width);assert.equal(Math.ceil(height*g.scale),g.height);
 }
 assert.deepEqual(exportRasterGeometry({width:3840,height:2160},1/3,'mp4'),{width:1280,height:720,scale:1/3});
});
