import test from 'node:test';
import assert from 'node:assert/strict';
import {getPlanPreviewView} from '../editor/production-plan-view-model.mjs';
const doc={id:'p',canvas:{fps:{num:30,den:1},durationFrames:300},instances:[],tracks:[],audioClips:[],audioTracks:[]};
const shot={id:'s',title:'本段',narration:'只需要十几块钱，\n你就可以低声和 AI 交流。',animationNeed:'optional',requirementVersion:1,slots:[],bindings:[],candidates:[],timing:{ranges:[{id:'r',startFrame:0,durationFrames:90}]},animationBrief:{goal:'表达设备与低声输入的联系',information:['设备只要十几块钱','支持低声输入'],relations:['低成本设备带来低声输入能力'],reason:'对比价格和使用收益'},templateMatch:{status:'none',reason:'保留真人实物展示，避免标签重复口播'}};
test('preview displays the full corresponding narration instead of an expression summary',()=>{
 const view=getPlanPreviewView(doc,shot);const narration=view.sections.find(s=>s.kind==='narration');
 assert.equal(narration?.title,'本段口播');assert.equal(narration?.items[0].text,shot.narration);
 assert.equal(view.sections.some(s=>s.title==='画面内容'),false);
});
test('animation preview includes the actual brief and matching information instead of yes/no',()=>{
 const view=getPlanPreviewView(doc,shot),animation=view.sections.find(s=>s.kind==='animation');
 assert.equal(animation.title,'动画安排');
 const content=JSON.stringify(animation);for(const value of [shot.animationBrief.goal,...shot.animationBrief.information,...shot.animationBrief.relations,shot.animationBrief.reason])assert.ok(content.includes(value),value);
 assert.equal(animation.items.some(i=>i.text==='是'||i.text==='否'),false);
});
test('long narration remains complete for content-aware layout',()=>{
 const narration='这是一段较长但必须完整展示的口播。'.repeat(35),view=getPlanPreviewView(doc,{...shot,narration});
 assert.equal(view.sections.find(s=>s.kind==='narration').items[0].text,narration);
});
test('AI explanation is available around the preview so action cards need not repeat it',()=>{
 const reason='补充办公环境里犹豫开口的关系',view=getPlanPreviewView(doc,{...shot,aiVideoCandidates:[{id:'ai',prompt:'四人办公',title:'办公室',reason,requirementVersion:1}]});
 assert.equal(view.sections.find(s=>s.kind==='aiVideo').items[0].detail,reason);
});
