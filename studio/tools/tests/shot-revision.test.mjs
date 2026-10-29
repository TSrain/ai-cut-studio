import test from 'node:test';
import assert from 'node:assert/strict';
import {validateShotRevision,applyShotRevision,revisionContext} from '../lib/shot-revision.mjs';
const doc=()=>({id:'p',canvas:{fps:{num:30,den:1}},source:null,instances:[{id:'i',startFrame:30,durationFrames:60,props:{text:'A'},trackId:'t'}],tracks:[{id:'t'}],productionPlan:{shots:[{id:'s',requirementVersion:1,slots:[],visualRequirement:'old',bindings:[{instanceId:'i'}],timing:{ranges:[{id:'r',startFrame:30,durationFrames:60}]},candidates:[{url:'https://a',readAt:'x'}]}],appliedResultIds:[],dismissedResultIds:[]}});
const snap=()=>({jobId:'j',projectId:'p',shotId:'s',kind:'revise',target:{rangeId:'r',startFrame:30,durationFrames:60},document:doc()});
const result=()=>({id:'o',jobId:'j',projectId:'p',shotId:'s',kind:'shot-revision',target:snap().target,reason:'修改当前文字',gaps:[],patches:[{entity:'instance',id:'i',field:'props',before:{text:'A'},after:{text:'B'}}]});
test('bounded edits merge unrelated concurrent fields and preserve candidate state',()=>{const current=doc();current.name='new';const next=applyShotRevision(result(),snap(),current);assert.equal(next.instances[0].props.text,'B');assert.equal(next.productionPlan.shots[0].requirementVersion,1);assert.equal(next.name,'new');assert.deepEqual(next.productionPlan.shots[0].candidates,current.productionPlan.shots[0].candidates);assert.deepEqual(applyShotRevision(result(),snap(),next),next);});
test('rejects stale, deleted, locked and outside-shot targets',()=>{for(const mutate of [d=>d.instances[0].props.text='C',d=>d.instances=[],d=>d.tracks[0].locked=true,d=>d.instances[0].startFrame=0]){const d=doc();mutate(d);assert.throws(()=>applyShotRevision(result(),snap(),d));}});
test('rejects arbitrary paths and snapshot forgery',()=>{const r=result();r.patches[0].field='path';assert.throws(()=>validateShotRevision(r,snap()));const forged=result();forged.patches[0].before={text:'other'};assert.throws(()=>validateShotRevision(forged,snap()));});
test('context excludes locked targets and includes current full plan',()=>{const s=snap();s.document.tracks[0].locked=true;assert.equal(revisionContext(s).editable.filter(x=>x.entity==='instance').length,0);assert.equal(revisionContext(s).document.productionPlan.shots[0].candidates[0].readAt,'x');});
test('camera zoom updates events and bounded caption text is editable',()=>{
 const s=snap();s.document.source={path:'video.mp4',startFrame:0,cameraPlan:{duration:10,events:[{at:0,to:'A',transition:'cut'}],clipGroups:[{id:'cam',start:1,in:.3,hold:.4,out:.3,zoom:1.12,enabled:true}]}};
 s.document.captions={cues:[{id:'cue',startFrame:30,endFrame:50,text:'旧',originalText:'旧',initialText:'旧'}]};
 const r={...result(),patches:[{entity:'camera',id:'cam',field:'zoom',before:1.12,after:1.2},{entity:'caption',id:'cue',field:'text',before:'旧',after:'新'}]};
 const next=applyShotRevision(r,s,s.document);assert.equal(next.source.cameraPlan.events[1].zoom,1.2);assert.equal(next.captions.cues[0].text,'新');
});
test('adds a bounded camera clip to an empty source camera plan',()=>{
 const s=snap();s.document.source={path:'video.mp4',startFrame:0,durationFrames:300};
 const capability=revisionContext(s).editable.find(p=>p.entity==='camera-create');assert.ok(capability);
 const r={...result(),patches:[{...capability,after:{id:capability.id,start:1,in:.4,hold:1,out:.4,zoom:1.15,enabled:true,name:'强调',inEasing:'ramped',outEasing:'ramped'}}]};
 const next=applyShotRevision(r,s,s.document);assert.equal(next.source.cameraPlan.clipGroups.length,1);assert.equal(next.source.cameraPlan.events[1].zoom,1.15);
 const outside=structuredClone(r);outside.patches[0].after.start=0;assert.throws(()=>applyShotRevision(outside,s,s.document));
 const locked=structuredClone(s.document);locked.source.locked=true;assert.throws(()=>applyShotRevision(r,s,locked));
});
test('sound edits protect actual automatic baseline and manual change',async()=>{
 const {createHash}=await import('node:crypto');const s=snap();
 s.document.audioClips=[{id:'a',trackId:'at',startFrame:30,durationFrames:30,volume:1}];s.document.audioTracks=[{id:'at'}];
 const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
 s.document.styleReference={allowedOverrides:{soundDesign:{baselines:{a:digest(s.document.audioClips[0])}}}};
 const r={...result(),patches:[{entity:'audio',id:'a',field:'volume',before:1,after:.5}]};
 const next=applyShotRevision(r,s,s.document);assert.equal(next.audioClips[0].volume,.5);assert.equal(next.styleReference.allowedOverrides.soundDesign.baselines.a,digest(next.audioClips[0]));
 const manual=structuredClone(s.document);manual.audioClips[0].volume=.9;assert.throws(()=>applyShotRevision(r,s,manual));
 delete s.document.styleReference.allowedOverrides.soundDesign;assert.throws(()=>validateShotRevision(r,s));
});
test('camera creation uses exact one-clip mapping and preserves remote groups',()=>{
 const s=snap();s.document.canvas.durationFrames=300;s.document.source={path:'video.mp4',startFrame:0,durationFrames:600,clips:[{id:'main',startFrame:0,durationFrames:300,sourceInFrame:150}],cameraPlan:{version:2,duration:20,events:[{at:0,to:'A',transition:'cut'}],clipGroups:[{id:'remote',start:12,in:.4,hold:.4,out:.4,zoom:1.12,enabled:true}]}};
 const capability=revisionContext(s).editable.find(x=>x.entity==='camera-create');assert.ok(capability);
 const r={...result(),patches:[{...capability,after:{id:capability.id,start:6,in:.4,hold:1,out:.4,zoom:1.15,enabled:true,name:'强调',inEasing:'ramped',outEasing:'ramped'}}]};
 const next=applyShotRevision(r,s,s.document);assert.deepEqual(next.source.cameraPlan.clipGroups[0],s.document.source.cameraPlan.clipGroups[0]);assert.equal(next.source.cameraPlan.clipGroups.length,2);
 const repeated=structuredClone(s);repeated.document.source.clips.push({id:'repeat',startFrame:100,durationFrames:100,sourceInFrame:180});assert.throws(()=>applyShotRevision(r,repeated,repeated.document));
});
test('explicit absent semantic fields use null before and canonical values are written',()=>{
 const s=snap();const context=revisionContext(s);const field=context.editable.find(p=>p.entity==='shot'&&p.field==='animationNeed');assert.deepEqual(field,{entity:'shot',id:'s',field:'animationNeed',before:null});
 const r={...result(),patches:[{...field,after:'none'},{entity:'shot',id:'s',field:'requiredInformation',before:null,after:['保留事实']}]};
 const next=applyShotRevision(r,s,s.document);assert.equal(next.productionPlan.shots[0].animationNeed,'none');assert.deepEqual(next.productionPlan.shots[0].requiredInformation,['保留事实']);
 const current=structuredClone(s.document);current.productionPlan.shots[0].animationNeed='required';assert.throws(()=>applyShotRevision(r,s,current));
});
test('verified footage and delivery identities permit only bounded current automatic media',()=>{
 for(const key of ['footageIdentity','deliveryIdentity']){
  const s=snap();s.document.productionPlan.shots[0].bindings=[];s.document.instances[0].props[key]={resultId:'old',applicationKey:'a'.repeat(64),...(key==='footageIdentity'?{candidateId:'c',placementId:'p'}:{})};s.document.productionPlan.appliedResultIds.push('old');
  const r={...result(),patches:[{entity:'instance',id:'i',field:'props',before:structuredClone(s.document.instances[0].props),after:{...structuredClone(s.document.instances[0].props),text:'B'}}]};
  assert.equal(applyShotRevision(r,s,s.document).instances[0].props.text,'B');
  const unverified=structuredClone(s);unverified.document.productionPlan.appliedResultIds=[];assert.throws(()=>validateShotRevision(r,unverified));
 }
});
test('manual or unknown caption baseline is protected',()=>{
 const s=snap();s.document.captions={cues:[{id:'c',startFrame:30,endFrame:50,text:'手动字幕',originalText:'原文'}]};
 assert.equal(revisionContext(s).editable.filter(p=>p.entity==='caption').length,0);
 const r={...result(),patches:[{entity:'caption',id:'c',field:'text',before:'手动字幕',after:'模型字幕'}]};assert.throws(()=>applyShotRevision(r,s,s.document));
});
