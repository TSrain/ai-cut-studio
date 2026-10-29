// Local clip time, never the enclosing movie duration. Last rendered frame is N-1.
export function presetExit(frame, fps, durationSeconds) {
  const last = Math.max(0, Math.round(durationSeconds * fps) - 1);
  const span = Math.max(1, Math.min(Math.round(.35 * fps), Math.floor((last + 1) * .4)));
  const start = Math.max(0, last - span);
  const t = Math.max(0, Math.min(1, (frame - start) / Math.max(1, last - start)));
  const progress = t * t * (3 - 2 * t);
  return {start, last, progress, opacity: 1 - progress};
}
