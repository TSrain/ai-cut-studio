import {open} from 'node:fs/promises';

const stages = new Set(['preparing','bundling','rendering','encoding','verifying','complete']);
const millis = value => typeof value === 'number' ? value : Date.parse(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);

// Read a bounded tail: progress polling must not repeatedly load an entire render log.
export const readExportProgress = async (logPath, {startedAt, now = Date.now(), durationFrames} = {}) => {
  const start = millis(startedAt);
  if (!Number.isFinite(start)) return {stage:'queued',elapsedSeconds:0};
  const elapsedSeconds = Math.max(0, (millis(now) - start) / 1000);
  let result = {stage:'preparing',elapsedSeconds};
  let handle;
  let text;
  try {
    handle = await open(logPath, 'r');
    const {size, mtimeMs} = await handle.stat();
    if (mtimeMs < start) return result;
    const length = Math.min(size, 256 * 1024);
    const buffer = Buffer.alloc(length);
    const {bytesRead} = await handle.read(buffer, 0, length, size - length);
    text = buffer.subarray(0, bytesRead).toString('utf8');
    if (size > length) text = text.replace(/^[^\r\n]*[\r\n]/, '');
  } catch { return result; }
  finally { await handle?.close(); }
  // Ignore the unfinished last line (a polling read may split JSON or counters).
  const lines = text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').split(/[\r\n]/).slice(0,-1);
  let anchor = null;
  for (const line of lines) {
    let event;
    const marker = line.indexOf('EXPORT_PROGRESS ');
    if (marker >= 0) {
      try { event = JSON.parse(line.slice(marker + 16)); } catch { continue; }
      if (!event || !stages.has(event.stage)) continue;
      if (finite(event.timestamp) && event.timestamp < start) continue;
    } else {
      const bundling = line.match(/Bundling\s+(\d+(?:\.\d+)?)%/i);
      const frames = line.match(/(Rendered|Encoded)\s+(\d+)\s*\/\s*(\d+)/i);
      if (frames) event = {stage:frames[1].toLowerCase() === 'rendered' ? 'rendering' : 'encoding', completed:Number(frames[2]), total:Number(frames[3])};
      else if (bundling) event = {stage:'bundling', progress:Number(bundling[1])/100};
      else continue;
    }
    const stage = event.stage === 'complete' ? 'verifying' : event.stage;
    const next = {stage,elapsedSeconds};
    if (typeof event.detail === 'string') next.detail = event.detail.slice(0,1000);
    if (['bundling','rendering','encoding'].includes(stage)) {
      const total = finite(event.total) ? event.total : durationFrames;
      if (finite(event.completed) && finite(total) && total > 0 && event.completed >= 0) {
        next.completed = Math.min(event.completed,total);
        next.total = total;
        next.progress = next.completed/total;
      } else if (finite(event.progress)) next.progress = Math.max(0, Math.min(1,event.progress));
    }
    if (stage !== result.stage || (finite(next.progress) && next.progress < (result.progress ?? 0))) anchor = null;
    if (finite(event.timestamp) && finite(next.progress)) {
      if (anchor && event.timestamp > anchor.timestamp && next.progress > anchor.progress && next.progress < 1) {
        const seconds = (event.timestamp - anchor.timestamp)/1000;
        if (seconds >= 1) next.etaSeconds = Math.ceil(seconds * (1-next.progress)/(next.progress-anchor.progress));
      }
      if (!anchor) anchor = {timestamp:event.timestamp,progress:next.progress};
    }
    result = next;
  }
  return result;
};
