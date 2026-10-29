import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDocument} from '../lib/editor-store.mjs';
import {DEFAULT_CAPTION_STYLE,resolveCaptionStyle} from '../../templates/remotion-base/src/editor/captions.mjs';
import {audioVolumeAt,editAudioFades} from '../../templates/remotion-base/src/editor/audio.mjs';
import {reviewContext,applyReviewResult} from '../lib/editor-review-model.mjs';
import {createReviewService} from '../lib/editor-review-service.mjs';
const doc=()=>createDocument({id:'demo',name:'审片测试',revision:1,canvas:{width:640,height:360,fps:{num:30,den:1},durationFrames:180},source:{path:'media/talk.mp4',publicPath:'media/talk.mp4',startFrame:0,durationFrames:300,clips:[{id:'s',startFrame:0,durationFrames:180,sourceInFrame:60}]},instances:[],captions:{version:1,enabled:true,style:{...DEFAULT_CAPTION_STYLE},cues:[{id:'c',startFrame:0,endFrame:60,text:'原文',originalText:'原文'},{id:'other',startFrame:60,endFrame:120,text:'别处',originalText:'别处'}]}});
const result=value=>({summary:'修正当前字幕',patches:[{key:'caption/c/text',value}],gaps:[]});
test('frame anchor has source time and edits only active targets',()=>{const c=reviewContext(doc(),15);assert.equal(c.anchor.sourceFrame,75);assert.ok(c.editable.some(e=>e.key==='caption/c/text'));assert.ok(!c.editable.some(e=>e.key==='caption/other/text'));});
test('apply preserves unrelated edits and rejects concurrent target/source/lock changes',()=>{const d=doc(),s=reviewContext(d,15),current=structuredClone(d);current.name='改名';current.captions.cues[1].text='手调';const next=applyReviewResult(s,result('新文'),current);assert.equal(next.name,'改名');assert.equal(next.captions.cues[1].text,'手调');assert.equal(next.captions.cues[0].text,'新文');assert.equal(next.captions.cues[0].originalText,'原文');for(const change of [x=>x.captions.cues[0].text='已改',x=>x.captions.locked=true,x=>x.source.clips[0].sourceInFrame=61]){const n=doc();change(n);assert.throws(()=>applyReviewResult(s,result('新文'),n));}});
test('unknown targets and type changes cannot escape bounded changes',()=>{const s=reviewContext(doc(),15);assert.throws(()=>applyReviewResult(s,{...result('x'),patches:[{key:'source/path',value:'/etc/passwd'}]},doc()));assert.throws(()=>applyReviewResult(s,result(12),doc()));});
test('caption positioning is scoped to current cue',()=>{const d=doc(),s=reviewContext(d,15);const next=applyReviewResult(s,{...result('x'),patches:[{key:'caption/c/style.bottomPercent',value:20}]},d);assert.equal(next.captions.cues[0].style.bottomPercent,20);assert.equal(next.captions.style.bottomPercent,8);assert.equal(next.captions.cues[1].style,undefined);});
const captionPosition={summary:'调整字幕位置',patches:[{key:'caption/c/style.bottomPercent',value:20}],gaps:[]};
test('caption revert restores inheritance and the original local storage shape',()=>{
 for(const style of [undefined,{}, {color:'#ff0000'}, {bottomPercent:12,color:'#ff0000'}]){
  const d=doc();if(style!==undefined)d.captions.cues[0].style=style;
  const s=JSON.parse(JSON.stringify(reviewContext(d,15))),applied=applyReviewResult(s,captionPosition,d);
  applied.captions.style.bottomPercent=30;
  const reverted=applyReviewResult(s,captionPosition,applied,{reverse:true});
  assert.deepEqual(reverted.captions.cues[0],d.captions.cues[0]);
  assert.equal(resolveCaptionStyle(reverted.captions,reverted.captions.cues[0]).bottomPercent,style?.bottomPercent??30);
 }
});
test('caption revert removes only its override and retains concurrent local edits',()=>{
 const d=doc(),s=reviewContext(d,15),applied=applyReviewResult(s,captionPosition,d);
 applied.captions.cues[0].style.color='#123456';applied.captions.cues[0].text='手调文案';
 const reverted=applyReviewResult(s,captionPosition,applied,{reverse:true});
 assert.deepEqual(reverted.captions.cues[0].style,{color:'#123456'});assert.equal(reverted.captions.cues[0].text,'手调文案');
});
test('caption override storage changes remain conflicts even with equal effective values',()=>{
 const d=doc(),s=reviewContext(d,15),current=structuredClone(d);current.captions.cues[0].style={bottomPercent:8};
 assert.throws(()=>applyReviewResult(s,captionPosition,current),/已被修改/);
 const applied=applyReviewResult(s,captionPosition,d);delete applied.captions.cues[0].style;applied.captions.style.bottomPercent=20;
 assert.throws(()=>applyReviewResult(s,captionPosition,applied,{reverse:true}),/已被修改/);
});
const audioDoc=()=>{const d=doc();d.audioTracks=[{id:'music',name:'配乐'}];d.audioClips=[{id:'a',trackId:'music',name:'配乐',path:'media/music.wav',startFrame:0,durationFrames:60,sourceInFrame:60,sourceDurationFrames:300,volume:1,fadeInFrames:0,fadeOutFrames:120,envelopeOffsetFrames:60,envelopeDurationFrames:180}];return d;};
const fadeResult=patch=>({summary:'调整淡化',patches:Object.entries(patch).map(([field,value])=>({key:'audio/a/'+field,value})),gaps:[]});
test('review fade edits rebase a split envelope exactly like precision controls',()=>{
 for(const patch of [{fadeInFrames:30},{fadeOutFrames:30},{fadeInFrames:30,fadeOutFrames:20}]){
  const d=audioDoc(),s=reviewContext(d,15),next=applyReviewResult(s,fadeResult(patch),d);
  const expected={...d.audioClips[0],...editAudioFades(d.audioClips[0],patch)};
  assert.deepEqual(next.audioClips[0],expected);
  if(patch.fadeInFrames)assert.equal(audioVolumeAt(next.audioClips[0],0),0);
  if(patch.fadeOutFrames){assert.equal(audioVolumeAt(next.audioClips[0],60),0);assert.ok(audioVolumeAt(next.audioClips[0],59)<.1);}
  assert.deepEqual(applyReviewResult(s,fadeResult(patch),next,{reverse:true}).audioClips,d.audioClips);
  assert.deepEqual(d.audioClips[0].envelopeOffsetFrames,60);
 }
});
test('review fade revert restores raw envelope metadata and clamped sibling fades',()=>{
 for(const envelope of [{},{envelopeOffsetFrames:0},{envelopeDurationFrames:180},{envelopeOffsetFrames:60,envelopeDurationFrames:180}]){
  const d=audioDoc();delete d.audioClips[0].envelopeOffsetFrames;delete d.audioClips[0].envelopeDurationFrames;Object.assign(d.audioClips[0],envelope);
  const s=JSON.parse(JSON.stringify(reviewContext(d,15))),r=fadeResult({fadeInFrames:30}),applied=applyReviewResult(s,r,d);
  assert.equal(applied.audioClips[0].fadeOutFrames,60);
  applied.audioClips[0].volume=.4;applied.audioClips[0].fadeInCurve='smooth';
  const reverted=applyReviewResult(s,r,applied,{reverse:true});
  assert.deepEqual(reverted.audioClips[0],{...d.audioClips[0],volume:.4,fadeInCurve:'smooth'});
 }
});
test('review fades reject concurrent dependent-envelope or sibling-fade changes',()=>{
 const d=audioDoc(),s=reviewContext(d,15),r=fadeResult({fadeInFrames:30});
 for(const field of ['envelopeOffsetFrames','envelopeDurationFrames','fadeOutFrames']){
  const current=structuredClone(d);current.audioClips[0][field]++;
  assert.throws(()=>applyReviewResult(s,r,current),/已被修改/);
  const applied=applyReviewResult(s,r,d);applied.audioClips[0][field]++;
  assert.throws(()=>applyReviewResult(s,r,applied,{reverse:true}),/已被修改/);
 }
 const current=structuredClone(d);delete current.audioClips[0].envelopeOffsetFrames;
 assert.throws(()=>applyReviewResult(s,r,current),/已被修改/);
 const applied=applyReviewResult(s,r,d);delete applied.audioClips[0].envelopeOffsetFrames;
 assert.throws(()=>applyReviewResult(s,r,applied,{reverse:true}),/已被修改/);
 const inherited=audioDoc();delete inherited.audioClips[0].envelopeOffsetFrames;
 const inheritedSnapshot=reviewContext(inherited,15);inherited.audioClips[0].envelopeOffsetFrames=0;
 assert.throws(()=>applyReviewResult(inheritedSnapshot,r,inherited),/已被修改/);
});
test('service persists notes, requires acceptance and supports conflict-safe revert',async()=>{const root=mkdtempSync(join(tmpdir(),'review-service-'));let d=doc();const opts={root,load:()=>structuredClone(d),save:n=>(d={...n,revision:d.revision+1}),runner:async()=>result('新文'),capture:async()=>null};try{const svc=createReviewService(opts);let n=await svc.add({projectId:'demo',revision:1,frame:15,text:'把这句改成新文'});await svc.run('demo',n.id);n=svc.list('demo')[0];assert.equal(n.status,'ready');assert.equal(d.captions.cues[0].text,'原文');const out=svc.accept('demo',n.id,d.revision);assert.equal(out.document.captions.cues[0].text,'新文');assert.equal(svc.accept('demo',n.id,d.revision).document.revision,d.revision);assert.equal(createReviewService(opts).list('demo')[0].status,'applied');d.name='另一个改动';const reverted=svc.revert('demo',n.id,d.revision);assert.equal(reverted.document.captions.cues[0].text,'原文');assert.equal(reverted.document.name,'另一个改动');}finally{rmSync(root,{recursive:true,force:true});}});
test('cancellation ignores a late model result and notes from other projects are rejected',async()=>{const root=mkdtempSync(join(tmpdir(),'review-cancel-'));let finish;try{const svc=createReviewService({root,load:id=>{if(id!=='demo')throw Error('no project');return doc();},save:x=>x,capture:async()=>null,runner:()=>new Promise(r=>finish=r)});const n=await svc.add({projectId:'demo',revision:1,frame:15,text:'修改'});const work=svc.run('demo',n.id);await new Promise(r=>setImmediate(r));svc.cancel('demo',n.id);finish(result('新文'));await work;assert.equal(svc.list('demo')[0].status,'cancelled');assert.throws(()=>svc.get('other',n.id));}finally{rmSync(root,{recursive:true,force:true});}});
test('production handoff is explicit, scoped, durable and idempotent',async()=>{const root=mkdtempSync(join(tmpdir(),'review-delegate-'));try{let d=doc();d.productionPlan={shots:[{id:'shot',timing:{ranges:[{id:'r',startFrame:0,durationFrames:60}]}}]};let calls=[];const service=createReviewService({root,load:()=>structuredClone(d),save:n=>(d=n),runner:async()=>({summary:'需要素材流程',patches:[],gaps:['替换本段素材']}),capture:async()=>null});const note=await service.add({projectId:'demo',revision:1,frame:15,text:'把这段素材换成原始产品页面'});await service.run('demo',note.id);assert.equal(calls.length,0);const createJob=async r=>{calls.push(r);return {job:{id:'production-1'},document:d};};await assert.rejects(service.delegate('demo',note.id,2,createJob),/更新/);const response=await service.delegate('demo',note.id,1,createJob);assert.equal(response.note.status,'delegated');assert.equal(calls[0].shotId,'shot');assert.equal(calls[0].rangeId,'r');assert.deepEqual(calls[0].scope,{camera:false,sound:false,footage:true});await service.delegate('demo',note.id,1,createJob);assert.equal(calls.length,1);}finally{rmSync(root,{recursive:true,force:true});}});
