import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import * as camera from '../lib/aroll-shot-plan.mjs';
import {planNativeSource,runNativeSource} from '../lib/editor-native-source.mjs';
test('source-only full export preserves camera timing, audio and output duration; rejects overlays and unsupported sources',async()=>{
 const root=mkdtempSync(join(tmpdir(),'native-source-'));
 try {
 execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=s=640x360:r=30:d=2','-f','lavfi','-i','sine=frequency=440:duration=2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',join(root,'input.mp4')]);
 const document={canvas:{width:320,height:180,fps:{num:30,den:1},durationFrames:60},source:{publicPath:'input.mp4',startFrame:0},instances:[]};
 const item={extension:'mp4',renderMode:'full',rangeStartFrame:15,durationFrames:30};
 const captions={enabled:true,cues:[{startFrame:0,endFrame:60,text:'必须烧录的字幕'}]};
 assert.equal(planNativeSource({...document,captions},item,{publicRoot:root}),null);
 assert.ok(planNativeSource({...document,captions:{...captions,enabled:false}},item,{publicRoot:root}));
 const plan=planNativeSource(document,item,{publicRoot:root});assert.ok(plan);assert.equal(plan.startSeconds,.5);
 assert.equal(planNativeSource({...document,instances:[{id:'overlay'}]},item,{publicRoot:root}),null);
 assert.equal(planNativeSource({...document,source:{...document.source,publicPath:'../input.mp4'}},item,{publicRoot:root}),null);
 assert.equal(planNativeSource(document,{...item,extension:'mov'},{publicRoot:root}),null);
 assert.equal(planNativeSource({...document,canvas:{...document.canvas,width:3840,height:2160}},item,{publicRoot:root}),null);
 const events=[];const outputPath=join(root,'out.mp4');await runNativeSource(plan,{outputPath,onProgress:e=>events.push(e)});
 const info=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',outputPath]));
 assert.equal(info.streams[0].width,320);assert.equal(Number(info.streams[0].nb_frames),30);assert.ok(info.streams.some(s=>s.codec_type==='audio'));
 assert.equal(events.at(-1).completed,30);
 const accelerated=await runNativeSource(plan,{outputPath:join(root,'hardware.mp4'),hardwareAcceleration:'if-possible'});assert.ok(['libx264','h264_videotoolbox'].includes(accelerated.codec));
 const cameraDoc={...document,source:{...document.source,cameraPlan:{version:2,duration:2,anchor:{x:.5,y:.5},events:[{at:0,to:'A',transition:'cut',purpose:'hook',cue:'test',reason:'test'},{from:.5,toTime:1.5,to:'B',transition:'slow',easing:'linear',purpose:'argument',cue:'test',reason:'test'}]}}};
 assert.equal(planNativeSource(cameraDoc,item,{publicRoot:root}),null);
 const moving=planNativeSource(cameraDoc,item,{publicRoot:root,camera});assert.ok(moving);assert.match(moving.filters,/perspective/);
 await runNativeSource(moving,{outputPath:join(root,'moving.mp4')});
 const movingInfo=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',join(root,'moving.mp4')]));assert.equal(Number(movingInfo.streams[0].nb_frames),30);
 assert.equal(planNativeSource({...document,source:{...document.source,volume:0}},item,{publicRoot:root}),null);
 const whole=planNativeSource(cameraDoc,{...item,rangeStartFrame:0,durationFrames:60},{publicRoot:root,camera});
 await runNativeSource(whole,{outputPath:join(root,'whole.mp4')});
 const comparison=spawnSync('ffmpeg',['-v','info','-i',join(root,'whole.mp4'),'-i',join(root,'moving.mp4'),'-lavfi','[0:v]trim=start_frame=15:end_frame=45,setpts=PTS-STARTPTS[a];[a][1:v]ssim','-an','-f','null','-'],{encoding:'utf8'});assert.equal(comparison.status,0);assert.ok(Number(comparison.stderr.match(/All:([0-9.]+)/)?.[1])>.98,comparison.stderr);

 } finally {rmSync(root,{recursive:true,force:true});}
});
