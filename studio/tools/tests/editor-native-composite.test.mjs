import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
test('opaque full-canvas media reuses its picture with correctly trimmed main audio; overlap falls back',async()=>{
 const {planNativeComposite,runNativeComposite}=await import('../lib/editor-native-composite.mjs');
 const root=mkdtempSync(join(tmpdir(),'composite-fast-'));
 try{
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=red:s=64x36:r=30:d=1','-c:v','libx264','-pix_fmt','yuv420p',join(root,'visual.mp4')]);
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=700:duration=2','-c:a','aac',join(root,'voice.m4a')]);
  const d={canvas:{width:64,height:36,fps:{num:30,den:1},durationFrames:60},source:{publicPath:'voice.m4a',startFrame:3},instances:[{id:'clip',assetId:'source-pip',startFrame:15,durationFrames:30,props:{sourceMode:'media',media:{kind:'video',publicPath:'visual.mp4',width:64,height:36,durationSeconds:1,startSeconds:0},crop:{x:0,y:0,width:1,height:1,sourceAspect:64/36},size:100*64/36,x:50,y:50,radius:0,borderWidth:0,shadow:0,entrance:'none',exit:'none',transitionSeconds:0,editorBackground:'transparent'}}]};
  const item={renderMode:'full',rangeStartFrame:15,durationFrames:30,extension:'mp4'};
  const captions={enabled:true,cues:[{startFrame:0,endFrame:60,text:'字幕覆盖素材'}]};
  assert.equal(planNativeComposite({...d,captions},item,{publicRoot:root}),null);
  assert.ok(planNativeComposite({...d,captions:{...captions,enabled:false}},item,{publicRoot:root}));
  const plan=planNativeComposite(d,item,{publicRoot:root});assert.ok(plan);assert.equal(plan.audioStartSeconds,.6);
  assert.equal(planNativeComposite({...d,instances:[...d.instances,{...d.instances[0],id:'overlap'}]},item,{publicRoot:root}),null);
  const output=join(root,'out.mp4');await runNativeComposite(plan,{outputPath:output});
  const streams=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',output])).streams;
  assert.equal(streams.find(s=>s.codec_type==='video').nb_frames,'30');assert.ok(streams.some(s=>s.codec_type==='audio'));
 }finally{rmSync(root,{recursive:true,force:true});}
});
