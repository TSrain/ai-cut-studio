import test from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../editor/roughcut-model.mjs';
import {DEFAULT_CAPTION_STYLE} from '../../templates/remotion-base/src/editor/captions.mjs';
const fixture=()=>{
 const d={canvas:{fps:{num:30,den:1},durationFrames:600},source:{path:'voice.mp4',startFrame:0,durationFrames:600},instances:[],tracks:[]};
 const units=[['a',1,2],['b',2,3],['c',7,8],['d',8,9],['e',14,15]].map(([id,startSeconds,endSeconds])=>({id,text:id,startSeconds,endSeconds,groupId:id,timing:'word'}));
 const a={version:1,sourceKey:m.roughcutSourceKey(d),sourceDurationSeconds:20,timing:'word',units,decisions:[],silences:[],editPlan:{version:1,mode:'complete-takes',selections:[{id:'take',startUnitId:'c',endUnitId:'e',reason:'完整表达'}],omissions:[{startUnitId:'a',endUnitId:'b',reason:'重录',kind:'retake',coveredBySelectionIds:['take']}],reviewNotes:[]}};
 return {d,a};
};
test('complete take removes all rejected speech and surrounding air without orphan pause tails',()=>{
 const {d,a}=fixture(),n=m.createRoughcut(d,a);
 assert.deepEqual(n.source.clips.map(c=>[c.sourceInFrame,c.durationFrames]),[[207,248]]);
 assert.equal(n.captions.cues.map(c=>c.text).join(''),'cde');
 assert.equal(m.validateRoughcut(n.roughcut),true);
 assert.deepEqual(m.resetRoughcut(n),d);
});
test('complete take keeps internally uncertain alignment whole and has no independent pause cuts',()=>{
 const {d,a}=fixture();a.units[3].safeBoundaries=false;a.units[3].protectionReasons=['zero_duration_alignment'];
 const n=m.createRoughcut(d,a);assert.equal(n.source.clips.length,1);assert.equal(n.roughcut.cuts.length,2);
});
test('complete take requires exact ordered coverage and valid replacement references',()=>{
 for(const mutate of [a=>a.editPlan.omissions=[],a=>a.editPlan.omissions[0].endUnitId='c',a=>a.editPlan.omissions[0].coveredBySelectionIds=['missing'],a=>a.editPlan.selections[0].startSeconds=7]){
 const {d,a}=fixture();mutate(a);assert.throws(()=>m.createRoughcut(d,a),/粗剪/);
 }
});
test('complete take cuts restore and adjust with caption projection and atomic words',()=>{
 const {d,a}=fixture(),n=m.createRoughcut(d,a),head=n.roughcut.cuts[0];
 const adjusted=m.setRoughcutCut(n,head.id,{endFrame:200});assert.equal(adjusted.captions.cues.map(c=>c.text).join(''),'cde');
 assert.throws(()=>m.setRoughcutCut(n,head.id,{endFrame:220}),/完整|保留/);
 const restored=m.setRoughcutCut(n,head.id,{enabled:false});assert.equal(restored.captions.cues.map(c=>c.text).join(''),'abcde');
 assert.deepEqual(m.resetRoughcut(restored),d);
});
test('complete takes protect explicit ranges and preserve uncertain omitted endpoints with review warning',()=>{
 const {d,a}=fixture();a.protectedRanges=[{startSeconds:1,endSeconds:3}];
 const n=m.createRoughcut(d,a);assert.ok(n.source.clips.some(c=>c.sourceInFrame<=30&&c.sourceInFrame+c.durationFrames>=90));
 const f=fixture();f.a.units[0].protectionReasons=['missing_transcript'];const safe=m.createRoughcut(f.d,f.a);
 assert.match(safe.roughcut.warnings.join(''),/待核对/);assert.equal(safe.captions.cues.map(c=>c.text).join(''),'acde');
});
test('coalesced zero-alignment endpoint stays atomic and permits a complete take',()=>{
 const {d,a}=fixture();a.units[2].protectionReasons=['zero_duration_alignment'];a.units[2].safeBoundaries=false;
 const n=m.createRoughcut(d,a);assert.deepEqual(n.source.clips.map(c=>[c.sourceInFrame,c.durationFrames]),[[207,248]]);assert.equal(n.roughcut.warnings.length,0);
});
test('separate takes with omitted words never merge or delete internal speech through pause detection',()=>{
 const {d,a}=fixture();a.editPlan.selections=[{id:'one',startUnitId:'a',endUnitId:'b',reason:'前句'},{id:'two',startUnitId:'e',endUnitId:'e',reason:'后句'}];
 a.editPlan.omissions=[{startUnitId:'c',endUnitId:'d',kind:'aside',reason:'插话',coveredBySelectionIds:[]}];
 const n=m.createRoughcut(d,a);assert.equal(n.source.clips.length,2);assert.equal(n.captions.cues.map(c=>c.text).join(''),'abe');
 assert.ok(n.source.clips.every(c=>c.durationFrames>30));
});
test('complete take reconstruction at another fps retains reversible selection cuts',()=>{
 const {d,a}=fixture(),n=m.createRoughcut(d,a);
 const retimed=m.retimeRoughcutDocument(n,{...n,canvas:{...n.canvas,fps:{num:60,den:1},durationFrames:n.canvas.durationFrames*2}});
 assert.equal(m.validateRoughcut(retimed.roughcut),true);
 assert.equal(m.resetRoughcut(retimed).canvas.durationFrames,1200);
 const restored=m.setRoughcutCut(retimed,retimed.roughcut.cuts[0].id,{enabled:false});
 assert.equal(restored.captions.cues.map(c=>c.text).join(''),'abcde');
});
test('consecutive selected units merge only with genuinely contiguous source spans',()=>{
 const {d,a}=fixture();a.editPlan.selections=[{id:'one',startUnitId:'a',endUnitId:'b',reason:'前句'},{id:'two',startUnitId:'c',endUnitId:'e',reason:'后句'}];a.editPlan.omissions=[];
 const n=m.createRoughcut(d,a);assert.equal(n.source.clips.length,2);
 a.units[2].startSeconds=3;a.units[2].endSeconds=4;
 assert.equal(m.createRoughcut(d,a).source.clips.length,1);
});

test('genuinely missing transcript protects only the affected take and adjacent air',()=>{
 const {d,a}=fixture();a.units[2].protectionReasons=['possible_missing_transcript'];
 const n=m.createRoughcut(d,a);assert.equal(n.source.clips[0].sourceInFrame,90);assert.ok(n.canvas.durationFrames<600);assert.match(n.roughcut.warnings.join(''),/待核对/);
});
test('complete take compresses only reliable internal silence with speech on both resulting sides',()=>{
 const {d,a}=fixture();a.silences=[{startSeconds:3,endSeconds:7},{startSeconds:9,endSeconds:14}];const n=m.createRoughcut(d,a);
 assert.equal(n.source.clips.length,2);assert.ok(n.canvas.durationFrames<140);
 assert.equal(n.captions.cues.map(c=>c.text).join(''),'cde');
 for(const clip of n.source.clips) assert.ok(a.units.filter(u=>['c','d','e'].includes(u.id)).some(u=>u.startSeconds*30>=clip.sourceInFrame&&u.endSeconds*30<=clip.sourceInFrame+clip.durationFrames));
 const middle=n.roughcut.cuts.find(c=>c.unitIds.length===0&&c.startFrame>210&&c.endFrame<450);
 assert.ok(middle);assert.ok(middle.startFrame>=277);assert.ok(middle.endFrame<=413);
 assert.equal(m.setRoughcutCut(n,middle.id,{enabled:false}).source.clips.length,1);
 assert.deepEqual(m.resetRoughcut(n),d);
});
test('retake omissions require at least one covering complete selection',()=>{
 const {d,a}=fixture();a.editPlan.omissions[0].coveredBySelectionIds=[];
 assert.throws(()=>m.createRoughcut(d,a),/替代|省略/);
});
test('internal silence misdetections never clip atomic words and protection cannot become an air island',()=>{
 for(const protect of [false,true]){
 const {d,a}=fixture();a.silences=[{startSeconds:7,endSeconds:15}];
 if(protect)a.protectedRanges=[{startSeconds:11,endSeconds:12}];
 const n=m.createRoughcut(d,a);assert.equal(n.captions.cues.map(c=>c.text).join(''),'cde');
 const retained=a.units.filter(u=>['c','d','e'].includes(u.id));
 for(const clip of n.source.clips) assert.ok(retained.some(u=>u.startSeconds*30>=clip.sourceInFrame&&u.endSeconds*30<=clip.sourceInFrame+clip.durationFrames));
 if(protect) assert.ok(n.source.clips.some(c=>c.sourceInFrame<=330&&c.sourceInFrame+c.durationFrames>=360));
 assert.equal(m.validateRoughcut(n.roughcut),true);
 }
});
test('uncertain omitted group stays local and remains explicitly adoptable without orphan air',()=>{
 const {d,a}=fixture();a.units[1].protectionReasons=['possible_missing_transcript'];
 const n=m.createRoughcut(d,a),review=n.roughcut.cuts.find(c=>c.review&&!c.enabled&&c.unitIds.includes('b'));
 assert.ok(review);assert.equal(n.captions.cues.map(c=>c.text).join(''),'bcde');
 assert.throws(()=>m.setRoughcutCut(n,review.id,{enabled:true}),/保护|可靠|转写/);
 const adopted=m.adoptRoughcutCutManually(n,review.id);
 assert.equal(adopted.captions.cues.map(c=>c.text).join(''),'cde');
 assert.equal(adopted.source.clips.length,1);assert.equal(adopted.source.clips[0].sourceInFrame,207);
 assert.equal(m.setRoughcutCut(adopted,review.id,{enabled:false}).captions.cues.map(c=>c.text).join(''),'bcde');
 assert.deepEqual(m.resetRoughcut(adopted),d);
});
test('local uncertain-group manual adoption still cannot override explicit protected source ranges',()=>{
 const {d,a}=fixture();a.units[1].protectionReasons=['possible_missing_transcript'];a.protectedRanges=[{startSeconds:2.2,endSeconds:2.5}];
 const n=m.createRoughcut(d,a),review=n.roughcut.cuts.find(c=>c.review&&c.unitIds.includes('b'));
 assert.ok(review);assert.throws(()=>m.adoptRoughcutCutManually(n,review.id),/明确保护/);
});
test('missing transcript group protects unknown leading speech before its first aligned atomic unit',()=>{
 const {d,a}=fixture();a.units[1].startSeconds=2.8;a.units[1].endSeconds=3.4;a.units[1].protectionReasons=['possible_missing_transcript'];
 const n=m.createRoughcut(d,a);
 assert.ok(n.source.clips.some(c=>c.sourceInFrame<=60&&c.sourceInFrame+c.durationFrames>=102));
 const review=n.roughcut.cuts.find(c=>c.review&&c.unitIds.includes('b'));assert.ok(review);assert.ok(review.startFrame<=60);
 const adopted=m.adoptRoughcutCutManually(n,review.id);assert.equal(adopted.source.clips.length,1);assert.equal(adopted.source.clips[0].sourceInFrame,207);
});
const captionFixture=()=>{
 const d={canvas:{fps:{num:30,den:1},durationFrames:180},source:{path:'voice.mp4',durationFrames:180},instances:[],tracks:[]};
 const text='这是一段专门用来测试字幕长度的完整效果。';
 const units=[...text].map((text,i)=>({id:`w${i}`,text,startSeconds:1+i*.12,endSeconds:1+(i+1)*.12,groupId:'sentence',timing:'word'}));
 return {d,a:{version:1,sourceKey:m.roughcutSourceKey(d),sourceDurationSeconds:6,timing:'word',units,decisions:[],silences:[],editPlan:{version:1,mode:'complete-takes',selections:[{id:'all',startUnitId:units[0].id,endUnitId:units.at(-1).id,reason:'完整句'}],omissions:[],reviewNotes:[]}}};
};
test('v2 caption layout rejoins short forced-length tails while legacy layout remains unchanged',()=>{
 const {d,a}=captionFixture(),n=m.createRoughcut(d,a);assert.equal(n.roughcut.policy.captionLayoutVersion,2);assert.equal(n.captions.cues.length,1);
 const old=structuredClone(a);delete old.editPlan;const legacy=m.createRoughcut(d,old);assert.equal(legacy.roughcut.policy.captionLayoutVersion,1);assert.equal(legacy.captions.cues.length,2);
});
test('caption overrides correct only derived text and preserve original transcript and restoration',()=>{
 const {d,a}=captionFixture();a.captionOverrides={w0:'那'};const n=m.createRoughcut(d,a);
 assert.ok(n.captions.cues[0].text.startsWith('那'));assert.ok(n.captions.cues[0].originalText.startsWith('这'));assert.equal(n.roughcut.analysis.units[0].text,'这');assert.equal(a.units[0].text,'这');assert.deepEqual(m.resetRoughcut(n),d);
 for(const overrides of [{missing:'字'},{w0:''},{w0:17},{w0:'多\n行'}])assert.throws(()=>m.createRoughcut(d,{...a,captionOverrides:overrides}),/字幕|字词/);
});
test('caption v2 leaves manual subtitle corrections intact and never rejoins across source cuts or groups',()=>{
 const {d,a}=captionFixture();
 d.captions={version:1,enabled:true,style:{...DEFAULT_CAPTION_STYLE},cues:[{id:'manual',startFrame:30,endFrame:102,text:'人工改过的整句',originalText:'人工快照',initialText:'人工快照'}]};
 a.captionOverrides={w0:'那'};const n=m.createRoughcut(d,a);assert.equal(n.captions.cues[0].text,'人工改过的整句');assert.equal(n.captions.cues[0].originalText,'人工快照');
 const f=captionFixture();f.a.units.at(-1).groupId='different';assert.equal(m.createRoughcut(f.d,f.a).captions.cues.length,2);
 const cut=captionFixture();const last=cut.a.units.at(-1);last.startSeconds+=2;last.endSeconds+=2;cut.a.silences=[{startSeconds:cut.a.units.at(-2).endSeconds,endSeconds:last.startSeconds}];
 const split=m.createRoughcut(cut.d,cut.a);assert.equal(split.source.clips.length,2);assert.equal(split.captions.cues.length,2);
});
test('v2 also rejoins a short tail caused by the four-second caption duration cap',()=>{
 const {d,a}=captionFixture();a.units=a.units.slice(0,15).map((u,i)=>({...u,startSeconds:1+i*.28,endSeconds:1+(i+1)*.28}));
 a.editPlan.selections[0].endUnitId=a.units.at(-1).id;
 const n=m.createRoughcut(d,a);assert.equal(n.captions.cues.length,1);assert.ok(n.captions.cues[0].endFrame-n.captions.cues[0].startFrame<=150);
});
