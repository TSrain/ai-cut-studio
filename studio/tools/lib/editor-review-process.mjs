import {spawn} from 'node:child_process';
export function reviewProcess(command,args,{cwd,input='',signal,timeout=900000,onData=()=>{}}={}){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted)return reject(Error('任务已取消'));
  const child=spawn(command,args,{cwd,env:process.env,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']});let tail='',done=false,killTimer;
  const stop=()=>{try{process.kill(-child.pid,'SIGTERM');}catch{child.kill('SIGTERM');}killTimer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},3000);killTimer.unref();};
  const finish=error=>{if(done)return;done=true;clearTimeout(timer);clearTimeout(killTimer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(tail);};
  const abort=()=>{stop();};signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>{stop();},timeout);let timedOut=false;
  const timeoutFlag=setTimeout(()=>{timedOut=true;},timeout);timeoutFlag.unref();
  const capture=b=>{const text=b.toString();tail=(tail+text).slice(-16000);onData(text);};
  child.stdout.on('data',capture);child.stderr.on('data',capture);child.stdin.on('error',()=>{});
  child.on('error',error=>{clearTimeout(timeoutFlag);finish(error);});
  child.on('close',code=>{clearTimeout(timeoutFlag);finish(signal?.aborted?Error('任务已取消'):timedOut?Error('后台任务超时，可重试'):code===0?null:Error(tail.slice(-1200)||`后台进程退出 ${code}`));});
  child.stdin.end(input);
 });
}
