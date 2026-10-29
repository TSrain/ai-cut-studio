import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createDocument} from '../studio/tools/lib/editor-store.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const base=process.env.STUDIO_URL||'http://127.0.0.1:4321';
if(!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(base))throw Error('Smoke test requires a loopback editor URL');
const id='smoke-'+randomUUID(),dir=join(root,'studio/workspace',id);
mkdirSync(dir,{recursive:true});
const video=join(dir,'synthetic.mp4'),srt=join(dir,'synthetic.srt');
execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=640x360:r=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',video]);
writeFileSync(srt,'1\n00:00:00,000 --> 00:00:02,000\nSynthetic test, not recorded speech.\n');
execFileSync('python3',[join(root,'workflow/tools/transcribe.py'),'--audio',video,'--source-srt',srt,'--out',join(dir,'transcript')],{env:{...process.env,TRANSCRIBE_PROVIDER:'',TRANSCRIPT_CACHE_ROOT:join(dir,'cache')}});
async function request(path,body,headers={}){
 const response=await fetch(base+'/api/editor/'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?headers:{'content-type':'application/json',...headers},body:body===undefined?undefined:Buffer.isBuffer(body)?body:JSON.stringify(body)});
 const value=await response.json();if(!response.ok)throw Error(JSON.stringify(value));return value;
}
const media=await request('import?kind=video',readFileSync(video),{'content-type':'application/octet-stream','x-editor-import':'1','x-filename':'synthetic.mp4'});
const document=createDocument({id,name:'Synthetic smoke test',canvas:media.canvas,source:{path:media.path,publicPath:media.publicPath,startFrame:0,durationFrames:media.canvas.durationFrames}});
await request('save',{document});
const job=await request('export',{documentId:id,mode:'full',fps:30,planAcknowledged:true});
const deadline=Date.now()+120000;
while(Date.now()<deadline){
 const state=await request('job?id='+encodeURIComponent(job.id));
 if(state.status==='complete'){
  const path=state.items[0].path;
  const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',path],{encoding:'utf8'}));
  const stream=probe.streams.find(s=>s.codec_type==='video');
  if(stream.width!==640||stream.height!==360||Math.abs(Number(probe.format.duration)-2)>.15)throw Error('Export geometry or duration changed');
  if(!probe.streams.some(s=>s.codec_type==='audio'))throw Error('Original audio was lost');
  execFileSync('ffmpeg',['-v','error','-xerror','-i',path,'-f','null','-']);
  console.log(JSON.stringify({projectId:id,export:path,width:stream.width,height:stream.height,duration:probe.format.duration,decoded:true},null,2));
  process.exit(0);
 }
 if(['failed','cancelled','interrupted'].includes(state.status))throw Error(JSON.stringify(state));
 await new Promise(resolve=>setTimeout(resolve,1000));
}
throw Error('Export timeout; inspect the project job before retrying');
