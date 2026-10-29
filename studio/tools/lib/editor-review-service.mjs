import {reviewMediaIdentity} from './editor-review-identity.mjs';
import {randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {loadDocument,saveDocument} from './editor-store.mjs';
import {reviewContext,applyReviewResult} from './editor-review-model.mjs';
import {runReviewCodex} from './editor-review-runner.mjs';
const safe=id=>{if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw Error('无效审片标识');return id;};
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const atomic=(p,v)=>{const tmp=p+'.'+randomUUID()+'.tmp';writeFileSync(tmp,JSON.stringify(v,null,2));renameSync(tmp,p);};
export function createReviewService({root,load,save,runner=runReviewCodex,capture=async()=>null,...storeOptions}){
 const opts={rootDir:join(root,'workspace/editor-projects'),assetSourceRoot:root,...storeOptions};
 load??=id=>loadDocument(id,opts);save??=d=>saveDocument(d,opts);
 const base=join(root,'workspace/editor-review'),active=new Map();let tail=Promise.resolve();
 const directory=(projectId,id)=>join(base,safe(projectId),safe(id));
 const persist=n=>{const dir=directory(n.projectId,n.id);mkdirSync(dir,{recursive:true});atomic(join(dir,'note.json'),n);return structuredClone(n);};
 function get(projectId,id){const p=join(directory(projectId,id),'note.json');if(!existsSync(p))throw Error('批注不存在');const n=read(p);if(n.projectId!==projectId||n.id!==id)throw Error('批注身份不符');if(['running','queued'].includes(n.status)&&!active.has(id)){n.status='failed';n.error='服务已重启，批注和原始版本已保留，可重试';persist(n);}return n;}
 function list(projectId){load(projectId);const p=join(base,safe(projectId));return existsSync(p)?readdirSync(p).filter(id=>existsSync(join(p,id,'note.json'))).map(id=>get(projectId,id)).sort((a,b)=>b.createdAt-a.createdAt):[];}
 async function add({projectId,revision,frame,text}){
  const d=load(safe(projectId));if(d.revision!==revision)throw Error('工程已更新，请先保存再提交批注');
  if(typeof text!=='string'||!text.trim()||text.length>4000)throw Error('请输入1–4000字批注');
  const snapshot={...reviewContext(d,frame),mediaIdentity:reviewMediaIdentity(root,d)},id=randomUUID(),dir=directory(projectId,id);mkdirSync(dir,{recursive:true});atomic(join(dir,'snapshot.json'),snapshot);
  return persist({id,projectId,text:text.trim(),anchor:snapshot.anchor,status:'open',createdAt:Date.now(),attempt:0});
 }
 async function run(projectId,id){
  const n=get(projectId,id);if(active.has(id)){if(n.status==='cancelled')throw Error('停止中，请稍后重试');return active.get(id).promise;}
  if(!['open','failed','cancelled'].includes(n.status))throw Error('当前批注不能重复执行');
  const controller=new AbortController(),dir=directory(projectId,id);n.status='queued';n.attempt++;delete n.error;persist(n);
  const promise=tail.catch(()=>{}).then(async()=>{
   if(controller.signal.aborted){active.delete(id);return;}
   n.status='running';n.stage='capturing';persist(n);const snapshot=read(join(dir,'snapshot.json'));
   try{
    try{const file=await capture({document:snapshot.document,frame:n.anchor.frame,directory:dir,signal:controller.signal});if(file)n.screenshot=true;}catch(e){if(controller.signal.aborted)throw e;n.screenshotError=e.message;}
    if(controller.signal.aborted)return;
    n.stage='analyzing';persist(n);
    const result=await runner({note:n,snapshot,directory:dir,signal:controller.signal});
    if(controller.signal.aborted)return;
    applyReviewResult(snapshot,result,snapshot.document);
    n.result={...result,patches:result.patches.map(p=>{const field=snapshot.editable.find(e=>e.key===p.key);return {...p,before:field.before,label:field.label};})};n.status='ready';n.finishedAt=Date.now();
   }catch(e){if(!controller.signal.aborted){n.status='failed';n.error=e.message;}}
   finally{if(!controller.signal.aborted)persist(n);active.delete(id);}
  });active.set(id,{controller,promise});tail=promise;return promise;
 }
 function cancel(projectId,id){const n=get(projectId,id);if(!['queued','running'].includes(n.status))return n;active.get(id)?.controller.abort();n.status='cancelled';n.finishedAt=Date.now();return persist(n);}
 function accept(projectId,id,revision){
  const n=get(projectId,id),d=load(projectId);
  if(d.reviewAppliedIds?.includes(id)){n.status='applied';persist(n);return {note:n,document:d};}
  if(n.status!=='ready')throw Error('请等待修改建议完成');if(d.revision!==revision)throw Error('工程已更新，请刷新后接受');
  const snapshot=read(join(directory(projectId,id),'snapshot.json'));
  if(snapshot.mediaIdentity!==reviewMediaIdentity(root,d))throw Error('媒体文件已变化，请基于当前画面重新提交');
  const next=applyReviewResult(snapshot,n.result,d);
  if(!n.result.patches.length)throw Error('没有可应用的修改，请查看待处理项');
  next.reviewAppliedIds=[...(d.reviewAppliedIds??[]),id];const saved=save(next);
  n.status='applied';n.appliedRevision=saved.revision;n.appliedAt=Date.now();persist(n);return {note:n,document:load(projectId)};
 }
 function revert(projectId,id,revision){const n=get(projectId,id),d=load(projectId);if(n.status==='reverted')return {note:n,document:d};if(!['applied','verified'].includes(n.status))throw Error('此批注尚未应用');if(!d.reviewAppliedIds?.includes(id)){n.status='reverted';persist(n);return {note:n,document:d};}if(d.revision!==revision)throw Error('工程已更新，请刷新后撤回');const next=applyReviewResult(read(join(directory(projectId,id),'snapshot.json')),n.result,d,{reverse:true});next.reviewAppliedIds=(next.reviewAppliedIds??[]).filter(x=>x!==id);save(next);n.status='reverted';persist(n);return {note:n,document:load(projectId)};}
 async function delegate(projectId,id,revision,createJob){
  const n=get(projectId,id),d=load(projectId);
  if(n.jobId)return {note:n,document:d};
  if(n.status!=='ready'||!n.anchor.shotId)throw Error('只有已定位镜头的待接受意见可以交给制作流程');
  if(d.revision!==revision)throw Error('工程已更新，请刷新后提交');
  const snapshot=read(join(directory(projectId,id),'snapshot.json'));
  applyReviewResult(snapshot,{summary:'校验定位',patches:[],gaps:[]},d);
  if(snapshot.mediaIdentity!==reviewMediaIdentity(root,d))throw Error('媒体文件已变化，请重新提交');
  const shot=d.productionPlan?.shots?.find(s=>s.id===n.anchor.shotId&&!s.cancelled);
  if(!shot||shot.locked)throw Error('这段计划已删除或锁定');
  const response=await createJob({projectId,revision,kind:'revise',shotId:shot.id,...(n.anchor.rangeId?{rangeId:n.anchor.rangeId}:{}),instructions:n.text+'\n审片位置：'+(n.anchor.frame/n.anchor.fps).toFixed(3)+'秒。仅修改本镜头，保留其余内容。',scope:{camera:false,sound:false,footage:true}});
  n.jobId=response.job.id;n.status='delegated';persist(n);return {...response,note:n};
 }
 function finish(projectId,id,status){const n=get(projectId,id);if(status==='verified'&&n.status!=='applied')throw Error('应用后才能标记复核通过');if(!['verified','dismissed'].includes(status)||['running','queued'].includes(n.status))throw Error('请先停止任务');n.status=status;return persist(n);}
 return {add,run,get,list,accept,revert,cancel,finish,directory,delegate};
}
