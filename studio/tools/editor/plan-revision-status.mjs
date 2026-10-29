export function planRevisionStatus(job,submitting=false){
 if(submitting||['queued','running'].includes(job?.status))return {state:'working',label:'修改中…'};
 if(!job)return null;
 if(job.status==='cancelling')return {state:'working',label:'正在停止…'};
 const results=(job.results??[]).filter(r=>r.kind==='shot-revision');
 if(['failed','interrupted'].includes(job.status))return {state:'failed',label:'修改失败'};
 if(job.status==='cancelled')return {state:'stopped',label:'已停止修改'};
 if(results.some(r=>['stale','conflict','failed','ignored'].includes(r.state)))return {state:'failed',label:'修改未写回'};
 const execution=results.some(r=>r.execution?.kind==='footage');
 if(execution){
  if(['queued','running','pending',undefined].includes(job.executionStatus))return {state:'working',label:job.executionStatus?'正在搜集素材…':'准备素材修改…'};
  if(job.executionStatus==='cancelling')return {state:'working',label:'正在停止…'};
  if(['failed','interrupted'].includes(job.executionStatus))return {state:'failed',label:'素材修改失败'};
  if(job.executionStatus==='cancelled')return {state:'stopped',label:'已停止修改'};
  if(job.executionStatus==='partial')return {state:'partial',label:'素材尚未完成'};
  if(job.executionStatus==='complete')return results.every(r=>r.state==='applied')
   ?results.some(r=>(r.gaps??[]).length)?{state:'partial',label:'部分修改完成'}:{state:'success',label:'修改成功'}
   :{state:'saving',label:'正在保存…'};
 }
 if(results.length&&results.every(r=>r.state==='applied')){
  const changed=results.some(r=>(r.patches??[]).some(p=>JSON.stringify(p.before)!==JSON.stringify(p.after)));
  if(!changed)return {state:'partial',label:'未修改'};
  const gaps=results.some(r=>(r.gaps??[]).length);
  return gaps||job.status==='partial'?{state:'partial',label:'部分修改完成'}:{state:'success',label:'修改成功'};
 }
 if(job.status==='partial')return {state:'failed',label:'修改未写回'};
 return {state:'saving',label:'正在保存…'};
}
