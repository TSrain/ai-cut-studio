import test from 'node:test';
import assert from 'node:assert/strict';
const model=await import('../editor/timeline-model.mjs').catch(()=>({}));
const clip=(id,start,duration,z=0)=>({id,assetId:'number-beat',assetVersion:1,startFrame:start,durationFrames:duration,zIndex:z,props:{slots:{label:id}}});
const doc=()=>({schemaVersion:1,id:'test',name:'test',revision:0,canvas:{width:1920,height:1080,fps:{num:30,den:1},durationFrames:600},source:null,instances:[clip('a',0,90),clip('b',120,90,1),clip('c',30,120,2)]});
test('迁移把不重叠片段放同轨并保留所有重叠的遮挡顺序',()=>{assert.equal(typeof model.ensureTimeline,'function');const d=model.ensureTimeline(doc());assert.equal(d.instances[0].trackId,d.instances[1].trackId);assert.notEqual(d.instances[0].trackId,d.instances[2].trackId);assert.deepEqual(doc().instances.map(x=>x.props),d.instances.map(x=>x.props));assert.deepEqual(model.ensureTimeline(d),d);});
test('整体移动在零点统一限制且间距不变',()=>{const d=model.ensureTimeline(doc());const n=model.moveSelection(d,['a','b'],-60);assert.equal(n.instances[0].startFrame,0);assert.equal(n.instances[1].startFrame,120);const p=model.moveSelection(d,['a','b'],60);assert.equal(p.instances[0].startFrame,60);assert.equal(p.instances[1].startFrame,180);assert.equal(d.instances[0].startFrame,0);});
test('同轨碰撞拒绝整次移动',()=>{const d=model.ensureTimeline({...doc(),instances:[clip('a',0,90),clip('b',120,90)]});assert.throws(()=>model.moveSelection(d,['a'],60),/重叠|空位/);});
test('框选按矩形交集选择，反向框选一致',()=>{assert.deepEqual(model.marqueeIds({x:110,y:70,width:-100,height:-60},[{id:'a',x:20,y:20,width:20,height:20},{id:'b',x:150,y:20,width:20,height:20}]),['a']);});
test('分割保持动画源时钟，右段不重新入场',()=>{const d=model.ensureTimeline({...doc(),instances:[clip('a',30,120)]});const n=model.splitSelection(d,['a'],75,()=> 'right');assert.equal(n.instances.length,2);assert.deepEqual(n.instances.map(x=>[x.startFrame,x.durationFrames,x.sourceOffsetFrames,x.sourceDurationFrames]),[[30,45,0,120],[75,75,45,120]]);assert.equal(n.instances[1].trackId,n.instances[0].trackId);});
test('分割首尾不产生零长片段',()=>{const d=model.ensureTimeline({...doc(),instances:[clip('a',30,120)]});assert.equal(model.splitSelection(d,['a'],30,()=> 'right').instances.length,1);});
test('裁切后可恢复被裁内容，不能越过源内容',()=>{const d=model.ensureTimeline({...doc(),instances:[clip('a',30,120)]});const n=model.trimClip(d,'a','left',30);assert.deepEqual([n.instances[0].startFrame,n.instances[0].durationFrames,n.instances[0].sourceOffsetFrames],[60,90,30]);const restored=model.trimClip(n,'a','left',-100);assert.deepEqual([restored.instances[0].startFrame,restored.instances[0].durationFrames,restored.instances[0].sourceOffsetFrames],[30,120,0]);});
test('复制到播放头保留时间差、属性且生成新ID，冲突自动放新轨',()=>{const d=model.ensureTimeline(doc());let k=0;const p=model.copySelection(d,['a','b']);const n=model.pasteSelection(d,p,60,()=>`copy-${++k}`);const copies=n.instances.slice(3);assert.deepEqual(copies.map(x=>x.startFrame),[60,180]);assert.equal(new Set(n.instances.map(x=>x.id)).size,5);assert.notEqual(copies[0].trackId,d.instances[0].trackId);copies[0].props.slots.label='copy';assert.equal(d.instances[0].props.slots.label,'a');});
test('锁定轨不被批量命令改变',()=>{const d=model.ensureTimeline(doc());d.tracks.find(t=>t.id===d.instances[0].trackId).locked=true;const n=model.deleteSelection(d,['a','b']);assert.equal(n.instances.length,3);assert.deepEqual(model.moveSelection(d,['a','b'],60),d);});
test('源视频拆分、移动与留空删除保留源入点',()=>{const d=model.ensureTimeline({...doc(),instances:[],source:{path:'media.mp4',startFrame:10}});const id='source/'+d.source.clips[0].id;const n=model.splitSelection(d,[id],150,()=> 'right');assert.deepEqual(n.source.clips.map(x=>[x.startFrame,x.durationFrames,x.sourceInFrame]),[[0,150,10],[150,450,160]]);const empty=model.deleteSelection(n,['source/right']);assert.equal(empty.source.clips.length,1);assert.equal(empty.canvas.durationFrames,600);});
test('粘贴越过片尾明确失败而不截断内容',()=>{const d=model.ensureTimeline(doc());assert.throws(()=>model.pasteSelection(d,model.copySelection(d,['a']),590,()=> 'copy'),/片尾|时长/);});
test('锚定缩放保持指针下的时间',()=>{const f=model.zoomAtPointer({scrollLeft:400,clientX:500,rectLeft:100,labelWidth:168,oldPx:2,newPx:4});assert.equal((400+500-100-168)/2,(f+500-100-168)/4);});
test('复制多轨按原层级粘贴，数组倒序或部分轨碰撞都不反转',()=>{
 for(const upperStart of [0,100]){
 const d=model.ensureTimeline({...doc(),instances:[clip('upper',upperStart,50,10),clip('lower',0,50,0)]});
 // Explicitly retain distinct tracks even for the non-overlapping partial-collision case.
 if(d.instances[0].trackId===d.instances[1].trackId){d.tracks.push({id:'upper-track',name:'upper'});d.instances[0].trackId='upper-track';}
 let n=0;const pasted=model.pasteSelection(d,model.copySelection(d,['upper','lower']),upperStart===0?0:100,()=>`copy-${++n}`);
 const upper=pasted.instances.find(i=>i.id==='copy-1'),lower=pasted.instances.find(i=>i.id==='copy-2');
 assert.ok(upper.zIndex>lower.zIndex);assert.ok(pasted.tracks.findIndex(t=>t.id===upper.trackId)>pasted.tracks.findIndex(t=>t.id===lower.trackId));assert.deepEqual(pasted.instances.slice(0,2),d.instances);
 }
});
test('源轨锁定使混合粘贴原子失败且不移动已有内容',()=>{const d=model.ensureTimeline({...doc(),source:{path:'media.mp4',startFrame:0,clips:[{id:'s',startFrame:0,durationFrames:40,sourceInFrame:0}]}}),clipboard=model.copySelection(d,['a','source/s']);d.source.locked=true;const snapshot=structuredClone(d);let n=0;assert.throws(()=>model.pasteSelection(d,clipboard,300,()=>`copy-${++n}`),/锁定/);assert.deepEqual(d,snapshot);});
test('下轨被占用但上轨可复用时，整组改用新轨保留遮挡关系',()=>{const d=model.ensureTimeline({...doc(),instances:[clip('upper',0,50,10),clip('lower',0,50,0),clip('blocker',100,50,0)]});let n=0;const result=model.pasteSelection(d,model.copySelection(d,['upper','lower']),100,()=>`copy-${++n}`);const upper=result.instances.find(i=>i.id==='copy-1'),lower=result.instances.find(i=>i.id==='copy-2');assert.notEqual(upper.trackId,d.instances[0].trackId);assert.ok(upper.zIndex>lower.zIndex);assert.deepEqual(result.instances.slice(0,3),d.instances);});
test('混合源视频和多轨粘贴保留层级与相对时间，原片段不变',()=>{const d=model.ensureTimeline({...doc(),instances:[clip('upper',0,50,10),clip('lower',0,50,0)],source:{path:'media.mp4',startFrame:0,clips:[{id:'s',startFrame:10,durationFrames:20,sourceInFrame:70}]}});let n=0;const result=model.pasteSelection(d,model.copySelection(d,['source/s','upper','lower']),100,()=>`copy-${++n}`);assert.deepEqual(result.instances.slice(0,2),d.instances);assert.deepEqual(result.source.clips[0],d.source.clips[0]);assert.equal(result.source.clips[1].startFrame,110);assert.equal(result.source.clips[1].sourceInFrame,70);assert.ok(result.instances[2].zIndex>result.instances[3].zIndex);});
test('迁移旧层级后跨轨移动和插入仍遵循轨道遮挡顺序',()=>{
 const d=model.ensureTimeline({...doc(),instances:[clip('low',0,200,0),clip('mid',0,50,10),clip('high',0,200,20),clip('moving',250,40,30)]});
 const target=d.instances.find(i=>i.id==='mid').trackId;
 for(const n of [model.moveSelection(d,['moving'],-150,target),model.placeInstance(d,clip('new',100,40),target)]){
  const item=n.instances.find(i=>i.id===(n.instances.some(i=>i.id==='new')?'new':'moving'));
  assert.ok(item.zIndex>n.instances.find(i=>i.id==='low').zIndex);
  assert.ok(item.zIndex<n.instances.find(i=>i.id==='high').zIndex);
 }
});
