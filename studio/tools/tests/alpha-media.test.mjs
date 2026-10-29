import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { probeEditorMedia, mediaMetadata } from "../lib/editor-media.mjs";
import { ensureAlphaPreview, normalizeOverlay } from "../lib/alpha-media.mjs";
import { assignPipMedia } from "../editor/pip-media.mjs";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "alpha-media-"));
  mkdirSync(join(root, "templates/remotion-base/public/editor-imports"), {
    recursive: true,
  });
  const path = "templates/remotion-base/public/editor-imports/overlay.mov";
  const frame = Buffer.alloc(64 * 48 * 4);
  for (let y = 12; y < 36; y++)
    for (let x = 16; x < 48; x++) {
      const i = (y * 64 + x) * 4;
      frame[i] = 255;
      frame[i + 3] = 255;
    }
  const out = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-f",
      "rawvideo",
      "-pixel_format",
      "rgba",
      "-video_size",
      "64x48",
      "-framerate",
      "10",
      "-i",
      "pipe:0",
      "-c:v",
      "prores_ks",
      "-profile:v",
      "4",
      "-pix_fmt",
      "yuva444p10le",
      "-alpha_bits",
      "16",
      join(root, path),
    ],
    { input: Buffer.concat(Array(6).fill(frame)) },
  );
  assert.equal(out.status, 0, out.stderr?.toString());
  return { root, path };
}
test("actual alpha video metadata and pip assignment retain alpha and preview identity", () => {
  const opts = fixture();
  const meta = probeEditorMedia(opts.path, opts);
  assert.equal(meta.hasAlpha, true);
  assert.equal(meta.codec, "prores");
  const props = assignPipMedia(
    {},
    { ...meta, publicPath: "raw.mov", previewPublicPath: "preview.webm" },
    "video",
  );
  assert.equal(props.media.hasAlpha, true);
  assert.equal(props.media.publicPath, "raw.mov");
  assert.equal(props.media.previewPublicPath, "preview.webm");
});
test("transparent browser preview preserves zero and opaque alpha while retaining original", async () => {
  const opts = fixture();
  const before = readFileSync(join(opts.root, opts.path));
  const result = await ensureAlphaPreview(opts.path, opts);
  assert.equal(result.hasAlpha, true);
  assert.match(result.previewPublicPath, /\.webm$/);
  const actual = join(
    opts.root,
    "templates/remotion-base/public",
    result.previewPublicPath,
  );
  assert.ok(existsSync(actual));
  const decoded = spawnSync("ffmpeg", [
    "-v",
    "error",
    "-c:v",
    "libvpx-vp9",
    "-i",
    actual,
    "-frames:v",
    "1",
    "-vf",
    "alphaextract",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "gray",
    "pipe:1",
  ]);
  assert.equal(decoded.status, 0, decoded.stderr?.toString());
  assert.equal(decoded.stdout[0], 0);
  assert.ok(decoded.stdout[24 * 64 + 32] > 245);
  assert.deepEqual(readFileSync(join(opts.root, opts.path)), before);
  assert.equal(
    (await ensureAlphaPreview(opts.path, opts)).previewPublicPath,
    result.previewPublicPath,
  );
});
test("overlay normalization rejects opaque or wrong canvas and preserves alpha", async () => {
  const opts = fixture(),
    input = join(opts.root, opts.path),
    output = join(opts.root, "normalized.mov");
  await assert.rejects(
    normalizeOverlay({
      input,
      output: join(opts.root, "bad.mp4"),
      width: 64,
      height: 48,
      fps: 10,
    }),
    /MOV|mov/,
  );
  await assert.rejects(
    normalizeOverlay({ input, output, width: 64, height: 64, fps: 10 }),
    /画幅|比例/,
  );
  await normalizeOverlay({ input, output, width: 64, height: 48, fps: 10 });
  assert.equal(probeEditorMedia("normalized.mov", opts).hasAlpha, true);
  const opaque = mediaMetadata({
    streams: [
      {
        codec_type: "video",
        width: 64,
        height: 48,
        duration: "1",
        avg_frame_rate: "10/1",
        pix_fmt: "yuv420p",
        codec_name: "h264",
      },
    ],
  });
  assert.equal(opaque.hasAlpha, false);
});
test("legacy normalizer cannot silently flatten a transparent source into mp4", () => {
  const opts = fixture();
  const result = spawnSync(
    "bash",
    [
      "tools/normalize-shot.sh",
      join(opts.root, opts.path),
      join(opts.root, "wrong.mp4"),
      "64",
      "48",
      "10",
      "none",
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /透明|Alpha|alpha/);
  assert.equal(existsSync(join(opts.root, "wrong.mp4")), false);
});
