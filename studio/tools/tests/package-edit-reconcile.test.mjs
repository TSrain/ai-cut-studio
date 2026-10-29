import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcilePackageDocument as reconcile,inspectPackageEdits} from '../lib/package-edit-reconcile.mjs';
const base=()=>({source:{path:'/original.mp4',durationFrames:100,clips:[{id:'s',startFrame:0,sourceInFrame:0,durationFrames:100}]},canvas:{fps:{num:30,den:1},width:1920,height:1080,durationFrames:100},instances:[],tracks:[{id:'auto'}],captions:{cues:[{id:'c',startFrame:50,endFrame:60,text:'原句'}]}});
const visual=(id='v',startFrame=50,durationFrames=10)=>({id,startFrame,durationFrames,trackId:'auto',props:{text:'演示'}});
const run=(b,p,c,writeSet=['instances'])=>reconcile(b,p,c,{writeSet});
test('deletion retimes new media and clips its original playback offsets',()=>{const b=base(),p=structuredClone(b),c=structuredClone(b);p.instances=[visual('v',10,50)];c.source.clips=[{startFrame:0,sourceInFrame:30,durationFrames:70}];c.canvas.durationFrames=70;const r=run(b,p,c);assert.deepEqual(r.document.instances[0],{...visual('v',0,30),sourceOffsetFrames:20,sourceDurationFrames:50});assert.deepEqual(r.document.source,c.source);assert.deepEqual(r.document.canvas,c.canvas);});
test('entire removed recommendation is discarded',()=>{const b=base(),p=structuredClone(b),c=structuredClone(b);p.instances=[visual('v',0,10)];c.source.clips=[{startFrame:0,sourceInFrame:30,durationFrames:70}];assert.deepEqual(run(b,p,c).document.instances,[]);});
test('manual caption words win and new visuals require review',()=>{const b=base(),p=structuredClone(b),c=structuredClone(b);p.captions.cues[0].text='自动修正';p.instances=[visual()];c.captions.cues[0].text='人工纠正';const r=run(b,p,c,['instances','captions.cues']);assert.equal(r.document.captions.cues[0].text,'人工纠正');assert.equal(r.document.instances.length,0);assert.equal(r.report.needsReview.length,1);});
test('edge extension preserves current captions in newly revealed time',()=>{const b=base();b.source.clips=[{startFrame:0,sourceInFrame:20,durationFrames:80}];b.canvas.durationFrames=80;const p=structuredClone(b),c=structuredClone(b);p.instances=[visual()];c.source.clips=[{startFrame:0,sourceInFrame:0,durationFrames:100}];c.canvas.durationFrames=100;c.captions.cues.push({id:'new',startFrame:0,endFrame:20,text:'新增原话'});const r=run(b,p,c,['instances','captions.cues']);assert.equal(r.document.instances[0].startFrame,70);assert.deepEqual(r.document.captions,c.captions);});
test('track lock prevents new writes',()=>{const b=base(),p=structuredClone(b),c=structuredClone(b);p.instances=[visual()];c.tracks[0].locked=true;assert.deepEqual(run(b,p,c).document.instances,[]);});
test('source replacement rejects publication',()=>{const b=base(),c=structuredClone(b);c.source.path='/replacement.mp4';assert.throws(()=>inspectPackageEdits(b,c),/identity changed/);});
test('idempotent publication preserves current-deleted objects',()=>{const b=base(),p=structuredClone(b);p.instances=[visual()];const first=run(b,p,b).document;assert.deepEqual(run(b,p,first).document,first);const old=structuredClone(first),next=structuredClone(old),current=structuredClone(old);next.instances[0].props.text='更新';current.instances=[];assert.deepEqual(run(old,next,current).document.instances,[]);});
test('manual object values and unrelated fields survive',()=>{const b=base();b.instances=[visual()];const p=structuredClone(b),c=structuredClone(b);p.instances[0].props.text='自动';c.instances[0].props.text='人工';c.name='手调';assert.deepEqual(run(b,p,c).document,c);});
test('queue array paths and source camera plan writes',()=>{const b=base(),p=structuredClone(b);p.source.cameraPlan={shots:[{sourceInFrame:40}]};const r=run(b,p,b,[{path:['source','cameraPlan']}]);assert.deepEqual(r.document.source.cameraPlan,p.source.cameraPlan);assert.equal(inspectPackageEdits(b,r.document).safe,true);});
test('implicit source origin changes and speed are unsupported',()=>{const b=base();delete b.source.clips;const c=structuredClone(b);c.source.startFrame=10;assert.throws(()=>inspectPackageEdits(b,c),/origin/);const d=base();d.source.clips[0].playbackRate=2;assert.throws(()=>inspectPackageEdits(base(),d),/speed/);});
test('caption edits protect only overlapping visuals',()=>{const b=base(),p=structuredClone(b),c=structuredClone(b);p.instances=[visual('near',50,10),visual('far',80,10)];c.captions.cues[0].text='纠正';assert.deepEqual(run(b,p,c).document.instances.map(x=>x.id),['far']);});
test('fully removed shots become cancelled and lose bindings',()=>{const b=base(),p=structuredClone(b),c=structuredClone(b);p.productionPlan={shots:[{id:'shot',timing:{ranges:[{startFrame:0,durationFrames:10}]},bindings:[{id:'binding',startFrame:0,durationFrames:10}]}]};c.source.clips=[{startFrame:0,sourceInFrame:30,durationFrames:70}];const s=run(b,p,c,['productionPlan']).document.productionPlan.shots[0];assert.equal(s.status,'cancelled');assert.deepEqual(s.bindings,[]);});
test('source ancestor lock protects camera writes',()=>{const b=base(),p=structuredClone(b),c=structuredClone(b);p.source.cameraPlan={shots:[]};c.source.locked=true;assert.equal(run(b,p,c,[{path:['source','cameraPlan']}]).document.source.cameraPlan,undefined);});
test('removed or cancelled plan shots cannot gain instances or bindings',()=>{for(const deleted of [true,false]){const b=base();b.productionPlan={shots:[{id:'shot',timing:{ranges:[{startFrame:50,durationFrames:10}]},bindings:[]}]};const p=structuredClone(b),c=structuredClone(b);p.instances=[visual()];p.productionPlan.shots[0].bindings=[{id:'bind',instanceId:'v'}];if(deleted)c.productionPlan.shots=[];else c.productionPlan.shots[0].cancelled=true;const r=run(b,p,c,['instances','productionPlan']);assert.deepEqual(r.document.instances,[]);if(!deleted)assert.deepEqual(r.document.productionPlan.shots[0].bindings,[]);}});
test('removed narration uses native cancellation fields',()=>{const b=base(),p=structuredClone(b),c=structuredClone(b);p.productionPlan={shots:[{id:'gone',timing:{status:'resolved',ranges:[{startFrame:0,durationFrames:10}]},bindings:[]}]};c.source.clips=[{startFrame:0,sourceInFrame:30,durationFrames:70}];const shot=run(b,p,c,['productionPlan']).document.productionPlan.shots[0];assert.equal(shot.cancelled,true);assert.notEqual(shot.timing.status,'resolved');});
test('disabled tracks and instances protect package writes',()=>{const b=base(),p=structuredClone(b),c=structuredClone(b);p.instances=[visual()];c.tracks[0].disabled=true;assert.deepEqual(run(b,p,c).document.instances,[]);b.instances=[visual()];p.instances=[visual()];p.instances[0].props.text='自动';c.instances=[visual()];c.instances[0].disabled=true;assert.equal(run(b,p,c).document.instances[0].props.text,'演示');});
test('trusted applied caption readback allows same-sentence templates while manual differences remain protected',()=>{const b=base(),p=structuredClone(b),c=structuredClone(b);p.instances=[visual()];c.captions.cues[0].text='自动修正';const accepted=structuredClone(c);const r=reconcile(b,p,c,{writeSet:['instances'],acceptedCaptionDocuments:[accepted]});assert.equal(r.document.instances.length,1);c.captions.cues[0].text='人工另改';const q=reconcile(b,p,c,{writeSet:['instances'],acceptedCaptionDocuments:[accepted]});assert.equal(q.document.instances.length,0);assert.equal(q.report.needsReview.length,1);});
test('caption resegmentation deletes unchanged old cue and protects manual cue',()=>{const b=base(),p=structuredClone(b);p.captions.cues=[{id:'new',startFrame:50,endFrame:60,text:'新断句'}];assert.deepEqual(run(b,p,b,['captions.cues']).document.captions.cues,p.captions.cues);const c=structuredClone(b);c.captions.cues[0].text='手改';assert.equal(run(b,p,c,['captions.cues']).document.captions.cues.find(x=>x.id==='c').text,'手改');});
test('continuous project and playback portions merge across source split',()=>{const b=base(),p=structuredClone(b),c=structuredClone(b);p.instances=[visual('v',40,30)];c.source.clips=[{startFrame:0,sourceInFrame:0,durationFrames:50},{startFrame:50,sourceInFrame:50,durationFrames:50}];assert.deepEqual(run(b,p,c).document.instances,p.instances);});
test('caption resegmentation cannot revive current-deleted words with new IDs',()=>{const b=base(),p=structuredClone(b),c=structuredClone(b);p.captions.cues=[{id:'replacement',startFrame:50,endFrame:60,text:'新断句'}];c.captions.cues=[];assert.deepEqual(run(b,p,c,['captions.cues']).document.captions.cues,[]);});

test('trusted caption extraction excludes manually retained words',async()=>{const {acceptedPackageCaptionDocument}=await import('../lib/package-edit-reconcile.mjs');assert.equal(typeof acceptedPackageCaptionDocument,'function');const b=base(),p=structuredClone(b),readback=structuredClone(b);p.captions.cues[0].text='自动纠正';readback.captions.cues[0].text='人工保留';const accepted=acceptedPackageCaptionDocument(b,p,readback);assert.deepEqual(accepted.captions.cues,[]);const v=structuredClone(b);v.instances=[visual()];assert.equal(reconcile(b,v,readback,{writeSet:['instances'],acceptedCaptionDocuments:[accepted]}).report.needsReview.length,1);readback.captions.cues[0].text='自动纠正';assert.equal(acceptedPackageCaptionDocument(b,p,readback).captions.cues.length,1);});


test('manual edits or deletion after trusted resegmentation block only affected visuals',async()=>{
 const {acceptedPackageCaptionDocument}=await import('../lib/package-edit-reconcile.mjs');
 const b=base(),cap=structuredClone(b),proposal=structuredClone(b);
 cap.captions.cues=[{id:'first',startFrame:50,endFrame:55,text:'自动前半'},{id:'second',startFrame:55,endFrame:60,text:'自动后半'}];
 const accepted=acceptedPackageCaptionDocument(b,cap,cap);
 proposal.instances=[visual('first-visual',50,5),visual('second-visual',55,5)];
 assert.equal(reconcile(b,proposal,cap,{writeSet:['instances'],acceptedCaptionDocuments:[accepted]}).document.instances.length,2);
 for(const deletion of [false,true]){
  const current=structuredClone(cap);
  if(deletion)current.captions.cues.shift();else current.captions.cues[0].text='人工改变含义';
  const result=reconcile(b,proposal,current,{writeSet:['instances'],acceptedCaptionDocuments:[accepted]});
  assert.deepEqual(result.document.instances.map(i=>i.id),['second-visual']);
  assert.equal(result.report.needsReview.length,1);
 }
});
test('manual replacement cue IDs require visual review without trusted application',()=>{
 const b=base(),p=structuredClone(b),c=structuredClone(b);
 c.captions.cues=[{id:'manual-new',startFrame:50,endFrame:60,text:'人工重写'}];p.instances=[visual()];
 const result=run(b,p,c);assert.deepEqual(result.document.instances,[]);assert.equal(result.report.needsReview.length,1);
});
test('automatic resegmentation cannot overlap newly inserted manual cues',()=>{
 const b=base(),p=structuredClone(b),c=structuredClone(b);
 p.captions.cues=[{id:'automatic',startFrame:50,endFrame:60,text:'自动重断'}];
 c.captions.cues=[{...b.captions.cues[0],endFrame:55},{id:'manual-new',startFrame:55,endFrame:60,text:'人工追加'}];
 const result=run(b,p,c,['captions']);assert.deepEqual(result.document.captions,c.captions);
 assert.ok(result.report.protectedPaths.some(p=>p.includes('manual-caption-overlap')));
});
