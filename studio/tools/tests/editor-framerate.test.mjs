import test from "node:test";
import assert from "node:assert/strict";
import { retimeEditorDocument } from "../lib/editor-framerate.mjs";
test("导出帧率同时换算时间轴、动画、章节和源视频裁剪，秒位置不变", () => {
  const doc = {
    canvas: {
      width: 1920,
      height: 1080,
      fps: { num: 30, den: 1 },
      durationFrames: 300,
    },
    source: { startFrame: 60 },
    instances: [
      {
        startFrame: 30,
        durationFrames: 120,
        props: {
          chapters: [{ startFrame: 0, endFrame: 300 }],
          hiddenIntervals: [{ startFrame: 90, endFrame: 120 }],
        },
      },
    ],
  };
  const r = retimeEditorDocument(doc, 60);
  assert.equal(r.canvas.durationFrames, 600);
  assert.equal(r.instances[0].startFrame, 60);
  assert.equal(r.instances[0].durationFrames, 240);
  assert.equal(r.source.startFrame, 120);
  assert.equal(r.instances[0].props.chapters[0].endFrame, 600);
  assert.equal(doc.canvas.durationFrames, 300);
  assert.throws(() => retimeEditorDocument(doc, 0));
});
import {retimeEditorTarget} from '../lib/editor-framerate.mjs';
import {planEditorExport} from '../lib/editor-export.mjs';
test('explicit camera export target converts rounded endpoints and retains strict projection validation',()=>{const doc={canvas:{width:320,height:180,fps:{num:30,den:1},durationFrames:300},instances:[],source:{startFrame:0,clips:[{id:'s',startFrame:90,durationFrames:90,sourceInFrame:0}],cameraPlan:{clipGroups:[{id:'c',name:'camera',start:0,in:.5,hold:1,out:.5}]}}};const target={kind:'camera',id:'c',rangeStartFrame:90,durationFrames:60};const mapped=retimeEditorTarget(target,doc,24);assert.deepEqual(mapped,{kind:'camera',id:'c',rangeStartFrame:72,durationFrames:48});assert.equal(planEditorExport(retimeEditorDocument(doc,24),'clip',mapped)[0].rangeStartFrame,72);assert.equal(target.rangeStartFrame,90);assert.deepEqual(retimeEditorTarget({kind:'camera',id:'c',rangeStartFrame:1,durationFrames:1},doc,24),{kind:'camera',id:'c',rangeStartFrame:1,durationFrames:1});assert.throws(()=>retimeEditorTarget({...target,durationFrames:NaN},doc,24));assert.throws(()=>planEditorExport(retimeEditorDocument(doc,24),'clip',retimeEditorTarget({...target,rangeStartFrame:0},doc,24)));});
