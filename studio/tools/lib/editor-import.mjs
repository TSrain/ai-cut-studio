import { registerProjectMedia, validateMediaProjectId, safeMediaPath } from './project-media.mjs';
import {ensureAlphaPreview} from './alpha-media.mjs';
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, writeFile, statfs } from "node:fs/promises";
import { join, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFileSync } from "node:child_process";
import { probeEditorMedia, probeEditorAudio } from "./editor-media.mjs";
const extensions = {
  video: [".mp4", ".mov", ".m4v", ".webm"],
  image: [".png", ".jpg", ".jpeg", ".webp"],
  audio: [".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac", ".aiff"],
};
export const EDITOR_VIDEO_MAX_BYTES=32*1024**3;
export function checkEditorImportCapacity({expectedBytes,maxBytes,availableBytes}){
 if(expectedBytes!==undefined&&(!Number.isSafeInteger(expectedBytes)||expectedBytes<=0))throw Error('文件大小无效');
 if(!Number.isSafeInteger(maxBytes)||maxBytes<=0)throw Error('导入上限无效');
 if(expectedBytes>maxBytes)throw Error(`文件超过导入上限（${Math.round(maxBytes/1024**3)} GiB）`);
 if(expectedBytes!==undefined&&Number.isFinite(availableBytes)&&availableBytes<expectedBytes+256*1024**2)throw Error('磁盘空间不足，请腾出原片大小及至少 256 MiB 余量后重试');
}
/** Stream into a private temporary file; publish only after successful media probing. */
export async function importEditorFile(
  stream,
  { root, kind, name, audioCategory, projectId, maxBytes, expectedBytes = stream.headers?.["content-length"] ? Number(stream.headers["content-length"]) : undefined },
) {
  if (kind === 'media') {
    if (!projectId) throw new Error('请指定当前项目');
    const ext = extname(String(name || '')).toLowerCase();
    kind = extensions.video.includes(ext) ? 'video' : extensions.image.includes(ext) ? 'image' : 'media';
  }
  maxBytes ??= kind === "video" ? EDITOR_VIDEO_MAX_BYTES : 4*1024**3;
  checkEditorImportCapacity({expectedBytes,maxBytes});
  if (projectId != null) validateMediaProjectId(projectId);
  if (!extensions[kind]) throw new Error("不支持的素材类型");
  if (kind === "audio" && !["music", "effect"].includes(audioCategory)) throw new Error("请选择配乐或音效分类");
  const filename = String(name || "")
    .split(/[/\\]/)
    .pop();
  const ext = extname(filename).toLowerCase();
  if (!extensions[kind].includes(ext))
    throw new Error(
      kind === "video"
        ? "请选择 MP4、MOV、M4V 或 WebM 视频"
        : kind === "audio" ? "请选择 MP3、WAV、M4A 等音频文件" : "请选择 PNG、JPG 或 WebP 图片",
    );
  const folder = projectId && kind !== 'audio' ? `editor-project-media/${projectId}` : 'editor-imports';
  const dir = safeMediaPath(root, `templates/remotion-base/public/${folder}/placeholder`, {createParent:true});
  const directory = dir.slice(0, -'/placeholder'.length);
  await mkdir(directory, { recursive: true });
  const disk=await statfs(directory);
  checkEditorImportCapacity({expectedBytes,maxBytes,availableBytes:disk.bavail*disk.bsize});
  const id =
      randomUUID() +
      "--" +
      filename
        .replace(/[\x00-\x1f]/g, "")
        .slice(0, 140)
        .slice(0, -ext.length),
    temporary = join(directory, `.${id}${ext}`),
    target = join(directory, `${id}${ext}`);
  let bytes = 0;
  try {
    await pipeline(
      stream,
      new Transform({
        transform(chunk, enc, cb) {
          bytes += chunk.length;
          cb(
            bytes > maxBytes
              ? new Error(`文件超过导入上限（${Math.round(maxBytes/1024**3)} GiB）`)
              : null,
            chunk,
          );
        },
      }),
      createWriteStream(temporary, { flags: "wx" }),
    );
    if (!bytes) throw new Error("文件为空，请重新选择");
    if(expectedBytes!==undefined&&bytes!==expectedBytes)throw Error("导入文件大小不一致，文件可能不完整，请重试");
    let meta;
    if (kind === "video")
      meta = probeEditorMedia(
        `templates/remotion-base/public/${folder}/.${id}${ext}`,
        { root },
      );
    else if (kind === "audio") meta = probeEditorAudio(`templates/remotion-base/public/${folder}/.${id}${ext}`, {root});
    else {
      const data = JSON.parse(
        execFileSync(
          "ffprobe",
          ["-v", "error", "-show_streams", "-of", "json", temporary],
          { encoding: "utf8", timeout: 30000, maxBuffer: 1024 ** 2 },
        ),
      );
      const image = data.streams?.find((s) => s.codec_type === "video");
      if (!image?.width || !image?.height) throw new Error("无法读取图片尺寸");
      meta = { width: image.width, height: image.height };
    }
    if (kind === "audio") {
      if(meta.durationSeconds>=20)audioCategory='music';
      await writeFile(target + '.audio.json', JSON.stringify({audioCategory}), {flag:'wx'});
    }
    await rename(temporary, target);
    const publicPath = `${folder}/${id}${ext}`;
    if(kind === "video" && meta.hasAlpha) meta={...meta,...await ensureAlphaPreview(`templates/remotion-base/public/${publicPath}`,{root})};
    const result = {
      kind,
      ...meta,
      ...(kind === "audio" ? {audioCategory} : {}),
      name: filename,
      bytes,
      publicPath,
      path: `templates/remotion-base/public/${publicPath}`,
    };
    return projectId && kind !== "audio" ? registerProjectMedia(result,{root,projectId}) : result;
  } catch (error) {
    await rm(temporary, { force: true });
    if (kind === "audio") await rm(target + '.audio.json', {force:true});
    throw new Error(
      error.message.startsWith("Command failed")
        ? "无法解码所选文件，请换一个文件重试"
        : error.message,
    );
  }
}
