import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,realpathSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDocument,saveDocument,loadDocument} from '../lib/editor-store.mjs';
import {createProductionPlanService} from '../lib/production-plan-jobs.mjs';
async function fixture(){
 const root=mkdtempSync(join(tmpdir(),'plan-report-links-'));
 const options={root,rootDir:join(root,'index'),artifactRoot:join(root,'artifacts'),assetSourceRoot:root,autoStart:false};
 mkdirSync(join(root,'templates/remotion-base/public'),{recursive:true});
 const service=createProductionPlanService(options);
 const create=async id=>{const d=saveDocument(createDocument({id,name:id,canvas:{width:1280,height:720,fps:{num:30,den:1},durationFrames:300},productionPlan:{shots:[{id:'s'}]}}),options);return (await service.createJob({projectId:id,revision:d.revision,kind:'package'})).job;};
 const job=await create('p');
 const file=(name,base=job.outputDir)=>{const path=join(base,name);mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,'{}');return path;};
 return {root,options,service,create,job,file};
}
test('current plan and shot upstream reports resolve within their registered project jobs',async()=>{
 const x=await fixture();
 try{
  const paths=Object.fromEntries(['analysis','summary','finalSummary','review','shotReview','shotSummary','design','report','readback','receipt'].map(k=>[k,x.file('package/'+k+'.json')]));
  const d=loadDocument('p',x.options);d.productionPlan.upstream={animationPackage:{analysisPath:paths.analysis,summaryPath:paths.summary,finalSummaryPath:paths.finalSummary},footagePackage:{reviewPath:paths.review},completePackage:{designPath:paths.design,reportPath:paths.report,productionReadbackPath:paths.readback,productionReceiptPaths:{scriptReview:paths.receipt}}};
  d.productionPlan.shots[0].upstream={footagePackage:{reviewPath:paths.shotReview,summaryPath:paths.shotSummary}};saveDocument(d,x.options);
  for(const path of Object.values(paths))assert.equal(x.service.resolveFile('p',path),realpathSync(path));
 }finally{x.service.close();}
});
test('upstream reports do not authorize foreign jobs, unreferenced siblings, arbitrary files or symlink escapes',async()=>{
 const x=await fixture();
 try{
  const other=await x.create('q'),foreign=x.file('foreign.json',other.outputDir),outside=x.file('outside.json',x.root),sibling=x.file('not-referenced.json'),linked=join(x.job.outputDir,'linked.json');symlinkSync(outside,linked);
  const d=loadDocument('p',x.options);d.productionPlan.upstream={animationPackage:{analysisPath:foreign,summaryPath:outside,finalSummaryPath:linked},arbitrary:{reportPath:sibling}};saveDocument(d,x.options);
  for(const path of [foreign,outside,sibling,linked])assert.throws(()=>x.service.resolveFile('p',path),/not referenced/i);
  const own=x.file('own.json'),latest=loadDocument('p',x.options);latest.productionPlan.upstream.animationPackage.analysisPath=own;saveDocument(latest,x.options);
  assert.throws(()=>x.service.resolveFile('q',own),/not referenced/i);
 }finally{x.service.close();}
});
test('AI reference images remain available through the same project-scoped file resolver',async()=>{
 const x=await fixture();
 try{
  const reference=x.file('reference.png',x.root),unlinked=x.file('unlinked.png',x.root),d=loadDocument('p',x.options);
  d.productionPlan.shots[0].aiVideoCandidates=[{id:'ai-1',title:'示意',prompt:'汽车前行',promptVersion:1,requirementVersion:1,sourceCueIds:[1],reason:'示意',aspectRatio:'16:9',durationSeconds:3,references:[{path:reference,label:'图1',purpose:'主体'}]}];saveDocument(d,x.options);
  assert.equal(x.service.resolveFile('p',reference),realpathSync(reference));assert.throws(()=>x.service.resolveFile('p',unlinked),/not referenced/i);
  await x.create('q');assert.throws(()=>x.service.resolveFile('q',reference),/not referenced/i);
 }finally{x.service.close();}
});
