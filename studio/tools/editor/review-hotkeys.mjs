// Rough-cut review keyboard model. Pure functions: the editor wires effects to the player.
// Existing editor bindings (interaction.mjs keyboardCommand) use only ⌘/Ctrl letter
// combinations, Space, arrows, Home/End, Backspace/Delete and Escape, so plain letters
// are free. Every binding here requires no modifier and never fires while typing.
export const TRANSPORT_SPEEDS = [1, 2, 4];
export const REVIEW_SHORTCUTS = [
  { group: '播放', keys: ['J'], label: '倒放；连按 1×→2×→4×（正向播放时先减速）' },
  { group: '播放', keys: ['K'], label: '暂停' },
  { group: '播放', keys: ['L'], label: '正向播放；连按 1×→2×→4×（倒放时先减速）' },
  { group: '播放', keys: ['K', 'J'], label: '按住 K 再按 J：后退一帧' },
  { group: '播放', keys: ['K', 'L'], label: '按住 K 再按 L：前进一帧' },
  { group: '粗剪审阅', keys: ['A'], label: '接受：删除当前片段' },
  { group: '粗剪审阅', keys: ['R'], label: '拒绝：保留当前片段' },
  { group: '粗剪审阅', keys: ['X'], label: '切换 保留 / 删除' },
  { group: '粗剪审阅', keys: ['N'], label: '下一个片段' },
  { group: '粗剪审阅', keys: ['P'], label: '上一个片段' },
  { group: '粗剪审阅', keys: ['I'], label: '把当前片段起点设到播放头（吸附字词 / 停顿）' },
  { group: '粗剪审阅', keys: ['O'], label: '把当前片段终点设到播放头（吸附字词 / 停顿）' },
  { group: '粗剪审阅', keys: ['S'], label: '在播放头分割主视频' },
  { group: '其他', keys: ['?'], label: '显示 / 隐藏快捷键' },
  { group: '其他', keys: ['Space'], label: '播放 / 暂停（原有）' },
  { group: '其他', keys: ['←', '→'], label: '逐帧（⇧ 十帧，原有）' },
  { group: '其他', keys: ['⌘Z', '⇧⌘Z'], label: '撤销 / 重做（原有）' },
];
const REVIEW_KEYS = { a: 'accept', r: 'reject', x: 'toggle', n: 'next', p: 'previous', i: 'markIn', o: 'markOut', s: 'split' };
export const EDITING_SELECTOR = 'input,textarea,select,[contenteditable="true"],[contenteditable=""],[contenteditable="plaintext-only"]';
export function isEditingTarget(target) {
  return !!(target && typeof target.closest === 'function' && target.closest(EDITING_SELECTOR));
}
/** Map a keydown to a review/transport command, or null to leave it to other handlers. */
export function reviewHotkeyCommand(event, { editing = false, modal = false, review = false } = {}) {
  if (!event || editing || modal || event.isComposing) return null;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  const key = String(event.key ?? '').toLowerCase();
  if (key === '?' || (event.code === 'Slash' && event.shiftKey)) return 'help';
  if (event.shiftKey) return null;
  if (key === 'j' || key === 'k' || key === 'l') return `transport-${key}`;
  return review ? REVIEW_KEYS[key] ?? null : null;
}
export function initialTransport() { return { rate: 0, kHeld: false }; }
const faster = (speed) => TRANSPORT_SPEEDS[Math.min(TRANSPORT_SPEEDS.length - 1, TRANSPORT_SPEEDS.indexOf(speed) + 1)];
const slower = (speed) => TRANSPORT_SPEEDS[Math.max(0, TRANSPORT_SPEEDS.indexOf(speed) - 1)];
/**
 * J/K/L state machine. input: {type:'down'|'up'|'stopped', key, repeat}.
 * Returns {state, effect} where effect is {kind:'rate', rate} (0 = pause) or
 * {kind:'step', delta} or null. Auto-repeat never ramps speed; it does keep jogging.
 */
export function transportReducer(state, input) {
  const current = state ?? initialTransport();
  if (input.type === 'stopped') return { state: { ...current, rate: 0 }, effect: null };
  if (input.type === 'up') return { state: input.key === 'k' ? { ...current, kHeld: false } : current, effect: null };
  if (input.key === 'k') {
    if (input.repeat) return { state: current, effect: null };
    return { state: { rate: 0, kHeld: true }, effect: { kind: 'rate', rate: 0 } };
  }
  if (current.kHeld) return { state: { ...current, rate: 0 }, effect: { kind: 'step', delta: input.key === 'j' ? -1 : 1 } };
  if (input.repeat) return { state: current, effect: null };
  const direction = input.key === 'j' ? -1 : 1, speed = Math.abs(current.rate);
  let rate;
  if (current.rate === 0) rate = direction;
  else if (Math.sign(current.rate) === direction) rate = direction * faster(speed);
  else rate = speed > 1 ? Math.sign(current.rate) * slower(speed) : direction;
  return { state: { ...current, rate }, effect: { kind: 'rate', rate } };
}
/** Next/previous review row relative to the focused row, or to the playhead (source frame). */
export function adjacentRow(rows, currentId, direction, sourceFrame = 0) {
  if (!rows.length) return null;
  const index = rows.findIndex((row) => row.id === currentId);
  if (index >= 0) return rows[Math.max(0, Math.min(rows.length - 1, index + direction))];
  if (direction > 0) return rows.find((row) => row.startFrame >= sourceFrame) ?? rows.at(-1);
  return [...rows].reverse().find((row) => row.endFrame <= sourceFrame) ?? rows[0];
}
/** Review command → setRoughcutCut/adopt intent for one row (null when it is a no-op). */
export function reviewDecision(row, command) {
  if (!row) return null;
  const cut = command === 'accept' ? true : command === 'reject' ? false : command === 'toggle' ? !row.enabled : null;
  if (cut === null || cut === row.enabled) return null;
  if (cut && row.safeToEnable === false && !row.manual) return row.kind === 'pause' ? { blocked: '停顿片段受保护，不能手动删除' } : { adopt: true };
  return { patch: { enabled: cut } };
}
