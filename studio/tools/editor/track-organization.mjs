const overlaps = (a, b) => a.startFrame < b.startFrame + b.durationFrames && b.startFrame < a.startFrame + a.durationFrames;
const validTiming = c => Number.isSafeInteger(c.startFrame) && c.startFrame >= 0 && Number.isSafeInteger(c.durationFrames) && c.durationFrames > 0;
const editable = t => !t.locked && !t.disabled;
const visualKind = c => {
  if (c.assetId === 'source-pip') return c.props?.media?.kind === 'video' ? 'video' : c.props?.media?.kind === 'image' ? 'image' : c.props?.sourceMode === 'media' ? 'unknown-media' : 'presenter';
  if (c.assetId === 'media-stack' || c.assetId === 'media-split') return c.assetId;
  return 'animation';
};
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])])) : value;
const settings = t => JSON.stringify(stable(Object.fromEntries(Object.entries(t).filter(([key]) => !['id', 'name', 'autoPlacement', 'locked', 'disabled'].includes(key)))));
const compatible = (a, b) => editable(a) && editable(b) && settings(a) === settings(b);

/** Manual, undoable packing. Keep absolute timing, media parameters and render zIndex intact. */
export function organizeTracks(document) {
  const d = structuredClone(document);
  let removedTracks = 0;
  const movedIds = new Set();
  function pack(trackKey, clipKey, kindOf, visual) {
    if (!Array.isArray(d[trackKey])) return;
    const clips = d[clipKey] ?? [];
    const originalOrder = new Map(clips.map((c, index) => [c.id, index]));
    const members = id => clips.filter(c => c.trackId === id);
    const cleanEmpty = () => {
      d[trackKey] = d[trackKey].filter(t => {
        if (!editable(t) || members(t.id).length) return true;
        // Unknown future track settings may carry behavior even on an empty lane.
        if (settings(t) !== '{}') return true;
        removedTracks++;
        return false;
      });
    };
    cleanEmpty();
    function move(source, target, group) {
      if (!group.length || !compatible(source, target)) return false;
      const targetClips = members(target.id), kind = kindOf(group[0]);
      if (group.some(c => c.locked || !validTiming(c) || kindOf(c) !== kind) || targetClips.some(c => !validTiming(c) || kindOf(c) !== kind)) return false;
      if (group.some((c, index) => group.slice(index + 1).some(other => overlaps(c, other))) || group.some(c => targetClips.some(other => overlaps(c, other)))) return false;
      if (visual) {
        const indices = new Map(d[trackKey].map((t, index) => [t.id, index]));
        const groupIds = new Set(group.map(c => c.id));
        for (const c of group) for (const other of clips) {
          if (groupIds.has(other.id) || !overlaps(c, other)) continue;
          const otherIndex = indices.get(other.trackId);
          // An untracked layer has no reliable lane order; leave the moving clip alone.
          if (otherIndex === undefined || !Number.isFinite(c.zIndex) || !Number.isFinite(other.zIndex)) return false;
          const oldOrder = Math.sign(c.zIndex - other.zIndex) || Math.sign(originalOrder.get(c.id) - originalOrder.get(other.id));
          const newOrder = Math.sign(indices.get(target.id) - otherIndex);
          if (oldOrder !== newOrder) return false;
        }
      }
      // Touched lanes become manually arranged. Auto append must not reuse them.
      delete source.autoPlacement;
      delete target.autoPlacement;
      for (const c of [...members(source.id), ...targetClips]) delete c.autoPlacement;
      for (const c of group) {
        c.trackId = target.id;
        movedIds.add(`${clipKey}/${c.id}`);
      }
      // Compatible settings already survive on the target, including future
      // metadata. Remove the emptied source explicitly to guarantee progress.
      if (!members(source.id).length) {
        d[trackKey] = d[trackKey].filter(t => t.id !== source.id);
        removedTracks++;
      }
      return true;
    }
    // Whole-lane merges reduce the lane count. Individual moves only go downward,
    // so repeated packing terminates without bouncing clips between two lanes.
    let progress = true;
    while (progress) {
      progress = false;
      const tracks = [...d[trackKey]];
      outer: for (const source of [...tracks].reverse()) {
        const group = members(source.id);
        if (!editable(source) || !group.length) continue;
        for (const target of tracks) {
          if (source.id !== target.id && move(source, target, group)) {
            progress = true;
            break outer;
          }
        }
      }
      if (progress) continue;
      outer: for (let index = tracks.length - 1; index > 0; index--) {
        const source = tracks[index];
        if (!editable(source)) continue;
        for (const c of members(source.id).sort((a, b) => a.startFrame - b.startFrame)) {
          for (const target of tracks.slice(0, index)) {
            if (move(source, target, [c])) {
              progress = true;
              break outer;
            }
          }
        }
      }
    }
  }
  pack('tracks', 'instances', visualKind, true);
  pack('audioTracks', 'audioClips', () => 'audio', false);
  const movedClips = movedIds.size;
  return {document: d, changed: removedTracks > 0 || movedClips > 0, removedTracks, movedClips};
}
