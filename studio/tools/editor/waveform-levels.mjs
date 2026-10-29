// Multi-resolution waveform peaks over 16 kHz mono PCM. Shared by the server (builds the
// levels once per media identity) and the timeline (chooses a level by zoom and fetches
// only the tiles intersecting the visible window).
export const PCM_RATE = 16000;
// Coarse → fine. Each level is exactly 4× finer, so coarser levels are maxima of finer ones.
export const PEAK_BUCKETS = [1024, 256, 64, 16];
export const PEAK_LEVELS = PEAK_BUCKETS.map((bucket, level) => ({ level, bucket, perSecond: PCM_RATE / bucket }));
export const TILE_PEAKS = 2048;
/** Smallest level that still gives ≥1 peak per `density` screen pixels (finest when zoomed in far). */
export function chooseLevel(pxPerSecond, { density = 1 } = {}) {
  if (!Number.isFinite(pxPerSecond) || pxPerSecond <= 0) return 0;
  const wanted = pxPerSecond / density;
  const found = PEAK_LEVELS.find((l) => l.perSecond >= wanted);
  return (found ?? PEAK_LEVELS.at(-1)).level;
}
/** Tile indices for a level covering [startSeconds, endSeconds) (clamped to the media). */
export function tilesForRange(level, startSeconds, endSeconds, durationSeconds = Infinity) {
  const { perSecond } = PEAK_LEVELS[level] ?? PEAK_LEVELS[0];
  const start = Math.max(0, startSeconds), end = Math.min(durationSeconds, endSeconds);
  if (!(end > start)) return [];
  const first = Math.floor((start * perSecond) / TILE_PEAKS), last = Math.floor((end * perSecond - 1e-9) / TILE_PEAKS);
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}
/** Streaming builder: feed Int16 samples in any chunking; finish() returns Uint8 levels (0–255). */
export function createPeakBuilder() {
  const finest = PEAK_BUCKETS.at(-1), out = [];
  let current = 0, count = 0;
  return {
    push(samples) {
      for (let i = 0; i < samples.length; i++) {
        const v = samples[i] < 0 ? -samples[i] : samples[i];
        if (v > current) current = v;
        if (++count === finest) { out.push(current); current = 0; count = 0; }
      }
    },
    finish() {
      if (count) out.push(current);
      const levels = new Array(PEAK_BUCKETS.length);
      let fine = Uint8Array.from(out, (v) => Math.min(255, Math.round((v / 32768) * 255)));
      levels[PEAK_BUCKETS.length - 1] = fine;
      for (let level = PEAK_BUCKETS.length - 2; level >= 0; level--) {
        const ratio = PEAK_BUCKETS[level] / PEAK_BUCKETS[level + 1], coarse = new Uint8Array(Math.ceil(fine.length / ratio));
        for (let i = 0; i < fine.length; i++) { const j = Math.floor(i / ratio); if (fine[i] > coarse[j]) coarse[j] = fine[i]; }
        levels[level] = coarse; fine = coarse;
      }
      return levels;
    },
  };
}
export function buildPeakLevels(samples) { const builder = createPeakBuilder(); builder.push(samples); return builder.finish(); }
/** Slice one tile from a level array. */
export function peakTile(levelArray, tile) {
  const start = tile * TILE_PEAKS;
  return Array.from(levelArray.subarray(Math.min(levelArray.length, start), Math.min(levelArray.length, start + TILE_PEAKS)));
}
/**
 * Visible peaks [{seconds, value 0..1}] for [startSeconds, endSeconds) from loaded tiles
 * (Map tile → number[]). Missing tiles are skipped; the caller falls back to coarse data.
 */
export function visiblePeaks(level, tiles, startSeconds, endSeconds) {
  const { perSecond } = PEAK_LEVELS[level], result = [];
  const first = Math.max(0, Math.floor(startSeconds * perSecond)), last = Math.ceil(endSeconds * perSecond);
  for (let index = first; index < last; index++) {
    const tile = tiles.get(Math.floor(index / TILE_PEAKS));
    if (!tile) continue;
    const value = tile[index % TILE_PEAKS];
    if (value === undefined) continue;
    result.push({ seconds: (index + 0.5) / perSecond, value: value / 255 });
  }
  return result;
}
