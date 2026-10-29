/** The ruler shows production work; the full plan keeps untouched narration too. */
export function needsProductionWork(shot) {
  if (shot.cancelled) return false;
  const row = shot.upstream?.packageShot ?? shot.details?.packageShot ?? {};
  // Concrete work always wins over an old keep-original marker.
  if (["slots", "bindings", "candidates", "keyframes"].some(k => shot[k]?.length)) return true;
  const actions = shot.productionActions ?? row.productionActions;
  if (Array.isArray(actions) && actions.length) return true;
  const sound = shot.soundDesign ?? row.soundDesign;
  if (sound?.cues?.length || (sound?.decision && !["silence", "none", "keep-original"].includes(sound.decision))) return true;
  // Explicit structured silence is authoritative over generic prose in old packages.
  // Current user-authored sound intent and concrete cues/actions still win.
  const soundIntent = shot.soundIntent ?? (sound?.decision ? "" : row["声音意图"]);
  if (soundIntent?.trim() && !/^(不加音效[；;，,]?人声优先[。.]?|无[。.]?|保留原声[。.]?|原声[。.]?)$/.test(soundIntent.trim())) return true;
  for (const k of ["cameraPlan", "cameraDesign", "camera", "cameraActions"]) {
    const value = shot[k] ?? row[k];
    if (value && (typeof value !== "object" || Object.keys(value).length)) return true;
  }
  if (row.requiresPackaging === true) return true;
  for (const key of ['cameraIntent','presenterLayerIntent']) {
    const intent = shot[key] ?? row[key];
    const action = intent?.mode ?? intent?.action ?? intent?.placement;
    if (intent && Object.keys(intent).length && !['none','keep-original'].includes(action)) return true;
  }
  // A sidebar edit invalidates historical classification until the updated design is known.
  if ((row["理想画面"] !== undefined && shot.visualRequirement !== row["理想画面"]) ||
      (row["创意方案"] !== undefined && shot.mediaDescription !== row["创意方案"])) return true;
  if (shot.keepOriginal === true || row.keepOriginal === true || (Array.isArray(actions) && !actions.length)) return false;
  // Narrow compatibility for old packages, never infer "untouched" from missing slots alone.
  const returnsToOriginal = (row["动作"] === "实录" && /^(硬切回真人|回真人)/.test(row["理想画面"] ?? "")) ||
    (row["动作"] === "定格" && (row["理想画面"] ?? "").includes("画面归静"));
  if (row["关键帧描述"] === "原口播画面，不新增关键帧。" &&
      (row["切法"] === "无" || (row["切法"] === "硬切" && returnsToOriginal))) return false;
  return true;
}
