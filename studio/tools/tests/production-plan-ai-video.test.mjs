import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePlan} from '../lib/production-plan-model.mjs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
const ui=await import('../editor/ai-video-candidates.mjs').catch(()=>({}));
const candidate=(id='ai-1')=>({id,title:'生成情境',prompt:'远景中汽车驶入收费站。',promptVersion:1,requirementVersion:1,sourceCueIds:[1,2],reason:'示意等待',aspectRatio:'16:9',durationSeconds:5,references:[{path:'/tmp/front.png',label:'车身',purpose:'主体外观'},{path:'/tmp/gate.png',label:'收费站',purpose:'环境'}]});
const shot=()=>({id:'s',requirementVersion:1,slots:[],bindings:[],aiVideoCandidates:[candidate(),candidate('ai-2')]});
const doc=()=>({id:'p',instances:[],productionPlan:{shots:[shot()]}});
test('AI candidates have no URL requirement and retain ordered real references',()=>{
 const value=normalizePlan({shots:[shot()]});
 assert.equal(value.shots[0].aiVideoCandidates[0].evidenceRole,'illustration');
 assert.deepEqual(value.shots[0].aiVideoCandidates[0].references.map(r=>r.label),['车身','收费站']);
 assert.equal(value.shots[0].aiVideoCandidates.length,2);
 assert.equal(normalizePlan({shots:[{id:'old'}]}).shots[0].aiVideoCandidates.length,0);
});
test('malformed prompts, duplicate IDs, versions and references are rejected',()=>{
 for(const patch of [{prompt:' '},{promptVersion:0},{requirementVersion:0},{sourceCueIds:[]},{references:[{path:'https://x/a.png',label:'图',purpose:'主体'}]},{references:[{path:'/tmp/a.png',label:'',purpose:'主体'}]},{references:[{path:'/tmp/a.png',label:'图',purpose:'主体',sha256:'bad'}]},{usage:'evidence'}]){
  assert.throws(()=>normalizePlan({shots:[{...shot(),aiVideoCandidates:[{...candidate(),...patch}]}]}),/AI video/i);
 }
 assert.throws(()=>normalizePlan({shots:[{...shot(),aiVideoCandidates:[candidate(),candidate()]}]}),/Duplicate AI video/);
 assert.throws(()=>normalizePlan({shots:[{id:'s',candidates:[{id:'net',slotId:'v',url:''}]}]}),/URL/);
});
test('copy includes complete prompt, aspect, duration and stable reference upload order',()=>{
 assert.equal(typeof ui.aiVideoPromptText,'function');
 const text=ui.aiVideoPromptText(candidate());
 assert.ok(text.includes(candidate().prompt));assert.ok(text.includes('16:9'));assert.ok(text.includes('5'));
 assert.ok(text.indexOf('图1：车身')<text.indexOf('图2：收费站'));assert.ok(text.includes('主体外观'));
});
test('candidate state follows exact project, prompt version and saved instance evidence',()=>{
 assert.equal(typeof ui.aiVideoCandidateState,'function');
 const d=doc(),s=d.productionPlan.shots[0],c=s.aiVideoCandidates[0];
 const job={id:'j',projectId:'p',kind:'recognize',shotId:'s',aiVideoCandidateId:c.id,aiVideoPromptVersion:1,status:'running',results:[]};
 assert.equal(ui.aiVideoCandidateState(d,s,c,[job]).state,'verifying');
 assert.equal(ui.aiVideoCandidateState(d,s,c,[{...job,projectId:'other'}]).state,'ready');
 assert.equal(ui.aiVideoCandidateState(d,s,c,[{...job,status:'failed',error:'解码失败'}]).state,'failed');
 assert.equal(ui.aiVideoCandidateState(d,s,c,[{...job,status:'complete'}]).state,'unmatched');
 assert.equal(ui.aiVideoCandidateState(d,s,{...c,promptVersion:2},[job]).state,'ready');
 const binding={instanceId:'i',aiVideoCandidateId:c.id,aiVideoPromptVersion:1,status:'current'};
 s.bindings=[binding];assert.notEqual(ui.aiVideoCandidateState(d,s,c,[]).state,'placed');
 d.instances=[{id:'i'}];assert.equal(ui.aiVideoCandidateState(d,s,c,[]).state,'placed');
 s.requirementVersion=2;assert.equal(ui.aiVideoCandidateState(d,s,c,[job]).state,'stale');
});
test('associated import rejects project switch, prompt edit or requirement change after upload',async()=>{
 assert.equal(typeof ui.recognizeAiVideoImport,'function');
 let d=doc(),calls=[];
 const expected={projectId:d.id,shotId:'s',candidate:structuredClone(d.productionPlan.shots[0].aiVideoCandidates[0])};
 const args={expected,files:[{id:'m',path:'/tmp/generated.mp4'}],getDocument:()=>d,getProjectId:()=>d.id,startJob:async(...x)=>calls.push(x)};
 await ui.recognizeAiVideoImport(args);assert.equal(calls[0][1].aiVideoCandidateId,'ai-1');assert.equal(calls[0][1].aiVideoPromptVersion,1);assert.equal(calls[0][1].shotId,'s');assert.equal(calls[0][1].candidateId,undefined);assert.ok(calls[0][1].aiVideoCandidateIdentity);
 d={...doc(),id:'other'};await assert.rejects(()=>ui.recognizeAiVideoImport(args),/切换/);
 d=doc();d.productionPlan.shots[0].aiVideoCandidates[0].prompt='已改';await assert.rejects(()=>ui.recognizeAiVideoImport(args),/变化/);
 d=doc();d.productionPlan.shots[0].requirementVersion=2;await assert.rejects(()=>ui.recognizeAiVideoImport(args),/变化/);
 assert.equal(calls.length,1);
});
test('shot inspector renders separate AI cards, copy and linked upload with ordered references',async()=>{
 const require=createRequire(new URL('../../templates/remotion-base/package.json',import.meta.url));
 const {build}=require('esbuild'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 const result=await build({entryPoints:[fileURLToPath(new URL('../editor/ProductionPlanShotInspector.tsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'cjs',loader:{'.css':'empty'},external:['react','react-dom','react-dom/*'],nodePaths:[fileURLToPath(new URL('../../templates/remotion-base/node_modules',import.meta.url))]});
 const module={exports:{}};runInNewContext(result.outputFiles[0].text,{module,exports:module.exports,require,structuredClone,localStorage:{getItem(){return null;}}});
 const d=doc();d.canvas={fps:{num:30,den:1}};Object.assign(d.productionPlan.shots[0],{title:'口播',timing:{ranges:[]},candidates:[]});
 const html=renderToStaticMarkup(React.createElement(module.exports.ProductionPlanQuickView,{document:d,controller:{jobs:[]},selectedShot:'s',onSelect(){}}));
 assert.equal((html.match(/复制提示词/g)||[]).length,2);assert.equal((html.match(/导入生成结果/g)||[]).length,4);
 assert.ok(html.includes('图1'));assert.ok(html.includes('图2'));assert.ok(html.includes('待生成结果'));assert.ok(html.includes('accept=".mp4,.mov,.m4v,.webm"')); assert.ok(html.indexOf('图1：车身')<html.indexOf('图2：收费站'));
});

test('package task panel renders actual branch execution independently of parent status',async()=>{
 const require=createRequire(new URL('../../templates/remotion-base/package.json',import.meta.url));
 const {build}=require('esbuild'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 const result=await build({entryPoints:[fileURLToPath(new URL('../editor/ProductionPlanPanel.tsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'cjs',loader:{'.css':'empty'},external:['react','react-dom','react-dom/*'],nodePaths:[fileURLToPath(new URL('../../templates/remotion-base/node_modules',import.meta.url))]});
 const module={exports:{}};runInNewContext(result.outputFiles[0].text,{module,exports:module.exports,require,structuredClone});
 const d=doc();d.canvas={fps:{num:30,den:1}};d.productionPlan.shots=[];
 const html=renderToStaticMarkup(React.createElement(module.exports.ProductionPlanPanel,{document:d,controller:{jobs:[{id:'pkg',kind:'package',status:'running',packageBranches:{version:1,runId:'run',branches:[{id:'templates',status:'running'},{id:'footage',status:'failed',error:'下载失败'},{id:'ai-video',status:'waiting_external'}]}}],history:[],pendingResults:[]},onSelect(){}}));
 for(const text of ['专项任务状态','模板','执行中','真实素材','失败','下载失败','等待外部结果'])assert.ok(html.includes(text),text);
});
