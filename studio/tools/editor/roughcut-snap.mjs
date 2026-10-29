// Snap targets for rough-cut boundaries, in source frames: word/character boundaries from
// the alignment (analysis units) and silence edges/midpoints from silencedetect.
const PRIORITY = { 'word-start': 0, 'word-end': 0, 'silence-mid': 1, 'silence-start': 2, 'silence-end': 2 };
export const SNAP_THRESHOLD_PX = 8;
const cache = new WeakMap();
const fpsOf = (fps) => (fps && fps.num > 0 && fps.den > 0 ? fps.num / fps.den : 30);
/** Sorted unique snap points [{frame, kind, text?}] for a roughcut state (memoized per object). */
export function roughcutSnapPoints(roughcut) {
  if (!roughcut?.analysis || !roughcut.original) return [];
  if (cache.has(roughcut)) return cache.get(roughcut);
  const fps = fpsOf(roughcut.original.fps), total = roughcut.original.canvasDurationFrames ?? Infinity;
  const byFrame = new Map();
  const add = (seconds, kind, text) => {
    if (!Number.isFinite(seconds)) return;
    const frame = Math.max(0, Math.min(total, Math.round(seconds * fps)));
    const prior = byFrame.get(frame);
    if (!prior || PRIORITY[kind] < PRIORITY[prior.kind]) byFrame.set(frame, { frame, kind, ...(text ? { text } : {}) });
  };
  for (const unit of roughcut.analysis.units ?? []) { add(unit.startSeconds, 'word-start', unit.text); add(unit.endSeconds, 'word-end', unit.text); }
  for (const silence of roughcut.analysis.silences ?? []) {
    add(silence.startSeconds, 'silence-start'); add(silence.endSeconds, 'silence-end');
    add((silence.startSeconds + silence.endSeconds) / 2, 'silence-mid');
  }
  const points = [...byFrame.values()].sort((a, b) => a.frame - b.frame);
  cache.set(roughcut, points);
  return points;
}
function lowerBound(points, frame) {
  let lo = 0, hi = points.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (points[mid].frame < frame) lo = mid + 1; else hi = mid; }
  return lo;
}
/** Zoom-dependent capture distance: a fixed screen distance expressed in frames. */
export function snapThresholdFrames(pxPerFrame, thresholdPx = SNAP_THRESHOLD_PX) {
  return Number.isFinite(pxPerFrame) && pxPerFrame > 0 ? thresholdPx / pxPerFrame : 0;
}
/** Snap a raw (fractional) frame to the nearest point within the pixel threshold. */
export function snapToPoints(raw, points, { pxPerFrame, thresholdPx = SNAP_THRESHOLD_PX, disabled = false, min = -Infinity, max = Infinity, filter } = {}) {
  const clamp = (value) => Math.max(min, Math.min(max, value));
  const frame = clamp(Math.round(raw));
  if (disabled || !Number.isFinite(raw) || !points?.length) return { frame, snapped: false, point: null };
  const limit = snapThresholdFrames(pxPerFrame, thresholdPx), i = lowerBound(points, raw);
  let best = null, distance = Infinity;
  for (let j = Math.max(0, i - 2); j < Math.min(points.length, i + 2); j++) {
    const point = points[j];
    if (filter && !filter(point)) continue;
    if (point.frame < min || point.frame > max) continue;
    const delta = Math.abs(point.frame - raw);
    if (delta <= limit && delta < distance) { best = point; distance = delta; }
  }
  return best ? { frame: best.frame, snapped: true, point: best } : { frame, snapped: false, point: null };
}
/** The first point strictly before (direction -1) or after (+1) a frame, for nudge buttons. */
export function adjacentSnapPoint(points, frame, direction, filter) {
  if (direction > 0) { for (let j = lowerBound(points, frame + 1); j < points.length; j++) if (!filter || filter(points[j])) return points[j]; return null; }
  for (let j = lowerBound(points, frame) - 1; j >= 0; j--) if (!filter || filter(points[j])) return points[j];
  return null;
}
/** Project frame → source frame through the (possibly cut) source clip mapping. */
export function projectToSourceFrame(document, frame) {
  const clips = document?.source?.clips;
  if (!clips?.length) return Math.round(frame) + (document?.source?.startFrame ?? 0);
  const sorted = [...clips].sort((a, b) => a.startFrame - b.startFrame);
  const clip = sorted.find((c) => frame >= c.startFrame && frame < c.startFrame + c.durationFrames) ?? (frame < sorted[0].startFrame ? sorted[0] : sorted.at(-1));
  const offset = Math.max(0, Math.min(clip.durationFrames, Math.round(frame) - clip.startFrame));
  return clip.sourceInFrame + offset;
}
/** Source frame → project frame, or null when that source frame is cut out of the timeline. */
export function sourceToProjectFrame(document, sourceFrame) {
  const clips = document?.source?.clips;
  if (!clips?.length) return sourceFrame - (document?.source?.startFrame ?? 0);
  const clip = clips.find((c) => sourceFrame >= c.sourceInFrame && sourceFrame < c.sourceInFrame + c.durationFrames);
  return clip ? clip.startFrame + sourceFrame - clip.sourceInFrame : null;
}
/** Source-frame snap points as plain numbers for a timeline source trim (left or right edge). */
export function sourceTrimSnap({ roughcut, edgeSourceFrame, delta, pxPerFrame, disabled = false, thresholdPx = SNAP_THRESHOLD_PX }) {
  const points = roughcutSnapPoints(roughcut);
  const result = snapToPoints(edgeSourceFrame + delta, points, { pxPerFrame, thresholdPx, disabled });
  return result.snapped ? { delta: result.frame - edgeSourceFrame, point: result.point } : null;
}
export const SNAP_KIND_LABEL = { 'word-start': '字词起点', 'word-end': '字词终点', 'silence-start': '停顿开始', 'silence-mid': '停顿中点', 'silence-end': '停顿结束' };

/** Label for a rough-cut snap during a timeline drag. */
export function snapHintText(point) {
  if (!point) return '';
  return `吸附到${String(point.kind).startsWith('word') ? '字词边界' : '停顿'}${point.text ? `「${point.text}」` : ''}`;
}
/** The range/delta hint is written on every pointer move; keep the snap label in front of it. */
export function composeDragHint(snap, range) {
  if (!snap) return range;
  return [snap, range, '按住 Option 取消吸附'].filter(Boolean).join(' · ');
}
