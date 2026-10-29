import {validateCaptionTrack} from '../../templates/remotion-base/src/editor/captions.mjs';
import {applyPatch,diffValues,patchBytes} from './history-patch.mjs';
const restore = (snapshot, live) =>
  snapshot.id && snapshot.id === live.id
    ? {
        ...snapshot,
        revision: live.revision,
        ...(live.assetSourceHash
          ? { assetSourceHash: live.assetSourceHash }
          : {}),
      }
    : snapshot;
// Undo/redo keeps one live document plus small patches instead of full copies.
// past[k] turns the document after it (the anchor for the last entry) into the
// earlier document; future[j] turns the document before it (the anchor for the
// first entry) into the later document. Full documents are still accepted as
// absolute entries (literal histories, syncPlanHistory output) and are compacted
// into patches on the next edit. The anchor is the document past/future are
// relative to; it differs from present only while a gesture streams live
// updates through `{...h, present}` or right after an undo/redo restore.
export const HISTORY_LIMITS = { count: 100, bytes: 32 * 1024 * 1024 };
class HistoryPatch {
  constructor(ops) {
    this.ops = ops;
    this.bytes = patchBytes(ops);
  }
}
export const isHistoryPatch = (entry) => entry instanceof HistoryPatch;
const patchTo = (from, to) => new HistoryPatch(diffValues(from, to));
const resolve = (entry, onto) => (isHistoryPatch(entry) ? applyPatch(onto, entry.ops) : entry);
const anchorOf = (h) => h.anchor ?? h.present;
const snapshotBytes = new WeakMap();
export const historyEntryBytes = (entry) => {
  if (isHistoryPatch(entry)) return entry.bytes;
  if (entry === null || typeof entry !== "object") return 16;
  if (!snapshotBytes.has(entry)) snapshotBytes.set(entry, 2 * JSON.stringify(entry).length);
  return snapshotBytes.get(entry);
};
export const historyBytes = (h) =>
  [...h.past, ...h.future].reduce((sum, entry) => sum + historyEntryBytes(entry), 0);
const sizeOf = (entries) => entries.reduce((sum, entry) => sum + historyEntryBytes(entry), 0);
// Oldest undo steps go first; the newest step is always kept.
function trimPast(past, limits = HISTORY_LIMITS) {
  let start = Math.max(0, past.length - limits.count), bytes = sizeOf(past.slice(start));
  while (past.length - start > 1 && bytes > limits.bytes) bytes -= historyEntryBytes(past[start++]);
  return start ? past.slice(start) : past;
}
function trimFuture(future, limits = HISTORY_LIMITS) {
  let end = Math.min(future.length, limits.count), bytes = sizeOf(future.slice(0, end));
  while (end > 1 && bytes > limits.bytes) bytes -= historyEntryBytes(future[--end]);
  return end < future.length ? future.slice(0, end) : future;
}
function reanchorPast(h, target) {
  const anchor = anchorOf(h), last = h.past.at(-1);
  if (anchor === target || !isHistoryPatch(last)) return h.past;
  return [...h.past.slice(0, -1), patchTo(target, resolve(last, anchor))];
}
function reanchorFuture(h, target) {
  const anchor = anchorOf(h), first = h.future[0];
  if (anchor === target || !isHistoryPatch(first)) return h.future;
  return [patchTo(target, resolve(first, anchor)), ...h.future.slice(1)];
}
// Turn absolute snapshots back into patches (relative to the entry after them).
function compactPast(past, anchor) {
  if (past.every(isHistoryPatch)) return past;
  const out = new Array(past.length);
  let current = anchor;
  for (let i = past.length - 1; i >= 0; i--) {
    const doc = resolve(past[i], current);
    out[i] = isHistoryPatch(past[i]) ? past[i] : patchTo(current, doc);
    current = doc;
  }
  return out;
}
/** Expand to full documents: {past: oldest..newest, present, future: next..last}. */
export function materializeHistory(h) {
  const anchor = anchorOf(h), past = new Array(h.past.length), future = [];
  let current = anchor;
  for (let i = h.past.length - 1; i >= 0; i--) past[i] = current = resolve(h.past[i], current);
  current = anchor;
  for (const entry of h.future) future.push((current = resolve(entry, current)));
  return { past, present: h.present, future };
}
/** Record base -> next as one undo step (base becomes the undo target). */
export function commitHistory(h, base, next) {
  const past = compactPast(reanchorPast(h, base), base);
  return { past: trimPast([...past, patchTo(next, base)]), present: next, future: [], anchor: next };
}
/** End of a live gesture: present already holds the result; base is the state before it. */
export const pushPastHistory = (h, base) => commitHistory(h, base, h.present);
export const editHistory = (h, next) => commitHistory(h, h.present, structuredClone(next));
/** Fold `next` into the newest undo step: one undo returns to the state before the whole group. */
export function amendHistory(h, next) {
  if (!h.past.length) return editHistory(h, next);
  const base = resolve(h.past.at(-1), anchorOf(h));
  return commitHistory({ past: h.past.slice(0, -1), present: base, future: [], anchor: base }, base, structuredClone(next));
}
export const undoHistory = (h) => {
  if (!h.past.length) return h;
  const previous = resolve(h.past.at(-1), anchorOf(h));
  return {
    past: h.past.slice(0, -1),
    present: restore(previous, h.present),
    future: trimFuture([patchTo(previous, h.present), ...reanchorFuture(h, h.present)]),
    anchor: previous,
  };
};
export const redoHistory = (h) => {
  if (!h.future.length) return h;
  const next = resolve(h.future[0], anchorOf(h));
  const past = compactPast(reanchorPast(h, h.present), h.present);
  return {
    past: trimPast([...past, patchTo(next, h.present)]),
    present: restore(next, h.present),
    future: h.future.slice(1),
    anchor: next,
  };
};
export function moveClip(clip, mode, delta, total) {
  delta = Math.round(delta);
  const end = clip.startFrame + clip.durationFrames;
  if (mode === "left") {
    const startFrame = Math.max(0, Math.min(end - 1, clip.startFrame + delta));
    return { ...clip, startFrame, durationFrames: end - startFrame };
  }
  if (mode === "right")
    return {
      ...clip,
      durationFrames: Math.max(
        1,
        Math.min(total - clip.startFrame, clip.durationFrames + delta),
      ),
    };
  return {
    ...clip,
    startFrame: Math.max(
      0,
      Math.min(total - clip.durationFrames, clip.startFrame + delta),
    ),
  };
}

const editableParts = (instance) => {
  if (instance.assetId === "number-beat")
    return new Set(["group", "number", "unit", "label"]);
  if (instance.assetId === "pill-stack")
    return new Set([
      "group",
      "title",
      ...(instance.props?.slots?.items ?? []).map(
        (_, index) => `item-${index}`,
      ),
    ]);
  if (instance.assetId !== "chapter-progress") return new Set(["group"]);
  return new Set([
    "group",
    "bar",
    ...(instance.props?.chapters ?? []).map((chapter) => chapter.id),
  ]);
};

export function normalizeEditorSelection(document, selected, part, parts) {
  const instance = document.instances.find((item) => item.id === selected);
  if (!instance) return { selected: "", part: "group" };
  return {
    selected,
    part: (parts ? new Set(["group",...parts]) : editableParts(instance)).has(part) ? part : "group",
  };
}

export function resizeTimeline(document, durationFrames) {
  if (
    !Number.isFinite(durationFrames) ||
    !Number.isInteger(durationFrames) ||
    durationFrames < 1
  )
    throw new Error("总帧数必须是正整数。");
  if(document.captions!==undefined)validateCaptionTrack(document.captions,{durationFrames});
  if(document.audioClips?.some(c=>c.startFrame+c.durationFrames>durationFrames))throw new Error('已有音频超出新时长，请先裁切或移动音频。');
  if(document.markers?.some(m=>m.frame>=durationFrames))throw new Error('已有标记超出新时长，请先移除片尾标记。');
  const previousDuration = document.canvas.durationFrames;
  const blocking = document.instances.find(
    (instance) =>
      instance.assetId !== "chapter-progress" &&
      instance.startFrame + instance.durationFrames > durationFrames,
  );
  if (blocking) throw new Error("已有动画超出新时长，请先调整动画结束位置。");

  const next = structuredClone(document);
  next.canvas.durationFrames = durationFrames;
  for (const instance of next.instances) {
    if (instance.assetId !== "chapter-progress") continue;
    const fullLength =
      instance.startFrame === 0 && instance.durationFrames === previousDuration;
    const chapters = Array.isArray(instance.props?.chapters)
      ? instance.props.chapters.filter(
          (chapter) => chapter.startFrame < durationFrames,
        )
      : [];
    if (chapters.length) chapters.at(-1).endFrame = durationFrames;
    instance.props.chapters = chapters;
    if (fullLength) instance.durationFrames = durationFrames;
    else if (instance.startFrame + instance.durationFrames > durationFrames)
      throw new Error("已有章节进度超出新时长，请先调整动画结束位置。");
  }
  return next;
}
