import test from 'node:test';import assert from 'node:assert/strict';
const {getPlanPreviewView}=await import('../editor/production-plan-view-model.mjs').catch(()=>({}));
const shot={id:'s',title:'内容',narration:'原始口播不要重复',slots:[],bindings:[],candidates:[],timing:{ranges:[{id:'r',startFrame:0,durationFrames:90}]},upstream:{packageShot:{sourceCueIds:[1]}}};
const doc=()=>({canvas:{fps:{num:30,den:1},durationFrames:300},source:{startFrame:0,cameraPlan:{duration:10,clipGroups:[{id:'camera',start:0,in:.4,hold:.5,out:.4,zoom:1.1,enabled:true}]}},tracks:[],instances:[],audioTracks:[],audioClips:[{id:'sound',startFrame:10,durationFrames:10}],captions:{enabled:true,cues:[{id:'cap',startFrame:0,endFrame:30,text:'字幕不要重复'}]}});
test('pure presenter with camera sound captions and optional search intent is omitted from plan track',()=>{
 assert.equal(typeof getPlanPreviewView,'function');const v=getPlanPreviewView(doc(),shot,[],{analysis:{sections:[{id:'s',animationNeed:'none',goal:'保留真人'}]},footage:{sections:[{id:'s',footageNeed:'optional',visualTargets:[{description:'若无真人使用工作台'}]}]}});assert.equal(v.visible,false);assert.deepEqual(v.sections,[]);
});
test('animated plan shows corresponding narration and concrete animation information',()=>{
 const v=getPlanPreviewView(doc(),shot,[],{analysis:{sections:[{id:'s',animationNeed:'required',goal:'两种门槛朝相反方向变化',information:['入行低','赚钱高'],relations:['方向相反']} ]}});
 assert.equal(v.visible,true);assert.equal(v.category,'animation');assert.equal(v.tryAnimation,true);
 assert.deepEqual(v.sections.map(s=>s.kind),['narration','animation']);assert.equal(v.sections[0].items[0].text,shot.narration);assert.ok(JSON.stringify(v.sections[1]).includes('方向相反'));
 assert.ok(v.sections[0].items[0].text.length<=110);assert.equal(JSON.stringify(v.sections).includes('字幕不要重复'),false);assert.equal(JSON.stringify(v.sections).includes('原始口播不要重复'),true);
});
test('active stock presents script analysis and intended search content without clip timings or status',()=>{
 const d=doc();d.instances=[{id:'media',assetId:'source-pip',startFrame:10,durationFrames:30,props:{sourceMode:'media',media:{publicPath:'test.mp4'},footageIdentity:{candidateId:'c'}}}];
 const v=getPlanPreviewView(d,shot,[],{analysis:{sections:[{id:'s',animationNeed:'none',goal:'作品做出来后仍需回答为什么被选择'}]},footage:{sections:[{id:'s',sourceCueIds:[1],footageNeed:'optional',visualTargets:[{description:'真实作品比较'},{description:'软件功能与定价'}]}]}});
 assert.equal(v.visible,true);assert.equal(v.category,'footage');assert.equal(v.sections.find(s=>s.kind==='animation').items[0].text,'保留口播画面，无需额外动画');assert.equal(v.sections.find(s=>s.kind==='footage').items[0].text,'真实作品比较；软件功能与定价');
 for(const group of v.sections)for(const item of group.items){assert.equal(item.time,undefined);assert.equal(item.status,undefined);}
});
test('required search intent can appear before downloads and mixed plans have distinct category',()=>{
 const v=getPlanPreviewView(doc(),shot,[],{analysis:{sections:[{id:'s',animationNeed:'optional',goal:'表达关系'}]},footage:{sections:[{id:'s',footageNeed:'required',visualTargets:[{description:'官方产品操作画面'}]}]}});assert.equal(v.category,'mixed');assert.ok(v.visible);assert.equal(v.tryAnimation,true);
});
test('hidden visual assets do not make a keep-presenter section show on the track',()=>{
 const d=doc();d.instances=[{id:'i',assetId:'source-pip',disabled:true,startFrame:0,durationFrames:50,props:{sourceMode:'media',media:{publicPath:'old.mp4'}}}];const v=getPlanPreviewView(d,shot,[],{analysis:{sections:[{id:'s',animationNeed:'none'}]}});assert.equal(v.visible,false);
});
test('saved media feedback immediately overrides stale archived search intent',()=>{
 const s={...shot,animationNeed:'none',expressionGoal:'用电脑操作承接可用性差别',visualRequirement:'找人物与屏幕同框的电脑操作镜头',mediaDescription:'电脑操作实拍，鼠标点击与屏幕响应相对应。'};
 const jobs=[{kind:'revise',shotId:'s',results:[{kind:'shot-revision',state:'applied',patches:[{entity:'shot',id:'s',field:'mediaDescription',before:'旧素材',after:s.mediaDescription}]}]}];
 const v=getPlanPreviewView(doc(),s,jobs,{footage:{sections:[{id:'s',footageNeed:'required',visualTargets:[{description:'手机和纸面原型'}]}]}});
 assert.equal(v.sections.find(x=>x.kind==='footage').items[0].text,'找人物与屏幕同框的电脑操作镜头');
});
