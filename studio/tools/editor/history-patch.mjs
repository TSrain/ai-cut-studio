// Minimal structural diff/patch for JSON documents (no dependencies).
// diffValues(a, b) returns ops that turn a into b; applyPatch(a, ops) applies them
// copy-on-write, so the result shares every untouched subtree with a.
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
export function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (!Object.prototype.hasOwnProperty.call(b, k) || !deepEqual(a[k], b[k])) return false;
  return true;
}
export function diffValues(from, to, path = [], ops = []) {
  if (Object.is(from, to)) return ops;
  if (Array.isArray(from) && Array.isArray(to)) {
    if (from.length === to.length) {
      for (let i = 0; i < to.length; i++) diffValues(from[i], to[i], [...path, i], ops);
      return ops;
    }
    let head = 0;
    const max = Math.min(from.length, to.length);
    while (head < max && deepEqual(from[head], to[head])) head++;
    let tail = 0;
    while (tail < max - head && deepEqual(from[from.length - 1 - tail], to[to.length - 1 - tail])) tail++;
    ops.push({ t: "splice", p: path, i: head, n: from.length - head - tail, v: to.slice(head, to.length - tail) });
    return ops;
  }
  if (plain(from) && plain(to)) {
    for (const k of Object.keys(to)) {
      if (Object.prototype.hasOwnProperty.call(from, k)) diffValues(from[k], to[k], [...path, k], ops);
      else ops.push({ t: "set", p: [...path, k], v: to[k] });
    }
    for (const k of Object.keys(from)) if (!Object.prototype.hasOwnProperty.call(to, k)) ops.push({ t: "del", p: [...path, k] });
    return ops;
  }
  ops.push({ t: "set", p: path, v: to });
  return ops;
}
export function applyPatch(root, ops) {
  const owned = new Set();
  const own = (v) => {
    if (owned.has(v)) return v;
    const copy = Array.isArray(v) ? v.slice() : { ...v };
    owned.add(copy);
    return copy;
  };
  let out = root;
  for (const op of ops) {
    if (!op.p.length) {
      if (op.t !== "set") throw new Error("Invalid root patch");
      out = op.v;
      owned.clear();
      continue;
    }
    out = own(out);
    let node = out;
    for (let i = 0; i < op.p.length - 1; i++) {
      const key = op.p[i];
      node = node[key] = own(node[key]);
    }
    const key = op.p.at(-1);
    if (op.t === "set") node[key] = op.v;
    else if (op.t === "del") delete node[key];
    else if (op.t === "splice") node[key] = own(node[key]), node[key].splice(op.i, op.n, ...op.v);
    else throw new Error(`Unknown patch op ${op.t}`);
  }
  return out;
}
// Approximate retained size (UTF-16 chars of the JSON form); computed once per entry.
export const patchBytes = (ops) => 2 * JSON.stringify(ops).length;
