import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureTimeline,moveSelection,splitSelection} from '../editor/timeline-model.mjs';
const layer=(id,startFrame,durationFrames)=>({id,assetId:'number-beat',assetVersion:1,startFrame,durationFrames,zIndex:0,props:{slots:{label:id}}});
const fixture=(instances=[])=>ensureTimeline({schemaVersion:1,id:'linked',name:'linked',revision:0,canvas:{width:1920,height:1080,fps:{num:30,den:1},durationFrames:900},source:{path:'video.mp4',startFrame:0,durationFrames:900,clips:[{id:'left',startFrame:0,durationFrames:150,sourceInFrame:0},{id:'right',startFrame:150,durationFrames:150,sourceInFrame:150}]},instances});
test('主视频移动携带其范围内的模板，保留间距和原动画时钟',()=>{
 const d=fixture([layer('a',20,60),layer('b',180,60)]),before=structuredClone(d);
 const n=moveSelection(d,['source/right'],90);
 assert.equal(n.instances.find(i=>i.id==='a').startFrame,20);
 assert.equal(n.instances.find(i=>i.id==='b').startFrame,270);
 assert.equal(n.source.clips[1].startFrame,240);assert.deepEqual(d,before);
});
test('跨越分割点的模板只移动对应部分，左右片段仍读取原动画帧',()=>{
 const d=fixture([layer('cross',120,90)]),n=moveSelection(d,['source/right'],90);
 assert.deepEqual(n.instances.map(i=>[i.startFrame,i.durationFrames,i.sourceOffsetFrames,i.sourceDurationFrames]),[[120,30,0,90],[240,60,30,90]]);
 assert.equal(n.instances[0].id,'cross');assert.notEqual(n.instances[1].id,'cross');
});
test('已经分割的模板再次切段保留累计offset，多选不重复移动',()=>{
 const d=fixture([{...layer('b',180,60),sourceOffsetFrames:40,sourceDurationFrames:120}]);
 const n=moveSelection(d,['source/right','b'],90);
 assert.equal(n.instances[0].startFrame,270);assert.equal(n.instances[0].sourceOffsetFrames,40);
});
test('零移动不拆模板，端点相接的模板不被关联',()=>{
 const d=fixture([layer('end',100,50),layer('after',300,60)]);
 assert.deepEqual(moveSelection(d,['source/right'],0),d);
 assert.deepEqual(moveSelection(d,['source/right'],90).instances,d.instances);
});
test('关联模板锁定时拒绝整组移动，避免主轨单独错位',()=>{
 const d=fixture([layer('b',180,60)]);d.tracks[0].locked=true;
 assert.throws(()=>moveSelection(d,['source/right'],90),/锁定/);
});
test('关联模板目的地冲突时原子失败',()=>{
 const d=fixture([layer('b',180,60),layer('occupied',360,60)]);
 assert.throws(()=>moveSelection(d,['source/right'],180),/重叠|空位/);
});
test('多段主视频和跨段模板联动一次，间隙部分留在原位',()=>{
 const d=fixture([layer('span',100,300)]);d.source.clips=[{id:'one',startFrame:100,durationFrames:50,sourceInFrame:0},{id:'two',startFrame:250,durationFrames:50,sourceInFrame:50}];
 const n=moveSelection(d,['source/one','source/two'],400);
 assert.deepEqual(n.instances.map(i=>[i.startFrame,i.durationFrames,i.sourceOffsetFrames]),[[500,50,0],[150,100,50],[650,50,150],[300,100,200]]);
 assert.equal(new Set(n.instances.map(i=>i.id)).size,4);
});
test('只移动模板不会带动主视频',()=>{const d=fixture([layer('b',180,60)]),n=moveSelection(d,['b'],20);assert.equal(n.instances[0].startFrame,200);assert.deepEqual(n.source,d.source);});
test('现有主轨分割后直接移动也能联动，无需重新建项目',()=>{const d=fixture([layer('b',180,60)]);d.source.clips=[{id:'whole',startFrame:0,durationFrames:300,sourceInFrame:0}];const split=splitSelection(d,['source/whole'],150,()=> 'split');assert.equal(moveSelection(split,['source/split'],90).instances[0].startFrame,270);});
