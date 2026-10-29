import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePlan,planRanges,reconcilePlan,mergePlans,dependencyFingerprint,currentPlanMarkdown,changePlan} from '../lib/production-plan-model.mjs';
const effect=()=>({status:'draft',sourcePath:'talk.mp4',startSeconds:2,changeSeconds:2.4,holdSeconds:3.5,endSeconds:4,evidence:{sourceSha256:'a'.repeat(64),transcriptHash:'b'.repeat(64),sourceCueIds:[1,2],reason:'已查看对应口播，效果只覆盖强调句'}});
const doc=()=>({id:'p',revision:1,name:'test',canvas:{fps:{num:30,den:1},durationFrames:300,width:1080,height:1920},source:{path:'talk.mp4',clips:[{id:'a',startFrame:0,sourceInFrame:0,durationFrames:300}]},instances:[],productionPlan:{shots:[{id:'s',title:'强调',approval:'approved',requirementVersion:1,visualRequirement:'当前画面',mediaDescription:'',narration:'原文',anchor:{sourcePath:'talk.mp4',startSeconds:0,endSeconds:8,confidence:1},effectTiming:effect()}]}});
test('effect range is shorter than narration without rewriting its anchor or claiming confirmed',()=>{
 const d=doc(),r=reconcilePlan(d),s=r.productionPlan.shots[0];
 assert.deepEqual(planRanges(r).map(x=>[x.startFrame,x.durationFrames]),[[60,60]]);
 assert.equal(s.anchor.endSeconds,8);assert.equal(s.timing.status,'review');assert.equal(d.productionPlan.shots[0].timing,undefined);
 assert.ok(currentPlanMarkdown(r).includes('效果时间设计'));
});
test('effect timing follows split source and manual trim wins',()=>{
 const d=doc();d.source.clips=[{id:'a',startFrame:0,sourceInFrame:0,durationFrames:90},{id:'b',startFrame:100,sourceInFrame:105,durationFrames:90}];
 assert.deepEqual(planRanges(d).map(x=>[x.startFrame,x.durationFrames]),[[60,30],[100,15]]);
 d.productionPlan.shots[0].timing={status:'manual',manual:true,ranges:[{id:'hand',startFrame:220,durationFrames:20}]};
 assert.deepEqual(planRanges(d).map(x=>[x.startFrame,x.durationFrames]),[[220,20]]);
});
test('invalid timing evidence and inverted stages are rejected; replacement source cannot reuse timing',()=>{
 for(const edit of [e=>e.endSeconds=1,e=>e.changeSeconds=5,e=>e.evidence.transcriptHash='',e=>e.evidence.sourceCueIds=[0],e=>e.status='estimated']) {
  const d=doc();edit(d.productionPlan.shots[0].effectTiming);assert.throws(()=>normalizePlan(d.productionPlan),/effect timing/i);
 }
 const d=doc();d.source.path='new.mp4';assert.equal(planRanges(d).length,0);
});
test('camera and layering design edits invalidate approval and stale production results',()=>{
 for(const field of ['cameraIntent','presenterLayerIntent','effectTiming']) {
  const d=doc(),base=normalizePlan(d.productionPlan),incoming=structuredClone(base);const before=dependencyFingerprint(d,'s');
  incoming.shots[0][field]=field==='effectTiming'?{...effect(),endSeconds:4.5}:{purpose:'强调',mode:field==='cameraIntent'?'push':'behind-presenter'};
  const merged=mergePlans(base,base,incoming);assert.equal(merged.shots[0].approval,'needs_design');
  assert.notEqual(dependencyFingerprint({...d,productionPlan:merged},'s'),before);
 }
});

test('effect range respects speed and disabled source clips',()=>{
 const d=doc();d.source.clips=[{id:'a',startFrame:0,sourceInFrame:0,durationFrames:150,playbackRate:2},{id:'off',startFrame:150,sourceInFrame:0,durationFrames:150,disabled:true}];
 assert.deepEqual(planRanges(d).map(x=>[x.startFrame,x.durationFrames]),[[30,30]]);
});

test('existing actual use preserves plan timing; removed binding does not block new design',()=>{
 const d=doc();d.instances=[{id:'actual',startFrame:150,durationFrames:45}];
 const s=d.productionPlan.shots[0];s.timing={status:'aligned',manual:false,ranges:[{id:'existing',startFrame:30,durationFrames:60}]};
 s.slots=[{id:'slot',type:'animation',description:'动画'}];s.bindings=[{id:'b',slotId:'slot',instanceId:'actual',status:'current'}];
 assert.deepEqual(planRanges(d).map(x=>[x.startFrame,x.durationFrames]),[[30,60]]);
 s.bindings[0].status='removed';assert.deepEqual(planRanges(d).map(x=>[x.startFrame,x.durationFrames]),[[60,60]]);
});

test('reset timing clears legacy manual status and restores automatic effect range',()=>{
 const d=doc();d.productionPlan.shots[0].timing={status:'manual',manual:true,ranges:[{id:'hand',startFrame:220,durationFrames:20}]};
 const r=changePlan(d,{type:'reset-timing',shotId:'s'});
 assert.equal(r.productionPlan.shots[0].timing.manual,false);
 assert.deepEqual(planRanges(r).map(x=>[x.startFrame,x.durationFrames]),[[60,60]]);
});
