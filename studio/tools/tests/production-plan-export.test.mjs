import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assessProductionPlanExport,
  assertExportMediaReadable,
} from "../lib/production-plan-export.mjs";
const doc = () => ({
  schemaVersion: 1,
  id: "export-plan",
  name: "x",
  revision: 0,
  canvas: {
    width: 320,
    height: 240,
    fps: { num: 30, den: 1 },
    durationFrames: 300,
  },
  source: null,
  instances: [],
  productionPlan: {
    shots: [
      {
        id: "s1",
        title: "屏幕",
        slots: [{ id: "slot", requirementVersion: 1 }],
        bindings: [],
        timing: { ranges: [{ startFrame: 30, durationFrames: 60 }] },
      },
    ],
  },
});
test("unfinished plan produces explicit warning, not a media/render failure", () => {
  const d = doc();
  const result = assessProductionPlanExport(d);
  assert.equal(result.requiresAcknowledgement, true);
  assert.equal(result.missing[0].slotId, "slot");
  assert.equal(result.emptyRanges.length, 1);
  d.productionPlan.shots[0].cancelled = true;
  assert.equal(assessProductionPlanExport(d).missing.length, 0);
});
test("adoption requires live enabled actual instance; deleted or disabled media returns a gap", () => {
  const d = doc();
  d.instances = [{ id: "i", startFrame: 30, durationFrames: 60 }];
  d.productionPlan.shots[0].bindings = [
    { id: "b", instanceId: "i", slotId: "slot", requirementVersion: 1 },
  ];
  assert.equal(assessProductionPlanExport(d).missing.length, 0);
  d.instances[0].disabled = true;
  assert.equal(assessProductionPlanExport(d).missing.length, 1);
});
test("referenced corrupt files block actual export even if path exists; unfilled plans do not", async () => {
  const root = mkdtempSync(join(tmpdir(), "plan-export-"));
  mkdirSync(join(root, "templates/remotion-base/public/fixture"), {
    recursive: true,
  });
  const d = doc();
  await assertExportMediaReadable(d, { root, mode: "full" });
  writeFileSync(
    join(root, "templates/remotion-base/public/fixture/bad.mp4"),
    "not a video",
  );
  d.source = {
    path: "templates/remotion-base/public/fixture/bad.mp4",
    publicPath: "fixture/bad.mp4",
    startFrame: 0,
  };
  await assert.rejects(
    assertExportMediaReadable(d, { root, mode: "full" }),
    /不可解码|无法读取/,
  );
});

test("valid SVG assets remain exportable without an ffmpeg SVG decoder", async () => {
  const root = mkdtempSync(join(tmpdir(), "plan-svg-export-"));
  const folder = join(root, "templates/remotion-base/public/fixture");
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "valid.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="red"/></svg>',
  );
  const d = doc();
  d.instances = [
    {
      id: "svg",
      assetId: "source-pip",
      startFrame: 0,
      durationFrames: 30,
      props: {
        sourceMode: "media",
        media: { kind: "image", publicPath: "fixture/valid.svg" },
      },
    },
  ];
  assert.equal((await assertExportMediaReadable(d, { root })).checked, 1);
  writeFileSync(join(folder, "valid.svg"), "<svg><broken></svg>");
  await assert.rejects(assertExportMediaReadable(d, { root }), /不可解码/);
});
test("disabled audio tracks do not block export on unused missing files", async () => {
  const root = mkdtempSync(join(tmpdir(), "plan-muted-export-"));
  mkdirSync(join(root, "templates/remotion-base/public"), { recursive: true });
  const d = doc();
  d.audioTracks = [{ id: "muted", disabled: true }];
  d.audioClips = [
    {
      id: "a",
      trackId: "muted",
      publicPath: "missing.wav",
      startFrame: 0,
      durationFrames: 60,
    },
  ];
  assert.equal((await assertExportMediaReadable(d, { root })).checked, 0);
  d.audioTracks[0].disabled = false;
  await assert.rejects(assertExportMediaReadable(d, { root }), /缺失/);
});
test("instance exports inspect linked source-pip but do not require an unused source for overlays", async () => {
  const root = mkdtempSync(join(tmpdir(), "plan-source-export-"));
  mkdirSync(join(root, "templates/remotion-base/public"), { recursive: true });
  const d = doc();
  d.source = { publicPath: "missing.mp4", startFrame: 0 };
  assert.equal(
    (await assertExportMediaReadable(d, { root, mode: "layer" })).checked,
    0,
  );
  d.instances = [
    {
      id: "pip",
      assetId: "source-pip",
      assetVersion: 1,
      startFrame: 0,
      durationFrames: 30,
      props: { sourceMode: "source" },
    },
  ];
  await assert.rejects(
    assertExportMediaReadable(d, { root, mode: "instances" }),
    /缺失/,
  );
});
test('export snapshots omit disabled media and audio outside the selected range before staging', async()=>{
 const {exportDocumentForItem,prepareExportDocument}=await import('../lib/editor-export.mjs');
 const d=doc(); d.source={path:'unused.mp4'};
 d.tracks=[{id:'off',disabled:true}];
 d.instances=[{id:'hidden',assetId:'media-stage',trackId:'off',startFrame:0,durationFrames:60,props:{slots:{clip:'missing.mp4'}}},{id:'title',assetId:'number-beat',startFrame:30,durationFrames:30,props:{}}];
 d.audioTracks=[{id:'muted',disabled:true},{id:'on'}];
 d.audioClips=[{id:'a',trackId:'muted',startFrame:30,durationFrames:30,path:'missing.wav'},{id:'b',trackId:'on',startFrame:100,durationFrames:30,path:'later.wav'}];
 const slice=exportDocumentForItem(d,{renderMode:'full',rangeStartFrame:30,durationFrames:30});
 assert.deepEqual(slice.instances.map(i=>i.id),['title']);assert.equal(slice.audioClips.length,0);
 const layer=prepareExportDocument(d,'layer');assert.equal(layer.source,null);assert.equal(layer.audioClips.length,0);assert.equal(d.audioClips.length,2);
});
