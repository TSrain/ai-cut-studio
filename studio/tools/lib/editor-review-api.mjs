import {productionPlanService} from './production-plan-api.mjs';
import {createReadStream,statSync} from 'node:fs';
import {join} from 'node:path';
import {json} from './panel-api.mjs';
import {loadDocument} from './editor-store.mjs';
import {createReviewService} from './editor-review-service.mjs';
import {renderReviewMedia,createReviewPreviewService} from './editor-review-media.mjs';
const services=new Map();
export function reviewServices(options){
 const key=options.root;if(!services.has(key)){
  const load=id=>loadDocument(id,options);
  services.set(key,{notes:createReviewService({...options,load,capture:args=>renderReviewMedia({root:key,...args})}),previews:createReviewPreviewService({root:key,load})});
 }return services.get(key);
}
function stream(req,res,path,type){const size=statSync(path).size;let start=0,end=size-1,status=200;
 if(req.headers.range){const m=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!m){res.writeHead(416,{'Content-Range':`bytes */${size}`});res.end();return;}start=Number(m[1]);end=m[2]?Math.min(size-1,Number(m[2])):size-1;if(start>end||start>=size){res.writeHead(416,{'Content-Range':`bytes */${size}`});res.end();return;}status=206;}
 res.writeHead(status,{'Content-Type':type,'Content-Length':end-start+1,'Accept-Ranges':'bytes','Cache-Control':'private, max-age=3600',...(status===206?{'Content-Range':`bytes ${start}-${end}/${size}`}:{})});if(req.method==='HEAD'){res.end();return;}createReadStream(path,{start,end}).on('error',()=>res.destroy()).pipe(res);
}
export async function editorReviewApi(action,req,res,url,body,options){
 if(!action.startsWith('review/'))return false;
 const {notes,previews}=reviewServices(options),route=action.slice(7),projectId=req.method==='POST'?body.projectId:url.searchParams.get('projectId'),id=req.method==='POST'?body.id:url.searchParams.get('id');
 if(route==='notes'&&req.method==='GET')json(res,200,{notes:notes.list(projectId)});
 else if(route==='notes'&&req.method==='POST'){const note=await notes.add(body);void notes.run(projectId,note.id).catch(()=>{});json(res,200,{note:notes.get(projectId,note.id)});}
 else if(route==='retry'&&req.method==='POST'){void notes.run(projectId,id).catch(()=>{});json(res,200,{note:notes.get(projectId,id)});}
 else if(route==='cancel'&&req.method==='POST')json(res,200,{note:notes.cancel(projectId,id)});
 else if(route==='accept'&&req.method==='POST')json(res,200,notes.accept(projectId,id,body.revision));
 else if(route==='revert'&&req.method==='POST')json(res,200,notes.revert(projectId,id,body.revision));
 else if(route==='delegate'&&req.method==='POST')json(res,200,await notes.delegate(projectId,id,body.revision,request=>productionPlanService(options).createJob(request)));
 else if(route==='finish'&&req.method==='POST')json(res,200,{note:notes.finish(projectId,id,body.status)});
 else if(route==='frame'&&['GET','HEAD'].includes(req.method)){notes.get(projectId,id);stream(req,res,join(notes.directory(projectId,id),'frame.png'),'image/png');}
 else if(route==='preview'&&req.method==='POST'){const d=loadDocument(projectId,options);if(d.revision!==body.revision)throw Error('请先保存当前工程');json(res,200,await previews.request(d));}
 else if(route==='preview-cancel'&&req.method==='POST')json(res,200,previews.cancel(projectId,body.key));
 else if(route==='preview'&&req.method==='GET')json(res,200,previews.get(projectId,url.searchParams.get('key')));
 else if(route==='preview-file'&&['GET','HEAD'].includes(req.method))stream(req,res,previews.path(projectId,url.searchParams.get('key')),'video/mp4');
 else json(res,404,{error:'审片操作不存在'});return true;
}
