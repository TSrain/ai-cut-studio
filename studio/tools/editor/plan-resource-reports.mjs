const list=v=>Array.isArray(v)?v:[];
/** Read-only latest per-shot projection; immutable full-film reports stay intact. */
export function mergeFootageReports(full,scoped=[]){
 let value=structuredClone(full??{});
 for(const {shotId,report} of scoped){
  if(!report||list(report.sections).length!==1||report.sections[0].id!==shotId)continue;
  if(['projectId','sourceSrtPath','sourceVideoPath'].some(k=>value[k]&&report[k]!==value[k]))continue;
  const old=list(value.candidates).map(c=>({...c,matchedSectionIds:list(c.matchedSectionIds).filter(id=>id!==shotId)})).filter(c=>c.matchedSectionIds.length);
  const candidates=new Map(old.map(c=>[c.id,c]));
  for(const c of list(report.candidates)){
   if(!list(c.matchedSectionIds).includes(shotId))continue;
   const prior=candidates.get(c.id);
   candidates.set(c.id,{...c,matchedSectionIds:[...new Set([...(prior?.matchedSectionIds??[]),shotId])]});
  }
  value={...report,...value,sections:[...list(value.sections).filter(s=>s.id!==shotId),report.sections[0]],candidates:[...candidates.values()],placements:[...list(value.placements).filter(p=>p.sectionId!==shotId),...list(report.placements).filter(p=>p.sectionId===shotId)]};
 }
 return value;
}
