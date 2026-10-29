import test from "node:test";
import assert from "node:assert/strict";
import { planEditorExport } from "../lib/editor-export.mjs";
const doc = {
  schemaVersion: 1,
  id: "test",
  name: "Test",
  revision: 0,
  canvas: {
    width: 1920,
    height: 1080,
    fps: { num: 30000, den: 1001 },
    durationFrames: 300,
  },
  source: null,
  styleReference: {
    contractPath: null,
    styleframePath: null,
    allowedOverrides: [],
  },
  instances: [
    {
      id: "a",
      assetId: "number-beat",
      assetVersion: 1,
      startFrame: 30,
      durationFrames: 75,
      zIndex: 2,
      props: {variant: {layout: 'side', bg: 'transparent'}},
    },
    {
      id: "b",
      assetId: "number-beat",
      assetVersion: 1,
      startFrame: 150,
      durationFrames: 90,
      zIndex: 1,
      props: {variant: {layout: 'side', bg: 'transparent'}},
    },
    {
      id: "p",
      assetId: "chapter-progress",
      assetVersion: 1,
      startFrame: 0,
      durationFrames: 300,
      zIndex: 3,
      props: {},
    },
  ],
};
test("每次使用各导出一个文件，裁掉前空白，保留全局帧与画幅", () => {
  const out = planEditorExport(doc, "instances");
  assert.equal(out.length, 3);
  assert.deepEqual(
    out.map((x) => x.rangeStartFrame),
    [30, 150, 0],
  );
  assert.deepEqual(
    out.map((x) => x.durationFrames),
    [75, 90, 300],
  );
  assert.equal(new Set(out.map((x) => x.filename)).size, 3);
  assert.ok(
    out.every((x) => x.extension === "mov" && x.renderMode === "instances"),
  );
  assert.equal(out[0].sourceStartSeconds, (30 * 1001) / 30000);
});
test("整片与整条动画层独立，拒绝未知选项", () => {
  assert.equal(planEditorExport(doc, "full")[0].extension, "mp4");
  assert.equal(planEditorExport(doc, "layer")[0].extension, "mov");
  assert.throws(() => planEditorExport(doc, "wrong"));
});
test('单实例按 preset 背景合同选择容器', () => {
  const copy = structuredClone(doc);
  copy.instances = [
    {...copy.instances[0], id: 'opaque', assetId: 'title-reveal', props: {slots: {title: '整镜'}}},
    {...copy.instances[0], id: 'conditional-alpha', assetId: 'word-cascade', props: {variant: {bg: 'transparent'}, slots: {lines: ['叠加层']}}},
    {...copy.instances[0], id: 'conditional-opaque', assetId: 'word-cascade', props: {variant: {bg: 'aurora'}, slots: {lines: ['整镜']}}},
    {...copy.instances[0], id: 'pill-scene', assetId: 'pill-stack', props: {variant: {bg: 'scene'}, slots: {items: ['整镜胶囊']}}},
  ];
  assert.deepEqual(planEditorExport(copy, 'instances').map((item) => item.extension), ['mp4', 'mov', 'mp4', 'mp4']);
});
test("不能让实例 id 注入文件路径", () => {
  const copy = structuredClone(doc);
  copy.instances[0].id = "../bad";
  assert.throws(() => planEditorExport(copy, "instances"));
});
test('single template range exports a composited MP4 without filtering other visible layers',()=>{
 const [item]=planEditorExport(doc,'clip',{kind:'instance',id:'a'});
 assert.equal(item.extension,'mp4');assert.equal(item.renderMode,'full');assert.equal(item.rangeStartFrame,30);assert.equal(item.durationFrames,75);assert.equal(item.instanceId,undefined);
 assert.throws(()=>planEditorExport(doc,'clip',{kind:'instance',id:'missing'}));
});
test('single camera block rounds start and end at output fps and cannot escape project',()=>{
 const copy=structuredClone(doc);copy.source={path:'media/x.mp4',startFrame:0,cameraPlan:{clipGroups:[{id:'camera-1',start:1.1,in:.35,hold:1,out:.4,enabled:true,name:'强调'}]}};
 const [item]=planEditorExport(copy,'clip',{kind:'camera',id:'camera-1'});
 const fps=30000/1001;assert.equal(item.rangeStartFrame,Math.round(1.1*fps));assert.equal(item.durationFrames,Math.round(2.85*fps)-Math.round(1.1*fps));assert.equal(item.renderMode,'full');
 assert.throws(()=>planEditorExport(copy,'clip',{kind:'other',id:'camera-1'}));
 assert.throws(()=>planEditorExport(copy,'clip',{kind:'camera',id:'../bad'}));
});
test('selected layer preserves alpha and isolates the template from every other layer',()=>{
 const [item]=planEditorExport(doc,'single-layer',{kind:'instance',id:'a'});
 assert.equal(item.extension,'mov');assert.equal(item.renderMode,'instances');assert.equal(item.instanceId,'a');assert.equal(item.durationFrames,75);
 const opaque=structuredClone(doc);opaque.instances[0]={...opaque.instances[0],assetId:'title-reveal',props:{slots:{title:'标题'}}};
 assert.equal(planEditorExport(opaque,'single-layer',{kind:'instance',id:'a'})[0].extension,'mp4');
 assert.throws(()=>planEditorExport(doc,'single-layer',{kind:'camera',id:'a'}));
});
test('render snapshot drops out-of-range layers, keeps intersecting layers and original time',async()=>{
 const {exportDocumentForItem}=await import('../lib/editor-export.mjs');
 const [clip]=planEditorExport(doc,'clip',{kind:'instance',id:'a'});
 assert.deepEqual(exportDocumentForItem(doc,clip).instances.map(i=>i.id),['a','p']);
 const [layer]=planEditorExport(doc,'single-layer',{kind:'instance',id:'a'});
 const isolated=exportDocumentForItem(doc,layer);assert.deepEqual(isolated.instances.map(i=>i.id),['a']);assert.equal(isolated.instances[0].startFrame,30);assert.equal(doc.instances.length,3);
});
