import {artifactRootDefault} from './production-plan-storage.mjs';
import {startCoverJob,getCoverJob} from './editor-cover-jobs.mjs';
import {stageProjectCover} from './editor-cover-selection.mjs';
import {createReadStream,existsSync,mkdirSync,readFileSync,renameSync,writeFileSync,realpathSync,statSync} from 'node:fs';
import {join,resolve,extname} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {loadDocument} from './editor-store.mjs';
import {listProjectCovers,resolveCoverImage} from './editor-covers.mjs';
import {json} from './panel-api.mjs';
const exec=promisify(execFile);

export async function editorCoverApi(action,req,res,url,body,{root}){
 if(!['covers','covers/image','covers/reveal','covers/source','covers/start','covers/select'].includes(action))return false;
 const expected=['covers','covers/image'].includes(action)?'GET':'POST';
 if(req.method!==expected){json(res,405,{error:'不支持的请求方法'});return true;}
 const id=expected==='GET'?url.searchParams.get('id'):body.documentId;
 const doc=loadDocument(id,{rootDir:join(root,'workspace/editor-projects')});
 const workflowRoot=process.env.CONTENT_WORKFLOW_ROOT||resolve(root,'../workflow');
 const stateDir=join(root,'workspace/editor-covers'),statePath=join(stateDir,doc.id+'.json');
 let state={};
 if(existsSync(statePath))state=JSON.parse(readFileSync(statePath,'utf8'));
 const opts={coversRoot:join(workflowRoot,'workspace/covers'),artifactRoot:artifactRootDefault(),source:state.source};
 const activeJob=state.jobId?getCoverJob(state.jobId,{workflowRoot}):null;
 if(action==='covers/start'){
  if(activeJob?.status==='running'){json(res,200,{job:activeJob});return true;}
  const listing=listProjectCovers(doc,opts);
  const job=startCoverJob({document:doc,source:listing.source,episode:listing.episode,existingRunIds:listProjectCovers(doc,{...opts,source:listing.source}).runs.map(x=>x.id)},{root,workflowRoot,artifactRoot:opts.artifactRoot});
  state={...state,source:listing.source,jobId:job.id};mkdirSync(stateDir,{recursive:true});writeFileSync(statePath+'.tmp',JSON.stringify(state,null,2));renameSync(statePath+'.tmp',statePath);
  json(res,200,{job});return true;
 }
 if(action==='covers/select'){
  const cover=stageProjectCover(doc,body,{...opts,publicRoot:join(root,'templates/remotion-base/public')});json(res,200,{cover});return true;
 }
 if(action==='covers/source'){
  if(activeJob?.status==='running')throw Error('封面正在制作，结束后可更改原稿');
  let source=String(body.source||'').trim();
  if(source&&!/^SC-\d+$/.test(source)){
   if(!source.startsWith('/')||!['.md','.txt'].includes(extname(source).toLowerCase()))throw new Error('请输入 SC 编号或 Markdown / TXT 原稿的完整路径');
   source=realpathSync(source);if(!statSync(source).isFile())throw new Error('原稿文件不存在');
  }
  state={...state,source};delete state.jobId;mkdirSync(stateDir,{recursive:true});
  writeFileSync(statePath+'.tmp',JSON.stringify(state,null,2));renameSync(statePath+'.tmp',statePath);
  json(res,200,{source});return true;
 }
 if(action==='covers'){
  const listing=listProjectCovers(doc,opts);
  for(const run of listing.runs)for(const group of run.groups)group.images=Object.fromEntries(Object.keys(group.images).map(ratio=>[ratio,'/api/editor/covers/image?'+new URLSearchParams({id:doc.id,run:run.id,group:group.id,ratio})]));
  json(res,200,{...listing,job:activeJob});return true;
 }
 const params=expected==='GET'?{runId:url.searchParams.get('run'),groupId:url.searchParams.get('group'),ratio:url.searchParams.get('ratio')}:body;
 const path=resolveCoverImage(doc,params,opts);
 if(action==='covers/reveal'){
  if(process.platform!=='darwin')throw new Error('Finder 仅在 Mac 上可用');
  await exec('open',['-R',path],{timeout:10000});json(res,200,{revealed:true});return true;
 }
 res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
 const stream=createReadStream(path);stream.on('error',()=>res.destroy());stream.pipe(res);return true;
}
