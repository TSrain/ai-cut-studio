import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocument,validateDocument} from '../lib/editor-store.mjs';
import {placeAudio,splitSelection,trimClip,moveSelection,pasteSelection,copySelection,deleteSelection} from '../editor/timeline-model.mjs';
import {audioVolumeAt} from '../../templates/remotion-base/src/editor/audio.mjs';
import {retimeEditorDocument} from '../lib/editor-framerate.mjs';
const clip={id:'music',name:'Music',path:'assets/music.wav',startFrame:20,durationFrames:100,sourceInFrame:10,sourceDurationFrames:200,volume:1.5,fadeInFrames:30,fadeOutFrames:40,trackId:'audio-1'};
const doc=()=>createDocument({id:'audio-test',name:'Audio',canvas:{width:320,height:180,fps:{num:30,den:1},durationFrames:300},audioTracks:[{id:'audio-1',name:'Music'}],audioClips:[structuredClone(clip)]});
test('audio serializes and rejects invalid numeric/path/track data',()=>{assert.deepEqual(createDocument(JSON.parse(JSON.stringify(doc()))),doc());for(const patch of [{volume:NaN},{volume:3},{sourceInFrame:150},{fadeInFrames:-1},{path:'../bad.wav'},{trackId:'missing'}])assert.throws(()=>validateDocument({...doc(),audioClips:[{...clip,...patch}]}));});
test('split and trim preserve original fade envelope and source time',()=>{const d=splitSelection(doc(),['audio/music'],70,()=> 'right');for(let f=0;f<100;f++){const c=d.audioClips[f<50?0:1];assert.equal(audioVolumeAt(c,f%50),audioVolumeAt(clip,f));}assert.equal(d.audioClips[1].sourceInFrame,60);const trimmed=trimClip(doc(),'audio/music','left',15).audioClips[0];assert.equal(trimmed.sourceInFrame,25);assert.equal(audioVolumeAt(trimmed,0),audioVolumeAt(clip,15));});
test('audio move, locking, collision and copy/delete',()=>{let d=placeAudio(doc(),{...clip,id:'other'});assert.equal(d.audioClips[1].trackId,'audio-2');assert.throws(()=>moveSelection(d,['audio/other'],0,'audio-1'));d.audioTracks[1].locked=true;assert.throws(()=>moveSelection(d,['audio/music'],0,'audio-2'));const pasted=pasteSelection(doc(),copySelection(doc(),['audio/music']),150,()=> 'copy');assert.equal(pasted.audioClips[1].startFrame,150);assert.equal(deleteSelection(pasted,['audio/copy']).audioClips.length,1);});
test('retiming includes fades, offsets and immutable original',()=>{const d=splitSelection(doc(),['audio/music'],70,()=> 'right');const r=retimeEditorDocument(d,60);assert.equal(r.audioClips[1].envelopeOffsetFrames,100);assert.equal(r.audioClips[0].fadeInFrames,60);assert.equal(d.audioClips[0].fadeInFrames,30);});

test('right trim preserves original fade-out and range uses original project frame',()=>{
 const right=trimClip(doc(),'audio/music','right',-20).audioClips[0];
 assert.equal(audioVolumeAt(right,70),audioVolumeAt(clip,70));
 const rangeStart=85,localFrame=4;
 assert.equal(audioVolumeAt(clip,rangeStart+localFrame-clip.startFrame),1.1625);
});
test('group clipboard regenerates a shared group once',()=>{
 const d=doc();d.audioClips[0].groupId='old-group';d.audioClips.push({...clip,id:'second',startFrame:130,groupId:'old-group'});
 let n=0;const pasted=pasteSelection(d,copySelection(d,['audio/music','audio/second']),30,()=>`new-${++n}`);
 const added=pasted.audioClips.filter(c=>c.id.startsWith('new-'));
 assert.equal(added[0].groupId,added[1].groupId);assert.notEqual(added[0].groupId,'old-group');
});

test('audio staging verifies actual duration, content hash and source confinement',async(t)=>{
 const {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {execFileSync}=await import('node:child_process');
 const {stageEditorSource,probeEditorAudio}=await import('../lib/editor-media.mjs');
 const root=mkdtempSync(join(tmpdir(),'editor-audio-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 mkdirSync(join(root,'assets'),{recursive:true});mkdirSync(join(root,'templates/remotion-base/public'),{recursive:true});
 execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=frequency=330:duration=4',join(root,'assets/music.wav')]);
 assert.equal(probeEditorAudio('assets/music.wav',{root}).durationSeconds,4);
 const d=doc(),staged=stageEditorSource(d,{root});assert.match(staged.audioClips[0].publicPath,/^editor-audio\/[a-f0-9]{64}\.wav$/);assert.equal(d.audioClips[0].publicPath,undefined);
 assert.deepEqual(readFileSync(join(root,'templates/remotion-base/public',staged.audioClips[0].publicPath)),readFileSync(join(root,'assets/music.wav')));
 const long=doc();long.audioClips[0].durationFrames=150;assert.throws(()=>stageEditorSource(long,{root}),/时长/);
 const bad=doc();bad.audioClips[0].path='../outside.wav';assert.throws(()=>stageEditorSource(bad,{root}));
 symlinkSync('/etc/hosts',join(root,'assets/escape.wav'));bad.audioClips[0].path='assets/escape.wav';assert.throws(()=>stageEditorSource(bad,{root}),/越界/);
 writeFileSync(join(root,'templates/remotion-base/public',staged.audioClips[0].publicPath),'corrupt');assert.throws(()=>stageEditorSource(d,{root}),/完整性/);
});
