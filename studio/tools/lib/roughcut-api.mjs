import {join} from 'node:path';
import {loadDocument,saveDocument,createDocument} from './editor-store.mjs';
import {startRoughcutAnalysis,getRoughcutAnalysis,roughcutSourceCopy} from './roughcut-jobs.mjs';
import {json} from './panel-api.mjs';
export async function roughcutApi(action,req,res,url,body,opts){
 const rootDir=opts.rootDir??join(opts.root,'workspace/editor-projects');
 if(action==='roughcut/start'&&req.method==='POST'){const doc=loadDocument(body.documentId,{rootDir});return json(res,200,startRoughcutAnalysis(doc)),true;}
 if(action==='roughcut/job'&&req.method==='GET')return json(res,200,getRoughcutAnalysis(url.searchParams.get('id'))),true;
 if(action==='roughcut/source-copy'&&req.method==='POST'){const original=loadDocument(body.documentId,{rootDir}),copy=createDocument(roughcutSourceCopy(original));return json(res,200,saveDocument(copy,{...opts,rootDir,expectedRevision:0})),true;}
 return false;
}
