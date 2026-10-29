import test from 'node:test';
import assert from 'node:assert/strict';
import {timelineRuler} from '../editor/timeline-ruler.mjs';
const options={fps:30,durationFrames:7200,pxPerFrame:1722/7200,viewportWidth:1722,scrollLeft:0};
test('four-minute overview uses 30-second labels with quiet minor ticks',()=>{
 const r=timelineRuler(options);
 assert.equal(r.mode,'overview');assert.equal(r.majorStepFrames,900);
 assert.ok(r.ticks.filter(t=>t.label).length<=9);
 assert.equal(r.ticks.find(t=>t.frame===900).label,'00:30');
 assert.ok(r.ticks.some(t=>!t.label));
});
test('zoom progressively exposes seconds and integer frames',()=>{
 const mid=timelineRuler({...options,pxPerFrame:options.pxPerFrame*8});
 const fine=timelineRuler({...options,pxPerFrame:options.pxPerFrame*128});
 assert.ok(mid.majorStepFrames<900);assert.ok(mid.majorStepFrames>=30);
 assert.ok(fine.majorStepFrames<30);assert.ok(fine.ticks.some(t=>t.label==='00:00:05'));
 assert.ok(fine.ticks.every(t=>Number.isInteger(t.frame)));
});
test('labels do not overlap across zoom and viewport sizes',()=>{
 for(const fps of [24,25,30,60,30000/1001])for(const width of [320,900,1722])for(const zoom of [1,2,8,32,128,256]){
  const r=timelineRuler({...options,fps,viewportWidth:width,pxPerFrame:width/(240*fps)*zoom});
  const labels=r.ticks.filter(t=>t.label);
  for(let i=1;i<labels.length;i++)assert.ok(labels[i].x-labels[i-1].x>=r.minLabelSpacing-1);
  assert.ok(r.ticks.length<=width/8+50);
 }
});
test('late horizontal scroll remains populated and aligned to zero',()=>{
 const r=timelineRuler({...options,durationFrames:3600*30,pxPerFrame:20,viewportWidth:1000,scrollLeft:1500000});
 assert.ok(r.ticks.length>10&&r.ticks.length<160);
 assert.ok(r.ticks.some(t=>t.x>=1500000&&t.x<=1501000));
 assert.ok(r.ticks.every(t=>t.frame>70000));
});
test('noninteger FPS yields stable whole-second labels on integer frames',()=>{
 const r=timelineRuler({...options,fps:30000/1001});
 assert.equal(r.ticks.find(t=>t.label==='00:30').frame,900);
 assert.ok(r.ticks.every(t=>Number.isInteger(t.frame)));
 assert.equal(new Set(r.ticks.map(t=>t.frame)).size,r.ticks.length);
});
test('invalid inputs cannot create unbounded or invalid geometry',()=>{
 for(const patch of [{fps:0},{pxPerFrame:0},{durationFrames:NaN},{viewportWidth:Infinity}])assert.deepEqual(timelineRuler({...options,...patch}).ticks,[]);
});
