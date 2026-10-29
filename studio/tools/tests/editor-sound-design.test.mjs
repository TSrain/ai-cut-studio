import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeSoundDesign} from '../lib/editor-sound-design.mjs';
const doc=()=>({id:'test',canvas:{fps:{num:30,den:1},durationFrames:300},styleReference:{allowedOverrides:{}},audioClips:[],audioTracks:[],instances:[]});
const clip=()=>({id:'sfx-a',name:'落定',path:'assets/library/sfx/pop.wav',startFrame:30,durationFrames:10,sourceInFrame:0,sourceDurationFrames:20,volume:.1,fadeInFrames:0,fadeOutFrames:2,trackId:'sfx-a'});
test('repeat merge is idempotent and manual edit/deletion survive',()=>{
 let r=mergeSoundDesign(doc(),[clip()]);assert.equal(r.document.audioClips.length,1);
 r=mergeSoundDesign(r.document,[clip()]);assert.equal(r.document.audioClips.length,1);
 r.document.audioClips[0].volume=.6;r=mergeSoundDesign(r.document,[clip()]);assert.equal(r.document.audioClips[0].volume,.6);assert.equal(r.protectedEdits.length,1);
 r.document.audioClips=[];r=mergeSoundDesign(r.document,[clip()]);assert.equal(r.document.audioClips.length,0);assert.equal(r.protectedEdits.length,1);
});
test('unmanaged and locked audio preserved; removed authored cues removed',()=>{
 const d=doc();d.audioClips=[{...clip(),id:'music',trackId:'music'}];d.audioTracks=[{id:'music',name:'音乐'}];let r=mergeSoundDesign(d,[clip()]);
 r.document.audioTracks.find(t=>t.id==='sfx-a').locked=true;r=mergeSoundDesign(r.document,[]);assert.equal(r.document.audioClips.length,2);
 r.document.audioTracks.find(t=>t.id==='sfx-a').locked=false;r=mergeSoundDesign(r.document,[]);assert.equal(r.document.audioClips.length,1);assert.equal(r.document.audioClips[0].id,'music');
});
test('same IDs cannot overwrite unrelated user sounds',()=>{const d=doc();d.audioClips=[clip()];d.audioTracks=[{id:'sfx-a',name:'自己的声音'}];const r=mergeSoundDesign(d,[{...clip(),volume:.3}]);assert.equal(r.document.audioClips[0].volume,.1);assert.equal(r.protectedEdits.length,1);});
import {soundRecipes,templateSoundClip} from '../editor/sound-recipes.mjs';
import {readPresetCatalog} from '../lib/preset-catalog.mjs';
import {existsSync} from 'node:fs';
test('every registered preset has a sound or deliberate silence; files exist',()=>{for(const p of readPresetCatalog()){assert.ok(soundRecipes[p.id],p.id);if(soundRecipes[p.id].file&&process.env.STUDIO_ASSET_TESTS==='1')assert.ok(existsSync(soundRecipes[p.id].file));}});
test('number landing follows 0.8 second event at 24/30/60fps, respects trims',()=>{for(const fps of [24,30,60]){const i={id:'n',assetId:'number-beat',startFrame:fps,durationFrames:fps*3};const c=templateSoundClip(i,{path:'a.wav',durationSeconds:.17},fps,fps*5);assert.equal(c.startFrame,fps+Math.round(.8*fps));assert.ok(c.durationFrames>0);assert.throws(()=>templateSoundClip({...i,sourceOffsetFrames:fps},{path:'a.wav',durationSeconds:.17},fps,fps*5),/裁掉/);}});
import {stageSoundDesign} from '../lib/editor-sound-design.mjs';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
test('real sound file staged; bounds/timebase/plan binding fail closed',t=>{
 const root=mkdtempSync(join(tmpdir(),'sfx-design-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'templates/remotion-base/public'),{recursive:true});
 const file=join(root,'tone.wav');execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=1',file]);
 const planPath=join(root,'plan.json');writeFileSync(planPath,JSON.stringify({soundDesignVersion:1,shots:[{soundDesign:{cues:[{id:'a',intent:'落定',anchor:'结果',event:'settle'}]}}]}));
 const m={version:1,projectId:'test',fps:30,durationFrames:300,planPath,planSha256:createHash('sha256').update(readFileSync(planPath)).digest('hex'),cues:[{id:'sfx-a',name:'结果',intent:'落定',anchor:'结果',event:'settle',timingEvidence:'existing SRT',audition:'draft',file,startSeconds:1,durationSeconds:.5}]};
 const c=stageSoundDesign(m,doc(),{root})[0];assert.equal(c.startFrame,30);assert.equal(c.durationFrames,15);assert.ok(existsSync(join(root,c.path)));
 assert.throws(()=>stageSoundDesign({...m,fps:60},doc(),{root}),/timebase/);
 assert.throws(()=>stageSoundDesign({...m,cues:[{...m.cues[0],startSeconds:9.9}]},doc(),{root}),/exceeds/);
 assert.throws(()=>stageSoundDesign({...m,cues:[{...m.cues[0],intent:'擅自修改'}]},doc(),{root}),/approved/);
 writeFileSync(planPath,'{}');assert.throws(()=>stageSoundDesign(m,doc(),{root}),/hash/);
});
