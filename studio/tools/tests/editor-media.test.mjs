import test from "node:test";
import assert from "node:assert/strict";
import {
  realpathSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveEditorMedia } from "../lib/editor-media.mjs";
test("媒体只允许仓库内真实视频文件，拒绝越界和符号链接逃逸", () => {
  const root = mkdtempSync(join(tmpdir(), "editor-media-"));
  try {
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "assets", "x.mp4"), "x");
    assert.equal(
      resolveEditorMedia("assets/x.mp4", root),
      realpathSync(join(root, "assets/x.mp4")),
    );
    assert.throws(() => resolveEditorMedia("../secrets.mp4", root));
    assert.throws(() => resolveEditorMedia("/etc/passwd", root));
    symlinkSync("/etc", join(root, "assets", "escape"));
    assert.throws(() => resolveEditorMedia("assets/escape/passwd", root));
    assert.throws(() =>
      resolveEditorMedia("https://example.com/movie.mp4", root),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
