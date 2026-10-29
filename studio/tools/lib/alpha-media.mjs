import { createHash, randomUUID } from "node:crypto";
import {
  createReadStream,
  existsSync,
  realpathSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { resolve, join, extname, dirname, sep } from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { mediaMetadata, resolveEditorMedia } from "./editor-media.mjs";
const run = promisify(execFile),
  pending = new Map();
async function digest(path) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest("hex");
}
function probe(path) {
  return mediaMetadata(
    JSON.parse(
      execFileSync(
        "ffprobe",
        ["-v", "error", "-show_streams", "-show_format", "-of", "json", path],
        { encoding: "utf8", timeout: 30000, maxBuffer: 2 * 1024 * 1024 },
      ),
    ),
  );
}
/** Browser preview is a disposable mirror; exports always retain the original alpha file. */
export async function ensureAlphaPreview(path, { root, signal } = {}) {
  const actual = resolveEditorMedia(path, root),
    meta = probe(actual);
  if (!meta.hasAlpha) return { hasAlpha: false };
  const publicRoot = realpathSync(join(root, "templates/remotion-base/public"));
  if (
    extname(actual).toLowerCase() === ".webm" &&
    actual.startsWith(publicRoot + sep)
  )
    return {
      hasAlpha: true,
      previewPublicPath: actual.slice(publicRoot.length + 1),
    };
  const key = await digest(actual),
    previewPublicPath = `editor-alpha-preview/${key}.webm`,
    target = join(publicRoot, previewPublicPath);
  mkdirSync(dirname(target), { recursive: true });
  if (!realpathSync(dirname(target)).startsWith(publicRoot + sep))
    throw Error("透明预览缓存目录越界");
  const check = () => {
    if (!existsSync(target)) return false;
    if (realpathSync(target) !== target || !statSync(target).isFile())
      throw Error("透明预览缓存路径异常");
    const cached = probe(target);
    return (
      cached.hasAlpha &&
      cached.canvas.width === meta.canvas.width &&
      cached.canvas.height === meta.canvas.height &&
      Math.abs(cached.durationSeconds - meta.durationSeconds) < 0.12
    );
  };
  if (!check()) {
    let job = pending.get(target);
    if (!job) {
      job = (async () => {
        const temp = target + "." + randomUUID() + ".webm";
        try {
          await run(
            "ffmpeg",
            [
              "-v",
              "error",
              "-nostdin",
              "-i",
              actual,
              "-map",
              "0:v:0",
              "-an",
              "-c:v",
              "libvpx-vp9",
              "-pix_fmt",
              "yuva420p",
              "-auto-alt-ref",
              "0",
              "-b:v",
              "0",
              "-lossless",
              "1",
              "-deadline",
              "realtime",
              "-cpu-used",
              "6",
              temp,
            ],
            { signal, maxBuffer: 2 * 1024 * 1024 },
          );
          if (!probe(temp).hasAlpha) throw Error("透明预览没有 Alpha 通道");
          renameSync(temp, target);
        } finally {
          rmSync(temp, { force: true });
        }
      })();
      pending.set(target, job);
      job.finally(() => pending.delete(target)).catch(() => {});
    }
    await job;
  }
  return { hasAlpha: true, previewPublicPath };
}
export async function normalizeOverlay({
  input,
  output,
  width,
  height,
  fps,
  audio = "none",
  signal,
}) {
  if (extname(output).toLowerCase() !== ".mov")
    throw Error("透明叠层必须输出 MOV，不能转为不透明 MP4");
  if (
    ![width, height, fps].every((n) => Number.isFinite(n) && n > 0) ||
    !Number.isInteger(width) ||
    !Number.isInteger(height)
  )
    throw Error("无效画幅或帧率");
  if (!["none", "keep"].includes(audio))
    throw Error("audio 只接受 none 或 keep");
  const source = probe(input);
  if (!source.hasAlpha) throw Error("输入不含 Alpha 通道，不能冒充透明叠层");
  if (
    Math.abs(source.canvas.width / source.canvas.height - width / height) >
    0.001
  )
    throw Error("透明素材画幅比例不符，需按合同重新构图");
  if (resolve(input) === resolve(output)) throw Error("不能覆盖透明源文件");
  if (existsSync(output)) throw Error("输出已存在，请指定新版本路径");
  mkdirSync(dirname(output), { recursive: true });
  const temp = output + "." + randomUUID() + ".mov";
  try {
    await run(
      "ffmpeg",
      [
        "-v",
        "error",
        "-nostdin",
        "-i",
        input,
        "-map",
        "0:v:0",
        ...(audio === "keep" ? ["-map", "0:a?"] : []),
        "-vf",
        `scale=${width}:${height}:flags=lanczos,setsar=1,fps=${fps}`,
        "-c:v",
        "prores_ks",
        "-profile:v",
        "4",
        "-pix_fmt",
        "yuva444p10le",
        "-alpha_bits",
        "16",
        ...(audio === "keep" ? ["-c:a", "pcm_s16le"] : ["-an"]),
        temp,
      ],
      { signal, maxBuffer: 2 * 1024 * 1024 },
    );
    const result = probe(temp);
    if (
      !result.hasAlpha ||
      result.canvas.width !== width ||
      result.canvas.height !== height
    )
      throw Error("透明输出校验失败");
    renameSync(temp, output);
    return { ...result, path: output };
  } finally {
    rmSync(temp, { force: true });
  }
}
