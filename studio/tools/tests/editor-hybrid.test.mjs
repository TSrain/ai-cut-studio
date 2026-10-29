import {compileShotPlan,buildCameraFilter} from '../../templates/remotion-base/src/editor/aroll-shot-plan.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {captionSpans,isDirectMedia,visualGroups,planHybrid,runHybrid} from '../lib/editor-hybrid.mjs';
const canvas={width:2160,height:3840,fps:{num:30,den:1},durationFrames:300};
const media={id:'m',assetId:'source-pip',startFrame:20,durationFrames:90,props:{sourceMode:'media',media:{kind:'video',width:2160,height:3840,publicPath:'clip.mov',hasAlpha:true},size:177.77777777777777,x:50,y:50,radius:0,borderWidth:0,shadow:0,entrance:'none',exit:'none',transitionSeconds:0,crop:{x:0,y:0,width:1,height:1,sourceAspect:0.5625}}};
test('captions obey half-open frame boundaries and overlap priority',()=>{
 const track={enabled:true,cues:[{startFrame:2,endFrame:5,text:'A'},{startFrame:4,endFrame:7,text:'B'}]};
 assert.deepEqual(captionSpans(track,0,8).map(s=>[s.start,s.end,s.text]),[[0,2,''],[2,5,'A'],[5,7,'B'],[7,8,'']]);
});
test('direct media includes Alpha and preserves trim instead of browser rendering',()=>{
 assert.equal(isDirectMedia({...media,sourceOffsetFrames:30,sourceDurationFrames:120},canvas),true);
 assert.equal(isDirectMedia({...media,props:{...media.props,radius:16}},canvas),false);
});
test('complex intervals merge only overlaps, independent native videos stay outside',()=>{
 const complex={id:'c',assetId:'number-beat',startFrame:40,durationFrames:30,props:{}};
 const groups=visualGroups({canvas,instances:[media,complex,{...complex,id:'d',startFrame:60,durationFrames:40}]},0,300);
 assert.deepEqual(groups,[[40,100]]);
});

import {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {execFileSync} from 'node:child_process';
test('real hybrid export keeps caption frame edges, main audio and editable Alpha output',async()=>{
 const root=mkdtempSync(join(tmpdir(),'hybrid-export-'));
 try{
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=64x36:r=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','0.2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',join(root,'source.mp4')]);
  execFileSync('/usr/bin/python3',['-c',"from PIL import Image; import sys; Image.new('RGBA',(64,36),(255,0,0,128)).save(sys.argv[1])",join(root,'alpha.png')]);
  execFileSync('ffmpeg',['-v','error','-loop','1','-framerate','30','-i',join(root,'alpha.png'),'-frames:v','6','-c:v','prores_ks','-profile:v','4','-pix_fmt','yuva444p10le',join(root,'alpha.mov')]);
  const canvas={width:64,height:36,fps:{num:30,den:1},durationFrames:6};
  const d={canvas,source:{publicPath:'source.mp4',startFrame:0},instances:[],captions:{enabled:true,cues:[{startFrame:2,endFrame:4,text:'X'}]}};
  const item={renderMode:'full',extension:'mp4',rangeStartFrame:0,durationFrames:6};
  const plan=planHybrid(d,item,{publicRoot:root});assert.ok(plan);
  let index=0;
  const plate=async props=>{const path=join(root,`plate-${index++}.png`),text=props.document.captions?.cues[0].text;
   execFileSync('/usr/bin/python3',['-c',"from PIL import Image,ImageDraw; import sys; im=Image.new('RGBA',(64,36)); d=ImageDraw.Draw(im); d.rectangle((20,24,40,30),fill=(0,255,0,255)) if sys.argv[2]=='X' else None;im.save(sys.argv[1])",path,text??'']);return path;};
  const work=join(root,'work');mkdirSync(work);
  const out=join(root,'full.mp4');await runHybrid(plan,d,item,{outputPath:out,workRoot:work,renderPlate:plate,hardware:false});
  const meta=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',out]));assert.equal(meta.streams[0].nb_frames,'6');assert.ok(meta.streams.some(s=>s.codec_type==='audio'));
  const raw=execFileSync('ffmpeg',['-v','error','-i',out,'-f','rawvideo','-pix_fmt','rgb24','-']);
  const color=n=>{const x=n*64*36*3+(26*64+30)*3;return [...raw.subarray(x,x+3)];};assert.ok(color(1)[2]>200);assert.ok(color(2)[1]>180);assert.ok(color(3)[1]>180);assert.ok(color(4)[2]>200);
  const alpha={...media,startFrame:0,durationFrames:6,props:{...media.props,media:{kind:'video',width:64,height:36,publicPath:'alpha.mov',hasAlpha:true,durationSeconds:0.2},size:100*64/36,crop:{x:0,y:0,width:1,height:1,sourceAspect:64/36}}};
  const layerDoc={canvas,source:null,instances:[alpha]},layerItem={...item,renderMode:'instances',extension:'mov'};
  const layer=planHybrid(layerDoc,layerItem,{publicRoot:root});assert.ok(layer);const layerPath=join(root,'layer.mov');await runHybrid(layer,layerDoc,layerItem,{outputPath:layerPath,workRoot:work,hardware:false});
  const rgba=execFileSync('ffmpeg',['-v','error','-i',layerPath,'-frames:v','1','-f','rawvideo','-pix_fmt','rgba','-']);assert.ok(rgba[3]>110&&rgba[3]<145);
 }finally{rmSync(root,{recursive:true,force:true});}
});


test('full-canvas scaled deliveries keep the native path despite provenance metadata',()=>{
 const scaled={...media,props:{...media.props,media:{...media.props.media,width:1080,height:1920},deliveryIdentity:{resultId:'receipt'},footageIdentity:{candidateId:'candidate'}}};
 assert.equal(isDirectMedia(scaled,canvas),true);
 assert.equal(isDirectMedia({...scaled,props:{...scaled.props,blur:3}},canvas),false);
 assert.equal(isDirectMedia({...scaled,props:{...scaled.props,presenterLayer:'behind'}},canvas),false);
 assert.equal(isDirectMedia({...scaled,props:{...scaled.props,media:{...scaled.props.media,width:1920,height:1080}}},canvas),false);
 assert.deepEqual(visualGroups({canvas,instances:[scaled]},0,300),[]);
});

test('real scaled native media keeps full coverage, Alpha and exact boundaries',async()=>{
 const root=mkdtempSync(join(tmpdir(),'hybrid-scaled-'));
 try{
  execFileSync('/usr/bin/python3',['-c',"from PIL import Image; import sys; Image.new('RGBA',(32,18),(255,0,0,128)).save(sys.argv[1])",join(root,'alpha.png')]);
  execFileSync('ffmpeg',['-v','error','-loop','1','-framerate','30','-i',join(root,'alpha.png'),'-frames:v','6','-c:v','prores_ks','-profile:v','4','-pix_fmt','yuva444p10le',join(root,'alpha.mov')]);
  const c={width:64,height:36,fps:{num:30,den:1},durationFrames:10};
  const i={...media,startFrame:2,durationFrames:6,props:{...media.props,deliveryIdentity:{resultId:'r'},media:{kind:'video',width:32,height:18,publicPath:'alpha.mov',hasAlpha:true,durationSeconds:.2},size:100*64/36,crop:{x:0,y:0,width:1,height:1,sourceAspect:64/36}}};
  const d={canvas:c,source:null,instances:[i]},item={renderMode:'instances',extension:'mov',rangeStartFrame:0,durationFrames:10};
  const plan=planHybrid(d,item,{publicRoot:root});assert.equal(plan.direct.length,1);assert.deepEqual(plan.groups,[]);
  await runHybrid(plan,d,item,{outputPath:join(root,'out.mov'),workRoot:root,hardware:false,renderVisual:()=>{throw Error('Native media must not call browser rendering');}});
  const raw=execFileSync('ffmpeg',['-v','error','-i',join(root,'out.mov'),'-f','rawvideo','-pix_fmt','rgba','-']);
  assert.equal(raw.length,10*64*36*4);
  const alpha=(f,x,y)=>raw[(f*64*36+y*64+x)*4+3];
  for(const f of [0,1,8,9])assert.equal(alpha(f,60,32),0);
  for(const f of [2,7])assert.ok(alpha(f,60,32)>110&&alpha(f,60,32)<145);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('rotated VFR source normalizes once, preserves source seconds and sample-accurate audio across many cuts',async()=>{
 const root=mkdtempSync(join(tmpdir(),'hybrid-rotation-vfr-'));
 try{
  const base=join(root,'vfr.mp4'),source=join(root,'rotated.mov');
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=s=96x64:r=30:d=18,drawbox=x=0:y=0:w=18:h=18:color=red:t=fill,drawbox=x=78:y=46:w=18:h=18:color=blue:t=fill','-f','lavfi','-i','aevalsrc=0.15*sin(2*PI*(220+220*floor(t))*t):s=48000:d=18','-vf','select=not(eq(mod(n\\,5)\\,4))','-fps_mode','vfr','-t','18','-c:v','libx264','-crf','15','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k',base]);
  execFileSync('ffmpeg',['-v','error','-display_rotation:v:0','90','-i',base,'-map','0','-c','copy',source]);
  const inputMeta=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',source]));
  const inputVideo=inputMeta.streams.find(s=>s.codec_type==='video');assert.equal(inputVideo.side_data_list[0].rotation,90);assert.notEqual(inputVideo.avg_frame_rate,inputVideo.r_frame_rate);
  const expected=execFileSync('ffmpeg',['-v','error','-i',source,'-vf','fps=30:start_time=0,scale=64:96,setsar=1','-an','-f','rawvideo','-pix_fmt','rgb24','-'],{maxBuffer:16*1024*1024});
  const originalAudio=execFileSync('ffmpeg',['-v','error','-i',source,'-vn','-ac','1','-ar','48000','-f','f32le','-'],{maxBuffer:8*1024*1024});
  const makeDoc=clips=>({canvas:{width:64,height:96,fps:{num:30,den:1},durationFrames:clips.reduce((n,c)=>n+c.durationFrames,0)},source:{path:'rotated.mov',publicPath:'rotated.mov',startFrame:0,durationFrames:540,clips},instances:[]});
  for(const [label,starts,length] of [['single',[4],3],['sparse',[4,124],3],['three',[15,60,90],15],['many',Array.from({length:12},(_,n)=>n*9),3],['hundred',Array.from({length:100},(_,n)=>Math.floor(n*1.7)),1],['two-fifty-six',Array.from({length:256},(_,n)=>n*2),1]]){
   const clips=starts.map((sourceInFrame,n)=>({id:`s${n}`,sourceInFrame,startFrame:n*length,durationFrames:length})),d=makeDoc(clips),item={renderMode:'full',extension:'mp4',rangeStartFrame:0,durationFrames:d.canvas.durationFrames};
   const plan=planHybrid(d,item,{publicRoot:root});assert.ok(plan,'rotated VFR source must use the native hybrid path');assert.deepEqual(plan.groups,[]);
   const work=join(root,label);mkdirSync(work);const outputPath=join(work,'output.mp4');
   await runHybrid(plan,d,item,{outputPath,workRoot:work,hardware:false,renderVisual:()=>{throw Error('source normalization must not call Remotion');}});
   const command=JSON.parse(readFileSync(join(work,'hybrid-command.json'),'utf8'));assert.equal(command.filter(x=>x===plan.source).length,1,'a monotonic compact sequence uses only one source decoder');
   const graph=readFileSync(join(work,'hybrid.ffgraph'),'utf8');assert.match(graph,/select=/);assert.match(graph,/start_sample=/);assert.match(graph,/concat=n=/);assert.doesNotMatch(graph,/aselect=/);
   const meta=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',outputPath]));const v=meta.streams.find(s=>s.codec_type==='video'),a=meta.streams.find(s=>s.codec_type==='audio');
   assert.deepEqual([v.width,v.height,v.nb_frames,v.avg_frame_rate],[64,96,String(item.durationFrames),'30/1']);assert.ok(!v.side_data_list?.some(s=>s.rotation));assert.ok(Math.abs(Number(a.duration)-item.durationFrames/30)<.025);
   const actual=execFileSync('ffmpeg',['-v','error','-i',outputPath,'-an','-f','rawvideo','-pix_fmt','rgb24','-'],{maxBuffer:8*1024*1024});assert.equal(actual.length,item.durationFrames*64*96*3);
   const size=64*96*3;
   for(let n=0;n<item.durationFrames;n++){const wanted=starts[Math.floor(n/length)]+n%length;let sum=0;for(let p=0;p<size;p++)sum+=Math.abs(actual[n*size+p]-expected[wanted*size+p]);assert.ok(sum/size<5,`${label} output frame ${n} must map to normalized source frame ${wanted}, error=${sum/size}`);}
   const audio=execFileSync('ffmpeg',['-v','error','-i',outputPath,'-vn','-ac','1','-ar','48000','-f','f32le','-'],{maxBuffer:8*1024*1024});
   for(let n=0;n<starts.length;n++){let dot=0,s1=0,s2=0;const count=length*1600,from=starts[n]*1600,margin=Math.min(1200,Math.floor(count/4));
    for(let k=margin;k<count-margin;k++){const x=originalAudio.readFloatLE((from+k)*4),y=audio.readFloatLE((n*count+k)*4);dot+=x*y;s1+=x*x;s2+=y*y;}
    assert.ok(dot/Math.sqrt(s1*s2)>.9,`${label} clip ${n} audio must retain the same source samples`);
   }
  }
  // Changed clocks now normalize a lossless source before gap/reorder/camera/visual processing.
  for(const kind of ['gap','reorder','camera','visual']){
   const d=makeDoc([{id:'a',sourceInFrame:30,startFrame:0,durationFrames:6},{id:'b',sourceInFrame:60,startFrame:6,durationFrames:6}]);
   if(kind==='gap'){d.source.clips[1].startFrame=7;d.canvas.durationFrames=13;}
   if(kind==='reorder')d.source.clips[1].sourceInFrame=0;
   if(kind==='camera')d.source.cameraPlan={shots:[]};
   if(kind==='visual')d.instances=[{id:'visual',assetId:'number-beat',startFrame:0,durationFrames:12,props:{}}];
   assert.ok(planHybrid(d,{renderMode:'full',extension:'mp4',rangeStartFrame:0,durationFrames:d.canvas.durationFrames},{publicRoot:root})?.requiresNormalization,`${kind} VFR timeline must use a normalized source`);
  }
  // A VFR full-frame delivery remains on the conservative complex-media path.
  const direct={...media,startFrame:0,durationFrames:30,props:{...media.props,media:{kind:'video',width:96,height:64,publicPath:'vfr.mp4'},size:100*96/64,crop:{x:0,y:0,width:1,height:1,sourceAspect:96/64}}};
  const directDoc={canvas:{width:96,height:64,fps:{num:30,den:1},durationFrames:30},source:null,instances:[direct]};
  const directPlan=planHybrid(directDoc,{renderMode:'instances',extension:'mp4',rangeStartFrame:0,durationFrames:30},{publicRoot:root});assert.equal(directPlan.direct.length,0);assert.deepEqual(directPlan.groups,[[0,30]]);
  execFileSync('ffmpeg',['-v','error','-i',source,'-t','0.2','-c:v','libx264','-color_trc','smpte2084','-color_primaries','bt2020','-colorspace','bt2020nc','-an',join(root,'hdr.mp4')]);
  const hdr=makeDoc([{id:'one',startFrame:0,sourceInFrame:0,durationFrames:6}]);hdr.source.publicPath='hdr.mp4';assert.equal(planHybrid(hdr,{renderMode:'full',extension:'mp4',rangeStartFrame:0,durationFrames:6},{publicRoot:root}),null,'HDR color restrictions remain unchanged');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('legacy CFR sources with a shifted audio origin retain their existing seek path',async()=>{
 const root=mkdtempSync(join(tmpdir(),'hybrid-audio-origin-'));
 try{
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=64x36:r=30:d=2','-itsoffset','0.2','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=2','-t','2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',join(root,'offset.mp4')]);
  const d={canvas:{width:64,height:36,fps:{num:30,den:1},durationFrames:24},source:{path:'offset.mp4',publicPath:'offset.mp4',startFrame:0,durationFrames:60,clips:[{id:'a',startFrame:0,sourceInFrame:0,durationFrames:12},{id:'b',startFrame:12,sourceInFrame:30,durationFrames:12}]},instances:[]};
  const item={renderMode:'full',extension:'mp4',rangeStartFrame:0,durationFrames:24},plan=planHybrid(d,item,{publicRoot:root});assert.ok(plan);assert.ok(Number(plan.sourceMeta.streams.find(s=>s.codec_type==='audio').start_time)>.1);
  const result=await runHybrid(plan,d,item,{outputPath:join(root,'out.mp4'),workRoot:root,hardware:false});assert.equal(result.sourceDecoders,2,'the new sample-based path requires a verified zero audio origin');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('explicit bounded groups keep persistent overlays independently cacheable',()=>{
 const persistent={id:'p',assetId:'chapter-progress',startFrame:0,durationFrames:1200,props:{}};
 assert.deepEqual(visualGroups({canvas,instances:[persistent]},100,650,undefined,{maxFrames:300}),[[100,400],[400,700],[700,750]]);
 assert.deepEqual(visualGroups({canvas,instances:[persistent]},100,650),[[100,750]],'public default remains compatible');
});

test('fractional source with music, camera and complex visuals uses normalized source clock',async()=>{
 const root=mkdtempSync(join(tmpdir(),'hybrid-fractional-'));
 try{
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=s=96x64:r=30000/1001:d=2','-f','lavfi','-i','aevalsrc=0.15*sin(2*PI*(220+90*t)*t):s=48000:d=2','-c:v','libx264','-crf','12','-pix_fmt','yuv420p','-x264-params','colorprim=bt709:transfer=bt709:colormatrix=bt709','-c:a','aac',join(root,'source.mp4')]);
  const clips=Array.from({length:10},(_,n)=>({id:`c${n}`,sourceInFrame:3+n*5,startFrame:n*3,durationFrames:3}));
  const d={canvas:{width:96,height:64,fps:{num:30,den:1},durationFrames:30},source:{path:'source.mp4',publicPath:'source.mp4',startFrame:0,clips,cameraPlan:{version:2,duration:2,events:[{at:0,to:'A',transition:'cut',purpose:'hook',cue:'test',reason:'test'},{from:.2,toTime:1.2,to:'B',transition:'slow',easing:'linear',purpose:'argument',cue:'test',reason:'test'}]}},instances:[{id:'overlay',assetId:'number-beat',startFrame:0,durationFrames:30,props:{}}],audioClips:[{id:'music',publicPath:'source.mp4',sourceInFrame:0,startFrame:0,durationFrames:30,volume:.1}]};
  const item={renderMode:'full',extension:'mp4',rangeStartFrame:0,durationFrames:30};
  const plan=planHybrid(d,item,{publicRoot:root});assert.ok(plan,'fractional source must support music/camera/visuals without browser-only fallback');
  let renderedSource;const renderVisual=async p=>{renderedSource=p.document.source.publicPath;const out=join(root,'visual.mp4');execFileSync('ffmpeg',['-v','error','-i',join(root,renderedSource),'-t','1','-an','-c:v','libx264',out]);return out;};
  const result=await runHybrid(plan,d,item,{outputPath:join(root,'out.mp4'),workRoot:root,renderVisual,hardware:false});
  assert.equal(result.sourceDecoders,1);assert.equal(result.normalizedSource,true);assert.notEqual(renderedSource,'source.mp4');
  const meta=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',join(root,renderedSource)]));const v=meta.streams.find(s=>s.codec_type==='video');
  assert.deepEqual([v.width,v.height,v.avg_frame_rate,v.color_transfer,v.color_primaries,v.color_space],[96,64,'30/1','bt709','bt709','bt709']);
  const nativeDoc={...d,instances:[]},nativePlan=planHybrid(nativeDoc,item,{publicRoot:root});
  const native=await runHybrid(nativePlan,nativeDoc,item,{outputPath:join(root,'native.mp4'),workRoot:root,hardware:false});
  assert.equal(native.sourceDecoders,1);assert.equal(native.normalizationCacheHit,true);
  const camera=buildCameraFilter(compileShotPlan(d.source.cameraPlan),{width:96,height:64,fps:30,anchor:{x:.5,y:.5}});
  const expected=execFileSync('ffmpeg',['-v','error','-i',join(root,'source.mp4'),'-vf',`fps=30:start_time=0,scale=96:64,setsar=1,${camera}`,'-an','-f','rawvideo','-pix_fmt','rgb24','-'],{maxBuffer:4*1024*1024});
  const actual=execFileSync('ffmpeg',['-v','error','-i',join(root,'native.mp4'),'-an','-f','rawvideo','-pix_fmt','rgb24','-'],{maxBuffer:4*1024*1024});
  assert.equal(actual.length,30*96*64*3);
  for(let n=0;n<30;n++){const wanted=clips[Math.floor(n/3)].sourceInFrame+n%3,size=96*64*3;let error=0;for(let k=0;k<size;k++)error+=Math.abs(actual[n*size+k]-expected[wanted*size+k]);assert.ok(error/size<5,`fractional camera frame ${n} source ${wanted}: mean byte error ${error/size}`);}
  const decodeAudio=path=>execFileSync('ffmpeg',['-v','error','-i',path,'-vn','-ac','1','-ar','48000','-f','f32le','-']);
  const sourceAudio=decodeAudio(join(root,'source.mp4')),actualAudio=decodeAudio(join(root,'native.mp4'));
  assert.ok(Math.abs(actualAudio.length/4-48000)<1024,'AAC output duration stays within one packet');
  for(let n=0;n<10;n++){let dot=0,x2=0,y2=0,error=0;
   for(let k=800;k<4000;k++){const sample=n*4800+k,x=sourceAudio.readFloatLE((clips[n].sourceInFrame*1600+k)*4)+.1*sourceAudio.readFloatLE(sample*4),y=actualAudio.readFloatLE(sample*4);dot+=x*y;x2+=x*x;y2+=y*y;error+=(x-y)**2;}
   assert.ok(dot/Math.sqrt(x2*y2)>.98,`cut ${n} retains source sample alignment`);assert.ok(Math.sqrt(error/3200)<.015,`cut ${n} mix amplitude matches original source samples`);
  }

 }finally{rmSync(root,{recursive:true,force:true});}
});

test('chunked persistent visual ranges preserve absolute clock across every join',async()=>{
 const root=mkdtempSync(join(tmpdir(),'hybrid-chunks-'));
 try{
  const c={width:64,height:36,fps:{num:30,den:1},durationFrames:330},persistent={id:'p',assetId:'chapter-progress',startFrame:0,durationFrames:330,sourceDurationFrames:360,sourceOffsetFrames:15,props:{}};
  const d={canvas:c,source:null,instances:[persistent]},item={renderMode:'full',extension:'mp4',rangeStartFrame:0,durationFrames:330},plan=planHybrid(d,item,{publicRoot:root});
  assert.deepEqual(plan.groups,[[0,300],[300,330]]);const seen=[];
  const renderVisual=async p=>{seen.push([p.rangeStartFrame,p.renderDurationFrames]);assert.equal(p.document.instances[0].sourceOffsetFrames,15);assert.equal(p.document.instances[0].sourceDurationFrames,360);
   const out=join(root,`chunk-${p.rangeStartFrame}.mp4`);execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=s=64x36:r=30:d=11','-vf',`trim=start_frame=${p.rangeStartFrame}:end_frame=${p.rangeStartFrame+p.renderDurationFrames},setpts=PTS-STARTPTS`,'-c:v','libx264','-crf','0','-pix_fmt','yuv420p',out]);return out;};
  await runHybrid(plan,d,item,{outputPath:join(root,'out.mp4'),workRoot:root,renderVisual,hardware:false});assert.deepEqual(seen,[[0,300],[300,30]]);
  const expected=execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=s=64x36:r=30:d=11','-f','rawvideo','-pix_fmt','rgb24','-'],{maxBuffer:4*1024*1024});
  const actual=execFileSync('ffmpeg',['-v','error','-i',join(root,'out.mp4'),'-f','rawvideo','-pix_fmt','rgb24','-'],{maxBuffer:4*1024*1024});assert.equal(actual.length,expected.length);
  for(const n of [0,1,298,299,300,301,329]){let sum=0;const size=64*36*3;for(let k=0;k<size;k++)sum+=Math.abs(expected[n*size+k]-actual[n*size+k]);assert.ok(sum/size<5,`absolute frame ${n} average error ${sum/size}`);}
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('lossless source normalization preserves full-range decoded pixels',async()=>{
 const {normalizeHybridSource}=await import('../lib/editor-source-normalization.mjs');const root=mkdtempSync(join(tmpdir(),'hybrid-full-range-'));
 try{
  const source=join(root,'source.mp4');execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=s=64x36:r=30000/1001:d=0.4','-c:v','libx264','-pix_fmt','yuvj420p','-crf','12',source]);
  const d={canvas:{width:64,height:36,fps:{num:30,den:1},durationFrames:12},source:{publicPath:'source.mp4',startFrame:0},instances:[],audioClips:[{id:'music'}]},item={renderMode:'full',extension:'mp4',rangeStartFrame:0,durationFrames:12};
  const plan=planHybrid(d,item,{publicRoot:root});assert.ok(plan.requiresNormalization);const normalized=await normalizeHybridSource(plan,d);
  const actualMeta=normalized.plan.sourceMeta.streams.find(s=>s.codec_type==='video');assert.equal(actualMeta.color_range,'pc');
  const raw=(path,vf)=>execFileSync('ffmpeg',['-v','error','-i',path,...(vf?['-vf',vf]:[]),'-an','-pix_fmt','yuvj420p','-f','rawvideo','-']);
  assert.deepEqual(raw(normalized.plan.source),raw(source,'fps=30:start_time=0'),'standardization changes frame timing without requantizing pixels');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('embedded media sound and preset SFX preserve the full Remotion audio path',()=>{
 const d={canvas,source:null,instances:[{id:'s',assetId:'media-stage',startFrame:0,durationFrames:30,props:{variant:{sound:'keep'},slots:{clip:'some.mp4'}}}]},item={renderMode:'full',extension:'mp4',rangeStartFrame:0,durationFrames:30};
 assert.equal(planHybrid(d,item,{publicRoot:'.'}),null);
 d.instances[0].props={sfx:{file:'whoosh.wav'}};assert.equal(planHybrid(d,item,{publicRoot:'.'}),null);
});
