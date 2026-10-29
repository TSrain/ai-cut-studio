import test from 'node:test';
import assert from 'node:assert/strict';
import {cameraClips,withCameraClips,retimeCameraClip,duplicateCameraClip,applyCameraPreset} from '../../templates/remotion-base/src/editor/camera-clips.mjs';
import {compileShotPlan,sampleCameraZoom,validateShotPlan} from '../lib/aroll-shot-plan.mjs';
const p={version:2,duration:30,levels:{A:1,B:1.1,C:1.12},anchor:{x:.6,y:.1},events:[{at:0,to:'A',transition:'cut',purpose:'hook',cue:'开场',reason:'基础'},{from:2,toTime:4,to:'B',transition:'slow',easing:'ramped',purpose:'argument',cue:'重点',reason:'强调'},{from:6,toTime:7,to:'A',transition:'slow',easing:'linear',purpose:'tension-release',cue:'解释',reason:'回归'}]};
test('existing push hold return becomes one block without changing any sampled frame',()=>{const clips=cameraClips(p);assert.equal(clips.length,1);assert.equal(clips[0].start,2);assert.equal(clips[0].hold,2);assert.equal(clips[0].out,1);const q=withCameraClips(p,clips);for(let t=0;t<30;t+=1/30)assert.ok(Math.abs(sampleCameraZoom(compileShotPlan(p),t)-sampleCameraZoom(compileShotPlan(q),t))<1e-8);});
test('move preserves timing and resize respects total duration; collisions fail',()=>{const c=cameraClips(p)[0];assert.equal(retimeCameraClip(c,'move',3,30).start,5);const larger=retimeCameraClip(c,'right',5,30);assert.equal(larger.in+larger.hold+larger.out,10);assert.throws(()=>withCameraClips(p,[c,{...c,id:'other',start:3}]),/overlap/);});
test('disable removes full effect, duplicate finds a free gap, independent zoom survives',()=>{const c=cameraClips(p)[0],disabled=withCameraClips(p,[{...c,enabled:false}]);assert.equal(sampleCameraZoom(compileShotPlan(disabled),5),1);const d=duplicateCameraClip([c],c.id,30);assert.equal(d.length,2);assert.ok(d[1].start>=7);const q=withCameraClips(p,[c,{...d[1],zoom:1.2}]);assert.deepEqual(validateShotPlan(q).errors,[]);assert.equal(sampleCameraZoom(compileShotPlan(q),d[1].start+d[1].in+.2),1.2);});
test('template replacement preserves block span and rejects unsafe values',()=>{const c=cameraClips(p)[0],r=applyCameraPreset(c,'slow-fast');assert.equal(r.in+r.hold+r.out,c.in+c.hold+c.out);assert.equal(r.out,.35);assert.throws(()=>withCameraClips(p,[{...c,zoom:2}]),/zoom/);assert.throws(()=>withCameraClips(p,[{...c,in:NaN}]),/finite/);});

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('extending either edge adds only hold time and keeps the opposite edge fixed',()=>{
 const c=cameraClips(p)[0];
 for(const [edge,delta,start,end] of [['right',3,2,10],['left',-1,1,7]]){
  const r=retimeCameraClip(c,edge,delta,30);near(r.start,start);near(r.start+r.in+r.hold+r.out,end);near(r.in,c.in);near(r.out,c.out);near(r.hold,c.hold+Math.abs(delta));
 }
});
test('trimming consumes hold before touching either motion',()=>{
 const c=cameraClips(p)[0];
 for(const edge of ['left','right'])for(const cut of [1,2]){
  const r=retimeCameraClip(c,edge,edge==='left'?cut:-cut,30);near(r.in,2);near(r.out,1);near(r.hold,2-cut);near(r.start,edge==='left'?2+cut:2);
 }
});
test('after hold reaches zero, motions shrink proportionally with a 0.2s floor',()=>{
 const c=cameraClips(p)[0];
 for(const edge of ['left','right']){
  const r=retimeCameraClip(c,edge,edge==='left'?3.5:-3.5,30);near(r.hold,0);near(r.in,1);near(r.out,.5);assert.deepEqual(validateShotPlan(withCameraClips(p,[r])).errors,[]);
  const min=retimeCameraClip(c,edge,edge==='left'?100:-100,30);near(min.hold,0);near(min.in,.2);near(min.out,.2);
 }
 const asymmetric={...c,in:2,hold:0,out:.2};const r=retimeCameraClip(asymmetric,'right',-1,30);near(r.in,1);near(r.out,.2);near(r.hold,0);
 const grown=retimeCameraClip(r,'right',1,30);near(grown.in,1);near(grown.out,.2);near(grown.hold,1);
});
test('resize clamps to project edges and leaves zoom and easing unchanged',()=>{
 const c=cameraClips(p)[0],left=retimeCameraClip(c,'left',-100,30),right=retimeCameraClip(c,'right',100,8);
 near(left.start,0);near(left.hold,4);near(right.hold,3);
 for(const r of [left,right]){near(r.in,c.in);near(r.out,c.out);assert.equal(r.zoom,c.zoom);assert.equal(r.inEasing,c.inEasing);assert.equal(r.outEasing,c.outEasing);}
});

const tailPlan=()=>({...structuredClone(p),endCloseException:'片尾推近保持',events:[...structuredClone(p.events),{from:26,toTime:28,to:'B',zoom:1.05,transition:'slow',easing:'ramped',purpose:'argument',cue:'结尾',reason:'推近后停住'}]});
test('approved final push migrates without inventing a return or changing sampled zoom',()=>{
 const source=tailPlan(),clips=cameraClips(source),tail=clips.at(-1);
 assert.equal(tail.holdToEnd,true);assert.equal(tail.out,0);assert.equal(tail.hold,2);
 const migrated=withCameraClips(source,clips);assert.equal(migrated.events.length,source.events.length);assert.deepEqual(validateShotPlan(migrated).errors,[]);
 for(let frame=0;frame<900;frame++)near(sampleCameraZoom(compileShotPlan(source),frame/30),sampleCameraZoom(compileShotPlan(migrated),frame/30));
});
test('terminal hold cannot end early or silently gain a return; disabled tail restores base',()=>{
 const source=tailPlan(),clips=cameraClips(source),tail=clips.at(-1);
 assert.throws(()=>withCameraClips(source,[{...tail,hold:1}]),/片尾/);
 assert.throws(()=>withCameraClips(source,[{...tail,out:.2,hold:1.8}]),/片尾/);
 near(sampleCameraZoom(compileShotPlan(withCameraClips(source,clips.map(c=>c.id===tail.id?{...c,enabled:false}:c))),29),1);
 const noApproval=tailPlan();delete noApproval.endCloseException;assert.throws(()=>cameraClips(noApproval),/非成组/);
});
test('terminal resize and preset preserve its end and never introduce return motion',()=>{
 const tail=cameraClips(tailPlan()).at(-1);
 for(const [kind,delta] of [['left',1],['move',-1],['right',-2]]){
  const next=retimeCameraClip(tail,kind,delta,30);near(next.start+next.in+next.hold,30);near(next.out,0);assert.ok(next.in>=.2);assert.ok(next.hold>=0);
  assert.deepEqual(validateShotPlan(withCameraClips(tailPlan(),[next])).errors,[]);
 }
 const next=applyCameraPreset(tail,'slow-fast');near(next.start+next.in+next.hold,30);near(next.out,0);assert.equal(next.holdToEnd,true);
});
