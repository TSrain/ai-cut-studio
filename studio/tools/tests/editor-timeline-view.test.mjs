import test from 'node:test';
import assert from 'node:assert/strict';
import * as view from '../editor/timeline-view.mjs';
const doc={canvas:{fps:{num:30,den:1},durationFrames:7200},tracks:[{id:'v'}],instances:[{id:'a',trackId:'v',startFrame:150,durationFrames:90}],captions:{cues:[{id:'c',startFrame:30,endFrame:95,text:'字幕'}]},source:null};
test('适配字幕使用字幕时间范围而非动画选择',()=>{
 assert.deepEqual(view.timelineSelection(doc,{captionId:'c'}),{start:30,end:95,count:1,kind:'caption'});
 assert.equal(view.timelineSelection(doc,{captionId:'missing'}),null);
});
test('动画与主轨选择仍沿用实际片段范围',()=>{
 const selected=view.timelineSelection(doc,{keys:['a']});
 assert.equal(selected.start,150);assert.equal(selected.end,240);assert.equal(selected.count,1);
});
test('短块保证移动区域，放大后才启用裁切与文字',()=>{
 assert.equal(view.clipDensity(9),'compact');assert.equal(view.clipDensity(22),'compact');
 assert.equal(view.clipDensity(60),'label');assert.equal(view.clipDensity(140),'detail');
});
test('时间轴可超过40vh且给预览保留空间，缩窗和异常值受限',()=>{
 assert.equal(view.clampTimelineHeight(479,958),479);
 assert.ok(view.clampTimelineHeight(10000,800)<=542);
 assert.ok(view.clampTimelineHeight(-10,800)>=180);
 assert.ok(Number.isFinite(view.clampTimelineHeight(NaN,800)));
});
test('时间范围读数扣除固定轨头并限制到片尾',()=>{
 assert.deepEqual(view.visibleTimelineRange({scrollLeft:300,viewport:1000,labelWidth:168,px:2,duration:7200}),{start:150,end:566});
 assert.deepEqual(view.visibleTimelineRange({scrollLeft:14300,viewport:1000,labelWidth:168,px:2,duration:7200}),{start:7150,end:7200});
});
test('单一镜头移动后仍按当前范围适配，重复素材按点中的出现位置适配',()=>{
 const source={startFrame:0,cameraPlan:{clipGroups:[{id:'cam',name:'镜头',start:1,in:.5,hold:1,out:.5}]}};
 const d={...doc,source};
 assert.deepEqual(view.timelineSelection(d,{cameraId:'cam',cameraRange:{startFrame:0,endFrame:60}}),{start:30,end:90,count:1,kind:'camera'});
 d.source={...source,clips:[{id:'a',startFrame:300,durationFrames:100,sourceInFrame:0},{id:'b',startFrame:900,durationFrames:100,sourceInFrame:0}]};
 assert.deepEqual(view.timelineSelection(d,{cameraId:'cam',cameraRange:{startFrame:930,endFrame:990}}),{start:930,end:990,count:1,kind:'camera'});
 assert.equal(view.timelineSelection(d,{cameraId:'cam',cameraRange:{startFrame:0,endFrame:60}}),null);
});
