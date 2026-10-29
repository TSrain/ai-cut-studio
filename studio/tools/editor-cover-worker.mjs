#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {createWriteStream,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {readJob,writeJob,coverWorkerArgs,coverPrompt,newCoverRuns} from './lib/editor-cover-jobs.mjs';
import {listProjectCovers} from './lib/editor-covers.mjs';
const dir=resolve(process.argv[2]),job=readJob(dir);
job.workerPid=process.pid;writeJob(dir,job);
const task=JSON.parse(readFileSync(join(dir,'request.json'),'utf8'));
const prompt=coverPrompt({...job,episode:task.episode});writeFileSync(join(dir,'prompt.md'),prompt);
const events=createWriteStream(join(dir,'events.jsonl')),errors=createWriteStream(join(dir,'stderr.log'));
let buffer='',failure='',lastSave=0;
const update=()=>{if(Date.now()-lastSave>1000){writeJob(dir,job);lastSave=Date.now();}};
try{
 const child=spawn(job.cli,coverWorkerArgs({...job,dir}),{cwd:job.workflowRoot,stdio:['pipe','pipe','pipe']});
 const timer=setTimeout(()=>{failure='制作超过 90 分钟，任务已停止；已有候选保留。';child.kill('SIGTERM');},90*60*1000);
 child.stdout.on('data',chunk=>{
  events.write(chunk);buffer+=chunk;
  const lines=buffer.split('\n');buffer=lines.pop();
  for(const line of lines){try{
   const event=JSON.parse(line),item=event.item??{};
   if(event.type==='thread.started')job.threadId=event.thread_id;
   if(event.type==='turn.failed')failure=event.error?.message||'封面制作失败';
   if(item.type==='agent_message'){
    const text=item.text||'';
    if(/校验|检查|目检|复查/.test(text))job.stage='检查封面';
    else if(/生成|制作/.test(text))job.stage='生成封面';
    else if(/读取|参考|原稿/.test(text))job.stage='阅读原稿与参考';
   }
   update();
  }catch{}}
 });
 child.stderr.on('data',chunk=>errors.write(chunk));
 child.stdin.on('error',()=>{});child.stdin.end(prompt);
 const code=await new Promise((done,fail)=>{child.once('error',fail);child.once('close',done);}).finally(()=>clearTimeout(timer));
 if(code!==0||failure)throw Error(failure||`后台任务退出（${code}），详情保存在任务日志。`);
 const listing=listProjectCovers(task.document,{coversRoot:join(job.workflowRoot,'workspace/covers'),artifactRoot:job.artifactRoot,source:job.source});
 const ready=newCoverRuns(listing,job);
 if(!ready.length)throw Error('任务已结束，但没有新增通过完整校验的封面候选。请检查原稿或任务日志后重试。');
 job.status='completed';job.stage='候选待选择';job.runIds=ready.map(x=>x.id);
}catch(e){job.status='failed';job.error=e.message;}
finally{job.finishedAt=Date.now();writeJob(dir,job);events.end();errors.end();}
