import test from 'node:test';
import assert from 'node:assert/strict';
import {appendAutomaticVisualTrack} from '../lib/automatic-visual-tracks.mjs';
const item=(id,start=0,duration=30)=>({id,assetId:'source-pip',startFrame:start,durationFrames:duration,zIndex:2,props:{}});
function append(d,i){const before=structuredClone(d.instances);appendAutomaticVisualTrack(d,i);assert.deepEqual(d.instances,before);d.instances.push(i);return i;}
test('nonoverlapping automatic footage/templates/deliveries share a persisted track, including touching boundaries',()=>{
 const d={tracks:[],instances:[]};const a=append(d,item('footage-a'));const b=append(d,item('template-b',30));const reopened=JSON.parse(JSON.stringify(d));const c=append(reopened,item('delivery-c',60));assert.equal(reopened.tracks.length,1);assert.equal(a.trackId,b.trackId);assert.equal(c.trackId,a.trackId);assert.equal(c.zIndex,2);
});
test('overlaps allocate upper lanes and later disjoint content reuses the first lane',()=>{
 const d={tracks:[],instances:[]};const a=append(d,item('a'));const b=append(d,item('b',15));const c=append(d,item('c',60));assert.notEqual(a.trackId,b.trackId);assert.equal(c.trackId,a.trackId);assert.equal(d.tracks.length,2);
 // First lane is free here, but using it would place new content below b.
 const upper=append(d,item('upper',31,10));assert.notEqual(upper.trackId,a.trackId);assert.notEqual(upper.trackId,b.trackId);
});
test('manual, renamed, reordered, locked, hidden or mixed tracks remain untouched',()=>{
 for(const kind of ['manual','renamed','reordered','locked','hidden','mixed','copied']){
  const d={tracks:[],instances:[]};const a=append(d,item('a'));const lane=d.tracks[0];
  if(kind==='manual')delete lane.autoPlacement;
  if(kind==='renamed')lane.name='我的轨道';
  if(kind==='reordered')d.tracks.unshift({id:'manual-other',name:'手动'});
  if(kind==='locked')lane.locked=true;
  if(kind==='hidden')lane.disabled=true;
  if(kind==='mixed')d.instances.push({...item('hand',90),trackId:lane.id});
  if(kind==='copied')d.instances.push({...structuredClone(a),id:'manual-copy',startFrame:90});
  const before=structuredClone(d);const b=append(d,item('b',60));assert.notEqual(b.trackId,a.trackId,kind);assert.deepEqual(d.tracks.slice(0,before.tracks.length),before.tracks,kind);assert.deepEqual(d.instances.slice(0,before.instances.length),before.instances,kind);
 }
});
test('later overlapping manual layer prevents automatic lane reuse below it',()=>{
 const d={tracks:[],instances:[]};const a=append(d,item('a'));d.tracks.push({id:'hand',name:'手动上层'});d.instances.push({...item('hand-i',60),trackId:'hand',zIndex:9});const b=append(d,item('b',60));assert.notEqual(b.trackId,a.trackId);assert.equal(d.tracks.at(-1).id,b.trackId);
});
