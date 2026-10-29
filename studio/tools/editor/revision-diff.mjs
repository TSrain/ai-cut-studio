// Before/after view of an AI shot revision (production-plan "shot-revision" results).
// Pure logic: text diff segments, per-patch rows, duration delta, current state, revert.
import {withCameraClips} from '../../templates/remotion-base/src/editor/camera-clips.mjs';
export const REVISION_FIELD_LABELS = {
  'caption:text': '字幕', 'shot:visualRequirement': '画面要求', 'shot:mediaDescription': '素材描述', 'shot:rationale': '理由',
  'shot:animationNeed': '动画需求', 'shot:expressionGoal': '表达目标', 'shot:requiredInformation': '必要信息', 'shot:relationships': '关系',
  'shot:comprehensionDifficulty': '理解难点', 'shot:factBoundary': '事实边界', 'instance:props': '模块参数',
  'audio:volume': '音量', 'audio:muted': '静音', 'audio:fadeInFrames': '淡入帧', 'audio:fadeOutFrames': '淡出帧',
  'camera:zoom': '镜头缩放', 'camera:in': '推入时长', 'camera:hold': '停留时长', 'camera:out': '拉回时长',
  'camera:inEasing': '推入曲线', 'camera:outEasing': '拉回曲线', 'camera:enabled': '镜头启用', 'camera-create:clip': '新增镜头变化',
};
const MAX_CELLS = 250000;
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** Character (code point) diff: [{op:'equal'|'delete'|'insert', text}], adjacent ops merged. */
export function textDiff(before, after) {
  const a = [...String(before ?? '')], b = [...String(after ?? '')];
  let head = 0; while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0; while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const x = a.slice(head, a.length - tail), y = b.slice(head, b.length - tail), ops = [];
  const push = (op, text) => { if (!text) return; const last = ops.at(-1); if (last?.op === op) last.text += text; else ops.push({ op, text }); };
  push('equal', a.slice(0, head).join(''));
  if (x.length * y.length > MAX_CELLS) { push('delete', x.join('')); push('insert', y.join('')); }
  else {
    // LCS table over the differing middle only.
    const n = x.length, m = y.length, table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) table[i][j] = x[i] === y[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (x[i] === y[j]) { push('equal', x[i]); i++; j++; }
      else if (table[i + 1][j] >= table[i][j + 1]) push('delete', x[i++]);
      else push('insert', y[j++]);
    }
    while (i < n) push('delete', x[i++]);
    while (j < m) push('insert', y[j++]);
  }
  push('equal', a.slice(a.length - tail).join(''));
  return ops;
}
const textual = (value) => typeof value === 'string' || (Array.isArray(value) && value.every((v) => typeof v === 'string'));
const asText = (value) => (Array.isArray(value) ? value.join('；') : value == null ? '' : String(value));
export function formatRevisionValue(value) {
  if (value === null || value === undefined) return '（无）';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'number') return String(Math.round(value * 1000) / 1000);
  if (textual(value)) return asText(value);
  return JSON.stringify(value);
}
const cameraLength = (clip) => (clip ? (clip.in ?? 0) + (clip.hold ?? 0) + (clip.out ?? 0) : 0);
/** Seconds of on-screen timing changed by one patch (camera timing only; others are 0). */
export function patchDurationDelta(patch) {
  if (patch.entity === 'camera' && ['in', 'hold', 'out'].includes(patch.field)) return (Number(patch.after) || 0) - (Number(patch.before) || 0);
  if (patch.entity === 'camera-create') return cameraLength(patch.after) - cameraLength(patch.before);
  return 0;
}
function collection(document, entity) {
  if (entity === 'instance') return document?.instances;
  if (entity === 'audio') return document?.audioClips;
  if (entity === 'caption') return document?.captions?.cues;
  if (entity === 'camera' || entity === 'camera-create') return document?.source?.cameraPlan?.clipGroups;
  if (entity === 'shot') return document?.productionPlan?.shots;
  return undefined;
}
/** Current value of a patched field in a document (undefined when the target is gone). */
export function currentPatchValue(document, patch) {
  const target = collection(document, patch.entity)?.find((item) => item.id === patch.id);
  if (patch.entity === 'camera-create') return target ? structuredClone(target) : null;
  return target ? target[patch.field] ?? null : undefined;
}
function patchState(document, patch) {
  if (!document) return 'applied';
  const value = currentPatchValue(document, patch);
  if (patch.entity === 'camera-create') return value ? 'applied' : 'reverted';
  if (value === undefined) return 'missing';
  if (same(value, patch.after)) return 'applied';
  if (same(value, patch.before)) return 'reverted';
  return 'diverged';
}
/** Rows for a compact diff card, plus the aggregate duration delta and review state. */
export function revisionDiff(result, document) {
  const rows = (result?.patches ?? []).filter((p) => !same(p.before, p.after)).map((patch) => {
    const key = `${patch.entity}:${patch.field}`;
    const text = patch.entity !== 'camera-create' && (textual(patch.before) || patch.before === null) && textual(patch.after);
    return {
      key: `${patch.entity}:${patch.id}:${patch.field}`, entity: patch.entity, id: patch.id, field: patch.field,
      label: REVISION_FIELD_LABELS[key] ?? key, kind: text ? 'text' : 'value',
      segments: text ? textDiff(asText(patch.before), asText(patch.after)) : null,
      before: formatRevisionValue(patch.before), after: formatRevisionValue(patch.after),
      durationDelta: patchDurationDelta(patch), state: patchState(document, patch),
    };
  });
  const states = new Set(rows.map((r) => r.state));
  const state = !rows.length ? 'unchanged' : states.size === 1 ? [...states][0] : states.has('diverged') || states.has('missing') ? 'diverged' : 'mixed';
  return { id: result?.id, reason: result?.reason ?? '', rows, durationDelta: rows.reduce((sum, r) => sum + r.durationDelta, 0), state };
}
/** Undo one revision locally (an ordinary, undoable document edit). Fails closed on later edits. */
export function revertRevision(document, result) {
  const next = structuredClone(document);
  const patches = (result?.patches ?? []).filter((p) => !same(p.before, p.after));
  let camera = false;
  for (const patch of patches) {
    const state = patchState(next, patch);
    if (state === 'reverted') continue;
    if (state !== 'applied') throw new Error(`${REVISION_FIELD_LABELS[`${patch.entity}:${patch.field}`] ?? patch.field}在修改后又被编辑过，未撤回；请手动调整`);
    const items = collection(next, patch.entity);
    if (patch.entity === 'camera-create') { next.source.cameraPlan.clipGroups = items.filter((item) => item.id !== patch.id); camera = true; continue; }
    const target = items.find((item) => item.id === patch.id);
    if (target.locked) throw new Error('目标已锁定，未撤回');
    if (patch.before === null && patch.entity === 'shot') delete target[patch.field]; else target[patch.field] = structuredClone(patch.before);
    if (patch.entity === 'caption' && target.initialText !== undefined) target.initialText = target.text;
    if (patch.entity === 'camera') camera = true;
  }
  if (camera) next.source.cameraPlan = withCameraClips(next.source.cameraPlan, next.source.cameraPlan.clipGroups ?? []);
  return next;
}
/** Applied shot-revision results that actually changed something, newest first. */
export function reviewableRevisions(job) {
  if (!job || job.kind !== 'revise') return [];
  return (job.results ?? []).filter((r) => r.kind === 'shot-revision' && r.state === 'applied' && (r.patches ?? []).some((p) => !same(p.before, p.after))).reverse();
}
export function formatDurationDelta(seconds) {
  if (!seconds || Math.abs(seconds) < 0.005) return '';
  return `${seconds > 0 ? '+' : '−'}${Math.abs(seconds).toFixed(2)} 秒`;
}
