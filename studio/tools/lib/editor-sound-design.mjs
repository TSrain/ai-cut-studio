import {createHash} from 'node:crypto';
import {readFileSync,mkdirSync,copyFileSync,existsSync,realpathSync} from 'node:fs';
import {join,extname,sep,isAbsolute} from 'node:path';
import {execFileSync} from 'node:child_process';
const digest=v=>createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:JSON.stringify(v)).digest('hex');
const safeId=v=>{if(typeof v!=='string'||!/^sfx-[a-zA-Z0-9_-]{1,65}$/.test(v))throw Error('Invalid sound cue ID');};
const finite=(v,min,max)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw Error('Invalid sound timing/gain');return v;};
/** Input is already semantically resolved by broll using existing transcription, not ASR. */
export function stageSoundDesign(manifest,document,{root}){
 if(manifest.version!==1||manifest.projectId!==document.id||!Array.isArray(manifest.cues))throw Error('Sound manifest/project mismatch');
 const fps=document.canvas.fps.num/document.canvas.fps.den;
 if(manifest.fps!==fps||manifest.durationFrames!==document.canvas.durationFrames)throw Error('Sound plan timebase changed; realign');
 if(!/^[a-f0-9]{64}$/.test(manifest.planSha256??''))throw Error('Missing approved sound plan hash');
 if(!isAbsolute(manifest.planPath??''))throw Error('Missing approved plan path');
 const planBytes=readFileSync(manifest.planPath);if(digest(planBytes)!==manifest.planSha256)throw Error('Sound plan hash changed');
 const plan=JSON.parse(planBytes);if(plan.soundDesignVersion!==1)throw Error('Missing approved sound design v1');
 const authored=new Map();for(const shot of plan.shots??[])for(const cue of shot.soundDesign?.cues??[]){if(authored.has('sfx-'+cue.id))throw Error('Duplicate approved sound ID');authored.set('sfx-'+cue.id,cue);}
 const publicRoot=realpathSync(join(root,'templates/remotion-base/public')),dir=join(publicRoot,'editor-audio');mkdirSync(dir,{recursive:true});
 if(!realpathSync(dir).startsWith(publicRoot+sep))throw Error('Audio cache escapes public');
 const ids=new Set();
 return manifest.cues.map(c=>{
  safeId(c.id);if(ids.has(c.id))throw Error('Duplicate sound cue');ids.add(c.id);
  const approved=authored.get(c.id);if(!approved||['intent','anchor','event'].some(k=>approved[k]!==c[k]))throw Error('Cue differs from approved sound intent');
  if(typeof c.name!=='string'||!c.name.trim()||!c.intent||!c.anchor||!c.event||!c.timingEvidence)throw Error('Sound cue needs intent/anchor/event/timingEvidence');
  if(!['reviewed','draft'].includes(c.audition))throw Error('Mark audition reviewed or draft, never imply listening');
  if(!isAbsolute(c.file??''))throw Error('Sound file must be absolute');
  const file=realpathSync(c.file),extension=extname(file).toLowerCase();if(!['.wav','.mp3','.m4a','.aac','.ogg','.flac','.aiff'].includes(extension))throw Error('Unsupported sound file');
  const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file],{encoding:'utf8',timeout:30000}));
  if(!probe.streams?.some(s=>s.codec_type==='audio'))throw Error('Missing audio stream');
  const duration=Number(probe.format.duration);finite(duration,0.001,36000);
  const sourceDurationFrames=Math.floor(duration*fps),startFrame=Math.round(finite(c.startSeconds,0,document.canvas.durationFrames/fps)*fps),sourceInFrame=Math.round(finite(c.sourceInSeconds??0,0,duration)*fps);
  const durationFrames=Math.round(finite(c.durationSeconds,1/fps,duration)*fps);
  if(startFrame+durationFrames>document.canvas.durationFrames||sourceInFrame+durationFrames>sourceDurationFrames)throw Error('Sound cue exceeds timeline/source; explicitly trim tail');
  const bytes=readFileSync(file),sha=digest(bytes),publicPath=`editor-audio/${sha}${extension}`,destination=join(publicRoot,publicPath);
  if(existsSync(destination)){if(!realpathSync(destination).startsWith(publicRoot+sep)||digest(readFileSync(destination))!==sha)throw Error('Audio cache integrity mismatch');}else copyFileSync(file,destination);
  const gain=finite(c.gainDb??-18,-60,0),fade=seconds=>Math.min(durationFrames,Math.round(finite(seconds??0,0,duration)*fps));
  return {id:c.id,name:`${c.audition==='draft'?'待试听 · ':''}${c.name}`,path:`templates/remotion-base/public/${publicPath}`,publicPath,originalPath:file,startFrame,durationFrames,sourceInFrame,sourceDurationFrames,volume:10**(gain/20),muted:c.muted===true,fadeInFrames:fade(c.fadeInSeconds),fadeOutFrames:fade(c.fadeOutSeconds??.04),trackId:c.id};
 });
}
/** CAS happens at API save. Preserve manual edits, deletion tombstones and track locks. */
export function mergeSoundDesign(document,clips){
 const d=structuredClone(document);d.audioClips??=[];d.audioTracks??=[];d.styleReference??={};d.styleReference.allowedOverrides??={};
 const prior=d.styleReference.allowedOverrides.soundDesign??{baselines:{}};
 const baselines={...prior.baselines},protectedEdits=[],seen=new Set();
 for(const clip of clips){safeId(clip.id);if(seen.has(clip.id))throw Error('Duplicate sound cue');seen.add(clip.id);
  const index=d.audioClips.findIndex(c=>c.id===clip.id),old=d.audioClips[index],oldHash=baselines[clip.id],track=d.audioTracks.find(t=>t.id===(old?.trackId??clip.trackId));
  if(track?.locked||track?.disabled||(old&&(!oldHash||digest(old)!==oldHash))||(!old&&oldHash)){protectedEdits.push(clip.id);continue;}
  if(!track)d.audioTracks.push({id:clip.trackId,name:'音效 · '+clip.name});
  if(old)d.audioClips[index]=clip;else d.audioClips.push(clip);baselines[clip.id]=digest(clip);
 }
 d.audioClips=d.audioClips.filter(c=>{
  if(!baselines[c.id]||seen.has(c.id))return true;
  const track=d.audioTracks.find(t=>t.id===c.trackId);
  if(track?.locked||track?.disabled||digest(c)!==baselines[c.id]){protectedEdits.push(c.id);return true;}
  delete baselines[c.id];return false;
 });
 d.styleReference.allowedOverrides.soundDesign={...prior,baselines};
 return {document:d,protectedEdits};
}
