import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_CAPTION_STYLE,validateCaptionTrack} from '../../templates/remotion-base/src/editor/captions.mjs';
import {editHistory,undoHistory,redoHistory} from '../editor/history.mjs';
import * as model from '../editor/roughcut-model.mjs';

const doc=(fps={num:30,den:1},frames=300)=>({schemaVersion:1,id:'roughcut-test',name:'原片',revision:0,canvas:{width:1920,height:1080,fps,durationFrames:frames},source:{path:'voice.mp4',publicPath:'voice.mp4',startFrame:0,durationFrames:frames,clips:[{id:'source-main',name:'主视频',startFrame:0,durationFrames:frames,sourceInFrame:0}]},instances:[],tracks:[],captions:{version:1,enabled:true,style:{...DEFAULT_CAPTION_STYLE},cues:[{id:'c1',startFrame:30,endFrame:150,text:'我不喜欢你',originalText:'我不喜欢你',initialText:'原字幕快照',style:{fontSize:60}}]}});
const words=()=>['我','不','喜欢','你'].map((text,i)=>({id:`u${i+1}`,text,startSeconds:i+1,endSeconds:i+2,timing:'word',groupId:'c1'}));
const analysis=(d=doc(),extra={})=>({version:1,sourceKey:model.roughcutSourceKey(d),sourceDurationSeconds:d.source.durationFrames*d.canvas.fps.den/d.canvas.fps.num,timing:'word',units:words(),silences:[],decisions:[{id:'remove-no',unitIds:['u2'],action:'delete',kind:'retake',reason:'删除口误',keepUnitIds:[],confidence:0.98}],warnings:[],...extra});
const first=d=>model.roughcutRows(d)[0];
const assertContinuous=d=>{let end=0;for(const c of d.source.clips){assert.equal(c.startFrame,end);assert.ok(c.durationFrames>0);end+=c.durationFrames;}assert.equal(end,d.canvas.durationFrames);};

test('source identity is stable under object ordering and changes only with source mapping identity',()=>{
 const d=doc(),key=model.roughcutSourceKey(d);d.name='重命名';d.captions.cues[0].text='修正';d.revision=20;assert.equal(model.roughcutSourceKey(d),key);
 assert.equal(model.roughcutSourceKey({...d,canvas:{...d.canvas,fps:{den:1,num:30}}}),key);
 for(const change of [x=>x.source.path='other.mp4',x=>x.source.clips[0].sourceInFrame++,x=>x.canvas.fps.num=25]){const copy=structuredClone(d);change(copy);assert.notEqual(model.roughcutSourceKey(copy),key);}
});

test('word deletion compacts AV source references and rebuilds complete nonrepeated caption text',()=>{
 const d=doc(),before=structuredClone(d),a=analysis(d),next=model.createRoughcut(d,a);
 assert.deepEqual(d,before);assert.equal(next.source.path,d.source.path);assert.equal(next.source.durationFrames,300);assert.equal(next.canvas.durationFrames,270);
 assert.deepEqual(next.source.clips.map(c=>[c.startFrame,c.durationFrames,c.sourceInFrame]),[[0,60,0],[60,210,90]]);
 assert.equal(next.captions.cues.map(c=>c.text).join(''),'我喜欢你');assert.deepEqual(next.captions.cues.map(c=>[c.startFrame,c.endFrame]),[[30,120]]);assertContinuous(next);validateCaptionTrack(next.captions,{durationFrames:270});
 assert.equal(first(next).projectFrame,60);assert.equal(first(next).text,'不');assert.equal(first(next).startSeconds,2);assert.equal(model.validateRoughcut(next.roughcut),true);
 assert.equal(model.roughcutSrt(next),'1\n00:00:01,000 --> 00:00:04,000\n我喜欢你\n');
});

test('disabling the final deletion restores exact original source and caption snapshot, repeatedly',()=>{
 const d=doc(),cut=model.createRoughcut(d,analysis(d)),id=first(cut).id;
 const restored=model.setRoughcutCut(cut,id,{enabled:false});assert.deepEqual(restored.source,d.source);assert.deepEqual(restored.captions,d.captions);assert.equal(restored.canvas.durationFrames,300);
 assert.deepEqual(model.setRoughcutCut(restored,id,{enabled:false}),restored);
 assert.deepEqual(model.resetRoughcut(cut),d);assert.deepEqual(model.resetRoughcut(model.resetRoughcut(cut)),d);
 const again=model.setRoughcutCut(restored,id,{enabled:true});assert.deepEqual(again.source.clips,cut.source.clips);assert.equal(again.captions.cues.map(c=>c.text).join(''),'我喜欢你');
});

test('pure edits support existing undo and redo history without mutating earlier results',()=>{
 const d=doc(),cut=model.createRoughcut(d,analysis(d)),before=structuredClone(cut),restored=model.setRoughcutCut(cut,first(cut).id,{enabled:false});
 const h=editHistory(editHistory({past:[],present:d,future:[]},cut),restored);assert.deepEqual(cut,before);assert.deepEqual(undoHistory(h).present,cut);assert.deepEqual(redoHistory(undoHistory(h)).present,restored);
});

test('long pauses remove only the middle and retain at least the requested natural gap',()=>{
 const d=doc(),next=model.createRoughcut(d,analysis(d,{decisions:[],silences:[{startSeconds:5,endSeconds:9}]}));const row=first(next);
 assert.equal(row.kind,'pause');assert.ok(row.startFrame>=158);assert.ok(row.endFrame<=262);assert.ok(row.startFrame-150+270-row.endFrame>=15);assertContinuous(next);
 assert.equal(next.captions.cues.map(c=>c.text).join(''),'我不喜欢你');
 assert.equal(model.roughcutRows(model.createRoughcut(d,analysis(d,{decisions:[],silences:[{startSeconds:5,endSeconds:6}]}))).length,0);
});

test('silence detector intervals overlapping spoken units never delete speech',()=>{
 const d=doc(),next=model.createRoughcut(d,analysis(d,{decisions:[],silences:[{startSeconds:1.5,endSeconds:4.5}]}));assert.equal(next.canvas.durationFrames,300);assert.ok(model.roughcutRows(next).every(r=>!r.enabled));
});

test('review and missing or low model scores remain intact until explicitly accepted',()=>{
 const d=doc();for(const patch of [{action:'review',confidence:1},{confidence:0.89},{confidence:undefined}]){const a=analysis(d);Object.assign(a.decisions[0],patch);if(patch.confidence===undefined)delete a.decisions[0].confidence;const next=model.createRoughcut(d,a);assert.equal(first(next).enabled,false);assert.equal(first(next).review,true);assert.equal(next.canvas.durationFrames,300);assert.equal(model.setRoughcutCut(next,first(next).id,{enabled:true}).canvas.durationFrames,270);}
});

test('segment decisions require explicit complete-sentence and safe-boundary evidence',()=>{
 const d=doc();delete d.captions;const base={id:'s1',text:'完整一句。',startSeconds:1,endSeconds:4,timing:'segment',groupId:'c1'};
 for(const flags of [{},{completeSentence:true},{completeSentence:true,safeBoundaries:false}]){const a=analysis(d,{timing:'segment',units:[{...base,...flags}],decisions:[{id:'ds',unitIds:['s1'],action:'delete',kind:'retake',reason:'重录',confidence:0.99}]});const next=model.createRoughcut(d,a);assert.equal(first(next).enabled,false);assert.equal(first(next).safeToEnable,false);assert.throws(()=>model.setRoughcutCut(next,first(next).id,{enabled:true}),/整句|边界|保护/);}
 const a=analysis(d,{timing:'segment',units:[{...base,completeSentence:true,safeBoundaries:true}],decisions:[{id:'ds',unitIds:['s1'],action:'delete',kind:'retake',reason:'重录',confidence:0.99}]});const next=model.createRoughcut(d,a);assert.equal(next.canvas.durationFrames,210);assert.equal(next.captions.cues.length,0);assert.throws(()=>model.setRoughcutCut(next,first(next).id,{startFrame:60}),/完整|句|字词/);
});

test('unit timing overrides mixed analysis timing and protected units cannot be enabled',()=>{
 const d=doc(),a=analysis(d,{timing:'segment'});assert.equal(model.createRoughcut(d,a).canvas.durationFrames,270);
 for(const flags of [{safeBoundaries:false},{protectionReasons:['可能漏字']}]){const b=analysis(d);Object.assign(b.units[1],flags);const next=model.createRoughcut(d,b);assert.equal(first(next).enabled,false);assert.throws(()=>model.setRoughcutCut(next,first(next).id,{enabled:true}),/边界|保护/);}
});

test('overlapping timing keeps affected units and does not create duplicate subtitle fragments',()=>{
 const d=doc(),a=analysis(d);a.units[1].startSeconds=1.5;const next=model.createRoughcut(d,a);assert.equal(first(next).enabled,false);assert.equal(next.canvas.durationFrames,300);assert.deepEqual(next.captions,d.captions);
});

test('keepUnitIds are hard protection across all decisions',()=>{
 const d=doc(),a=analysis(d);a.decisions[0].keepUnitIds=['u2'];const next=model.createRoughcut(d,a);assert.equal(first(next).enabled,false);assert.throws(()=>model.setRoughcutCut(next,first(next).id,{enabled:true}),/保留|保护/);
});

test('cut endpoints cannot clip half words, absorb retained speech, or create invalid ranges',()=>{
 const d=doc(),next=model.createRoughcut(d,analysis(d)),id=first(next).id;
 for(const patch of [{startFrame:61},{endFrame:89},{startFrame:30},{endFrame:120},{startFrame:-1},{endFrame:301},{endFrame:60},{startFrame:60.5},{enabled:'yes'},{foo:1}])assert.throws(()=>model.setRoughcutCut(next,id,patch),/粗剪/);
 assert.throws(()=>model.setRoughcutCut(next,'unknown',{enabled:false}),/不存在/);
});

test('cut adjustment within real speech-free gaps remains recoverable',()=>{
 const d=doc(),a=analysis(d);a.units[0].endSeconds=1.6;a.units[1].startSeconds=2.1;a.units[1].endSeconds=2.8;a.units[2].startSeconds=3.2;
 const next=model.createRoughcut(d,a),changed=model.setRoughcutCut(next,first(next).id,{startFrame:60,endFrame:90});assert.equal(changed.canvas.durationFrames,270);assertContinuous(changed);assert.deepEqual(model.resetRoughcut(changed),d);
});

test('noninteger fps uses one frame mapping with no holes or duplicated caption text',()=>{
 const d=doc({num:30000,den:1001},300),a=analysis(d);a.units=words().map((u,i)=>({...u,startSeconds:(i+1)*1.001,endSeconds:(i+2)*1.001}));const next=model.createRoughcut(d,a);
 assert.deepEqual(next.source.clips.map(c=>[c.startFrame,c.durationFrames,c.sourceInFrame]),[[0,60,0],[60,210,90]]);assert.equal(next.canvas.durationFrames,270);assertContinuous(next);assert.match(model.roughcutSrt(next),/00:00:01,001 --> 00:00:04,004/);
});

test('rejects stale source identity, locked source, partial clips, and existing dependent content',()=>{
 const d=doc(),a=analysis(d);for(const change of [x=>x.source.locked=true,x=>x.source.clips[0].sourceInFrame=1,x=>x.source.clips.push({...x.source.clips[0],id:'duplicate'}),x=>x.source.startFrame=1,x=>x.source.durationFrames=301,x=>x.instances.push({id:'manual'}),x=>x.audioClips=[{id:'music'}],x=>x.source.cameraPlan={version:2},x=>x.markers=[{id:'m',frame:10}],x=>x.productionPlan={version:1},x=>x.captions.locked=true]){const copy=structuredClone(d);change(copy);assert.throws(()=>model.createRoughcut(copy,{...a,sourceKey:model.roughcutSourceKey(copy)}),/原片|锁定|副本|工程/);}
 assert.throws(()=>model.createRoughcut(d,{...a,sourceKey:'stale'}),/来源|变更|匹配/);
});

test('subsequent source/caption/manual additions conflict rather than being overwritten',()=>{
 const d=doc(),next=model.createRoughcut(d,analysis(d));for(const change of [x=>x.source.clips[0].durationFrames--,x=>x.captions.cues[0].text='用户修订',x=>x.source.locked=true,x=>x.canvas.fps.num=60,x=>x.instances.push({id:'new'})]){const changed=structuredClone(next);change(changed);assert.throws(()=>model.setRoughcutCut(changed,first(next).id,{enabled:false}),/变更|修改|锁定|副本|冲突/);assert.throws(()=>model.resetRoughcut(changed),/变更|修改|锁定|副本|冲突/);}
 const renamed={...next,name:'可以改名',revision:4};assert.equal(model.setRoughcutCut(renamed,first(next).id,{enabled:false}).name,'可以改名');
});

test('analysis rejects nonexistent, duplicate, reversed or out-of-range units and model timestamps',()=>{
 const d=doc();for(const change of [a=>a.decisions[0].unitIds=['missing'],a=>a.decisions[0].unitIds=['u3','u2'],a=>a.units[1].id='u1',a=>a.units[0].startSeconds=-1,a=>a.units[3].endSeconds=11,a=>a.decisions[0].startSeconds=2,a=>a.decisions[0].confidence=NaN,a=>a.silences=[{startSeconds:8,endSeconds:7}]]){const a=analysis(d);change(a);assert.throws(()=>model.createRoughcut(d,a),/粗剪/);}
 for(const options of [{minPauseSeconds:0},{keepPauseSeconds:-1},{minPauseSeconds:1,keepPauseSeconds:2}])assert.throws(()=>model.createRoughcut(d,analysis(d),options),/粗剪/);
});

test('state validates snapshot integrity, cut bounds and generated fingerprint before saving',()=>{
 const d=doc(),next=model.createRoughcut(d,analysis(d));assert.equal(Object.isFrozen(next.roughcut.original),true);assert.equal(model.validateRoughcut(structuredClone(next.roughcut)),true);
 for(const change of [s=>s.original.source.path='tampered.mp4',s=>s.cuts[0].startFrame++,s=>s.resultFingerprint='fake',s=>s.analysis.units[1].text='篡改']){const s=structuredClone(next.roughcut);change(s);assert.throws(()=>model.validateRoughcut(s),/粗剪/);}
 assert.throws(()=>model.validateRoughcut(undefined),/粗剪/);assert.deepEqual(model.createRoughcut(next,analysis(d)),next);
});

test('reset removes generated subtitles when the original had none; no deletion still produces SRT',()=>{
 const d=doc();delete d.captions;const next=model.createRoughcut(d,analysis(d));assert.match(model.roughcutSrt(next),/我喜欢你/);assert.equal('captions' in model.resetRoughcut(next),false);
 const unchanged=model.createRoughcut(d,analysis(d,{decisions:[]}));assert.match(model.roughcutSrt(unchanged),/我不喜欢你/);
});

test('retiming rebuilds roughcut fingerprints and supports later restoration at target fps',()=>{
 const d=doc(),next=model.createRoughcut(d,analysis(d)),retimed=structuredClone(next);retimed.canvas.fps={num:60,den:1};
 const result=model.retimeRoughcutDocument(next,retimed);assert.equal(result.canvas.durationFrames,540);assert.equal(result.source.durationFrames,600);assertContinuous(result);assert.equal(model.validateRoughcut(result.roughcut),true);
 const restored=model.resetRoughcut(result);assert.equal(restored.canvas.durationFrames,600);assert.deepEqual(restored.captions.cues.map(c=>[c.startFrame,c.endFrame]),[[60,300]]);assert.equal(restored.captions.cues[0].initialText,'原字幕快照');assert.equal(model.setRoughcutCut(result,first(result).id,{enabled:false}).canvas.durationFrames,600);
});

test('sub-frame units stay protected and their original text is never dropped',()=>{
 const d=doc();delete d.captions;const a=analysis(d);a.units[1].startSeconds=2.001;a.units[1].endSeconds=2.002;
 const next=model.createRoughcut(d,a);assert.equal(first(next).enabled,false);assert.equal(first(next).safeToEnable,false);assert.equal(next.canvas.durationFrames,300);assert.equal(next.captions.cues.map(c=>c.text).join(''),'我不喜欢你');
});

test('retiming semantic boundaries follows original aligned units instead of rounded old frames',()=>{
 const d=doc(),a=analysis(d);a.units[0].endSeconds=1.9;a.units[1].startSeconds=2.02;a.units[1].endSeconds=2.98;a.units[2].startSeconds=3.2;
 const next=model.createRoughcut(d,a),retimed={...structuredClone(next),canvas:{...next.canvas,fps:{num:24,den:1}}};
 const result=model.retimeRoughcutDocument(next,retimed);assert.equal(first(result).startFrame,48);assert.equal(first(result).endFrame,72);assert.equal(model.validateRoughcut(result.roughcut),true);assert.equal(model.resetRoughcut(result).canvas.durationFrames,240);
});

test('semantic kinds cannot impersonate silence-detector pause records',()=>{
 const d=doc(),a=analysis(d);a.decisions[0].kind='pause';assert.throws(()=>model.createRoughcut(d,a),/粗剪/);
});

test('accepted media probe tail tolerance remains valid when exporting at a higher fps',()=>{
 const d=doc(),a=analysis(d,{sourceDurationSeconds:10.05}),next=model.createRoughcut(d,a);
 const retimed={...structuredClone(next),canvas:{...next.canvas,fps:{num:60,den:1}}};
 const result=model.retimeRoughcutDocument(next,retimed);assert.equal(result.source.durationFrames,600);assert.equal(model.validateRoughcut(result.roughcut),true);assert.equal(model.resetRoughcut(result).canvas.durationFrames,600);
});

test('frame quantization cannot make an adjacent protected short word disappear',()=>{
 const d=doc();delete d.captions;const a=analysis(d);a.units[0].endSeconds=2.001;a.units[1].startSeconds=2.001;a.units[1].endSeconds=2.002;a.units[2].startSeconds=2.002;a.decisions[0].unitIds=['u3'];
 const next=model.createRoughcut(d,a);assert.equal(first(next).enabled,false);assert.equal(next.canvas.durationFrames,300);assert.equal(next.captions.cues.map(c=>c.text).join(''),'我不喜欢你');
});

test('real smoke pause keeps segment tail and following protected speech while compressing the remaining silence',()=>{
 const d=doc({num:30,den:1},711);delete d.captions;
 const a=analysis(d,{units:[{id:'c4.s1',text:'这个功能是今年三月份上线的，我专门测试过。',startSeconds:11.67,endSeconds:16.254,timing:'segment',groupId:'c4',completeSentence:true,safeBoundaries:true},{id:'c5.w1',text:'它',startSeconds:18.754,endSeconds:18.914,timing:'word',groupId:'c5',protectionReasons:['possible_missing_transcript']}],decisions:[],silences:[{startSeconds:16.055563,endSeconds:18.761625}]});
 const next=model.createRoughcut(d,a),rows=model.roughcutRows(next);assert.equal(rows.length,1);assert.equal(rows[0].enabled,true);assert.deepEqual([rows[0].startFrame,rows[0].endFrame],[496,555]);assert.equal(next.canvas.durationFrames,652);assert.equal(model.validateRoughcut(next.roughcut),true);assertContinuous(next);
 assert.deepEqual(model.roughcutRows(model.createRoughcut(d,a)).map(r=>r.id),rows.map(r=>r.id));
});

test('one silence is split around every spoken or protected interval and each safe gap keeps both margins',()=>{
 const d=doc();delete d.captions;const a=analysis(d,{units:[{id:'a',text:'一',startSeconds:3,endSeconds:4,timing:'word'},{id:'b',text:'保护句',startSeconds:6,endSeconds:7,timing:'segment',protectionReasons:['uncertain']}],decisions:[],silences:[{startSeconds:1,endSeconds:9}],protectedRanges:[{startSeconds:4.5,endSeconds:5.5,reason:'未可靠转写的声音'}]});
 const next=model.createRoughcut(d,a),rows=model.roughcutRows(next);assert.deepEqual(rows.map(r=>[r.startFrame,r.endFrame]),[[38,82],[218,262]]);assert.equal(new Set(rows.map(r=>r.id)).size,2);assert.equal(model.validateRoughcut(next.roughcut),true);
 for(const row of rows){assert.equal(row.enabled,true);assert.ok(row.endFrame<=90||row.startFrame>=210);}
 assert.throws(()=>model.setRoughcutCut(next,rows[0].id,{endFrame:170}),/粗剪/);
});

test('pause-only edits retain corrected caption text, original cue IDs and local styles by source time',()=>{
 const d=doc();d.captions.cues=[{id:'caption-1-1-1',startFrame:30,endFrame:90,text:'OpenAI',originalText:'欧盆AI',initialText:'欧盆AI',style:{fontSize:70,color:'#ff0000'}},{id:'caption-2-1-1',startFrame:210,endFrame:270,text:'第二句',originalText:'第二句',style:{fontSize:64}}];
 const a=analysis(d,{units:[{id:'u1',text:'欧盆AI',startSeconds:1,endSeconds:3,timing:'segment',groupId:'c1'},{id:'u2',text:'第二句',startSeconds:7,endSeconds:9,timing:'segment',groupId:'c2'}],decisions:[],silences:[{startSeconds:3,endSeconds:7}]});
 const next=model.createRoughcut(d,a);assert.equal(next.captions.cues.length,2);assert.deepEqual(next.captions.cues[0],d.captions.cues[0]);assert.deepEqual(next.captions.cues[1],{...d.captions.cues[1],startFrame:106,endFrame:166});assert.match(model.roughcutSrt(next),/OpenAI/);assert.doesNotMatch(model.roughcutSrt(next),/欧盆/);assert.deepEqual(model.resetRoughcut(next),d);
});

test('partial semantic deletion protects a corrected cue that cannot be aligned exactly and still compresses unrelated pauses',()=>{
 const d=doc();d.captions.cues[0]={...d.captions.cues[0],id:'caption-1-1-1',text:'我真的喜欢你',style:{fontSize:72,color:'#ff0000'}};
 const a=analysis(d,{silences:[{startSeconds:5,endSeconds:9}]});const next=model.createRoughcut(d,a),speech=model.roughcutRows(next).find(r=>r.kind!=='pause');
 assert.equal(speech.enabled,false);assert.equal(speech.safeToEnable,false);assert.match(speech.reviewReason,/字幕/);assert.equal(next.captions.cues[0].text,'我真的喜欢你');assert.deepEqual(next.captions.cues[0].style,d.captions.cues[0].style);assert.ok(next.canvas.durationFrames<300);assert.throws(()=>model.setRoughcutCut(next,speech.id,{enabled:true}),/字幕/);
});

test('aligned semantic deletion keeps existing cue identity and styles even when group IDs differ',()=>{
 const d=doc();d.captions.cues[0].id='caption-1-1-1';const next=model.createRoughcut(d,analysis(d));assert.equal(next.captions.cues[0].id,'caption-1-1-1');assert.equal(next.captions.cues[0].text,'我喜欢你');assert.deepEqual(next.captions.cues[0].style,d.captions.cues[0].style);
});

test('semantic deletion cannot span an explicit protected gap between its selected words',()=>{
 const d=doc();delete d.captions;const a=analysis(d,{units:[{id:'a',text:'原',startSeconds:1,endSeconds:2,timing:'word',groupId:'g'},{id:'b',text:'话',startSeconds:5,endSeconds:6,timing:'word',groupId:'g'}],decisions:[{id:'remove',unitIds:['a','b'],action:'delete',kind:'retake',reason:'重复',confidence:0.99}],protectedRanges:[{startSeconds:3,endSeconds:4,reason:'未确认声音'}]});
 const next=model.createRoughcut(d,a),row=first(next);assert.equal(row.enabled,false);assert.equal(row.safeToEnable,false);assert.match(row.reviewReason,/保护区间/);assert.equal(next.canvas.durationFrames,300);assert.equal(model.validateRoughcut(next.roughcut),true);assert.throws(()=>model.setRoughcutCut(next,row.id,{enabled:true}),/保护区间/);
});

test('manual cut expansion cannot enter a protected interval even without touching another word',()=>{
 const d=doc();delete d.captions;const a=analysis(d,{units:[{id:'a',text:'删除',startSeconds:1,endSeconds:2,timing:'word',groupId:'g'},{id:'b',text:'保留',startSeconds:5,endSeconds:6,timing:'word',groupId:'h'}],decisions:[{id:'remove',unitIds:['a'],action:'delete',kind:'retake',reason:'重复',confidence:0.99}],protectedRanges:[{startSeconds:3,endSeconds:4}]});
 const next=model.createRoughcut(d,a),id=first(next).id;assert.equal(first(next).enabled,true);assert.throws(()=>model.setRoughcutCut(next,id,{endFrame:105}),/保护区间/);assert.throws(()=>model.setRoughcutCut(next,id,{endFrame:135}),/保护区间/);assert.equal(model.setRoughcutCut(next,id,{endFrame:90}).canvas.durationFrames,240);
});

test('new word captions use measured short phrase boundaries instead of one long ASR cue',()=>{
 const d=doc({num:30,den:1},900);delete d.captions;
 const text='这是一段用于验证字幕同步的完整口播内容每个字都有真实测量的时间边界';
 const units=[...text].map((text,i)=>({id:`long-${i}`,text,groupId:'long',timing:'word',startSeconds:1+i*.5,endSeconds:1.4+i*.5}));
 const next=model.createRoughcut(d,analysis(d,{units,decisions:[]}));
 assert.ok(next.captions.cues.length>=4);
 assert.equal(next.captions.cues.map(c=>c.text).join(''),text);
 for(const c of next.captions.cues){assert.ok(c.endFrame-c.startFrame<=120);assert.ok([...c.text].length<=18);assert.ok(units.some(u=>Math.floor(u.startSeconds*30+1e-9)===c.startFrame));assert.ok(units.some(u=>Math.ceil(u.endSeconds*30-1e-9)===c.endFrame));}
 const a=analysis(d,{units,decisions:[{id:'retry',unitIds:['long-0','long-1'],action:'delete',kind:'retake',reason:'重录',confidence:.99}]});
 const cut=model.createRoughcut(d,a),restored=model.setRoughcutCut(cut,first(cut).id,{enabled:false});
 assert.equal(cut.captions.cues.map(c=>c.text).join(''),text.slice(2));
 assert.deepEqual(restored.captions,next.captions);
});

test('caption breaks preserve gaps, punctuation and indivisible protected segment timing',()=>{
 const d=doc({num:30,den:1},900);delete d.captions;
 const long='这是一个只有整段可靠时间的受保护句子不能按字平均分配秒点';
 const units=[{id:'a',text:'先说。',groupId:'all',timing:'word',startSeconds:1,endSeconds:2},{id:'b',text:'继续',groupId:'all',timing:'word',startSeconds:2.1,endSeconds:2.6},{id:'c',text:'换气后',groupId:'all',timing:'word',startSeconds:4,endSeconds:5},{id:'d',text:long,groupId:'all',timing:'segment',startSeconds:6,endSeconds:16,protectionReasons:['局部对齐不确定']},{id:'e',text:'结束',groupId:'all',timing:'word',startSeconds:17,endSeconds:18}];
 const next=model.createRoughcut(d,analysis(d,{units,decisions:[]}));
 assert.deepEqual(next.captions.cues.map(c=>c.text),['先说。','继续','换气后',long,'结束']);
 assert.deepEqual(next.captions.cues.map(c=>[c.startFrame,c.endFrame]),[[30,60],[63,78],[120,150],[180,480],[510,540]]);
});

test('explicit manual adoption overrides only the chosen zero-alignment or semantic review',()=>{
 assert.equal(typeof model.adoptRoughcutCutManually,'function');
 const d=doc(),a=analysis(d);Object.assign(a.units[1],{safeBoundaries:false,protectionReasons:['zero_alignment']});
 a.decisions[0].action='review';a.decisions[0].keepUnitIds=['u2'];a.decisions.push({id:'other',unitIds:['u3'],action:'review',reason:'另一候选',confidence:.2});
 const before=model.createRoughcut(d,a),snapshot=structuredClone(before),id=first(before).id;
 assert.throws(()=>model.setRoughcutCut(before,id,{enabled:true}),/保护|保留|边界/);
 const after=model.adoptRoughcutCutManually(before,id),row=first(after);
 assert.deepEqual(before,snapshot);assert.equal(row.manual,true);assert.equal(row.enabled,true);assert.equal(row.safeToEnable,false);assert.equal(row.review,true);
 assert.deepEqual(after.roughcut.analysis,before.roughcut.analysis);assert.deepEqual(after.roughcut.cuts[1],before.roughcut.cuts[1]);
 assert.equal(after.canvas.durationFrames,270);assert.equal(after.captions.cues[0].text,'我喜欢你');assertContinuous(after);assert.equal(model.validateRoughcut(after.roughcut),true);
 assert.deepEqual(model.adoptRoughcutCutManually(after,id),after);
 assert.throws(()=>model.setRoughcutCut(before,id,{manual:true,enabled:true}),/仅支持/);
});

test('manual adoption is reversible through restore, reset, undo, redo and target-fps reconstruction',()=>{
 const d=doc(),a=analysis(d);a.units[1].protectionReasons=['possible_missing_transcript'];const before=model.createRoughcut(d,a),id=first(before).id,after=model.adoptRoughcutCutManually(before,id);
 const restored=model.setRoughcutCut(after,id,{enabled:false});assert.deepEqual(restored.source,d.source);assert.deepEqual(restored.captions,d.captions);assert.equal(first(restored).manual,true);assert.deepEqual(model.resetRoughcut(after),d);
 const history=editHistory({past:[],present:before,future:[]},after);assert.deepEqual(undoHistory(history).present,before);assert.deepEqual(redoHistory(undoHistory(history)).present,after);assert.equal(first(undoHistory(history).present).manual,undefined);
 for(const current of [after,restored]){const result=model.retimeRoughcutDocument(current,{...structuredClone(current),canvas:{...current.canvas,fps:{num:60,den:1}}});assert.equal(first(result).manual,true);assert.equal(first(result).enabled,first(current).enabled);assert.equal(model.validateRoughcut(result.roughcut),true);assert.equal(model.resetRoughcut(result).canvas.durationFrames,600);}
 assert.deepEqual(model.setRoughcutCut(restored,id,{enabled:true}),after);
});

test('manual segment adoption deletes the complete candidate and never half a word or segment',()=>{
 const d=doc();delete d.captions;const a=analysis(d,{timing:'segment',units:[{id:'segment',text:'对齐不确定的整句',startSeconds:1,endSeconds:4,timing:'segment',safeBoundaries:false,protectionReasons:['zero_alignment']}],decisions:[{id:'segment-review',unitIds:['segment'],action:'review',reason:'复核'}]});
 const before=model.createRoughcut(d,a),after=model.adoptRoughcutCutManually(before,first(before).id);assert.equal(after.canvas.durationFrames,210);assert.equal(after.captions.cues.length,0);
 for(const patch of [{startFrame:31},{endFrame:119},{startFrame:-1},{endFrame:301},{endFrame:30}])assert.throws(()=>model.setRoughcutCut(after,first(after).id,patch),/粗剪/);
 const b=analysis(d);b.units[1].protectionReasons=['zero_alignment'];b.decisions[0].unitIds=['u2','u3'];const whole=model.createRoughcut(d,b),manual=model.adoptRoughcutCutManually(whole,first(whole).id);
 assert.throws(()=>model.setRoughcutCut(manual,first(manual).id,{startFrame:90}),/完整|全部|候选/);
});

test('manual cut adjustments keep all selected units, neighboring speech and natural air',()=>{
 const d=doc(),a=analysis(d);a.units[0].endSeconds=1.6;Object.assign(a.units[1],{startSeconds:2.1,endSeconds:2.8,protectionReasons:['zero_alignment']});a.units[2].startSeconds=3.2;
 const before=model.createRoughcut(d,a),after=model.adoptRoughcutCutManually(before,first(before).id),id=first(after).id;
 const adjusted=model.setRoughcutCut(after,id,{startFrame:60,endFrame:90});assert.equal(adjusted.canvas.durationFrames,270);assert.equal(first(adjusted).manual,true);
 for(const patch of [{startFrame:64},{endFrame:83},{startFrame:30},{endFrame:120},{startFrame:50},{endFrame:94}])assert.throws(()=>model.setRoughcutCut(after,id,patch),/完整|字词|气口/);
 const stale=structuredClone(after);stale.captions.cues[0].text='新的手调';assert.throws(()=>model.adoptRoughcutCutManually(stale,id),/冲突/);
});

test('manual adoption still rejects explicit protected gaps and overlapping enabled deletions',()=>{
 const d=doc();delete d.captions;const units=[{id:'a',text:'原',startSeconds:1,endSeconds:2,timing:'word',groupId:'g',protectionReasons:['zero_alignment']},{id:'b',text:'话',startSeconds:5,endSeconds:6,timing:'word',groupId:'g'}],decisions=[{id:'review',unitIds:['a','b'],action:'review',reason:'复核'}];
 const protectedDoc=model.createRoughcut(d,analysis(d,{units,decisions,protectedRanges:[{startSeconds:3,endSeconds:4}]}));assert.throws(()=>model.adoptRoughcutCutManually(protectedDoc,first(protectedDoc).id),/保护区间/);
 const overlap=model.createRoughcut(d,analysis(d,{units,decisions,silences:[{startSeconds:2,endSeconds:5}]}));assert.throws(()=>model.adoptRoughcutCutManually(overlap,first(overlap).id),/重叠/);
 const restored=model.setRoughcutCut(overlap,model.roughcutRows(overlap)[1].id,{enabled:false});assert.equal(model.adoptRoughcutCutManually(restored,first(restored).id).canvas.durationFrames,150);
 const b=analysis(d);b.units[1].protectionReasons=['zero_alignment'];b.protectedRanges=[{startSeconds:5.5,endSeconds:6}];const before=model.createRoughcut(d,b),manual=model.adoptRoughcutCutManually(before,first(before).id);assert.throws(()=>model.setRoughcutCut(manual,first(manual).id,{endFrame:170}),/保护区间/);
});

test('manual adoption cannot erase the whole source, unresolved subtitle edits or sub-frame units',()=>{
 const d=doc();delete d.captions;const a=analysis(d,{units:[{id:'all',text:'全片',startSeconds:0,endSeconds:10,timing:'segment',protectionReasons:['zero_alignment']}],decisions:[{id:'all',unitIds:['all'],action:'review',reason:'复核'}]});
 const all=model.createRoughcut(d,a);assert.throws(()=>model.adoptRoughcutCutManually(all,first(all).id),/整段原片/);
 const corrected=doc();corrected.captions.cues[0].text='我真的喜欢你';const c=model.createRoughcut(corrected,analysis(corrected));assert.throws(()=>model.adoptRoughcutCutManually(c,first(c).id),/字幕/);
 const tiny=analysis(d);Object.assign(tiny.units[1],{startSeconds:2.001,endSeconds:2.002});const small=model.createRoughcut(d,tiny);assert.throws(()=>model.adoptRoughcutCutManually(small,first(small).id),/一帧/);
});

test('manual metadata is optional, boolean and limited to semantic editing provenance',()=>{
 const d=doc(),before=model.createRoughcut(d,analysis(d));assert.equal('manual' in first(before),false);assert.equal(model.validateRoughcut(before.roughcut),true);
 const optional=structuredClone(before.roughcut);optional.cuts[0].manual=false;assert.equal(model.validateRoughcut(optional),true);
 const invalid=structuredClone(before.roughcut);invalid.cuts[0].manual='heard';assert.throws(()=>model.validateRoughcut(invalid),/手动|布尔/);
 const pause=model.createRoughcut(d,analysis(d,{decisions:[],silences:[{startSeconds:5,endSeconds:9}]}));assert.throws(()=>model.adoptRoughcutCutManually(pause,first(pause).id),/停顿|语义/);
 assert.throws(()=>model.adoptRoughcutCutManually(before,'missing'),/不存在/);
});
