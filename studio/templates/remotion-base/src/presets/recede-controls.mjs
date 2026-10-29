/** Selection offsets use textarea's UTF-16 coordinates; never split a code point. */
export function normalizeRanges(text, ranges = []) {
  const boundaries = [0];
  for (const ch of text) boundaries.push(boundaries.at(-1) + ch.length);
  const result = [];
  for (const range of ranges) {
    if (!Number.isInteger(range?.start) || !Number.isInteger(range?.end) || range.end <= range.start || range.end <= 0 || range.start >= text.length) continue;
    const start = boundaries.findLast(n => n <= Math.max(0, range.start)) ?? 0;
    const end = boundaries.find(n => n >= Math.min(text.length, range.end)) ?? text.length;
    if (end > start) result.push({start, end});
  }
  result.sort((a, b) => a.start - b.start);
  return result.reduce((merged, range) => {
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({...range});
    return merged;
  }, []);
}

export function recedeRanges(slots) {
  const text = slots.line ?? '';
  if (slots.emphasisRanges !== undefined) return normalizeRanges(text, slots.emphasisRanges);
  if (!slots.hero || !text.includes(slots.hero)) return text ? [{start: 0, end: text.length}] : [];
  let offset = 0;
  return text.split('\n').flatMap(segment => {
    const at = segment.indexOf(slots.hero);
    const ranges = at < 0 ? [] : [{start: offset + at, end: offset + at + slots.hero.length}];
    offset += segment.length + 1;
    return ranges;
  });
}

export function rangeRuns(text, ranges) {
  const runs = [];
  let at = 0;
  for (const r of normalizeRanges(text, ranges)) {
    if (r.start > at) runs.push({text: text.slice(at, r.start), em: false});
    runs.push({text: text.slice(r.start, r.end), em: true});
    at = r.end;
  }
  if (at < text.length) runs.push({text: text.slice(at), em: false});
  return runs;
}

export function markRecedeRange(slots, start, end, enlarged) {
  const range = normalizeRanges(slots.line, [{start, end}])[0];
  if (!range) return recedeRanges(slots);
  const ranges = recedeRanges(slots);
  if (enlarged) return normalizeRanges(slots.line, [...ranges, range]);
  return normalizeRanges(slots.line, ranges.flatMap(r => [
    {start: r.start, end: Math.min(r.end, range.start)},
    {start: Math.max(r.start, range.end), end: r.end},
  ]));
}

/** Preserve only unchanged prefix/suffix; inserted/replaced copy starts ordinary. */
export function updateRecedeText(slots, line) {
  const previous = slots.line ?? '';
  if (previous === line) return {...slots, line};
  const before = Array.from(previous), after = Array.from(line);
  let head = 0, tail = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  while (tail < before.length - head && tail < after.length - head && before.at(-tail - 1) === after.at(-tail - 1)) tail++;
  const prefix = before.slice(0, head).join('').length;
  const suffix = before.slice(before.length - tail).join('').length;
  const oldEnd = previous.length - suffix, shift = line.length - previous.length;
  const ranges = recedeRanges(slots).flatMap(r => [
    {start: r.start, end: Math.min(r.end, prefix)},
    {start: Math.max(r.start, oldEnd) + shift, end: r.end + shift},
  ].filter(r => r.end > r.start));
  return {...slots, line, hero: '', emphasisRanges: normalizeRanges(line, ranges)};
}

export const RECEDE_EFFECTS = ['none', 'fade', 'rise', 'fall', 'zoom'];
const clamp = n => Math.max(0, Math.min(1, n));
const ease = n => {const t = clamp(n); return t * t * (3 - 2 * t);};
export function recedeMotion(frame, fps, durationSeconds, slots = {}) {
  const last = Math.max(0, Math.round(fps * durationSeconds) - 1);
  const enterFx = slots.enterFx ?? 'legacy', exitFx = slots.exitFx ?? 'none';
  const maxSpan = Math.max(1, Math.floor(last * .4));
  const enterFrames = Math.max(1, Math.min(maxSpan, Math.round((slots.enterSeconds ?? .5) * fps)));
  const exitFrames = Math.max(1, Math.min(maxSpan, Math.round((slots.exitSeconds ?? .35) * fps)));
  const enter = enterFx === 'none' || enterFx === 'legacy' ? 1 : ease(frame / enterFrames);
  const exit = exitFx === 'none' ? 0 : ease((frame - last + exitFrames) / exitFrames);
  return {
    opacity: enter * (1 - exit), enter,
    y: (enterFx === 'rise' ? 24 * (1 - enter) : enterFx === 'fall' ? -24 * (1 - enter) : 0) + (exitFx === 'rise' ? -24 * exit : exitFx === 'fall' ? 24 * exit : 0),
    scale: (enterFx === 'zoom' ? .88 + .12 * enter : 1) * (exitFx === 'zoom' ? 1 - .12 * exit : 1),
    enterFrames, exitFrames,
  };
}
