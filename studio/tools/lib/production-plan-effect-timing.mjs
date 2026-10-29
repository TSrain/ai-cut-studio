/** Source-time design is separate from the narration interval and from approval. */
export function validateEffectTiming(t) {
  if (t === undefined) return;
  const times = ['startSeconds','changeSeconds','holdSeconds','endSeconds'].map(k=>t?.[k]);
  const e=t?.evidence, ids=e?.sourceCueIds;
  if (!t || !['draft','confirmed'].includes(t.status) || typeof t.sourcePath!=='string' || !t.sourcePath ||
      times.some(x=>!Number.isFinite(x)||x<0) || times.some((x,i)=>i&&x<times[i-1]) || times[3]<=times[0] ||
      !e || !/^[a-f0-9]{64}$/.test(e.sourceSha256??'') || !/^[a-f0-9]{64}$/.test(e.transcriptHash??'') ||
      typeof e.reason!=='string' || !e.reason.trim() || !Array.isArray(ids) || !ids.length ||
      ids.some((x,i)=>!Number.isInteger(x)||x<1||(i&&x!==ids[i-1]+1))) throw new Error('Invalid effect timing or evidence');
}
