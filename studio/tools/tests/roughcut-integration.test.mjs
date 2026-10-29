import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDocument,saveDocument,loadDocument} from '../lib/editor-store.mjs';
import {retimeEditorDocument} from '../lib/editor-framerate.mjs';
import {createRoughcut,roughcutSourceKey,roughcutRows,setRoughcutCut,resetRoughcut,roughcutSrt,validateRoughcut} from '../editor/roughcut-model.mjs';
function fixture(){
 const d=createDocument({id:'roughcut-persistence',name:'测试原片',canvas:{width:960,height:540,fps:{num:30,den:1},durationFrames:300},source:{path:'templates/remotion-base/public/test.mp4',publicPath:'test.mp4',durationFrames:300,startFrame:0},instances:[]});
 const analysis={version:1,sourceKey:roughcutSourceKey(d),sourceDurationSeconds:10,timing:'word',units:[{id:'u1',text:'测试。',startSeconds:1,endSeconds:2,timing:'word',groupId:'c1'},{id:'u2',text:'测试。',startSeconds:3,endSeconds:4,timing:'word',groupId:'c2'}],silences:[{startSeconds:5,endSeconds:9}],decisions:[{id:'duplicate',unitIds:['u1'],keepUnitIds:['u2'],kind:'retake',action:'delete',reason:'重复句保留后句',confidence:.98}],warnings:[]};
 return {d,analysis};
}
test('roughcut survives real store save/reload, restores a selected cut and retains CAS protection',()=>{
 const {d,analysis}=fixture(),rootDir=mkdtempSync(join(tmpdir(),'roughcut-store-'));
 const cut=createRoughcut(d,analysis),saved=saveDocument(cut,{rootDir,expectedRevision:0});
 const loaded=loadDocument(d.id,{rootDir});assert.deepEqual(loaded.roughcut,saved.roughcut);assert.equal(roughcutSrt(loaded),roughcutSrt(cut));
 const restored=setRoughcutCut(loaded,roughcutRows(loaded).find(x=>x.kind==='retake').id,{enabled:false});
 assert.equal(restored.canvas.durationFrames,loaded.canvas.durationFrames+30);
 const again=saveDocument(restored,{rootDir,expectedRevision:1});assert.equal(again.revision,2);
 assert.throws(()=>saveDocument(loaded,{rootDir,expectedRevision:1}),/revision conflict/i);
 const reset=resetRoughcut(loadDocument(d.id,{rootDir}));assert.deepEqual(reset.source,d.source);assert.equal(reset.canvas.durationFrames,300);assert.equal(reset.captions,undefined);
});
test('actual export framerate conversion keeps roughcut valid and restorable',()=>{
 const {d,analysis}=fixture(),cut=createRoughcut(d,analysis);
 for(const fps of [24,25,30,50,60]){
  const scaled=retimeEditorDocument(cut,fps);assert.equal(validateRoughcut(scaled.roughcut),true);
  assert.equal(resetRoughcut(scaled).canvas.durationFrames,10*fps);
  const restored=setRoughcutCut(scaled,roughcutRows(scaled).find(x=>x.kind==='retake').id,{enabled:false});
  assert.equal(restored.canvas.durationFrames-scaled.canvas.durationFrames,fps);
 }
});

import {prepareExportDocument} from '../lib/editor-export.mjs';
test('export snapshot retains later subtitle edits and skips restoration metadata at every fps',()=>{
 const {d,analysis}=fixture(),cut=createRoughcut(d,analysis);
 cut.captions.style.fontSize=48;cut.captions.cues[0].text='人工润色字幕';
 for(const fps of [24,25,30,50,60]){
  const snapshot=prepareExportDocument(cut,'full');
  assert.equal(snapshot.roughcut,undefined);
  const exported=retimeEditorDocument(snapshot,fps);
  assert.equal(exported.captions.style.fontSize,48);assert.equal(exported.captions.cues[0].text,'人工润色字幕');
  assert.ok(exported.source.clips.length>1);assert.ok(cut.roughcut);
 }
});
