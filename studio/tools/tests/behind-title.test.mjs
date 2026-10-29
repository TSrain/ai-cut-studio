import test from 'node:test';import assert from 'node:assert/strict';
import {presenterPreparationRange,presenterBindingCurrent,behindTitleMotion} from '../../templates/remotion-base/src/editor/behind-title.mjs';
const d={id:'p',canvas:{durationFrames:90,fps:{num:30,den:1}},source:{path:'a',publicPath:'a',startFrame:100,clips:[{startFrame:0,durationFrames:30,sourceInFrame:100},{startFrame:30,durationFrames:60,sourceInFrame:200}]},instances:[]};
const i={id:'i',startFrame:20,durationFrames:30};
test('preparation maps edited source across a cut',()=>assert.deepEqual(presenterPreparationRange(d,i),{sourceStartFrame:120,frameCount:100}));
test('source gaps are rejected rather than masked with guessed frames',()=>assert.throws(()=>presenterPreparationRange({...d,source:{...d.source,clips:[{startFrame:0,durationFrames:25,sourceInFrame:100}]}},i),/底片/));
test('late result cannot overwrite changed timing or source',()=>{assert.ok(presenterBindingCurrent(d,i,d,i));assert.equal(presenterBindingCurrent(d,i,d,{...i,startFrame:21}),false);assert.equal(presenterBindingCurrent(d,i,{...d,source:{...d.source,startFrame:2}},i),false);assert.equal(presenterBindingCurrent(d,i,{...d,id:'q'},i),false);});
test('short clips retain finite motion and final actual frame exits completely',()=>{for(const n of [1,2,8,90]){for(let f=0;f<n;f++)for(const v of Object.values(behindTitleMotion(f,n,30,.18,.15)))assert.ok(Number.isFinite(v));assert.equal(behindTitleMotion(n-1,n,30,.18,.15).opacity,0);}assert.equal(behindTitleMotion(40,90,30,.18,.15).opacity,1);});


import {validateEditorProps} from '../lib/editor-props.mjs';
import {startPresenterJob} from '../lib/presenter-jobs.mjs';
const instance={id:'a',assetId:'behind-title',durationFrames:90,props:{durationSeconds:3,editorBackground:'transparent',slots:{title:'强调'},tune:{scale:1,x:0,y:0}}};
test('unfinished foreground can be edited but cannot be exported',()=>{assert.doesNotThrow(()=>validateEditorProps(instance,90,{fps:30}));assert.throws(()=>validateEditorProps(instance,90,{fps:30,requireAssets:true}),/尚未完成抠像/);});
test('foreground jobs reject missing source and unrelated assets before starting',()=>{const d={instances:[instance],source:null};assert.throws(()=>startPresenterJob(d,'a',{root:'/tmp'}),/导入口播/);assert.throws(()=>startPresenterJob({...d,instances:[{...instance,assetId:'word-cascade'}]},'a',{root:'/tmp'}),/模板/);});
