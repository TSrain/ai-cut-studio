import test from "node:test";
import assert from "node:assert/strict";
import {
  chapterWorkerArgs,
  finishChapterSummary,
} from "../lib/editor-chapters.mjs";
const cues = [
  { id: "1", startFrame: 15, endFrame: 45, text: "开场" },
  { id: "2", startFrame: 60, endFrame: 90, text: "结果" },
];
test("语义结果仍必须经过原字幕来源校验", () => {
  const chapters = finishChapterSummary(
    '{"chapters":[{"title":"背景","sourceCueIds":["1"]},{"title":"结果","sourceCueIds":["2"]}]}',
    cues,
    { durationFrames: 120 },
  );
  assert.equal(chapters[1].startFrame, 60);
  assert.equal(chapters[1].endFrame, 120);
  assert.throws(() =>
    finishChapterSummary(
      '{"chapters":[{"title":"造假","sourceCueIds":["99"]}]}',
      cues,
      { durationFrames: 120 },
    ),
  );
});
test("Codex 任务只读运行，不跳过审批和规则", () => {
  const args = chapterWorkerArgs("/tmp/job");
  assert.ok(args.includes("read-only"));
  assert.ok(args.includes("--output-schema"));
  assert.ok(
    !args.some((x) => x.includes("bypass") || x.includes("ignore-rules")),
  );
  assert.equal(args.at(-1), "-");
});
