import test from "node:test";
import assert from "node:assert/strict";
import {
  encodeDraft,
  decodeDraft,
  filterTemplates,
  formatStudioTime,
} from "../editor/studio-state.mjs";
const doc = {
  schemaVersion: 1,
  id: "draft-a",
  name: "我的口播",
  revision: 0,
  canvas: {
    width: 1920,
    height: 1080,
    durationFrames: 300,
    fps: { num: 30, den: 1 },
  },
  source: null,
  instances: [],
};
test("draft roundtrip preserves unsaved text, frame and source identity", () => {
  const raw = encodeDraft(doc, 75, 123);
  assert.deepEqual(decodeDraft(raw), {
    version: 1,
    document: doc,
    frame: 75,
    savedAt: 123,
  });
});
test("drafts reject malformed, incompatible or non-finite timelines", () => {
  for (const value of [
    "oops",
    "{}",
    JSON.stringify({ version: 2, document: doc }),
    JSON.stringify({
      version: 1,
      document: { ...doc, canvas: { ...doc.canvas, durationFrames: -1 } },
      frame: 0,
      savedAt: 123,
    }),
  ])
    assert.equal(decodeDraft(value), null);
});
test("draft clamps playhead without altering a source document", () => {
  assert.equal(decodeDraft(encodeDraft(doc, 500, 123)).frame, 299);
  assert.equal(doc.canvas.durationFrames, 300);
});
test("template search matches names and identifiers and supports content categories", () => {
  const assets = [
    { id: "number-beat", name: "数字重击" },
    { id: "pill-stack", name: "胶囊标签" },
    { id: "chapter-progress", name: "章节进度" },
  ];
  assert.equal(filterTemplates(assets, "NUMBER", "all").length, 1);
  assert.equal(filterTemplates(assets, "", "navigation").length, 1);
  assert.equal(filterTemplates(assets, "不存在", "all").length, 0);
});
test("timecode uses frame precision", () => {
  assert.equal(formatStudioTime(1815, 30), "01:00:15");
  assert.equal(formatStudioTime(0, 30), "00:00:00");
});
