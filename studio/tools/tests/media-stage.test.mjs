import test from 'node:test';
import assert from 'node:assert/strict';
import {stageGeometry,stageVideoTiming,stageImportSlots,titleCharacterState} from '../../templates/remotion-base/src/presets/media-stage.mjs';
test('wide, portrait and square media fit beneath the title on horizontal and vertical canvases',()=>{
 for(const [w,h] of [[1920,1080],[1080,1920],[1280,720]])for(const ratio of [16/9,9/16,1,3/2]){
  const g=stageGeometry(w,h,ratio,1);
  assert.ok(g.x>=0&&g.y>=h*.2&&g.x+g.width<=w+.01&&g.y+g.height<=h*.94+.01);
  assert.ok(Math.abs(g.width/g.height-ratio)<1e-8);
 }
});
test('replace image and video clears the previous media and resets trim',()=>{
 assert.deepEqual(stageImportSlots('image',{publicPath:'screens/new.png',width:720,height:1280}),{image:'screens/new.png',imgW:720,imgH:1280,clip:'',startSeconds:0});
 assert.deepEqual(stageImportSlots('video',{publicPath:'footage/new.mp4',canvas:{width:1920,height:1080},durationSeconds:2}),{clip:'footage/new.mp4',srcW:1920,srcH:1080,srcDur:2,image:'',startSeconds:0});
});
test('trim uses source time once and short video has an actual last available frame',()=>{
 const t=stageVideoTiming(2,1.2,30);
 assert.equal(t.trim,36);assert.equal(t.available,24);
 assert.equal(stageVideoTiming(.01,0,30).available,1);
 assert.equal(stageVideoTiming(2,999,30).available,1);
});
test('all title animations start hidden and settle without positional drift',()=>{
 for(const mode of ['stagger','reveal','tracking'])for(let i=0;i<12;i++){
  assert.equal(titleCharacterState(0,30,i,12,mode).opacity,0);
  const last=titleCharacterState(90,30,i,12,mode);
  assert.equal(last.opacity,1);assert.equal(last.y,0);assert.equal(last.x,0);
 }
 assert.ok(titleCharacterState(10,30,0,8,'stagger').opacity>titleCharacterState(10,30,7,8,'stagger').opacity);
});

test('export refuses missing media, absent duration and invalid video trim',async()=>{
 const {validateEditorProps}=await import('../lib/editor-props.mjs');
 const check=(slots,opts={})=>validateEditorProps({assetId:'media-stage',props:{slots}},180,{fps:30,...opts});
 assert.throws(()=>check({title:'展示'},{requireAssets:true}),/缺少/);
 assert.throws(()=>check({title:'展示',clip:'demo.mp4'}),/时长/);
 assert.throws(()=>check({title:'展示',clip:'demo.mp4',srcDur:2,startSeconds:2}),/起点/);
 assert.throws(()=>check({title:'   '}),/非空/);
 assert.doesNotThrow(()=>check({title:'展示',clip:'demo.mp4',srcDur:2,startSeconds:1}));
});
