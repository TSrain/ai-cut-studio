import test from 'node:test';
import assert from 'node:assert/strict';
import {timelineSnapPoints,createTimelineSnap} from '../editor/timeline-snap.mjs';
import {createTimelineHover} from '../editor/timeline-hover.mjs';
const resolve=(s,frame,extra={})=>s.resolve(frame,{points:[100,200],px:1,duration:300,enabled:true,...extra});
test('enters at seven pixels, stays until fourteen, then releases',()=>{
 const s=createTimelineSnap();
 assert.equal(resolve(s,92).frame,92);
 assert.equal(resolve(s,94).frame,100);
 assert.equal(resolve(s,112).frame,100);
 assert.equal(resolve(s,115).frame,115);
 assert.equal(resolve(s,108).frame,108);
});
test('screen distance uses fractional frames and is zoom independent',()=>{
 for(const px of [.1,2,20]){
  const s=createTimelineSnap();
  assert.equal(resolve(s,100-6/px,{px}).frame,100);
  assert.equal(resolve(s,100+12/px,{px,points:[100]}).frame,100);
  assert.equal(resolve(s,100+15/px,{px,points:[100]}).snapped,false);
 }
});
test('dense neighboring cuts remain reachable without flickering at midpoint',()=>{
 const s=createTimelineSnap(),extra={points:[100,108]};
 assert.equal(resolve(s,100,extra).frame,100);
 assert.equal(resolve(s,105,extra).frame,100);
 assert.equal(resolve(s,108,extra).frame,108);
 assert.equal(resolve(s,103,extra).frame,108);
 assert.equal(resolve(s,100,extra).frame,100);
});
test('bypass, reset and removed targets clear stickiness',()=>{
 const s=createTimelineSnap();resolve(s,100);
 assert.equal(resolve(s,110,{enabled:false}).frame,110);
 assert.equal(resolve(s,110).frame,110);
 resolve(s,100);s.reset();assert.equal(resolve(s,110).frame,110);
 resolve(s,100);assert.equal(resolve(s,110,{points:[200]}).frame,110);
});
test('collects project-time source, media, audio and subtitle edges with no duplicate/out-of-range targets',()=>{
 const d={canvas:{durationFrames:300},source:{clips:[{startFrame:0,durationFrames:60,sourceInFrame:999}]},instances:[{startFrame:60,durationFrames:40}],audioClips:[{startFrame:90,durationFrames:30}],captions:{cues:[{startFrame:70,endFrame:80},{startFrame:250,endFrame:300}]}};
 assert.deepEqual(timelineSnapPoints(d),[0,60,70,80,90,100,120,250,299]);
});
test('click commits the shown sticky frame once; a drag at another x uses the raw position',()=>{
 let committed=30;const h=createTimelineHover({clock:{getSnapshot:()=>committed,setFrame:f=>committed=f},seekTo:()=>{},getDuration:()=>300,isPlaying:()=>false});
 h.preview(100);h.capturePointerSeek(112);h.cancel();
 assert.equal(h.resolvePointerSeek(112,112),100);
 assert.equal(h.resolvePointerSeek(112,112),112);
 h.preview(100);h.capturePointerSeek(112);h.cancel();
 assert.equal(h.resolvePointerSeek(120,120),120);
 h.preview(100);h.capturePointerSeek(112);h.reset();
 assert.equal(h.resolvePointerSeek(112,112),112);
});
