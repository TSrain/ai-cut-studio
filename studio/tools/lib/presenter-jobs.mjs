import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,realpathSync} from 'node:fs';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {presenterPreparationRange} from '../../templates/remotion-base/src/editor/behind-title.mjs';
const jobs=new Map();let running=false;
export function startPresenterJob(document,instanceId,{root}){
 if(running)throw Error('另一片段正在准备人物前景，请稍后重试');
 const instance=document.instances.find(i=>i.id===instanceId);
 if(!instance||instance.assetId!=='behind-title')throw Error('请选择人物身后大字模板');
 if(!document.source?.publicPath)throw Error('请先导入口播主视频');
 if(document.tracks?.find(t=>t.id===instance.trackId)?.locked)throw Error('轨道已锁定');
 const publicRoot=realpathSync(join(root,'templates/remotion-base/public'));
 const path=realpathSync(resolve(publicRoot,document.source.publicPath)),rel=relative(publicRoot,path);
 if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('底片必须位于工程素材目录');
 const range=presenterPreparationRange(document,instance),id=randomUUID(),dir=join(root,'workspace/presenter-jobs',id);mkdirSync(dir,{recursive:true});
 const snapshot=join(dir,'document.json');writeFileSync(snapshot,JSON.stringify(document));
 const job={id,status:'running',instanceId};jobs.set(id,job);running=true;
 const child=spawn(process.execPath,[join(root,'tools/presenter-foreground.mjs'),'prepare','--document',snapshot,'--source-start-frame',String(range.sourceStartFrame),'--frames',String(range.frameCount)],{cwd:root,stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',s=>{stdout+=s;});child.stderr.on('data',s=>{stderr=(stderr+s).slice(-5000);});
 child.on('error',e=>{running=false;Object.assign(job,{status:'failed',error:e.message});});
 child.on('close',code=>{running=false;if(job.status==='failed')return;try{if(code!==0)throw Error(stderr||'本机人物分割失败');const manifest=JSON.parse(readFileSync(stdout.trim().split('\n').at(-1),'utf8'));Object.assign(job,{status:'completed',manifest});}catch(e){Object.assign(job,{status:'failed',error:e.message});}});
 return {...job};
}
export function getPresenterJob(id){const job=jobs.get(id);if(!job)throw Error('人物前景任务不存在，服务可能已重启，请重新准备');return {...job};}
