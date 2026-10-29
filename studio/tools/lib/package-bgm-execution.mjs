import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync,realpathSync} from 'node:fs';
import {join,extname,sep,isAbsolute} from 'node:path';
import {execFileSync} from 'node:child_process';
import {isDeepStrictEqual as equal} from 'node:util';
import {safeMusicUrl} from './bgm-plan-model.mjs';
const digest=v=>createHash('sha256').update(Buffer.isBuffer(v)?v:JSON.stringify(v)).digest('hex');
const fail=message=>{throw Error(`BGM execution: ${message}`);};
const text=v=>typeof v==='string'&&Boolean(v.trim());
const int=(v,min=0)=>Number.isSafeInteger(v)&&v>=min;
const appOf=d=>d.styleReference?.allowedOverrides?.bgmApplication;
function status(document,runId,status,gaps,clips=[]){document.productionPlan.bgmExecution={version:1,runId,status,gaps,clipIds:clips.map(c=>c.id),audition:'not_listened'};return document;}
/** Called only inside the package queue; the queue owns CAS and durable readback. */
export function applyPackageBgmExecution(document,value,{root,outputRoot,runId,files,protectedShotIds=new Set(),renamed=new Map()}){
 const execution=value.execution;
 if(execution?.version!==1||!Array.isArray(execution.assets)||!Array.isArray(execution.clips)||!Array.isArray(execution.gaps)||!execution.searchAudit)fail('missing versioned execution payload');
 const prior=appOf(document),fingerprint=digest(execution);
 if(prior){
  const baseline=prior.baseline,ownedClips=new Set((baseline?.clips??[]).map(c=>c.id)),ownedTracks=new Set((baseline?.tracks??[]).map(t=>t.id));
  const sameShots=equal([...(prior.reviewedShotIds??prior.clips?.flatMap(c=>c.shotIds)??[])].filter((id,i,all)=>all.indexOf(id)===i).sort(),value.sections.map(s=>s.id).sort());
  const unchanged=prior.version===1&&text(prior.runId)&&/^[a-f0-9]{64}$/.test(prior.executionSha256??'')&&Array.isArray(baseline?.clips)&&Array.isArray(baseline?.tracks)&&
   Array.isArray(prior.clips)&&prior.clips.length===baseline.clips.length&&prior.clips.every(c=>ownedClips.has(c.clipId))&&
   baseline.clips.every(c=>equal(c,(document.audioClips??[]).find(x=>x.id===c.id)))&&
   baseline.tracks.every(t=>!t.locked&&!t.disabled&&!t.hidden&&equal(t,(document.audioTracks??[]).find(x=>x.id===t.id)))&&
   !(document.audioClips??[]).some(c=>ownedTracks.has(c.trackId)&&!ownedClips.has(c.id));
  if((document.audioTracks??[]).some(t=>!ownedTracks.has(t.id)&&/bgm|配乐|音乐/i.test(t.name)))return status(document,runId,'protected',['Additional manual music tracks preserved together with existing automatic BGM']);
  if(unchanged&&sameShots&&prior.runId===runId&&prior.executionSha256===fingerprint)return status(document,runId,prior.status??'applied',prior.gaps??[],baseline.clips);
  if(!unchanged||!sameShots||protectedShotIds.size)return status(document,runId,'protected',['Existing BGM application, edits or deletions preserved']);
  // Only proven automatic ownership may be replaced; unrelated audio stays in place.
  document.audioClips=(document.audioClips??[]).filter(c=>!ownedClips.has(c.id));
  document.audioTracks=(document.audioTracks??[]).filter(t=>!ownedTracks.has(t.id));
 }
 if((document.audioTracks??[]).some(t=>/bgm|配乐|音乐/i.test(t.name)))return status(document,runId,'protected',['Existing music tracks without an automatic baseline preserved']);
 const fps=document.canvas.fps.num/document.canvas.fps.den,shots=new Map(document.productionPlan.shots.map(s=>[s.id,s]));
 const assets=new Map(),cacheRoot=realpathSync(join(root,'templates/remotion-base/public')),output=realpathSync(outputRoot),dir=join(cacheRoot,'editor-audio');
 mkdirSync(dir,{recursive:true});if(!realpathSync(dir).startsWith(cacheRoot+sep))fail('audio cache escapes public root');
 for(const asset of execution.assets){
  if(!text(asset.recommendationId)||assets.has(asset.recommendationId)||(asset.attributionRequired!==false&&!text(asset.credit))||!safeMusicUrl(asset.licenseUrl)||!safeMusicUrl(asset.sourceUrl)||!isAbsolute(asset.path??'')||!Number.isFinite(asset.sourceDurationSeconds)||asset.sourceDurationSeconds<=0)fail('invalid asset or attribution');
  const rec=value.recommendations.find(r=>r.id===asset.recommendationId);
  if(!rec||rec.licenseStatus!=='verified'||!safeMusicUrl(rec.licenseUrl))fail('asset requires verified recommendation license');
  const path=realpathSync(asset.path);let extension=extname(path).toLowerCase();
  if(!path.startsWith(output+sep)||!['.wav','.mp3','.m4a','.aac','.ogg','.flac','.aiff','.opus','.audio'].includes(extension))fail('asset outside bounded output or unsupported audio');
  if(!files.some(f=>realpathSync(f.path)===path&&f.sha256===asset.sha256))fail('asset is not bound to operation files');
  const bytes=readFileSync(path);if(!/^[a-f0-9]{64}$/.test(asset.sha256??'')||digest(bytes)!==asset.sha256)fail('asset SHA mismatch');
  if(extension==='.audio'){
   const sourceProbe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_format','-of','json',path],{encoding:'utf8',timeout:30000}));
   const format=sourceProbe.format?.format_name?.split(',')??[];
   extension=format.includes('wav')?'.wav':format.includes('mp3')?'.mp3':format.includes('flac')?'.flac':format.includes('ogg')?'.ogg':format.includes('aac')?'.aac':format.includes('mov')||format.includes('mp4')?'.m4a':null;
   if(!extension)fail('unsupported downloaded audio container');
  }
  const publicPath=`editor-audio/${asset.sha256}${extension}`,destination=join(cacheRoot,publicPath);
  if(existsSync(destination)){if(!realpathSync(destination).startsWith(cacheRoot+sep)||digest(readFileSync(destination))!==asset.sha256)fail('audio cache integrity mismatch');}
  else writeFileSync(destination,bytes,{flag:'wx'});
  const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',destination],{encoding:'utf8',timeout:30000}));
  const duration=Number(probe.format?.duration);
  if(!probe.streams?.some(s=>s.codec_type==='audio')||!Number.isFinite(duration)||duration<=0||Math.abs(duration-asset.sourceDurationSeconds)>Math.max(.1,1/fps))fail('audio source duration mismatch');
  execFileSync('ffmpeg',['-v','error','-xerror','-i',destination,'-map','0:a:0','-f','null','-'],{timeout:120000,stdio:['ignore','ignore','pipe']});
  assets.set(asset.recommendationId,{...structuredClone(asset),recommendationId:renamed.get(asset.recommendationId)??asset.recommendationId,path:`templates/remotion-base/public/${publicPath}`,publicPath,originalPath:path,sourceDurationFrames:Math.floor(duration*fps),technical:'decoded'});
 }
 const clips=[],clipMetadata=[],tracks=[],ends=[],gaps=structuredClone(execution.gaps),seen=new Set();
 const trackPrefix=`bgm-${digest(runId).slice(0,16)}`;
 for(const proposed of [...execution.clips].sort((a,b)=>a.startFrame-b.startFrame)){
  if(!text(proposed.id)||seen.has(proposed.id)||!Array.isArray(proposed.shotIds)||!proposed.shotIds.length||new Set(proposed.shotIds).size!==proposed.shotIds.length||!text(proposed.method))fail('invalid clip identity or method');seen.add(proposed.id);
  const asset=assets.get(proposed.assetId);if(!asset)fail('clip asset missing');
  if(!['startFrame','sourceInFrame','fadeInFrames','fadeOutFrames'].every(k=>int(proposed[k]))||!int(proposed.durationFrames,1)||!Number.isFinite(proposed.volume)||proposed.volume<=0||proposed.volume>2||!['fadeInCurve','fadeOutCurve'].every(k=>['linear','smooth','equalPower'].includes(proposed[k])))fail('invalid clip timing, gain or fade');
  if(proposed.startFrame+proposed.durationFrames>document.canvas.durationFrames||proposed.sourceInFrame+proposed.durationFrames>asset.sourceDurationFrames||proposed.fadeInFrames>proposed.durationFrames||proposed.fadeOutFrames>proposed.durationFrames)fail('clip exceeds project/audio/fade boundaries');
  for(const id of proposed.shotIds){const shot=shots.get(id);if(!shot||shot.requirementVersion!==proposed.requirementVersions?.[id])fail('clip semantic version changed');}
  if(proposed.shotIds.some(id=>protectedShotIds.has(id)||shots.get(id).cancelled||shots.get(id).locked||shots.get(id).manual)){gaps.push(`Protected BGM shots: ${proposed.shotIds.join(', ')}`);continue;}
  if(proposed.shotIds.some(id=>shots.get(id).bgmDesign?.decision!=='music'||!shots.get(id).bgmDesign.recommendationIds?.includes(asset.recommendationId)))fail('clip conflicts with music/silence decision');
  let lane=ends.findIndex(end=>end<=proposed.startFrame);if(lane<0){lane=ends.length;ends.push(0);const id=`${trackPrefix}-${lane}`;if((document.audioTracks??[]).some(t=>t.id===id))fail('automatic track ID collision');tracks.push({id,name:lane?'配乐 · 自动 '+(lane+1):'配乐 · 自动'});}ends[lane]=proposed.startFrame+proposed.durationFrames;
  const clip={id:`bgm-${digest([runId,proposed.id]).slice(0,24)}`,name:`待试听 · ${value.recommendations.find(r=>r.id===proposed.assetId)?.title??proposed.assetId}`,path:asset.path,publicPath:asset.publicPath,originalPath:asset.originalPath,trackId:tracks[lane].id,startFrame:proposed.startFrame,durationFrames:proposed.durationFrames,sourceInFrame:proposed.sourceInFrame,sourceDurationFrames:asset.sourceDurationFrames,volume:proposed.volume,fadeInFrames:proposed.fadeInFrames,fadeOutFrames:proposed.fadeOutFrames,fadeInCurve:proposed.fadeInCurve,fadeOutCurve:proposed.fadeOutCurve};
  if((document.audioClips??[]).some(c=>c.id===clip.id))fail('automatic clip ID collision');clips.push(clip);clipMetadata.push({...structuredClone(proposed),clipId:clip.id,assetId:asset.recommendationId,shotTimings:Object.fromEntries(proposed.shotIds.map(id=>[id,structuredClone(shots.get(id).timing??null)]))});
 }
 for(const row of value.sections)if(row.bgmDesign.decision==='music'&&!clipMetadata.some(c=>c.shotIds.includes(row.id)))gaps.push(`Music not applied for shot ${row.id}`);
 const applicationStatus=gaps.length?'partial':'applied';
 document.audioClips=[...(document.audioClips??[]),...clips];document.audioTracks=[...(document.audioTracks??[]),...tracks];
 document.styleReference.allowedOverrides.bgmApplication={version:1,runId,reviewedShotIds:value.sections.map(s=>s.id),status:applicationStatus,executionSha256:fingerprint,clips:clipMetadata,assets:[...assets.values()],credit:[...new Set([...assets.values()].map(a=>a.credit))],searchAudit:structuredClone(execution.searchAudit),gaps,baseline:{clips:structuredClone(clips),tracks:structuredClone(tracks)},audition:'not_listened'};
 return status(document,runId,applicationStatus,gaps,clips);
}
/** Metadata and playable clips form one atomic unit; a stale timebase must be replanned. */
export function assertBgmReconciliation(base,current){
 const timeline=d=>{const s=d.source??{};return (s.clips??[{startFrame:0,sourceInFrame:s.startFrame??0,durationFrames:s.durationFrames??d.canvas.durationFrames}]).map(c=>({startFrame:c.startFrame,sourceInFrame:c.sourceInFrame,durationFrames:c.durationFrames,playbackRate:c.playbackRate??c.speed??1,disabled:c.disabled??false}));};
 if(!equal(base.source?.path,current.source?.path)||!equal(timeline(base),timeline(current))||!equal(base.canvas,current.canvas))fail('source timeline changed; regenerate aligned BGM');
 if(!equal(base.audioClips??[],current.audioClips??[])||!equal(base.audioTracks??[],current.audioTracks??[])||!equal(appOf(base),appOf(current)))fail('concurrent audio edits preserved; regenerate BGM');
 for(const old of base.productionPlan.shots){const shot=current.productionPlan.shots.find(s=>s.id===old.id);if(!shot||['bgmDesign','timing','manual','locked','cancelled'].some(k=>!equal(old[k],shot[k])))fail('concurrent BGM shot edits preserved; regenerate BGM');}
}

/** Final receipt may only claim execution while its current saved objects still match. */
export function isPackageBgmApplied(document,runId){
 const execution=document.productionPlan?.bgmExecution,app=appOf(document);
 if(execution?.version!==1||execution.runId!==runId||execution.status!=='applied'||app?.version!==1||app.runId!==runId||app.status!=='applied'||!Array.isArray(app.baseline?.clips)||!Array.isArray(app.baseline?.tracks)||!Array.isArray(app.clips))return false;
 if(!equal(execution.clipIds,app.baseline.clips.map(c=>c.id))||app.clips.length!==app.baseline.clips.length)return false;
 if(app.baseline.clips.some(c=>!equal(c,document.audioClips?.find(x=>x.id===c.id)))||app.baseline.tracks.some(t=>!equal(t,document.audioTracks?.find(x=>x.id===t.id))))return false;
 for(const metadata of app.clips){if(!app.baseline.clips.some(c=>c.id===metadata.clipId)||!metadata.shotIds?.length)return false;for(const id of metadata.shotIds){const shot=document.productionPlan.shots.find(s=>s.id===id);if(!shot||shot.cancelled||shot.requirementVersion!==metadata.requirementVersions?.[id]||!Object.hasOwn(metadata.shotTimings??{},id)||!equal(shot.timing??null,metadata.shotTimings[id])||shot.bgmDesign?.decision!=='music')return false;}}
 return document.productionPlan.shots.every(s=>s.bgmDesign?.decision!=='music'||s.cancelled||app.clips.some(c=>c.shotIds.includes(s.id)));
}
