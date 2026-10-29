import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  realpathSync,
  statSync,
  readFileSync,
} from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export function resolveEditorMedia(path, root = ROOT, kind = "video") {
  if (
    typeof path !== "string" ||
    !path ||
    path.startsWith("/") ||
    path.includes("://")
  )
    throw new Error("请使用仓库内的视频相对路径");
  const candidate = resolve(root, path);
  const actual = realpathSync(candidate);
  const base = realpathSync(root);
  if (
    !actual.startsWith(base + sep) ||
    !(kind === "audio" ? [".mp3",".wav",".ogg",".m4a",".aac",".flac",".aiff"] : [".mp4", ".mov", ".webm", ".m4v"]).includes(
      extname(actual).toLowerCase(),
    ) ||
    !statSync(actual).isFile()
  )
    throw new Error("媒体路径越界或文件类型不支持");
  return actual;
}
export function probeEditorMedia(path, { root = ROOT } = {}) {
  const actual = resolveEditorMedia(path, root);
  const meta = JSON.parse(
    execFileSync(
      "ffprobe",
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", actual],
      { encoding: "utf8", maxBuffer: 2 * 1024 * 1024, timeout: 30000 },
    ),
  );
  return { path, ...mediaMetadata(meta) };
}
export function mediaMetadata(meta) {
  const video = meta.streams?.find(
    (s) => s.codec_type === "video" && !s.disposition?.attached_pic,
  );
  if (!video) throw new Error("文件没有视频轨");
  let [num, den] = String(video.avg_frame_rate || "0/0")
    .split("/")
    .map(Number);
  if (!(num > 0 && den > 0))
    [num, den] = String(video.r_frame_rate || "0/0")
      .split("/")
      .map(Number);
  const duration = Number(video.duration ?? meta.format?.duration);
  if (!(num > 0 && den > 0 && duration > 0 && Number.isFinite(duration)))
    throw new Error("无法读取有效帧率和时长");
  const rotation = Number(
    video.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ??
      video.tags?.rotate ??
      0,
  );
  const [sarW, sarH] = String(video.sample_aspect_ratio || "1:1")
    .split(":")
    .map(Number);
  let width = Math.round(
      Number(video.width) * (sarW > 0 && sarH > 0 ? sarW / sarH : 1),
    ),
    height = Number(video.height);
  if (Math.abs(Math.round(rotation / 90)) % 2 === 1)
    [width, height] = [height, width];
  if (!(width > 0 && height > 0)) throw new Error("无法读取视频画幅");
  const ratio = width / height;
  const aspectLabel =
    Math.abs(ratio - 9 / 16) < 0.02
      ? "9:16 竖屏"
      : Math.abs(ratio - 16 / 9) < 0.03
        ? "16:9 横屏"
        : Math.abs(ratio - 1) < 0.02
          ? "1:1 方形"
          : width > height
            ? "横屏（原始比例）"
            : "竖屏（原始比例）";
  return {
    canvas: {
      width,
      height,
      fps: { num, den },
      durationFrames: Math.max(1, Math.round((duration * num) / den)),
    },
    hasAlpha: /^(yuva|rgba|argb|bgra|abgr|gbrap)/.test(video.pix_fmt || "") || String(video.tags?.alpha_mode) === "1",
    pixelFormat: video.pix_fmt,
    codec: video.codec_name,
    durationSeconds: duration,
    aspectLabel,
  };
}

export function stageEditorSource(document, { root = ROOT } = {}) {
  const copy = structuredClone(document);
  for(const clip of copy.audioClips??[]){
    const actual=resolveEditorMedia(clip.path,root,'audio');
    const meta=probeEditorAudio(clip.path,{root});
    const fps=copy.canvas.fps.num/copy.canvas.fps.den;
    if(clip.sourceInFrame+clip.durationFrames>Math.ceil(meta.durationSeconds*fps))throw Error('音频片段超过源文件时长');
    const key=createHash('sha256').update(readFileSync(actual)).digest('hex');
    const rel=`editor-audio/${key}${extname(actual).toLowerCase()}`;
    const publicRoot=realpathSync(join(root,'templates/remotion-base/public')),folder=join(publicRoot,'editor-audio');
    mkdirSync(folder,{recursive:true});if(!realpathSync(folder).startsWith(publicRoot+sep))throw Error('音频缓存目录越界');
    const dest=join(publicRoot,rel);if(existsSync(dest)){if(!realpathSync(dest).startsWith(publicRoot+sep)||createHash('sha256').update(readFileSync(dest)).digest('hex')!==key)throw Error('音频缓存完整性错误');}else copyFileSync(actual,dest);
    clip.publicPath=rel;
  }
  if (!copy.source) return copy;
  const actual = resolveEditorMedia(copy.source.path, root);
  // Imported project media is already a stable public source. Preserve its identity
  // so source-bound foreground manifests remain valid through full export staging.
  if(typeof copy.source.publicPath==='string'){
    const base=resolve(root,'templates/remotion-base/public');
    const staged=resolve(base,copy.source.publicPath);
    if(staged.startsWith(base+sep)&&existsSync(staged)&&realpathSync(staged)===actual)return copy;
  }

  const stat = statSync(actual);
  const key = createHash("sha256")
    .update(`${actual}:${stat.size}:${stat.mtimeMs}`)
    .digest("hex")
    .slice(0, 24);
  const rel = `editor-media/${key}${extname(actual).toLowerCase()}`;
  const dest = join(root, "templates/remotion-base/public", rel);
  mkdirSync(join(root, "templates/remotion-base/public/editor-media"), {
    recursive: true,
  });
  if (!existsSync(dest)) copyFileSync(actual, dest);
  copy.source.publicPath = rel;
  return copy;
}

export function probeEditorAudio(path,{root=ROOT}={}){
 const actual=resolveEditorMedia(path,root,'audio');
 const meta=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',actual],{encoding:'utf8',maxBuffer:2*1024*1024,timeout:30000}));
 const stream=meta.streams?.find(s=>s.codec_type==='audio'),durationSeconds=Number(stream?.duration??meta.format?.duration);
 if(!stream||!Number.isFinite(durationSeconds)||durationSeconds<=0)throw Error('文件没有有效音轨或时长');
 return {path,durationSeconds};
}
