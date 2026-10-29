/** BGM is a plan annotation, never a playable audio clip. */
const text=v=>typeof v==='string'&&!!v.trim();
export function safeMusicUrl(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!!u.hostname?u.href:null;}catch{return null;}}
export function validateBgmPlan(plan){
 if(plan.bgmPlanVersion===undefined&&!plan.shots?.some(s=>s.bgmDesign))return;
 if(plan.bgmPlanVersion!==1)throw Error('Unsupported BGM plan version');
 if(!Array.isArray(plan.bgmRecommendations??[])||!Array.isArray(plan.bgmRecommendationGaps??[]))throw Error('Invalid BGM recommendations');
 const ids=new Set();
 for(const r of plan.bgmRecommendations??[]){
  if(!text(r.id)||ids.has(r.id)||!text(r.title)||!text(r.artist)||!text(r.reason)||!safeMusicUrl(r.url))throw Error('Invalid BGM recommendation');
  if(!['unknown','verify_before_use','verified'].includes(r.licenseStatus)||!['not_listened','listened'].includes(r.audition))throw Error('Invalid BGM evidence status');
  if(r.licenseStatus==='verified'&&!safeMusicUrl(r.licenseUrl))throw Error('BGM license evidence missing');
  ids.add(r.id);
 }
 for(const s of plan.shots??[]){const b=s.bgmDesign;if(!b)continue;
  if(!['music','silence'].includes(b.decision)||!text(b.reason)||!Number.isInteger(b.requirementVersion)||b.requirementVersion<1)throw Error('Invalid BGM decision');
  if(b.decision==='music'){
   if(!['continuity','narrative','atmosphere'].includes(b.purpose)||!['musicType','texture'].every(k=>text(b[k]))||!(Object.hasOwn(b,'transition')?text(b.transition):text(b.entry)&&text(b.exit)))throw Error('Incomplete BGM direction');
   if(!Array.isArray(b.recommendationIds)||b.recommendationIds.some(id=>!ids.has(id)))throw Error('Missing BGM recommendation reference');
  }
 }
}
export function bgmDetail(doc,shot){
 const b=shot?.bgmDesign;if(!b)return null;
 const status=b.requirementVersion!==shot.requirementVersion?'stale':b.decision;
 return {...b,transition:Object.hasOwn(b,'transition')?b.transition:[b.entry,b.exit].filter(text).join('；'),status,recommendations:status==='music'?(doc.productionPlan?.bgmRecommendations??[]).filter(r=>b.recommendationIds?.includes(r.id)&&safeMusicUrl(r.url)):[],gaps:doc.productionPlan?.bgmRecommendationGaps??[]};
}
export function getBgmRows(doc){
 const duration=doc.canvas?.durationFrames;
 if(!Number.isFinite(duration))return [];
 return (doc.productionPlan?.shots??[]).flatMap(shot=>{
  const b=bgmDetail(doc,shot);
  if(shot.cancelled||b?.status!=='music'||!['aligned','manual'].includes(shot.timing?.status))return [];
  return (shot.timing.ranges??[]).flatMap((range,index)=>{
   const start=Math.max(0,range.startFrame),end=Math.min(duration,range.startFrame+range.durationFrames);
   if(!Number.isInteger(start)||!Number.isInteger(end)||end<=start)return [];
   return [{id:shot.id+':'+(range.id??index),shotId:shot.id,title:shot.title,musicType:b.musicType,startFrame:start,durationFrames:end-start}];
  });
 });
}

// A concurrent local decision keeps its original track even if a new worker
// reuses a short recommendation ID for a different recording.
export function prepareBgmMerge(current,incoming){
 if(!Object.hasOwn(incoming,'bgmRecommendations'))return incoming;
 const next=structuredClone(incoming),pool=new Map((current.bgmRecommendations??[]).map(r=>[r.id,structuredClone(r)])),renamed=new Map();
 for(const item of next.bgmRecommendations){
  const rec=structuredClone(item),existing=pool.get(rec.id);
  if(existing&&JSON.stringify(existing)!==JSON.stringify(rec)){
   let hash=2166136261;for(const char of JSON.stringify(rec))hash=Math.imul(hash^char.charCodeAt(0),16777619)>>>0;
   let id=rec.id+'-proposal-'+hash.toString(16);
   while(pool.has(id)&&JSON.stringify({...pool.get(id),id:rec.id})!==JSON.stringify(rec))id+='x';
   renamed.set(rec.id,id);rec.id=id;
  }
  pool.set(rec.id,rec);
 }
 for(const s of next.shots??[]){
  for(const b of [s.bgmDesign,s.upstream?.packageShot?.bgmDesign])if(b?.recommendationIds)b.recommendationIds=b.recommendationIds.map(id=>renamed.get(id)??id);
 }
 next.bgmRecommendations=[...pool.values()];return next;
}
