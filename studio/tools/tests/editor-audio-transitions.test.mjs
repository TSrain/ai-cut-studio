import test from 'node:test';
import assert from 'node:assert/strict';
import * as audio from '../../templates/remotion-base/src/editor/audio.mjs';
import {createDocument,validateDocument} from '../lib/editor-store.mjs';
import {splitSelection} from '../editor/timeline-model.mjs';
const clip={id:'bgm',trackId:'bgm',name:'BGM',path:'assets/music.mp3',startFrame:0,durationFrames:120,sourceInFrame:0,sourceDurationFrames:600,volume:.2,fadeInFrames:30,fadeOutFrames:60};
const doc=c=>createDocument({id:'fade-test',name:'test',canvas:{width:320,height:180,fps:{num:30,den:1},durationFrames:180},audioTracks:[{id:'bgm',name:'BGM'}],audioClips:[c]});
test('smooth and equal power fades differ from linear while respecting endpoints',()=>{
 assert.equal(audio.audioVolumeAt({...clip,fadeInCurve:'smooth'},0),0);
 assert.ok(Math.abs(audio.audioVolumeAt({...clip,fadeInCurve:'smooth'},6)-.0208)<1e-10);
 assert.ok(Math.abs(audio.audioVolumeAt({...clip,fadeInCurve:'equalPower'},15)-.2*Math.SQRT1_2)<1e-10);
 assert.equal(audio.audioVolumeAt({...clip,fadeOutCurve:'smooth'},120),0);
});
test('preview and FFmpeg expressions match at range offsets and after splits',()=>{
 for(const curve of ['linear','smooth','equalPower']){
 const c={...clip,fadeInCurve:curve,fadeOutCurve:curve};const split=splitSelection(doc(c),['audio/bgm'],40,()=> 'right');
 for(let f=0;f<120;f++)assert.equal(audio.audioVolumeAt(split.audioClips[f<40?0:1],f<40?f:f-40),audio.audioVolumeAt(c,f));
 for(const part of split.audioClips){const expression=audio.audioVolumeExpression(part,30,5);const evaluate=Function('t','min','max','sin','PI',`return ${expression}`);
 for(let f=0;f<part.durationFrames-5;f++)assert.ok(Math.abs(evaluate(f/30,Math.min,Math.max,Math.sin,Math.PI)-audio.audioVolumeAt(part,f+5))<1e-10);}
 }
});
test('editing fades on a trimmed clip rebases onto visible range and clamps old lengths',()=>{
 const c={...clip,durationFrames:20,envelopeDurationFrames:120,envelopeOffsetFrames:40};
 const patch=audio.editAudioFades(c,{fadeInFrames:5,fadeOutCurve:'smooth'});
 assert.equal(patch.envelopeOffsetFrames,0);assert.equal(patch.envelopeDurationFrames,20);assert.equal(patch.fadeOutFrames,20);
 assert.equal(audio.audioVolumeAt({...c,...patch},0),0);
});
test('schema accepts known curves, rejects unknown curves, preserves old documents',()=>{
 validateDocument(doc(clip));validateDocument(doc({...clip,fadeInCurve:'smooth',fadeOutCurve:'equalPower'}));
 assert.throws(()=>validateDocument(doc({...clip,fadeInCurve:'mystery'})),/curve/i);
});
test('actual hybrid audio export renders the curved envelope and range offset',async(t)=>{
 const {mkdtempSync,rmSync,readFileSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {execFileSync}=await import('node:child_process');
 const {planHybrid,runHybrid}=await import('../lib/editor-hybrid.mjs');const root=mkdtempSync(join(tmpdir(),'fade-export-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','aevalsrc=0.2:s=48000:d=4','-c:a','pcm_f32le',join(root,'tone.wav')]);
 const c={...clip,path:'tone.wav',publicPath:'tone.wav',volume:1,fadeInFrames:60,fadeOutFrames:60,fadeInCurve:'smooth',fadeOutCurve:'equalPower'};
 const d={canvas:{width:64,height:36,fps:{num:30,den:1},durationFrames:120},source:null,instances:[],audioTracks:[{id:'bgm'}],audioClips:[c]};const item={renderMode:'full',extension:'mp4',rangeStartFrame:15,durationFrames:90};
 await runHybrid(planHybrid(d,item,{publicRoot:root}),d,item,{outputPath:join(root,'out.mp4'),workRoot:root,hardware:false});
 const graph=readFileSync(join(root,'hybrid.ffgraph'),'utf8');assert.ok(graph.includes(audio.audioVolumeExpression(c,30,15)));
 const pcm=execFileSync('ffmpeg',['-v','error','-i',join(root,'out.mp4'),'-ac','1','-ar','48000','-f','f32le','-']);
 for(const f of [10,30,50,70]){let sum=0,count=0;for(let n=Math.round(f/30*48000);n<Math.round((f/30+.01)*48000);n++){sum+=pcm.readFloatLE(n*4);count++;}assert.ok(Math.abs(sum/count-.2*audio.audioVolumeAt(c,f+15))<.015);}
});
