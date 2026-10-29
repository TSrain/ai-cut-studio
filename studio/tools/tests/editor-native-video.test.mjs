import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {planNativeVideo,runNativeVideo,probeNativeVideo} from '../lib/editor-native-video.mjs';
const root=mkdtempSync(join(tmpdir(),'native-video-test-'));
process.on('exit',()=>rmSync(root,{recursive:true,force:true}));
writeFileSync(join(root,'fixture.mp4'),'stub');
const doc=()=>({canvas:{width:64,height:36,fps:{num:30,den:1},durationFrames:300},instances:[{id:'clip',assetId:'source-pip',startFrame:20,durationFrames:30,props:{sourceMode:'media',media:{kind:'video',publicPath:'fixture.mp4',width:64,height:36,durationSeconds:1,startSeconds:0},crop:{x:0,y:0,width:1,height:1,sourceAspect:64/36},size:100*64/36,x:50,y:50,radius:0,borderWidth:0,shadow:0,entrance:'none',exit:'none',transitionSeconds:0,editorBackground:'transparent'}}]});
const item=()=>({renderMode:'instances',instanceId:'clip',rangeStartFrame:20,durationFrames:30,extension:'mp4'});
const metadata=()=>({streams:[{codec_type:'video',codec_name:'h264',width:64,height:36,pix_fmt:'yuv420p',sample_aspect_ratio:'1:1',avg_frame_rate:'30/1',r_frame_rate:'30/1',time_base:'1/15360',start_time:'0',nb_frames:'30'}],frames:Array.from({length:30},(_,i)=>({best_effort_timestamp_time:String(i/30)}))});
const plan=(d=doc(),i=item(),data=metadata())=>planNativeVideo(d,i,{publicRoot:root,probe:()=>data});
test('full matching MP4 copies; MOV retains alpha encoding contract',()=>{
 assert.equal(plan().method,'copy');assert.equal(plan().muted,true);
 assert.equal(plan(doc(),{...item(),extension:'mov'}).method,'transcode');
});
test('frame trim transcodes, while source exhaustion and freeze are rejected',()=>{
 const d=doc();d.instances[0].props.media.startSeconds=5/30;d.instances[0].durationFrames=20;
 const p=plan(d,{...item(),durationFrames:20});assert.equal(p.startFrame,5);assert.equal(p.method,'transcode');
 d.instances[0].durationFrames=30;assert.equal(plan(d),null);
});
test('unsupported rendering and visual semantics always fall back',()=>{
 for(const edit of [
 d=>d.instances[0].props.sceneBackground={type:'solid',color:'red'},
 d=>d.instances[0].props.crop.width=.9,
 d=>d.instances[0].props.size=100,
 d=>d.instances[0].props.radius=1,
 d=>d.instances[0].props.borderWidth=1,
 d=>d.instances[0].props.shadow=1,
 d=>d.instances[0].props.entrance='fade',
 d=>d.instances[0].props.exit='expand',
 d=>d.instances[0].props.editorBackground='scene',
 d=>d.instances[0].props.opacity=.5,
 d=>d.instances[0].props.sourceMode='source',
 d=>d.instances[0].props.media.kind='image',
 d=>d.instances.push(structuredClone(d.instances[0])),
 ]) {const d=doc();edit(d);assert.equal(plan(d),null);}
 for(const mode of ['full','clip','layer'])assert.equal(plan(doc(),{...item(),renderMode:mode}),null);
 assert.equal(plan(doc(),{...item(),rangeStartFrame:19}),null);
});
test('rotation, SAR, HDR, VFR, missing timestamps and wrong true dimensions are rejected',()=>{
 for(const edit of [
 s=>s.tags={rotate:'90'},s=>s.side_data_list=[{rotation:90}],s=>s.sample_aspect_ratio='4:3',
 s=>s.color_transfer='smpte2084',s=>s.color_primaries='bt2020',s=>s.width=128,
 s=>s.r_frame_rate='60/1',s=>s.pix_fmt='yuva444p10le',s=>s.start_time='0.1',
 ]){const data=metadata();edit(data.streams[0]);assert.equal(plan(doc(),item(),data),null);}
 const data=metadata();data.frames[15].best_effort_timestamp_time='0.52';assert.equal(plan(doc(),item(),data),null);
 delete data.frames;assert.equal(plan(doc(),item(),data),null);
 const tail=metadata();tail.frames.at(-1).pkt_duration_time='0.1';assert.equal(plan(doc(),item(),tail),null);
});
test('path confinement resolves symlinks, disallows traversal and absolute paths',()=>{
 symlinkSync('/etc/hosts',join(root,'escape.mp4'));
 for(const publicPath of ['../fixture.mp4','/etc/hosts','escape.mp4','https://example.com/a.mp4']){const d=doc();d.instances[0].props.media.publicPath=publicPath;assert.equal(plan(d),null);}
});
test('real ffmpeg: copy removes audio and exact trimmed MOV has alpha plus expected frame count',async()=>{
 execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=size=64x36:rate=30:duration=1','-f','lavfi','-i','sine=frequency=1000:duration=1','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',join(root,'real.mp4')]);
 const d=doc();d.instances[0].props.media.publicPath='real.mp4';
 const p=planNativeVideo(d,item(),{publicRoot:root});assert.ok(p);assert.equal(p.method,'copy');
 const mp4=join(root,'copied.mp4');writeFileSync(mp4,'stale partial output');await runNativeVideo(p,{outputPath:mp4});
 const copyResult=await runNativeVideo(p,{outputPath:mp4,hardwareAcceleration:'if-possible'}); // MP4 is unchanged.
 assert.equal(copyResult.codec,'h264');
 const copied=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',mp4],{encoding:'utf8'}));
 assert.equal(copied.streams.length,1);assert.equal(Number(copied.streams[0].nb_frames),30);
 d.instances[0].props.media.startSeconds=5/30;d.instances[0].durationFrames=12;
 const movPlan=planNativeVideo(d,{...item(),durationFrames:12,extension:'mov'},{publicRoot:root});assert.ok(movPlan);
 const mov=join(root,'alpha.mov'),progress=[];await runNativeVideo(movPlan,{outputPath:mov,onProgress:p=>progress.push(p)});
 const hwProgress=[];const hwPath=join(root,'optional-hardware.mov');
 const hwResult=await runNativeVideo(movPlan,{outputPath:hwPath,hardwareAcceleration:'if-possible',onProgress:p=>hwProgress.push(p)});
 assert.ok(['prores_ks','prores_videotoolbox'].includes(hwResult.codec));
 if(hwResult.hardwareFallback){assert.equal(hwResult.codec,'prores_ks');assert.ok(hwProgress.some(p=>p.hardwareFallback&&p.encodedFrames===0));assert.match(hwResult.fallbackReason,/failed/);}
 const hwMeta=probeNativeVideo(hwPath);assert.match(hwMeta.streams[0].pix_fmt,/^yuva444/);assert.equal(hwMeta.frames.length,12);
 const out=probeNativeVideo(mov);assert.equal(out.streams[0].codec_name,'prores');assert.match(out.streams[0].pix_fmt,/^yuva444/);assert.equal(out.frames.length,12);
 const gray=(path,frame)=>execFileSync('ffmpeg',['-v','error','-i',path,'-vf',`select=eq(n\\,${frame}),format=gray`,'-frames:v','1','-f','rawvideo','pipe:1']);
 const actual=gray(mov,0),expected=gray(join(root,'real.mp4'),5);assert.equal(actual.length,expected.length);assert.ok(actual.reduce((sum,byte,i)=>sum+Math.abs(byte-expected[i]),0)/actual.length<3,'first output frame must correspond to source frame 5');
 assert.equal(progress.at(-1).encodedFrames,12);assert.equal(progress.at(-1).stage,'encoding');
 const alpha=execFileSync('ffmpeg',['-v','error','-i',mov,'-vf','alphaextract,format=gray','-frames:v','1','-f','rawvideo','pipe:1']);assert.ok(alpha.every(byte=>byte===255));
 // A copied H.264 stream decodes identically to its source.
 const hash=path=>execFileSync('ffmpeg',['-v','error','-i',path,'-map','0:v:0','-f','framemd5','pipe:1'],{encoding:'utf8'}).split('\n').filter(line=>!line.startsWith('#')).join('\n');assert.equal(hash(mp4),hash(join(root,'real.mp4')));
 await assert.rejects(runNativeVideo(movPlan,{outputPath:join(root,'wrong.mp4')}),/extension/);
 const failedOutput=join(root,'retry-failure.mov');writeFileSync(failedOutput,'previous output');
 await assert.rejects(runNativeVideo({...movPlan,inputPath:join(root,'fixture.mp4')},{outputPath:failedOutput}),/failed/);
 assert.equal(readFileSync(failedOutput,'utf8'),'previous output');assert.ok(readdirSync(root).every(name=>!name.includes('.native-')));
});
