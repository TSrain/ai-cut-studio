// Delete/restore-only transcript editing over the rough-cut analysis units.
// Words are analysis units (characters for Chinese ASR); a word is "kept" when its
// source footage is exposed on the main video track. Text operations become source
// ranges expanded to whole units, padded to the middle of the neighbouring gap, and
// applied either by toggling a matching rough-cut candidate or by a manual ripple cut.
import {roughcutUnitFrames,cutRoughcutSourceRanges,restoreRoughcutSourceRanges,setRoughcutCut,adoptRoughcutCutManually} from './roughcut-model.mjs';

export const TRANSCRIPT_PAD_SECONDS = 0.25;
export const TRANSCRIPT_GROUP_MS = 2500;
const fpsOf = d => d.canvas.fps.num / d.canvas.fps.den;
const memo = new WeakMap();

function exposure(clips, startFrame, endFrame) {
  let covered = 0, clip = null;
  for (const c of clips) {
    const a = Math.max(startFrame, c.sourceInFrame), b = Math.min(endFrame, c.sourceInFrame + c.durationFrames);
    if (b > a) { covered += b - a; clip ??= c; }
  }
  return {fraction: covered / Math.max(1, endFrame - startFrame), clip};
}

/** View model: words with kept/cut state, candidate ownership, project position and edit flags. */
export function transcriptWords(document) {
  const state = document?.roughcut;
  if (!state) return {words: [], groups: []};
  const cached = memo.get(document);
  if (cached) return cached;
  const units = roughcutUnitFrames(state), clips = [...document.source.clips].sort((a, b) => a.sourceInFrame - b.sourceInFrame);
  const byStart = [...document.source.clips].sort((a, b) => a.startFrame - b.startFrame), protectedRanges = state.analysis.protectedRanges ?? [];
  const fps = fpsOf(document), total = document.canvas.durationFrames;
  const words = units.map((u, index) => {
    const {fraction, clip} = exposure(clips, u.startFrame, u.endFrame), kept = fraction >= 0.5;
    const owner = state.cuts.find(c => c.startFrame <= u.startFrame && c.endFrame >= u.endFrame);
    let projectFrame;
    if (clip) projectFrame = clip.startFrame + Math.max(0, u.startFrame - clip.sourceInFrame);
    else { const following = byStart.find(c => c.sourceInFrame >= u.endFrame); projectFrame = following ? following.startFrame : total - 1; }
    const reasons = u.protectionReasons ?? [];
    return {
      id: u.id, index, text: u.text, groupId: u.groupId ?? u.id, startFrame: u.startFrame, endFrame: u.endFrame,
      startSeconds: u.startSeconds, endSeconds: u.endSeconds, kept, cutId: owner?.id ?? null, cutEnabled: !!owner?.enabled,
      projectFrame: Math.max(0, Math.min(total - 1, projectFrame)), projectEndFrame: clip ? Math.min(total, projectFrame + Math.max(1, u.endFrame - u.startFrame)) : projectFrame,
      locked: protectedRanges.some(r => r.startSeconds * fps < u.endFrame && r.endSeconds * fps > u.startFrame),
      missing: reasons.includes('possible_missing_transcript'), segment: u.timing === 'segment',
    };
  });
  const groups = [];
  for (const w of words) { const last = groups.at(-1); if (last?.id === w.groupId) last.end = w.index + 1; else groups.push({id: w.groupId, start: w.index, end: w.index + 1}); }
  const result = {words, groups};
  memo.set(document, result);
  return result;
}

/** Index of the kept word under a project frame (binary search over kept words), or -1. */
export function wordAtFrame(words, frame) {
  let lo = 0, hi = words.length - 1, best = -1;
  const kept = words.filter(w => w.kept);
  lo = 0; hi = kept.length - 1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (kept[mid].projectFrame <= frame) { best = mid; lo = mid + 1; } else hi = mid - 1; }
  if (best < 0) return -1;
  const w = kept[best];
  return frame < Math.max(w.projectEndFrame, w.projectFrame + 1) + 3 ? w.index : -1;
}

/** Contiguous runs of selected words in one state (kept for cut, cut for restore). */
export function selectionRuns(words, from, to, kept) {
  const [a, b] = from <= to ? [from, to] : [to, from], runs = [];
  let run = null;
  for (let i = Math.max(0, a); i <= Math.min(words.length - 1, b); i++) {
    if (words[i].kept === kept) { if (run && run.at(-1).index === i - 1) run.push(words[i]); else runs.push(run = [words[i]]); }
    else run = null;
  }
  return runs;
}

function silenceMid(silences, fps, from, to) {
  const s = silences.find(x => x.startSeconds * fps < to && x.endSeconds * fps > from);
  if (!s) return null;
  return Math.round((Math.max(from, s.startSeconds * fps) + Math.min(to, s.endSeconds * fps)) / 2);
}
/** Whole-unit source range for a run, padded into the neighbouring gaps (silence midpoint when available). */
export function runSourceRange(document, words, run) {
  const state = document.roughcut, fps = fpsOf(document), pad = Math.round(TRANSCRIPT_PAD_SECONDS * fps), total = state.original.canvasDurationFrames;
  const first = run[0], last = run.at(-1), prev = words[first.index - 1], next = words[last.index + 1];
  const startFrame0 = Math.min(...run.map(w => w.startFrame)), endFrame0 = Math.max(...run.map(w => w.endFrame));
  const gapStart = prev ? Math.min(prev.endFrame, startFrame0) : Math.max(0, startFrame0 - pad), gapEnd = next ? Math.max(next.startFrame, endFrame0) : Math.min(total, endFrame0 + pad);
  const silences = state.analysis.silences ?? [];
  // No neighbour on a side (start/end of the recording): take the whole pad there.
  let startFrame = !prev ? gapStart : silenceMid(silences, fps, gapStart, startFrame0) ?? Math.floor((gapStart + startFrame0) / 2);
  let endFrame = !next ? gapEnd : silenceMid(silences, fps, endFrame0, gapEnd) ?? Math.ceil((endFrame0 + gapEnd) / 2);
  startFrame = Math.max(gapStart, startFrame0 - pad, Math.min(startFrame0, startFrame));
  endFrame = Math.min(gapEnd, endFrame0 + pad, Math.max(endFrame0, endFrame));
  // Padding never eats into explicit protected ranges or protected pauses.
  const guards = [...(state.analysis.protectedRanges ?? []).map(r => ({startFrame: Math.floor(r.startSeconds * fps), endFrame: Math.ceil(r.endSeconds * fps)})),
    ...state.cuts.filter(c => c.kind === 'pause' && c.safeToEnable === false)];
  for (const g of guards) {
    if (g.endFrame > startFrame && g.endFrame <= startFrame0) startFrame = g.endFrame;
    if (g.startFrame < endFrame && g.startFrame >= endFrame0) endFrame = g.startFrame;
  }
  return {startFrame: Math.max(0, startFrame), endFrame: Math.min(total, endFrame)};
}

const coveredBy = (words, cut) => words.filter(w => w.startFrame >= cut.startFrame && w.endFrame <= cut.endFrame);

/**
 * Cut (delete) or restore the words between indexes `from`..`to`. Returns
 * {document, kind, ranges, unitIds, enabled, disabled, warnings, message} or {blocked}.
 */
export function transcriptEdit(document, from, to, kind) {
  const {words} = transcriptWords(document), state = document.roughcut;
  if (!state) return {blocked: '工程没有粗剪记录'};
  const runs = selectionRuns(words, from, to, kind === 'cut');
  if (!runs.length) return {blocked: kind === 'cut' ? '所选文字已删除' : '所选文字未被删除'};
  const warnings = [], enabled = [], disabled = [], ranges = [];
  if (kind === 'cut') {
    if (runs.some(run => run.some(w => w.locked))) return {blocked: '所选文字包含明确保护的原话，不能删除'};
    if (words.every(w => !w.kept || runs.some(run => run.includes(w)))) return {blocked: '不能删除全部文字'};
    if (runs.some(run => run.some(w => w.missing))) warnings.push('附近可能缺字，删除后请试听');
    if (runs.some(run => run.some(w => w.segment))) warnings.push('含整句时间戳，按整句删除');
  }
  let next = document;
  for (const run of runs) {
    const ids = new Set(run.map(w => w.id));
    // Candidates fully inside the run keep their review status in sync with the text.
    for (const cut of state.cuts) {
      const covered = coveredBy(words, cut);
      if (!covered.length || !covered.every(w => ids.has(w.id))) continue;
      if (kind === 'cut' && !cut.enabled) {
        if (cut.kind === 'pause' && cut.safeToEnable === false) continue;
        next = cut.safeToEnable === false && !cut.manual ? adoptRoughcutCutManually(next, cut.id) : setRoughcutCut(next, cut.id, {enabled: true});
        enabled.push(cut.id);
      } else if (kind === 'restore' && cut.enabled) {
        next = setRoughcutCut(next, cut.id, {enabled: false}); disabled.push(cut.id);
      }
    }
    ranges.push(runSourceRange(document, words, run));
  }
  next = kind === 'cut' ? cutRoughcutSourceRanges(next, ranges) : restoreRoughcutSourceRanges(next, ranges);
  next = retextCaptions(document, next, runs);
  const count = runs.reduce((n, r) => n + r.length, 0), text = runs.map(r => r.map(w => w.text).join('')).join('…');
  const label = text.length > 14 ? text.slice(0, 14) + '…' : text;
  const message = `${kind === 'cut' ? '已删除' : '已恢复'}「${label}」（${count} 字${enabled.length ? `，采用 ${enabled.length} 个粗剪片段` : ''}${disabled.length ? `，恢复 ${disabled.length} 个粗剪片段` : ''}）${warnings.length ? ' · ' + warnings.join(' · ') : ''}`;
  return {document: next, kind, ranges, unitIds: runs.flat().map(w => w.id), enabled, disabled, warnings, message};
}

const wide = ch => /[A-Za-z0-9]/.test(ch ?? '');
export function joinWords(texts) { return texts.reduce((out, t) => out + (wide(out.at(-1)) && wide(t[0]) ? ' ' : '') + t, ''); }
const SENTENCE_END = /[。！？!?；;，,：:、]$/;
/**
 * Ripple splits keep a cue's whole text in every part. For cues touched by a text edit
 * (new or changed, around the edit), rebuild the text from the kept words they show and
 * merge parts of one sentence back together. Cues edited by hand keep their text.
 */
export function retextCaptions(before, after, runs) {
  if (!after.captions?.cues?.length || !after.roughcut) return after;
  const {words} = transcriptWords(after), overrides = after.roughcut.analysis.captionOverrides ?? {};
  const key = c => `${c.id}|${c.startFrame}|${c.endFrame}|${c.text}`, old = new Set((before.captions?.cues ?? []).map(key));
  const regions = runs.map(run => {
    const a = words[run[0].index - 1], b = words[run.at(-1).index + 1], inner = run.map(w => words[w.index]);
    return {from: Math.min(a?.projectFrame ?? 0, ...inner.map(w => w.projectFrame)), to: Math.max(b?.projectEndFrame ?? after.canvas.durationFrames, ...inner.map(w => w.projectEndFrame))};
  });
  const touched = c => !old.has(key(c)) && (c.text === (c.initialText ?? c.text)) && regions.some(r => c.startFrame <= r.to + 2 && c.endFrame >= r.from - 2);
  const kept = words.filter(w => w.kept);
  const cues = [];
  for (const c of after.captions.cues) {
    if (!touched(c)) { cues.push(c); continue; }
    const shown = kept.filter(w => w.projectFrame >= c.startFrame && w.projectFrame < c.endFrame).map(w => overrides[w.id] ?? w.text);
    if (!shown.length) continue;
    const text = joinWords(shown), previous = cues.at(-1);
    const mergeable = previous && (previous._retext || previous.text === (previous.initialText ?? previous.text));
    if (mergeable && c.startFrame - previous.endFrame <= 3 && [...previous.text + text].length <= 18 && !SENTENCE_END.test(previous.text)) {
      previous.text = previous.initialText = joinWords([previous.text, text]); previous.endFrame = Math.max(previous.endFrame, c.endFrame); continue;
    }
    cues.push({...c, text, initialText: text, _retext: true});
  }
  for (const c of cues) delete c._retext;
  return {...after, captions: {...after.captions, cues}};
}

/** Rapid same-kind edits on adjacent text merge into one undo step. */
export function shouldGroupTranscriptEdit(previous, edit, {now, present, fps = 30, same = (a, b) => a === b}) {
  // `present` must still be the document the previous edit produced (no other edit in between).
  if (!previous || previous.kind !== edit.kind || now - previous.at > TRANSCRIPT_GROUP_MS || !same(present, previous.document)) return false;
  const a = previous.span, b = edit.span, slack = Math.round(fps);
  return a.startFrame <= b.endFrame + slack && b.startFrame <= a.endFrame + slack;
}
export const editSpan = ranges => ({startFrame: Math.min(...ranges.map(r => r.startFrame)), endFrame: Math.max(...ranges.map(r => r.endFrame))});

/** Text-view keyboard map; null lets the key reach the global editor/review handlers. */
export function transcriptKeyCommand(event, {hasSelection}) {
  if (event.isComposing || event.altKey) return null;
  const k = event.key, mod = event.metaKey || event.ctrlKey;
  if (mod && !event.shiftKey && k.toLowerCase() === 'a') return 'select-all';
  if (mod) return null;
  if (k === 'Escape' && hasSelection) return 'clear';
  if (k === 'ArrowLeft' || k === 'ArrowRight') return event.shiftKey ? (k === 'ArrowLeft' ? 'extend-left' : 'extend-right') : (k === 'ArrowLeft' ? 'left' : 'right');
  // Never let Backspace fall through to the timeline's clip delete while the text has focus.
  if (k === 'Backspace' || k === 'Delete') return !hasSelection ? 'noop' : event.shiftKey ? 'restore' : 'cut';
  if (!hasSelection) return null;
  if (event.shiftKey) return null;
  const lower = k.toLowerCase();
  return lower === 'a' ? 'cut' : lower === 'r' ? 'restore' : lower === 'x' ? 'toggle' : null;
}
