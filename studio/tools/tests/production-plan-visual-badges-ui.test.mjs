import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {getPlanPreviewView} from '../editor/production-plan-view-model.mjs';
const require=createRequire(new URL('../../templates/remotion-base/package.json',import.meta.url));
const {build}=require('esbuild'),React=require('react'),{renderToStaticMarkup:render}=require('react-dom/server');
async function component(file,name){
 const result=await build({entryPoints:[fileURLToPath(new URL('../editor/'+file,import.meta.url))],bundle:true,write:false,platform:'node',format:'cjs',external:['react','react-dom','react-dom/*'],loader:{'.css':'empty'},nodePaths:[fileURLToPath(new URL('../../templates/remotion-base/node_modules',import.meta.url))]});
 const module={exports:{}};runInNewContext(result.outputFiles[0].text,{module,exports:module.exports,require,localStorage:{getItem(){return null;}},structuredClone,console,Object,URL});return module.exports[name];
}
const shot={id:'s',title:'办公片段',order:0,narration:'口播',requirementVersion:1,animationNeed:'required',mediaDescription:'解释同框关系',candidates:[{id:'web',slotId:'video',url:'https://example.com/office',title:'实拍办公室'}],bindings:[],slots:[{id:'video',type:'video',description:'办公环境'}],timing:{status:'manual',manual:true,ranges:[{id:'r',startFrame:0,durationFrames:300}]},aiVideoCandidates:[{id:'ai',title:'办公室生成',reason:'补足多人同框',sourceCueIds:[1],prompt:'四人办公',promptVersion:1,requirementVersion:1,references:[],aspectRatio:'16:9',durationSeconds:3}]};
const doc={id:'p',canvas:{fps:{num:30,den:1},durationFrames:600},instances:[],tracks:[],audioClips:[],audioTracks:[],productionPlan:{shots:[shot]}};
const labels=html=>[...html.matchAll(/class="plan-visual-badge kind-([^"]+)"/g)].map(x=>x[1]);
test('badge group always renders 动 网 AI in priority order and deduplicates',async()=>{
 const Group=await component('PlanVisualBadges.tsx','PlanVisualBadges');
 const html=render(React.createElement(Group,{kinds:['aiVideo','footage','animation','animation']}));
 assert.deepEqual(labels(html),['animation','footage','aiVideo']);
 assert.ok(html.includes('aria-label="动画"'));assert.ok(html.includes('aria-label="网络素材候选"'));assert.ok(html.includes('aria-label="AI 视频提示词"'));
 assert.equal(render(React.createElement(Group,{kinds:[]})),'');
});
test('timeline block leads with three badges and preserves its selectable range',async()=>{
 const Track=await component('ProductionPlanTrack.tsx','ProductionPlanTrack');
 const html=render(React.createElement(Track,{document:doc,px:1,labelWidth:100,onSelect(){},onAction(){}}));
 assert.deepEqual(labels(html),['animation','footage','aiVideo']);
 assert.ok(html.indexOf('plan-visual-badges')<html.indexOf('plan-block-title'));
 assert.ok(html.includes('办公片段，0.00 至 10.00 秒'));
});
test('preview section headings carry their matching 动 网 AI badges',async()=>{
 const Rail=await component('ProductionPlanAnnotations.tsx','PlanAnnotationRail');
 const view=getPlanPreviewView(doc,shot),sections=view.sections.filter(s=>s.kind!=='narration');
 const html=render(React.createElement(Rail,{sections,side:'left'}));
 assert.deepEqual(labels(html),['animation','footage','aiVideo']);
 for(const part of html.split('<h3>').slice(1))assert.ok(part.slice(0,part.indexOf('</h3>')).includes('plan-visual-badge'));
});
test('sidebar shows matching badges on the shot and type headings in priority order',async()=>{
 const Quick=await component('ProductionPlanShotInspector.tsx','ProductionPlanQuickView');
 const html=render(React.createElement(Quick,{document:doc,selectedShot:'s',controller:{jobs:[],busy:false},resources:{},onSelect(){}}));
 assert.deepEqual(labels(html),['animation','footage','aiVideo','animation','footage','aiVideo']);
 assert.ok(html.indexOf('当前段动画安排')<html.indexOf('当前段候选网络素材'));
 assert.ok(html.indexOf('当前段候选网络素材')<html.indexOf('当前段AI视频'));
});

test('sidebar includes 网 detail for placed stock even without candidate cards',async()=>{
 const Quick=await component('ProductionPlanShotInspector.tsx','ProductionPlanQuickView');
 const placed={...doc,instances:[{id:'stock',name:'已入轨办公素材',assetId:'source-pip',startFrame:0,durationFrames:90,props:{footageIdentity:{candidateId:'stock'}}}],productionPlan:{shots:[{...shot,candidates:[],aiVideoCandidates:[],animationNeed:'none'}]}};
 const html=render(React.createElement(Quick,{document:placed,selectedShot:'s',controller:{jobs:[],busy:false},resources:{},onSelect(){}}));
 assert.ok(html.includes('当前段候选网络素材'));assert.ok(html.includes('已入轨办公素材'));assert.deepEqual(labels(html),['footage','footage']);
});

test('visible preview owns descriptive content while sidebar retains generation actions',async()=>{
 const Quick=await component('ProductionPlanShotInspector.tsx','ProductionPlanQuickView');
 const original={...shot,animationBrief:{goal:'不应重复的动画说明'},aiVideoCandidates:[{...shot.aiVideoCandidates[0],reason:'不应重复的AI说明'}]};
 const d={...doc,productionPlan:{shots:[original]}};
 const html=render(React.createElement(Quick,{document:d,selectedShot:'s',annotationsVisible:true,controller:{jobs:[],busy:false},resources:{},onSelect(){}}));
 assert.equal(html.includes('当前段动画安排'),false);assert.equal(html.includes('不应重复的动画说明'),false);assert.equal(html.includes('不应重复的AI说明'),false);
 assert.ok(html.includes('复制提示词'));assert.ok(html.includes('导入生成结果'));assert.ok(html.includes('plan-delete-button'));assert.ok(html.includes('删除这一段计划'));
});
test('sidebar keeps descriptions available when preview annotations are hidden',async()=>{
 const Quick=await component('ProductionPlanShotInspector.tsx','ProductionPlanQuickView');
 const original={...shot,aiVideoCandidates:[{...shot.aiVideoCandidates[0],reason:'关闭标注时仍可查看的AI说明'}]};
 const html=render(React.createElement(Quick,{document:{...doc,productionPlan:{shots:[original]}},selectedShot:'s',annotationsVisible:false,controller:{jobs:[],busy:false},resources:{},onSelect(){}}));
 assert.ok(html.includes('当前段动画安排'));assert.ok(html.includes('关闭标注时仍可查看的AI说明'));
});
