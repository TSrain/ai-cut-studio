/** Freeze current saved narration without invoking ASR or mutating its document. */
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {verifiedFileDigest} from './verified-file-digest.mjs';
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b?-1:a>b?1:0)):item);
const sha=value=>createHash('sha256').update(value).digest('hex');

function stamp(frame,fps){let ms=Math.round(frame/fps*1000);const h=Math.floor(ms/3600000);ms%=3600000;const m=Math.floor(ms/60000);ms%=60000;const s=Math.floor(ms/1000);ms%=1000;return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;}
function freezeFile(path,value){if(existsSync(path)){if(readFileSync(path,'utf8')!==value)throw new Error('immutable transcript output belongs to another saved document');}else writeFileSync(path,value,{flag:'wx'});}

export function freezeProjectTranscript(document,directory,{sourcePath}={}){
 const {canvas}=document,source=document.source??{},rate=canvas?.fps,fps=typeof rate==='number'?rate:rate?.num/rate?.den;
 if(!Number.isFinite(fps)||fps<=0||!Number.isInteger(canvas.durationFrames)||canvas.durationFrames<=0)throw new Error('Invalid project transcript canvas');
 const actualSource=resolve(sourcePath??source.path??'');if(!(sourcePath??source.path)||!existsSync(actualSource))throw new Error('Missing actual project transcript source');
 const clips=source.clips??[{startFrame:0,durationFrames:source.durationFrames??canvas.durationFrames}];
 const intervals=clips.filter(c=>!c.disabled).map(c=>[Math.max(0,c.startFrame),Math.min(canvas.durationFrames,c.startFrame+c.durationFrames)]).filter(([a,b])=>b>a).sort(([a],[b])=>a-b);
 const savedCues=document.captions?.cues??[];const cues=[];
 for(const cue of [...savedCues].sort((a,b)=>a.startFrame-b.startFrame)){
  if(typeof cue.text!=='string'||!cue.text.trim())continue;
  if(!Number.isInteger(cue.startFrame)||!Number.isInteger(cue.endFrame)||cue.endFrame<=cue.startFrame)throw new Error('Invalid saved caption timing');
  const portions=intervals.map(([a,b])=>[Math.max(a,cue.startFrame),Math.min(b,cue.endFrame)]).filter(([a,b])=>b>a);
  if(portions.length)cues.push({startFrame:Math.min(...portions.map(x=>x[0])),endFrame:Math.max(...portions.map(x=>x[1])),text:cue.text,captionId:cue.id??null});
 }
 if(!cues.length)throw new Error('最新工程没有可用字幕；先保存字幕，不重跑 ASR');
 const srt=cues.map((c,i)=>`${i+1}\n${stamp(c.startFrame,fps)} --> ${stamp(c.endFrame,fps)}\n${c.text}`).join('\n\n')+'\n';
 const sourceSha256=verifiedFileDigest(actualSource),transcriptSha256=sha(srt);
 const provenance={schemaVersion:1,timeBase:'project',origin:'saved-document-captions',projectId:document.id,documentRevision:document.revision,sourcePath:actualSource,sourceSha256,sourceClipsSha256:sha(canonical(source.clips??null)),captionsSha256:sha(canonical(savedCues)),projectDurationSeconds:canvas.durationFrames/fps,srtSha256:transcriptSha256,cues};
 const target=resolve(directory),sourceSrtPath=join(target,'project-transcript.srt'),transcriptProvenancePath=join(target,'project-transcript.json');
 mkdirSync(target,{recursive:true});freezeFile(sourceSrtPath,srt);freezeFile(transcriptProvenancePath,JSON.stringify(provenance,null,2)+'\n');
 return {script:'## 完整口播脚本\n\n'+cues.map(c=>c.text).join('\n'),sourceSrtPath,transcriptTimeBase:'project',transcriptProvenancePath,transcriptBinding:{sourceSha256,transcriptSha256}};
}
