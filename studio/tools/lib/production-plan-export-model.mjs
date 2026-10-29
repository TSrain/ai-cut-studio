/** Plan gaps are advisory. Only actual referenced media can block rendering. */
export function assessProductionPlanExport(document) {
  const disabled = new Set(
    (document.tracks ?? []).filter((t) => t.disabled).map((t) => t.id),
  );
  const actual = (document.instances ?? []).filter(
      (i) => !i.disabled && !disabled.has(i.trackId),
    ),
    ids = new Set(actual.map((i) => i.id)),
    missing = [],
    emptyRanges = [];
  const occupied = actual.map((i) => [
    i.startFrame,
    i.startFrame + i.durationFrames,
  ]);
  if (document.source) {
    const source = document.source;
    for (const c of source.clips ?? [
      {
        startFrame: source.startFrame ?? 0,
        durationFrames: source.durationFrames ?? document.canvas.durationFrames,
      },
    ])
      occupied.push([c.startFrame, c.startFrame + c.durationFrames]);
  }
  for (const shot of document.productionPlan?.shots ?? []) {
    if (shot.cancelled) continue;
    for (const slot of shot.slots ?? []) {
      const adopted = (shot.bindings ?? []).find(
        (b) =>
          b.slotId === slot.id &&
          ids.has(b.instanceId) &&
          b.status !== "removed",
      );
      if (!adopted)
        missing.push({
          shotId: shot.id,
          title: shot.title || shot.id,
          slotId: slot.id,
          reason: "尚无已采用素材",
        });
      else if (
        adopted.requirementVersion !==
        (slot.requirementVersion ?? shot.requirementVersion)
      )
        missing.push({
          shotId: shot.id,
          title: shot.title || shot.id,
          slotId: slot.id,
          reason: "需求已变更，仍使用现有素材",
        });
    }
    for (const range of shot.timing?.ranges ?? []) {
      let gaps = [[range.startFrame, range.startFrame + range.durationFrames]];
      for (const [a, b] of occupied)
        gaps = gaps.flatMap(([x, y]) =>
          b <= x || a >= y
            ? [[x, y]]
            : [
                [x, Math.min(y, a)],
                [Math.max(x, b), y],
              ].filter(([s, e]) => e > s),
        );
      for (const [start, end] of gaps)
        emptyRanges.push({
          shotId: shot.id,
          startFrame: start,
          durationFrames: end - start,
        });
    }
  }
  return {
    missing,
    emptyRanges,
    requiresAcknowledgement: missing.length > 0 || emptyRanges.length > 0,
  };
}
