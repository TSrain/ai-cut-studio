// Machine gates for the existing motion-broll skill and continuity-reviewer contract.
// Design rules remain in Visualization; external schedulers invoke these gates.
export function validateContinuity(value, ids) {
  if (!value || JSON.stringify(value.shots)!==JSON.stringify(ids) || !Array.isArray(value.boundaries)
    || value.boundaries.length!==Math.max(0,ids.length-1)) throw new Error('continuity shot/boundary coverage mismatch');
  if (!Number.isFinite(value.continuityScore) || value.continuityScore<0 || value.continuityScore>10) throw new Error('continuityScore missing or invalid');
  for (const [i,b] of value.boundaries.entries()) {
    if (b.from!==ids[i] || b.to!==ids[i+1]) throw new Error('continuity boundary order mismatch');
    if (!Array.isArray(b.frames) || b.frames.length!==2 || b.frames.some(p=>typeof p!=='string'||!p)) throw new Error('continuity frame evidence missing');
    for (const key of ['focus','palette','typography','motionDirection','densityCurve','timing']) {
      if (b.checks?.[key]!==true) throw new Error(`continuity check not passed: ${b.from}/${key}`);
    }
    if (b.passed!==true) throw new Error('continuity boundary not passed');
    if ((b.repairs??[]).some(r=>![b.from,b.to].includes(r.shot))) throw new Error('continuity repair exceeds boundary');
  }
}
export function validatePresetReview(value) {
  for (const key of ['contract','output','fonts','assets','thumbnail']) {
    if(value?.technical?.[key]!==true) throw new Error(`preset technical.${key} not passed`);
  }
  for (const name of ['slots','preview','render','output']) {
    const entries=(value.commands??[]).filter(c=>c.name===name);
    if(entries.length!==1 || entries[0].exitCode!==0 || typeof entries[0].receiptPath!=='string') throw new Error(`preset command evidence missing/failed: ${name}`);
  }
}
