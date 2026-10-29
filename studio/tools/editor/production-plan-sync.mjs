import {materializeHistory} from "./history.mjs";
// JSON-equivalent structural comparison: identity short-circuit, early exit on the first
// difference and no whole-document strings (every save/poll used to stringify each side).
// Like JSON.stringify, undefined/function-valued keys are ignored and array holes are null;
// unlike it, key order does not matter.
const skipped = (v) => v === undefined || typeof v === "function" || typeof v === "symbol";
function jsonEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object")
    return JSON.stringify(a) === JSON.stringify(b);
  if (typeof a.toJSON === "function" || typeof b.toJSON === "function")
    return JSON.stringify(a) === JSON.stringify(b);
  const array = Array.isArray(a);
  if (array !== Array.isArray(b)) return false;
  if (array) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++)
      if (!jsonEqual(skipped(a[i]) ? null : a[i], skipped(b[i]) ? null : b[i])) return false;
    return true;
  }
  let count = 0;
  for (const k in a) {
    if (!Object.prototype.hasOwnProperty.call(a, k) || skipped(a[k])) continue;
    count++;
    if (!Object.prototype.hasOwnProperty.call(b, k) || skipped(b[k]) || !jsonEqual(a[k], b[k])) return false;
  }
  for (const k in b) if (Object.prototype.hasOwnProperty.call(b, k) && !skipped(b[k])) count--;
  return count === 0;
}
const equal = jsonEqual;
export {jsonEqual};
const keyed = (a) =>
  Array.isArray(a) &&
  a.every((v) => v && typeof v === "object" && typeof v.id === "string");
/** Apply only server changes since base. Concurrent local changes win. */
function merge(base, local, remote) {
  if (equal(base, remote)) return structuredClone(local);
  if (equal(base, local)) return structuredClone(remote);
  if (keyed(base) && keyed(local) && keyed(remote)) {
    const b = new Map(base.map((v) => [v.id, v])),
      r = new Map(remote.map((v) => [v.id, v])),
      l = new Map(local.map((v) => [v.id, v]));
    const next = local
      .filter((v) => r.has(v.id) || !b.has(v.id) || !equal(v, b.get(v.id)))
      .map((v) =>
        r.has(v.id) ? merge(b.get(v.id), v, r.get(v.id)) : structuredClone(v),
      );
    for (const v of remote)
      if (!l.has(v.id) && !b.has(v.id)) next.push(structuredClone(v));
    return next;
  }
  if (
    base &&
    local &&
    remote &&
    ![base, local, remote].some(Array.isArray) &&
    [base, local, remote].every((v) => typeof v === "object")
  ) {
    const out = { ...local };
    for (const k of new Set([...Object.keys(base), ...Object.keys(remote)])) {
      if (k === "revision") {
        out[k] = Math.max(local[k] ?? 0, remote[k] ?? 0);
        continue;
      }
      if (!Object.hasOwn(remote, k)) {
        if (equal(local[k], base[k])) delete out[k];
        continue;
      }
      if (!Object.hasOwn(local, k) && Object.hasOwn(base, k)) continue;
      out[k] = merge(base[k], local[k], remote[k]);
    }
    return out;
  }
  return structuredClone(local);
}
export function mergeServerDelta(base, local, remote) {
  if (local.id !== remote.id || base.id !== remote.id) return local;
  return merge(base, local, remote);
}
export function syncPlanHistory(h, base, remote, undoable = false) {
  if (h.present.id !== remote.id) return h;
  // Most polls contain no server delta. Keep React state and undo/redo snapshots
  // untouched instead of cloning the whole history every polling interval.
  if (equal(base, remote)) return h;
  const apply = (d) => mergeServerDelta(base, d, remote);
  const present = apply(h.present);
  // An acknowledgement or a locally overridden delta can also be a no-op.
  // There is no effective live change to rebase into historical snapshots.
  if (equal(h.present, present)) return h;
  // Polls can acknowledge an Undo saved after the hook's last server snapshot.
  // Rebase only the effective live delta; replaying base->remote into future
  // would erase redo, and treating that echo as a new media event loops Undo.
  const rebase = (snapshot) => mergeServerDelta(h.present, snapshot, present);
  // Undo entries are patches; rebase works on the full documents they encode.
  const expanded = materializeHistory(h);
  const next = {
    past: expanded.past.map(rebase),
    present,
    future: expanded.future.map(rebase),
  };
  if (undoable && !equal(h.present.instances, present.instances)) {
    const withoutMedia = {
      ...remote,
      instances: base.instances,
      productionPlan: structuredClone(remote.productionPlan),
    };
    if (withoutMedia.productionPlan) {
      const previousIds = new Set((base.instances ?? []).map((i) => i.id));
      const dismissed = new Set(
        withoutMedia.productionPlan.dismissedResultIds ?? [],
      );
      for (const shot of withoutMedia.productionPlan.shots ?? []) {
        const previous =
          base.productionPlan?.shots?.find((s) => s.id === shot.id)?.bindings ??
          [];
        const removed = (shot.bindings ?? [])
          .filter(
            (b) =>
              !previous.some((p) => p.id === b.id) &&
              !previousIds.has(b.instanceId),
          )
          .map((b) => ({ ...b, status: "removed" }));
        for (const binding of removed)
          if (binding.resultId) dismissed.add(binding.resultId);
        shot.bindings = [...previous, ...removed];
      }
      withoutMedia.productionPlan.dismissedResultIds = [...dismissed];
    }
    const beforeMedia = (snapshot) => {
      const previous = mergeServerDelta(base, snapshot, withoutMedia);
      if (previous.productionPlan)
        previous.productionPlan.dismissedResultIds = [
          ...new Set([
            ...(previous.productionPlan.dismissedResultIds ?? []),
            ...(withoutMedia.productionPlan?.dismissedResultIds ?? []),
          ]),
        ];
      return previous;
    };
    next.past = [
      // Older user edits precede this media event. Rebase their metadata while
      // keeping the media undone, so a second Undo cannot reapply the event.
      ...expanded.past.map(beforeMedia),
      beforeMedia(h.present),
    ].slice(-100);
    next.future = [];
  }
  return next;
}
export function adjustPlanRange(range, mode, delta, total) {
  delta = Math.round(delta);
  const end = range.startFrame + range.durationFrames;
  if (mode === "left") {
    const startFrame = Math.max(0, Math.min(end - 1, range.startFrame + delta));
    return { ...range, startFrame, durationFrames: end - startFrame };
  }
  if (mode === "right")
    return {
      ...range,
      durationFrames: Math.max(
        1,
        Math.min(total - range.startFrame, range.durationFrames + delta),
      ),
    };
  return {
    ...range,
    startFrame: Math.max(
      0,
      Math.min(total - range.durationFrames, range.startFrame + delta),
    ),
  };
}
export function planMediaUrl(path, projectId, browserPreview = false) {
  if (
    !path ||
    typeof path !== "string" ||
    /^(?!https?:)[a-z][a-z\d+.-]*:/i.test(path)
  )
    return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  return (
    "/api/editor/production-plan/file?projectId=" +
    encodeURIComponent(projectId ?? "") +
    "&path=" +
    encodeURIComponent(path) +
    (browserPreview ? "&browserPreview=1" : "")
  );
}

/** Mark only cards intersecting the actual inspector viewport, while displayed. */
export function observeCandidateReads({
  root,
  elements,
  isActive,
  onRead,
  Observer = globalThis.IntersectionObserver,
}) {
  if (!Observer || !root) return () => {};
  let alive = true;
  const seen = new Set();
  const observer = new Observer(
    (entries) => {
      if (!alive || !isActive()) return;
      const groups = new Map();
      for (const entry of entries) {
        const { shotId, candidateId, unread } = entry.target.dataset;
        const key = JSON.stringify([shotId, candidateId]);
        if (
          !entry.isIntersecting ||
          entry.intersectionRatio <= 0 ||
          unread !== "true" ||
          !shotId ||
          !candidateId ||
          seen.has(key)
        )
          continue;
        seen.add(key);
        const ids = groups.get(shotId) ?? [];
        ids.push(candidateId);
        groups.set(shotId, ids);
      }
      if (groups.size)
        onRead(
          [...groups].map(([shotId, candidateIds]) => ({
            shotId,
            candidateIds,
          })),
        );
    },
    { root, threshold: 0 },
  );
  for (const element of elements) observer.observe(element);
  return () => {
    alive = false;
    observer.disconnect();
  };
}

/** An explicit human decision may override semantic uncertainty, never probing. */
export function contentConfirmationFor(result, shot, slotId) {
  const hash = result.technical?.details?.sha256;
  if (
    result.technical?.passed !== true ||
    !/^[a-f\d]{64}$/i.test(hash ?? "") ||
    !shot ||
    !Number.isInteger(shot.requirementVersion) ||
    !shot.slots?.some((s) => s.id === slotId)
  )
    return undefined;
  return {
    confirmed: true,
    mediaSha256: hash,
    requirementVersion: shot.requirementVersion,
    shotId: shot.id,
    slotId,
  };
}
export function mediaResultEligible(result, document, override = {}) {
  if (!["media", "match"].includes(result.kind)) return true;
  if (result.technical?.passed !== true) return false;
  if (result.contentReview?.passed === true) return true;
  const shot = document.productionPlan?.shots.find(
    (s) => s.id === (override.shotId ?? result.shotId),
  );
  const expected = contentConfirmationFor(
      result,
      shot,
      override.slotId ?? result.slotId,
    ),
    decision = override.contentConfirmation;
  return (
    !!expected &&
    !!decision &&
    Object.keys(expected).every((key) => decision[key] === expected[key])
  );
}
