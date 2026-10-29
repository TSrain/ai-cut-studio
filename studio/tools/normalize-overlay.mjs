#!/usr/bin/env node
import { normalizeOverlay } from "./lib/alpha-media.mjs";
const [input, output, w, h, f, audio = "none"] = process.argv.slice(2);
try {
  if (!input || !output)
    throw Error(
      "用法: node tools/normalize-overlay.mjs <input> <output.mov> <width> <height> <fps> [none|keep]",
    );
  console.log(
    JSON.stringify(
      await normalizeOverlay({
        input,
        output,
        width: Number(w),
        height: Number(h),
        fps: Number(f),
        audio,
      }),
    ),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
