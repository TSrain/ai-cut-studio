import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {sha256Hex} from '../editor/sha256.mjs';
import {DEFAULT_CAPTION_STYLE} from '../../templates/remotion-base/src/editor/captions.mjs';
import * as model from '../editor/roughcut-model.mjs';
import {jsonEqual,syncPlanHistory} from '../editor/production-plan-sync.mjs';
import {reviewHotkeyCommand,transportReducer,initialTransport,adjacentRow,reviewDecision,isEditingTarget} from '../editor/review-hotkeys.mjs';
import {roughcutSnapPoints,snapToPoints,snapThresholdFrames,adjacentSnapPoint,projectToSourceFrame,sourceToProjectFrame,sourceTrimSnap} from '../editor/roughcut-snap.mjs';
import {textDiff,revisionDiff,revertRevision,reviewableRevisions,patchDurationDelta,formatDurationDelta} from '../editor/revision-diff.mjs';
import {chooseLevel,tilesForRange,buildPeakLevels,createPeakBuilder,visiblePeaks,peakTile,PEAK_LEVELS,TILE_PEAKS} from '../editor/waveform-levels.mjs';
import {getTimelinePeaks,findCachedPcm} from '../lib/editor-timeline-media.mjs';

// ---------- fixtures ----------
const doc=(frames=300)=>({schemaVersion:1,id:'rc',name:'原片',revision:0,canvas:{width:1920,height:1080,fps:{num:30,den:1},durationFrames:frames},source:{path:'voice.mp4',publicPath:'voice.mp4',startFrame:0,durationFrames:frames,clips:[{id:'source-main',name:'主视频',startFrame:0,durationFrames:frames,sourceInFrame:0}]},instances:[],tracks:[],captions:{version:1,enabled:true,style:{...DEFAULT_CAPTION_STYLE},cues:[{id:'c1',startFrame:30,endFrame:150,text:'我不喜欢你',originalText:'我不喜欢你'}]}});
const words=()=>['我','不','喜欢','你'].map((text,i)=>({id:`u${i+1}`,text,startSeconds:i+1,endSeconds:i+2,timing:'word',groupId:'c1'}));
const analysis=(d,extra={})=>({version:1,sourceKey:model.roughcutSourceKey(d),sourceDurationSeconds:10,timing:'word',units:words(),silences:[{startSeconds:5.2,endSeconds:7.6}],decisions:[{id:'remove-no',unitIds:['u2'],action:'delete',kind:'retake',reason:'删除口误',keepUnitIds:[],confidence:0.98}],warnings:[],...extra});
function stable(value){if(value===undefined)return 'null';if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;return JSON.stringify(value);}
const baselineValue=s=>({sourceKey:s.sourceKey,original:s.original,analysis:s.analysis,options:s.options,policy:s.policy});
const resultParts=d=>({source:d.source,fps:d.canvas.fps,durationFrames:d.canvas.durationFrames,captions:d.captions??null});

// ---------- 0. compact fingerprints ----------
test('sha256Hex matches node crypto on ASCII, CJK, emoji and block boundaries',()=>{
 for(const s of ['','abc','粗剪：我不喜欢你🎬','a'.repeat(55),'a'.repeat(56),'a'.repeat(119),'粗'.repeat(5000)])assert.equal(sha256Hex(s),createHash('sha256').update(s).digest('hex'));
});
test('new roughcut state stores constant-size v2 hashes; legacy v1 documents still validate and upgrade on write',()=>{
 const d=doc(),next=model.createRoughcut(d,analysis(d));
 assert.match(next.roughcut.baselineFingerprint,/^roughcut-v2:[0-9a-f]{64}$/);assert.match(next.roughcut.resultFingerprint,/^roughcut-v2:[0-9a-f]{64}$/);
 assert.equal(next.roughcut.baselineFingerprint,'roughcut-v2:'+createHash('sha256').update(stable(baselineValue(next.roughcut))).digest('hex'));
 // Rewrite as an old (v1, exact canonical JSON) document.
 const legacy=structuredClone(next);legacy.roughcut.baselineFingerprint='roughcut-v1:'+stable(baselineValue(legacy.roughcut));legacy.roughcut.resultFingerprint='roughcut-v1:'+stable(resultParts(legacy));
 assert.equal(model.validateRoughcut(legacy.roughcut),true);
 assert.ok(model.roughcutRows(legacy).length>0);
 const tampered=structuredClone(legacy);tampered.roughcut.analysis.units[0].text='篡改';assert.throws(()=>model.validateRoughcut(tampered.roughcut),/粗剪/);
 const forged=structuredClone(legacy);forged.roughcut.baselineFingerprint='roughcut-v1:{}';assert.throws(()=>model.validateRoughcut(forged.roughcut),/粗剪/);
 const unknown=structuredClone(next);unknown.roughcut.baselineFingerprint='roughcut-v3:x';assert.throws(()=>model.validateRoughcut(unknown.roughcut),/粗剪/);
 const id=model.roughcutRows(legacy)[0].id,written=model.setRoughcutCut(legacy,id,{enabled:false});
 assert.match(written.roughcut.baselineFingerprint,/^roughcut-v2:/);assert.equal(model.validateRoughcut(written.roughcut),true);
 assert.ok(JSON.stringify(written).length<JSON.stringify(legacy).length);
});
test('jsonEqual matches JSON.stringify equality for JSON values, ignoring key order',()=>{
 const pairs=[[{a:1,b:undefined},{a:1}],[[1,undefined],[1,null]],[{a:NaN},{a:null}],[{a:[1,{b:2}]},{a:[1,{b:2}]}],[{a:1},{a:2}],[null,undefined],[{},[]],['1',1],[{a:{b:[1,2]}},{a:{b:[1,2,3]}}]];
 for(const [a,b] of pairs)assert.equal(jsonEqual(a,b),JSON.stringify(a)===JSON.stringify(b),JSON.stringify([a,b]));
 assert.equal(jsonEqual({x:1,y:2},{y:2,x:1}),true);
 const h={past:[],present:{id:'p',revision:1,instances:[]},future:[]};
 assert.equal(syncPlanHistory(h,structuredClone(h.present),structuredClone(h.present)),h,'unchanged poll keeps history identity');
});

// ---------- 1. hotkeys ----------
const key=(k,extra={})=>({key:k,code:k==='?'?'Slash':'Key'+k.toUpperCase(),shiftKey:k==='?',metaKey:false,ctrlKey:false,altKey:false,...extra});
test('hotkey map: transport always, review keys only in review, never while typing or with modifiers',()=>{
 assert.equal(reviewHotkeyCommand(key('j')),'transport-j');assert.equal(reviewHotkeyCommand(key('K')),'transport-k');
 assert.equal(reviewHotkeyCommand(key('a')),null);assert.equal(reviewHotkeyCommand(key('a'),{review:true}),'accept');
 const expected={a:'accept',r:'reject',x:'toggle',n:'next',p:'previous',i:'markIn',o:'markOut',s:'split'};
 for(const [k,c] of Object.entries(expected))assert.equal(reviewHotkeyCommand(key(k),{review:true}),c);
 assert.equal(reviewHotkeyCommand(key('?')),'help');
 for(const mod of ['metaKey','ctrlKey','altKey'])assert.equal(reviewHotkeyCommand(key('s',{[mod]:true}),{review:true}),null,mod);
 assert.equal(reviewHotkeyCommand(key('l'),{editing:true}),null);assert.equal(reviewHotkeyCommand(key('a'),{review:true,modal:true}),null);
 assert.equal(reviewHotkeyCommand(key('a',{isComposing:true}),{review:true}),null);
 const fake=(match)=>({closest:sel=>match&&sel.includes(match)?{}:null});
 assert.equal(isEditingTarget(fake('textarea')),true);assert.equal(isEditingTarget(fake('contenteditable')),true);assert.equal(isEditingTarget(fake(null)),false);assert.equal(isEditingTarget(null),false);
});
test('J/K/L state machine: ramps 1x/2x/4x, opposite key slows then reverses, K pauses, K+J/K+L step',()=>{
 let s=initialTransport();const press=(k,repeat=false)=>{const r=transportReducer(s,{type:'down',key:k,repeat});s=r.state;return r.effect;};
 assert.deepEqual(press('l'),{kind:'rate',rate:1});assert.deepEqual(press('l'),{kind:'rate',rate:2});assert.deepEqual(press('l'),{kind:'rate',rate:4});assert.deepEqual(press('l'),{kind:'rate',rate:4});
 assert.equal(press('l',true),null,'auto-repeat never ramps');
 assert.deepEqual(press('j'),{kind:'rate',rate:2});assert.deepEqual(press('j'),{kind:'rate',rate:1});assert.deepEqual(press('j'),{kind:'rate',rate:-1});assert.deepEqual(press('j'),{kind:'rate',rate:-2});assert.deepEqual(press('j'),{kind:'rate',rate:-4});
 assert.deepEqual(press('k'),{kind:'rate',rate:0});assert.equal(s.kHeld,true);
 assert.deepEqual(press('j'),{kind:'step',delta:-1});assert.deepEqual(press('l'),{kind:'step',delta:1});assert.deepEqual(press('l',true),{kind:'step',delta:1},'holding K+L jogs');
 s=transportReducer(s,{type:'up',key:'k'}).state;assert.equal(s.kHeld,false);
 assert.deepEqual(press('j'),{kind:'rate',rate:-1});
 s=transportReducer(s,{type:'stopped'}).state;assert.equal(s.rate,0);assert.deepEqual(press('l'),{kind:'rate',rate:1});
});
test('review navigation and accept/reject/toggle intents respect protection',()=>{
 const rows=[{id:'a',startFrame:10,endFrame:20,enabled:true,safeToEnable:true},{id:'b',startFrame:40,endFrame:50,enabled:false,safeToEnable:false,kind:'complete-take'},{id:'c',startFrame:90,endFrame:95,enabled:false,safeToEnable:false,kind:'pause'}];
 assert.equal(adjacentRow(rows,'a',1).id,'b');assert.equal(adjacentRow(rows,'c',1).id,'c');assert.equal(adjacentRow(rows,'a',-1).id,'a');
 assert.equal(adjacentRow(rows,null,1,30).id,'b');assert.equal(adjacentRow(rows,null,-1,60).id,'b');assert.equal(adjacentRow([],null,1),null);
 assert.equal(reviewDecision(rows[0],'accept'),null);assert.deepEqual(reviewDecision(rows[0],'reject'),{patch:{enabled:false}});assert.deepEqual(reviewDecision(rows[0],'toggle'),{patch:{enabled:false}});
 assert.deepEqual(reviewDecision(rows[1],'accept'),{adopt:true});assert.ok(reviewDecision(rows[2],'toggle').blocked);assert.equal(reviewDecision(rows[1],'reject'),null);
});

// ---------- 2. snapping ----------
test('snap points come from word boundaries and silence edges/midpoints; threshold scales with zoom; Alt disables',()=>{
 const d=doc(),rc=model.createRoughcut(d,analysis(d)).roughcut,points=roughcutSnapPoints(rc);
 assert.equal(roughcutSnapPoints(rc),points,'memoized per state object');
 const frames=points.map(p=>p.frame);
 for(const f of [30,60,90,120,150])assert.ok(frames.includes(f),`word boundary ${f}`);
 assert.deepEqual(points.filter(p=>p.kind.startsWith('silence')).map(p=>[p.frame,p.kind]),[[156,'silence-start'],[192,'silence-mid'],[228,'silence-end']]);
 assert.equal(points.find(p=>p.frame===60).kind,'word-end'===points.find(p=>p.frame===60).kind?'word-end':'word-start');
 assert.equal(snapThresholdFrames(2),4);assert.equal(snapThresholdFrames(0.5),16);assert.equal(snapThresholdFrames(0),0);
 // 2 px/frame → 8px = 4 frames.
 assert.deepEqual(snapToPoints(63.4,points,{pxPerFrame:2}).frame,60);assert.equal(snapToPoints(65,points,{pxPerFrame:2}).snapped,false);
 // Zoomed out (0.5 px/frame → 16 frames) the same raw frame snaps.
 assert.equal(snapToPoints(77,points,{pxPerFrame:0.5}).frame,90);assert.equal(snapToPoints(77,points,{pxPerFrame:2}).frame,77);
 assert.deepEqual(snapToPoints(63.4,points,{pxPerFrame:2,disabled:true}),{frame:63,snapped:false,point:null});
 assert.equal(snapToPoints(190,points,{pxPerFrame:1}).point.kind,'silence-mid');
 assert.equal(snapToPoints(61,points,{pxPerFrame:2,filter:p=>p.kind.startsWith('silence')}).snapped,false);
 assert.equal(snapToPoints(58,points,{pxPerFrame:2,max:59}).snapped,false,'respects bounds');assert.equal(snapToPoints(58,points,{pxPerFrame:2,max:59}).frame,58);
 assert.equal(adjacentSnapPoint(points,60,1).frame,90);assert.equal(adjacentSnapPoint(points,60,-1).frame,30);assert.equal(adjacentSnapPoint(points,0,-1),null);
});
test('project/source frame mapping through cut clips and timeline source-trim snapping',()=>{
 const d=doc(),next=model.createRoughcut(d,analysis(d));
 assert.deepEqual(next.source.clips.map(c=>[c.startFrame,c.durationFrames,c.sourceInFrame]),[[0,60,0],[60,74,90],[134,80,220]]);
 assert.equal(projectToSourceFrame(next,59),59);assert.equal(projectToSourceFrame(next,60),90);assert.equal(projectToSourceFrame(next,70),100);
 assert.equal(sourceToProjectFrame(next,100),70);assert.equal(sourceToProjectFrame(next,75),null,'cut-out source frame');
 const snap=sourceTrimSnap({roughcut:next.roughcut,edgeSourceFrame:90,delta:28,pxPerFrame:2});assert.deepEqual([snap.delta,snap.point.frame],[30,120]);
 assert.equal(sourceTrimSnap({roughcut:next.roughcut,edgeSourceFrame:90,delta:28,pxPerFrame:2,disabled:true}),null);
});

// ---------- 3. AI revision diff ----------
const planDoc=()=>({id:'p',captions:{version:1,enabled:true,cues:[{id:'cap1',startFrame:0,endFrame:30,text:'今天讲三个重点',initialText:'今天讲三个重点'}]},instances:[{id:'i1',props:{title:'旧标题'}}],source:{cameraPlan:{version:2,duration:10,levels:{A:1,B:1.12,C:1.18},anchor:{x:.5,y:.5},events:[],clipGroups:[{id:'cam1',start:1,in:.5,hold:1,out:.5,zoom:1.12,enabled:true}]}},productionPlan:{shots:[{id:'s1',visualRequirement:'展示产品'}]}});
const revision=()=>({id:'r1',kind:'shot-revision',state:'applied',reason:'更口语',patches:[
 {entity:'caption',id:'cap1',field:'text',before:'今天讲三个重点',after:'今天只讲两个重点'},
 {entity:'camera',id:'cam1',field:'hold',before:1,after:1.75},
 {entity:'instance',id:'i1',field:'props',before:{title:'旧标题'},after:{title:'新标题'}},
 {entity:'audio',id:'a1',field:'volume',before:1,after:1}]});
const appliedDoc=()=>{const d=planDoc();d.captions.cues[0].text=d.captions.cues[0].initialText='今天只讲两个重点';d.source.cameraPlan.clipGroups[0].hold=1.75;d.instances[0].props={title:'新标题'};return d;};
test('text diff marks removed and added characters, merges runs and handles empty sides',()=>{
 assert.deepEqual(textDiff('今天讲三个重点','今天只讲两个重点'),[{op:'equal',text:'今天'},{op:'insert',text:'只'},{op:'equal',text:'讲'},{op:'delete',text:'三'},{op:'insert',text:'两'},{op:'equal',text:'个重点'}]);
 assert.deepEqual(textDiff('','新增'),[{op:'insert',text:'新增'}]);assert.deepEqual(textDiff('删除',''),[{op:'delete',text:'删除'}]);assert.deepEqual(textDiff('同','同'),[{op:'equal',text:'同'}]);
 const long='字'.repeat(700);const big=textDiff(long+'甲',long+'乙');assert.deepEqual(big.map(s=>s.op),['equal','delete','insert']);
 for(const [a,b] of [['abcdef','azced'],['口播粗剪工具','粗剪口播的工具'],['🎬一二','一🎬二']]){const ops=textDiff(a,b);assert.equal(ops.filter(o=>o.op!=='insert').map(o=>o.text).join(''),a);assert.equal(ops.filter(o=>o.op!=='delete').map(o=>o.text).join(''),b);}
});
test('revision diff rows: unchanged patches hidden, duration delta from camera timing, live state and revert',()=>{
 const d=appliedDoc(),r=revision(),diff=revisionDiff(r,d);
 assert.deepEqual(diff.rows.map(x=>x.key),['caption:cap1:text','camera:cam1:hold','instance:i1:props']);
 assert.equal(diff.rows[0].kind,'text');assert.equal(diff.rows[1].kind,'value');assert.equal(diff.rows[2].before,'{"title":"旧标题"}');
 assert.equal(diff.durationDelta,0.75);assert.equal(formatDurationDelta(diff.durationDelta),'+0.75 秒');assert.equal(formatDurationDelta(-0.5),'−0.50 秒');assert.equal(formatDurationDelta(0),'');
 assert.equal(diff.state,'applied');assert.equal(patchDurationDelta({entity:'camera-create',after:{in:.5,hold:1,out:.5},before:null}),2);
 const reverted=revertRevision(d,r);
 assert.equal(reverted.captions.cues[0].text,'今天讲三个重点');assert.equal(reverted.captions.cues[0].initialText,'今天讲三个重点');assert.equal(reverted.source.cameraPlan.clipGroups[0].hold,1);assert.deepEqual(reverted.instances[0].props,{title:'旧标题'});
 assert.ok(Array.isArray(reverted.source.cameraPlan.events));assert.equal(d.captions.cues[0].text,'今天只讲两个重点','input untouched');
 assert.equal(revisionDiff(r,reverted).state,'reverted');assert.deepEqual(revertRevision(reverted,r).captions,reverted.captions,'idempotent');
 const edited=appliedDoc();edited.captions.cues[0].text='用户又改了';assert.equal(revisionDiff(r,edited).state,'diverged');assert.throws(()=>revertRevision(edited,r),/又被编辑过/);
 assert.deepEqual(reviewableRevisions({kind:'revise',results:[r,{...r,id:'r2',state:'stale'},{...r,id:'r3',patches:[{entity:'audio',id:'a',field:'volume',before:1,after:1}]}]}).map(x=>x.id),['r1']);
});

// ---------- 4. waveform levels ----------
test('peak level follows zoom (px per second) and tiles cover only the visible window',()=>{
 assert.deepEqual(PEAK_LEVELS.map(l=>l.perSecond),[15.625,62.5,250,1000]);
 assert.equal(chooseLevel(5),0);assert.equal(chooseLevel(15),0);assert.equal(chooseLevel(40),1);assert.equal(chooseLevel(200),2);assert.equal(chooseLevel(900),3);assert.equal(chooseLevel(5000),3);assert.equal(chooseLevel(0),0);
 assert.equal(chooseLevel(100,{density:2}),1);
 assert.deepEqual(tilesForRange(3,0,1),[0]);assert.deepEqual(tilesForRange(3,2,2.1),[0,1]);assert.deepEqual(tilesForRange(3,10,12),[4,5]);
 assert.deepEqual(tilesForRange(0,0,300),[2]===null?[]:tilesForRange(0,0,300));assert.deepEqual(tilesForRange(0,0,300),[0,1,2]);
 assert.deepEqual(tilesForRange(3,5,4),[]);assert.deepEqual(tilesForRange(3,0,100,1),[0]);
});
test('peak builder: streaming equals one-shot, coarse levels are maxima of finer levels',()=>{
 const n=16000*3+123,samples=new Int16Array(n);for(let i=0;i<n;i++)samples[i]=Math.round(Math.sin(i/7)*((i%16000)<8000?20000:3000));
 samples[40000]=-32768;
 const levels=buildPeakLevels(samples),builder=createPeakBuilder();for(let i=0;i<n;i+=997)builder.push(samples.subarray(i,i+997));
 assert.deepEqual(builder.finish().map(l=>Array.from(l)),levels.map(l=>Array.from(l)));
 assert.equal(levels[3].length,Math.ceil(n/16));assert.equal(levels[0].length,Math.ceil(levels[1].length/4));
 for(let l=0;l<3;l++)for(let i=0;i<levels[l].length;i++)assert.equal(levels[l][i],Math.max(...levels[l+1].slice(i*4,i*4+4)));
 assert.equal(levels[3][Math.floor(40000/16)],255);assert.ok(levels[3][Math.floor(12000/16)]<levels[3][Math.floor(2000/16)]);
 const tile=peakTile(levels[3],1);assert.equal(tile.length,Math.min(TILE_PEAKS,levels[3].length-TILE_PEAKS));
 const visible=visiblePeaks(3,new Map([[1,tile]]),2.1,2.2);assert.equal(visible.length,100);assert.ok(Math.abs(visible[0].seconds-2.1005)<1e-9);
 assert.deepEqual(visiblePeaks(3,new Map(),0,1),[]);
});
test('timeline peaks endpoint: lazy multi-level build from ffmpeg or the rough-cut 16k PCM cache, tile slices, validation',async()=>{
 const root=mkdtempSync(join(tmpdir(),'peaks-')),cacheRoot=join(root,'pcm-cache');
 try{
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=s=160x90:r=10:d=3','-f','lavfi','-i','sine=frequency=440:duration=3','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',join(root,'clip.mp4')]);
  const fine=await getTimelinePeaks('clip.mp4',{root,level:3,tile:1,cacheRoot});
  assert.equal(fine.source,'ffmpeg');assert.equal(fine.perSecond,1000);assert.equal(fine.tilePeaks,TILE_PEAKS);assert.ok(fine.peaks.length>0&&fine.peaks.length<=TILE_PEAKS);assert.ok(fine.peaks.some(v=>v>0));
  const coarse=await getTimelinePeaks('clip.mp4',{root,level:0,tile:0,cacheRoot});assert.ok(coarse.peaks.length>=40&&coarse.peaks.length<=50);
  assert.deepEqual((await getTimelinePeaks('clip.mp4',{root,level:3,tile:9,cacheRoot})).peaks,[]);
  await assert.rejects(getTimelinePeaks('clip.mp4',{root,level:7,cacheRoot}),/精度/);await assert.rejects(getTimelinePeaks('clip.mp4',{root,tile:-1,cacheRoot}),/分块/);
  await assert.rejects(getTimelinePeaks('../etc/passwd',{root,cacheRoot}));
  // A matching rough-cut PCM entry is preferred over a fresh decode (identity incl. ns mtime).
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=s=160x90:r=10:d=2','-f','lavfi','-i','sine=frequency=220:duration=2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',join(root,'other.mp4')]);
  const actual=realpathSync(join(root,'other.mp4')),info=statSync(actual,{bigint:true}),entry=join(cacheRoot,'abc');mkdirSync(entry,{recursive:true});
  const pcm=Buffer.alloc(16000*2*2);for(let i=0;i<32000;i++)pcm.writeInt16LE(i<16000?1000:16000,i*2);
  const header=Buffer.alloc(44);header.write('RIFF',0);header.writeUInt32LE(36+pcm.length,4);header.write('WAVE',8);header.write('fmt ',12);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(16000,24);header.writeUInt32LE(32000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);
  writeFileSync(join(entry,'audio.wav'),Buffer.concat([header,pcm]));
  writeFileSync(join(entry,'meta.json'),`{"schemaVersion":1,"source":{"path":${JSON.stringify(actual)},"dev":${info.dev},"ino":${info.ino},"size":${info.size},"mtimeNs":${info.mtimeNs},"ctimeNs":${info.ctimeNs}},"sampleRate":16000,"channels":1,"durationSeconds":2,"audioStartOffsetSeconds":0.0}`);
  assert.equal((await findCachedPcm(actual,{cacheRoot})).path,join(entry,'audio.wav'));
  const reused=await getTimelinePeaks('other.mp4',{root,level:0,tile:0,cacheRoot});
  assert.equal(reused.source,'roughcut-pcm');assert.equal(reused.durationSeconds,2);assert.deepEqual(reused.peaks,[...Array(15).fill(8),...Array(17).fill(125)]);
  writeFileSync(join(entry,'meta.json'),`{"source":{"path":${JSON.stringify(actual)},"dev":${info.dev},"ino":${info.ino},"size":${info.size},"mtimeNs":${info.mtimeNs+1n},"ctimeNs":${info.ctimeNs}},"sampleRate":16000,"channels":1,"audioStartOffsetSeconds":0}`);
  assert.equal(await findCachedPcm(actual,{cacheRoot}),null,'stale identity is ignored');
 }finally{rmSync(root,{recursive:true,force:true});}
});
