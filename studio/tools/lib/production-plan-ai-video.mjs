/** Browser-safe AI-video contract shared by the editor and host. */
const text=v=>typeof v==='string'&&v.trim().length>0;
const identifier=v=>text(v)&&/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(v);
const positive=v=>Number.isInteger(v)&&v>0;
export function normalizeAiVideoCandidates(candidates=[]) {
 if(!Array.isArray(candidates))throw Error('Invalid AI video candidates');
 const ids=new Set();
 return candidates.map(value=>{
  const c=structuredClone(value);
  if(!c||!identifier(c.id))throw Error('Invalid AI video candidate ID');
  if(ids.has(c.id))throw Error('Duplicate AI video candidate ID');ids.add(c.id);
  if(!['title','prompt','reason','aspectRatio'].every(k=>text(c[k]))||!/^\d+:\d+$/.test(c.aspectRatio)||c.aspectRatio.split(':').some(n=>Number(n)<=0)||!positive(c.promptVersion)||!positive(c.requirementVersion)||!Number.isFinite(c.durationSeconds)||c.durationSeconds<=0)throw Error('Invalid AI video prompt or version');
  if(!Array.isArray(c.sourceCueIds)||!c.sourceCueIds.length||c.sourceCueIds.some(v=>!positive(v))||new Set(c.sourceCueIds).size!==c.sourceCueIds.length)throw Error('Invalid AI video source cues');
  if(!Array.isArray(c.references)||c.references.some(ref=>!ref||!text(ref.path)||/^[a-z][a-z0-9+.-]*:/i.test(ref.path)||ref.path.includes('\0')||!text(ref.label)||!text(ref.purpose)||(ref.sha256!==undefined&&!/^[a-f0-9]{64}$/.test(ref.sha256))))throw Error('Invalid AI video references');
  if((c.usage!==undefined&&c.usage!=='illustration')||(c.evidenceRole!==undefined&&c.evidenceRole!=='illustration')||c.candidateId!==undefined)throw Error('AI video must be illustration, never factual evidence or a network candidate');
  c.evidenceRole='illustration';
  return c;
 });
}
export const aiVideoSlotId=candidate=>`ai-video-${candidate.id}`;
/** Only source-defining fields participate; harmless UI metadata never changes identity. */
export function aiVideoIdentity(candidate){
 if(!candidate)return '';
 return JSON.stringify([candidate.id,candidate.promptVersion,candidate.requirementVersion,candidate.title,candidate.prompt,candidate.sourceCueIds,candidate.reason,candidate.aspectRatio,candidate.durationSeconds,candidate.references.map(r=>[r.path,r.label,r.purpose,r.sha256??null]),candidate.evidenceRole??candidate.usage??'illustration']);
}
export function aiVideoCandidateFor(document,request){
 const shot=document.productionPlan?.shots.find(s=>s.id===request.shotId);
 const c=shot?.aiVideoCandidates?.find(c=>c.id===request.aiVideoCandidateId);
 if(!shot||shot.cancelled||shot.locked||!c||c.ignored||c.promptVersion!==request.aiVideoPromptVersion||c.requirementVersion!==shot.requirementVersion)throw Error('AI video candidate, prompt or requirement changed');
 return c;
}
