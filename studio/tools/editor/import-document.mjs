import { resizeTimeline } from "./history.mjs";
/** Keep existing edits at the same second when an imported source changes frame rate. */
export function applyImportedSource(document, media) {
  const next = structuredClone(document),
    oldFps = next.canvas.fps.num / next.canvas.fps.den,
    newFps = 30;
  const ratio = newFps / oldFps;
  const timeKeys = new Set(["startFrame", "endFrame", "durationFrames", "sourceOffsetFrames", "sourceDurationFrames", "sourceInFrame"]);
  function retime(value) {
    if (!value || typeof value !== "object") return;
    for (const [key, v] of Object.entries(value)) {
      if (timeKeys.has(key) && Number.isFinite(v))
        value[key] = Math.round(v * ratio);
      else if (typeof v === "object") retime(v);
    }
  }
  retime(next);
  for (const instance of next.instances) {
    if (instance.durationFrames < 1)
      throw new Error("新底片帧率过低，已有短动画不足一帧，请先延长该动画");
    for (const chapter of instance.props.chapters ?? [])
      if (chapter.endFrame <= chapter.startFrame)
        throw new Error("新底片帧率过低，章节边界重叠，请先合并过短章节");
  }
  const resized = resizeTimeline(
    next,
    Math.max(
      1,
      Math.round(
        (media.durationSeconds ??
          (media.canvas.durationFrames * media.canvas.fps.den) /
            media.canvas.fps.num) * 30,
      ),
    ),
  );
  const scale = 1080 / Math.min(media.canvas.width, media.canvas.height);
  resized.canvas = {
    ...media.canvas,
    fps: { num: 30, den: 1 },
    durationFrames: resized.canvas.durationFrames,
    width: Math.round((media.canvas.width * scale) / 2) * 2,
    height: Math.round((media.canvas.height * scale) / 2) * 2,
  };
  resized.source = {
    path: media.path,
    publicPath: media.publicPath,
    displaySize: {width:media.canvas.width,height:media.canvas.height},
    startFrame: 0,
    durationFrames:resized.canvas.durationFrames,
  };
  if (!media.publicPath) delete resized.source.publicPath;
  for (const instance of resized.instances) {
    if (instance.assetId === 'source-pip' && instance.props.sourceMode !== 'media' && instance.props.crop) instance.props.crop.sourceAspect = media.canvas.width / media.canvas.height;
    instance.props.canvas = `${resized.canvas.width}x${resized.canvas.height}`;
    instance.props.durationSeconds = instance.durationFrames / newFps;
  }
  return resized;
}
