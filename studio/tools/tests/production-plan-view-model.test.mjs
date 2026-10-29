import test from 'node:test';
import assert from 'node:assert/strict';
const {getPlanShotView}=await import('../editor/production-plan-view-model.mjs').catch(()=>({}));
function fixture(){return {id:'p',canvas:{fps:{num:30,den:1},durationFrames:600},source:{startFrame:0,clips:[{id:'source',startFrame:0,durationFrames:600,sourceInFrame:0}],cameraPlan:{duration:20,clipGroups:[{id:'camera',start:2,in:1,hold:1,out:1,zoom:1.1,enabled:true,name:'强调'}]}},instances:[],tracks:[],audioTracks:[],audioClips:[{id:'sfx',name:'落点',startFrame:100,durationFrames:10,volume:.2}],captions:{enabled:true,cues:[{id:'cap',startFrame:70,endFrame:110,text:'原句'}]},productionPlan:{shots:[]}};}
const shot={id:'s',title:'观点',narration:'原句',slots:[],bindings:[],candidates:[],timing:{ranges:[{id:'r',startFrame:60,durationFrames:90}]},upstream:{packageShot:{sourceCueIds:[2,3]}}};
test('no-animation section omits understanding prose while showing actual camera and sound',()=>{
 assert.equal(typeof getPlanShotView,'function'); const d=fixture();
 const v=getPlanShotView(d,shot,[],{analysis:{sections:[{id:'s',animationNeed:'none',goal:'秘密理解目标',reason:'秘密困难'}]}});
 assert.equal(v.sections.some(s=>s.kind==='animation'),false);
 assert.ok(v.kinds.includes('camera'));assert.ok(v.kinds.includes('sound'));
 assert.equal(JSON.stringify(v).includes('秘密'),false);
 assert.equal(v.sections.find(s=>s.kind==='camera').items[0].time,'2.00–5.00 秒');
});
test('required animation shows concrete information and actual bound template',()=>{
 const d=fixture();d.instances=[{id:'i',assetId:'word-cascade',startFrame:90,durationFrames:50,name:'关键文字',props:{}}];
 const v=getPlanShotView(d,{...shot,bindings:[{instanceId:'i'}]},[],{analysis:{sections:[{id:'s',animationNeed:'required',goal:'秘密目标',information:['两种门槛'],relations:['反向变化'],templateMatch:{status:'partial',gaps:['缺少反向动作']}}]}});
 const a=v.sections.find(s=>s.kind==='animation');assert.ok(a.items.some(i=>i.text.includes('两种门槛')));assert.ok(a.items.some(i=>i.status==='已入轨'));assert.equal(JSON.stringify(v).includes('秘密目标'),false);
});
test('footage candidates associate by cues and only existing timeline media counts as applied',()=>{
 const d=fixture(),review={sections:[{id:'semantic-s',sourceCueIds:[2,3]}],candidates:[{id:'c',title:'工作台',matchedSectionIds:['semantic-s'],pageUrl:'https://example.com/c',path:'/c.mp4',technical:{passed:true}}],placements:[{id:'placement',sectionId:'semantic-s',candidateId:'c',startFrame:80,durationFrames:40}]};
 const resources={footage:review};const jobs=[{results:[{id:'result',kind:'footage',state:'applied',footage:{candidateId:'c',placementId:'placement'}}]}];
 let v=getPlanShotView(d,shot,jobs,resources);assert.equal(v.candidates.length,1);assert.notEqual(v.candidates[0].status,'已入轨');
 d.instances=[{id:'footage',assetId:'source-pip',startFrame:80,durationFrames:40,props:{footageIdentity:{candidateId:'c',placementId:'placement'}}}];
 v=getPlanShotView(d,shot,jobs,resources);assert.equal(v.candidates[0].status,'已入轨');assert.ok(v.kinds.includes('footage'));
 assert.equal(getPlanShotView(d,{...shot,id:'other',upstream:{packageShot:{sourceCueIds:[8]}},timing:{ranges:[{startFrame:400,durationFrames:60}]}},jobs,resources).candidates.length,0);
});
test('cancelled or untouched plans do not create processing blocks from plain captions',()=>{
 const d=fixture();d.source.cameraPlan=null;d.audioClips=[];
 assert.deepEqual(getPlanShotView(d,{...shot,cancelled:true}).kinds,[]);
 assert.deepEqual(getPlanShotView(d,shot,[],{analysis:{sections:[{id:'s',animationNeed:'none',soundDesign:{decision:'silence'}}]}}).kinds,[]);
});
test('edited canonical semantic fields win over archived package section',()=>{
 const d=fixture(),v=getPlanShotView(d,{...shot,animationNeed:'required',mediaDescription:'新内容'},[],{analysis:{sections:[{id:'s',animationNeed:'none',information:['旧内容']}]}});
 assert.ok(v.kinds.includes('animation'));assert.ok(v.sections.find(s=>s.kind==='animation').items.some(i=>i.text.includes('新内容')));
});
test('audio-only or camera work stays visible before media is produced',()=>{
 const d=fixture();d.source.cameraPlan=null;d.audioClips=[];
 const v=getPlanShotView(d,{...shot,productionActions:['sound','camera'],soundIntent:'转场音乐降低音量',cameraIntent:{mode:'push',description:'真人缓推'}},[],{});
 assert.ok(v.kinds.includes('sound'));assert.ok(v.kinds.includes('camera'));
});
test('fresh canonical information replaces archived animation content after revision',()=>{
 const d=fixture();const v=getPlanShotView(d,{...shot,animationNeed:'required',requiredInformation:['新版表达'],relationships:['新版关系']},[],{analysis:{sections:[{id:'s',animationNeed:'required',information:['旧版表达'],relations:['旧版关系']}]}});
 const rendered=JSON.stringify(v.sections);assert.ok(rendered.includes('新版表达'));assert.equal(rendered.includes('旧版表达'),false);
});
test('disabled visual and audio tracks are shown as disabled rather than active',()=>{
 const d=fixture();d.instances=[{id:'i',assetId:'word-cascade',startFrame:90,durationFrames:30,trackId:'visual',props:{}}];d.tracks=[{id:'visual',disabled:true}];d.audioTracks=[{id:'audio',disabled:true}];d.audioClips[0].trackId='audio';
 const v=getPlanShotView(d,{...shot,bindings:[{instanceId:'i'}]});
 assert.equal(v.sections.find(s=>s.kind==='animation').items[0].status,'已隐藏');
 assert.equal(v.sections.find(s=>s.kind==='sound').items[0].status,'已静音');
});
