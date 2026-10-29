import {useEffect,useState} from 'react';
import {mergeFootageReports} from './plan-resource-reports.mjs';
import {planMediaUrl} from './production-plan-sync.mjs';
/** Reports supplement the live plan. Never reuse a response from another project. */
export function usePlanResources(document:any){
 const plan=document.productionPlan;
 const analysisPath=plan?.upstream?.animationPackage?.analysisPath;
 const footagePath=plan?.upstream?.footagePackage?.reviewPath;
 const scoped=(plan?.shots??[]).filter((s:any)=>!s.cancelled&&s.upstream?.footagePackage?.reviewPath).map((s:any)=>({shotId:s.id,path:s.upstream.footagePackage.reviewPath}));
 const key=JSON.stringify([document.id,analysisPath,footagePath,scoped]);
 const [state,setState]=useState<any>({key:'',resources:{}});
 useEffect(()=>{
  const abort=new AbortController();
  setState({key,resources:{loading:!!(analysisPath||footagePath||scoped.length)}});
  void Promise.all([['analysis',analysisPath],['footage',footagePath],...scoped.map((s:any)=>['scoped:'+s.shotId,s.path])].map(async([name,path])=>{
   if(!path)return [name,undefined];
   const url=planMediaUrl(path,document.id);if(!url)return [name,undefined];
   try{const response=await fetch(url,{signal:abort.signal});if(!response.ok)throw Error('报告读取失败');const value=await response.json();if(value.projectId&&value.projectId!==document.id)throw Error('报告工程不一致');return [name,value];}
   catch(error){if(abort.signal.aborted)return [name,undefined];return [name+'Error','制作报告读取失败，可在更多中查看原文'];}
  })).then(rows=>{if(!abort.signal.aborted){const data:any=Object.fromEntries(rows);const reports=scoped.filter((s:any)=>data['scoped:'+s.shotId]).map((s:any)=>({shotId:s.shotId,report:data['scoped:'+s.shotId]}));
   if(reports.length)data.footage=mergeFootageReports(data.footage,reports);
   if(scoped.some((s:any)=>data['scoped:'+s.shotId+'Error']))data.footageError='片段素材报告读取失败';
   setState({key,resources:data});}});
  return ()=>abort.abort();
 },[key]);
 return state.key===key?state.resources:{loading:true};
}
