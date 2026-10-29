import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(resolve(root,'templates/remotion-base/package.json'));
let view;

test('roughcut panel exposes guarded apply and frame draft validation',async()=>{
 const entry=resolve(root,'tools/editor/RoughcutPanel.tsx');
 assert.equal(existsSync(entry),true,'粗剪面板尚未实现');
 const {outputFiles}=await require('esbuild').build({entryPoints:[entry],bundle:true,write:false,platform:'node',format:'cjs',loader:{'.css':'empty'},external:['react'],nodePaths:[resolve(root,'templates/remotion-base/node_modules')]});
 const module={exports:{}};
 new Function('require','module','exports',outputFiles[0].text)(require,module,module.exports);
 view=module.exports;
 assert.equal(typeof view.RoughcutPanel,'function');
 assert.equal(typeof view.roughcutApplyConflict,'function');
 assert.equal(typeof view.parseRoughcutBoundary,'function');
});

test('finished jobs cannot replace another project, a changed source or manual edits',t=>{
 if(!view)return t.skip('panel implementation unavailable');
 const doc={id:'one',revision:1,canvas:{fps:{num:30,den:1},durationFrames:300},source:{path:'video.mp4',durationFrames:300,startFrame:0},instances:[],captions:{cues:[]}};
 const baseline={documentId:doc.id,sourceKey:view.roughcutSourceKey(doc),fingerprint:view.roughcutEditFingerprint(doc)};
 const job={id:'job1',documentId:doc.id,sourceKey:baseline.sourceKey,status:'complete'};
 assert.equal(view.roughcutApplyConflict(doc,job,baseline),'');
 assert.match(view.roughcutApplyConflict({...doc,id:'two'},job,baseline),/工程/);
 assert.match(view.roughcutApplyConflict(doc,{...job,sourceKey:'different'},baseline),/原片/);
 assert.match(view.roughcutApplyConflict({...doc,source:null},job,baseline),/原片/);
 assert.match(view.roughcutApplyConflict({...doc,captions:{cues:[{text:'手改字幕'}]}},job,baseline),/修改/);
 assert.equal(view.roughcutApplyConflict({...doc,revision:2},job,baseline),'');
 assert.equal(view.roughcutApplyConflict({...doc,captions:{...doc.captions,style:{fontSize:80}}},job,baseline),'');
 const a={...doc,captions:{enabled:true,cues:[{id:'c1',text:'hello',startFrame:0,endFrame:30}]}},b={...doc,captions:{cues:[{endFrame:30,startFrame:0,text:'hello',id:'c1'}],enabled:true}};
 assert.equal(view.roughcutEditFingerprint(a),view.roughcutEditFingerprint(b));
});

test('frame drafts reject blank, fractional, inverted and out-of-source intervals',t=>{
 if(!view)return t.skip('panel implementation unavailable');
 assert.deepEqual(view.parseRoughcutBoundary('12','30',90),{startFrame:12,endFrame:30});
 assert.throws(()=>view.parseRoughcutBoundary('','30',90),/整数/);
 assert.throws(()=>view.parseRoughcutBoundary('12.5','30',90),/整数/);
 assert.throws(()=>view.parseRoughcutBoundary('30','12',90),/晚于/);
 assert.throws(()=>view.parseRoughcutBoundary('12','91',90),/原片/);
});


test('source preview URLs encode path characters without losing path separators',t=>{
 if(!view)return t.skip('panel implementation unavailable');
 assert.equal(view.roughcutSourceUrl({publicPath:'media/口播 #1?.mp4'}),'/media/%E5%8F%A3%E6%92%AD%20%231%3F.mp4');
 assert.equal(view.roughcutSourceUrl(null),'');
});

test('task resume persists identity and baseline but never huge analysis or applied jobs',t=>{
 if(!view)return t.skip('panel implementation unavailable');
 const baseline={documentId:'one',sourceKey:'source',fingerprint:'before'};
 const task={job:{id:'job1',documentId:'one',sourceKey:'source',status:'running',analysis:{units:['large']}},baseline};
 const encoded=view.serializeRoughcutTasks({one:task,applied:{...task,applied:true}});
 assert.equal(encoded.includes('large'),false);
 const restored=view.restoreRoughcutTasks(encoded);
 assert.equal(Object.keys(restored).length,1);
 assert.equal(restored.one.job.id,'job1');
 assert.equal(restored.one.job.status,'running');
 assert.deepEqual(restored.one.baseline,baseline);
 assert.deepEqual(view.restoreRoughcutTasks('invalid'),{});
 assert.deepEqual(view.restoreRoughcutTasks(JSON.stringify([{job:{...task.job,documentId:'different'},baseline}])),{});
 const pending={...task,job:{...task.job,status:'complete'},conflict:'已有手改'};
 assert.equal(view.restoreRoughcutTasks(view.serializeRoughcutTasks({one:pending})).one.job.status,'running');
 assert.equal(view.restoreRoughcutTasks(view.serializeRoughcutTasks({one:pending})).one.conflict,'已有手改');
});

test('real model results render review controls, frame drafts and source selection without browser globals',async t=>{
 if(!view)return t.skip('panel implementation unavailable');
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 const model=await import('./roughcut-model.mjs');
 const raw={schemaVersion:1,id:'render',name:'测试口播',revision:0,canvas:{width:1920,height:1080,fps:{num:30,den:1},durationFrames:300},source:{path:'voice.mp4',publicPath:'voice.mp4',startFrame:0,durationFrames:300},instances:[],tracks:[]};
 const analysis={version:1,sourceKey:model.roughcutSourceKey(raw),sourceDurationSeconds:10,timing:'word',units:[{id:'u1',text:'重新说',startSeconds:2,endSeconds:3,timing:'word'}],silences:[],decisions:[{id:'d1',unitIds:['u1'],action:'delete',kind:'retake',reason:'口误后重说',confidence:0.98}],warnings:['待连续听审']};
 const cut=model.createRoughcut(raw,analysis);
 const render=doc=>renderToStaticMarkup(React.createElement(view.RoughcutPanel,{document:doc,getDocument:()=>doc,save:async()=>doc,onChange:()=>{},onSeek:()=>{},onPlayCut:()=>{},onPause:()=>{},onChooseSource:()=>{},onOpenDocument:()=>{},active:true}));
 const html=render(cut);
 for(const label of ['下载当前 SRT','恢复这段','播放原片','预览切口','应用切点','待连续听审','循环切口','停止预览'])assert.ok(html.includes(label),label);
 assert.match(html,/value="60"/);
 assert.match(html,/value="90"/);
 assert.match(render({...raw,source:null}),/选择口播视频/);
});


test('cut-loop controls stop playback when disabled and provide an explicit stop action',t=>{
 if(!view)return t.skip('panel implementation unavailable');
 assert.equal(typeof view.RoughcutPreviewControls,'function');
 const events=[],tree=view.RoughcutPreviewControls({loop:true,onLoopChange:value=>events.push(['loop',value]),onStop:()=>events.push(['stop'])});
 const find=(node,type)=>{
  if(!node||typeof node!=='object')return null;
  if(node.type===type)return node;
  for(const child of [node.props?.children].flat(Infinity)){const found=find(child,type);if(found)return found;}
  return null;
 };
 const input=find(tree,'input'),button=find(tree,'button');
 assert.equal(input.props.type,'checkbox');
 assert.equal(input.props.checked,true);
 input.props.onChange({currentTarget:{checked:false}});
 assert.deepEqual(events,[['loop',false],['stop']]);
 events.length=0;
 input.props.onChange({currentTarget:{checked:true}});
 assert.deepEqual(events,[['loop',true]]);
 button.props.onClick();
 assert.deepEqual(events,[['loop',true],['stop']]);
 assert.equal(button.props.disabled,undefined);
});

test('leaving an active roughcut panel releases its loop once without pausing hidden normal playback',t=>{
 if(!view)return t.skip('panel implementation unavailable');
 assert.equal(typeof view.roughcutLoopCleanup,'function');
 let pauses=0;const loop={current:true};
 const leave=view.roughcutLoopCleanup(true,loop,()=>pauses++);
 leave();assert.equal(pauses,1);assert.equal(loop.current,false);
 leave();assert.equal(pauses,1);
 const hidden=view.roughcutLoopCleanup(false,{current:true},()=>pauses++);
 hidden();assert.equal(pauses,1);
 const inactiveLoop=view.roughcutLoopCleanup(true,{current:false},()=>pauses++);
 inactiveLoop();assert.equal(pauses,1);
});


test('protected review exposes explicit whole-unit adoption and preserves manual provenance on restore',async t=>{
 if(!view)return t.skip('panel implementation unavailable');
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),model=await import('./roughcut-model.mjs');
 const raw={schemaVersion:1,id:'manual-render',name:'测试口播',revision:0,canvas:{width:1920,height:1080,fps:{num:30,den:1},durationFrames:300},source:{path:'voice.mp4',publicPath:'voice.mp4',startFrame:0,durationFrames:300},instances:[],tracks:[]};
 const analysis={version:1,sourceKey:model.roughcutSourceKey(raw),sourceDurationSeconds:10,timing:'segment',units:[{id:'u1',text:'重新说',startSeconds:2,endSeconds:3,timing:'segment',protectionReasons:['zero_alignment']}],silences:[],decisions:[{id:'d1',unitIds:['u1'],action:'review',kind:'retake',reason:'边界待检查',confidence:0.98}],warnings:[]};
 const cut=model.createRoughcut(raw,analysis),id=model.roughcutRows(cut)[0].id;
 const render=doc=>renderToStaticMarkup(React.createElement(view.RoughcutPanel,{document:doc,getDocument:()=>doc,save:async()=>doc,onChange:()=>{},onSeek:()=>{},onPlayCut:()=>{},onPause:()=>{},onChooseSource:()=>{},onOpenDocument:()=>{},active:true}));
 const before=render(cut);assert.match(before,/手动删除整段/);assert.match(before,/需先播放原片核对/);
 const adopted=model.adoptRoughcutCutManually(cut,id);assert.match(render(adopted),/手动采用/);assert.match(render(adopted),/恢复这段/);
 const restored=render(model.setRoughcutCut(adopted,id,{enabled:false}));
 assert.doesNotMatch(restored,/<button[^>]*disabled[^>]*>删除这段/);assert.match(restored,/手动采用/);
});
