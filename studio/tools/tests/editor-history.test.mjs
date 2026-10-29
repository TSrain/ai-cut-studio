import test from "node:test";
import assert from "node:assert/strict";
import {
  editHistory,
  undoHistory,
  redoHistory,
  moveClip,
  resizeTimeline,
  normalizeEditorSelection,
} from "../editor/history.mjs";
test("撤销重做保留嵌套参数，新的修改清空重做分支", () => {
  const first = { past: [], present: { x: { value: 1 } }, future: [] };
  const changed = editHistory(first, { x: { value: 2 } });
  assert.equal(first.present.x.value, 1);
  const undone = undoHistory(changed);
  assert.equal(undone.present.x.value, 1);
  assert.equal(redoHistory(undone).present.x.value, 2);
  assert.equal(editHistory(undone, { x: { value: 3 } }).future.length, 0);
});
test("移动和裁剪吸附到帧并限制在时间轴，保留至少一帧", () => {
  const clip = { startFrame: 30, durationFrames: 60 };
  assert.deepEqual(moveClip(clip, "move", 500, 180), {
    startFrame: 120,
    durationFrames: 60,
  });
  assert.deepEqual(moveClip(clip, "left", 500, 180), {
    startFrame: 89,
    durationFrames: 1,
  });
  assert.deepEqual(moveClip(clip, "right", -500, 180), {
    startFrame: 30,
    durationFrames: 1,
  });
});
test("undo after save retains latest server revision so next save does not conflict", () => {
  const h = {
    past: [{ id: "x", revision: 1, value: "old" }],
    present: { id: "x", revision: 2, value: "new" },
    future: [],
  };
  const u = undoHistory(h);
  assert.equal(u.present.value, "old");
  assert.equal(u.present.revision, 2);
  assert.equal(redoHistory(u).present.revision, 2);
});

const timelineDocument = () => ({
  canvas: { durationFrames: 300 },
  instances: [
    {
      id: "progress",
      assetId: "chapter-progress",
      startFrame: 0,
      durationFrames: 300,
      props: {
        chapters: [
          { id: "a", startFrame: 0, endFrame: 100 },
          { id: "b", startFrame: 100, endFrame: 200 },
          { id: "c", startFrame: 200, endFrame: 300 },
        ],
      },
    },
    { id: "number", assetId: "number-beat", startFrame: 20, durationFrames: 60, props: {} },
  ],
});

test("resizing a timeline keeps a full-length progress instance and chapters covering the canvas", () => {
  const original = timelineDocument();
  const grown = resizeTimeline(original, 360);
  assert.equal(grown.canvas.durationFrames, 360);
  assert.equal(grown.instances[0].durationFrames, 360);
  assert.equal(grown.instances[0].props.chapters.at(-1).endFrame, 360);
  assert.deepEqual(grown.instances[1], original.instances[1]);

  const shrunk = resizeTimeline(original, 150);
  assert.equal(shrunk.instances[0].durationFrames, 150);
  assert.deepEqual(shrunk.instances[0].props.chapters.map(({ startFrame, endFrame }) => [startFrame, endFrame]), [[0, 100], [100, 150]]);
  assert.equal(original.canvas.durationFrames, 300);
});

test("timeline resize rejects non-progress instances beyond the new duration", () => {
  assert.throws(() => resizeTimeline(timelineDocument(), 70), /动画.*超出|exceed/i);
});

test("timeline growth extends global chapters even when the progress clip was trimmed", () => {
  const doc = timelineDocument();
  doc.instances[0].startFrame = 20;
  doc.instances[0].durationFrames = 120;
  const grown = resizeTimeline(doc, 360);
  assert.equal(grown.instances[0].startFrame, 20);
  assert.equal(grown.instances[0].durationFrames, 120);
  assert.equal(grown.instances[0].props.chapters.at(-1).endFrame, 360);
});

test("selection normalization resets stale parts and removed async selections", () => {
  const doc = timelineDocument();
  doc.instances[1].props = { slots: { value: 1, suffix: "%", label: "x" } };
  assert.deepEqual(normalizeEditorSelection(doc, "number", "item-0"), { selected: "number", part: "group" });
  assert.deepEqual(normalizeEditorSelection(doc, "removed", "number"), { selected: "", part: "group" });
  assert.deepEqual(normalizeEditorSelection(doc, "number", "label"), { selected: "number", part: "label" });
});

test('timeline resize rejects audio and markers beyond new bounds without mutating document',()=>{const d=timelineDocument();d.audioClips=[{startFrame:0,durationFrames:300}];assert.throws(()=>resizeTimeline(d,150),/音频.*超出/);d.audioClips=[];d.markers=[{frame:150}];assert.throws(()=>resizeTimeline(d,150),/标记.*超出/);});
