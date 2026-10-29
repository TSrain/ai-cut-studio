import test from 'node:test';
import assert from 'node:assert/strict';
const m=await import('../editor/track-insertion.mjs').catch(()=>({}));
const doc=()=>({canvas:{durationFrames:600},tracks:[{id:'v1',name:'一'},{id:'v2',name:'二'}],instances:[{id:'a',trackId:'v1',startFrame:30,durationFrames:60,zIndex:0},{id:'b',trackId:'v1',startFrame:120,durationFrames:60,zIndex:0},{id:'c',trackId:'v2',startFrame:30,durationFrames:60,zIndex:1000}],audioTracks:[{id:'audio-1',name:'音频 1'}],audioClips:[{id:'s',trackId:'audio-1',startFrame:30,durationFrames:90}],source:{startFrame:0,clips:[{id:'main',startFrame:0,durationFrames:600,sourceInFrame:0}]}});
test('new visual track preserves layer insertion, group spacing and original document',()=>{
 const d=doc(),before=structuredClone(d);const r=m.moveToNewTrack(d,['a','b'],15,1);
 assert.equal(r.tracks.length,3);assert.equal(r.instances[0].trackId,r.tracks[1].id);assert.equal(r.instances[1].trackId,r.tracks[1].id);assert.equal(r.instances[0].startFrame,45);assert.equal(r.instances[1].startFrame,135);assert.ok(r.instances[0].zIndex<r.instances[2].zIndex);assert.deepEqual(d,before);
});
test('audio drag creates audio track only; bounds are preserved',()=>{
 const d=doc(),r=m.moveToNewTrack(d,['audio/s'],1000,0);assert.equal(r.tracks.length,2);assert.equal(r.audioTracks.length,2);assert.equal(r.audioClips[0].trackId,r.audioTracks[0].id);assert.equal(r.audioClips[0].startFrame,510);
});
test('locked, mixed-kind and multi-track selections cannot create a partial track',()=>{
 const d=doc();d.tracks[0].locked=true;assert.throws(()=>m.moveToNewTrack(d,['a'],0,1),/锁定/);
 assert.throws(()=>m.moveToNewTrack(doc(),['a','audio/s'],0,1),/同一/);assert.throws(()=>m.moveToNewTrack(doc(),['a','c'],0,1),/同一/);assert.throws(()=>m.moveToNewTrack(doc(),['source/main'],0,1),/专属/);
});
test('insertion detects boundaries and outside area, not row interiors',()=>{
 const rows=[{top:30,bottom:78,index:1},{top:78,bottom:126,index:0}];
 assert.equal(m.trackInsertionAt(rows,20,'visual').index,2);assert.equal(m.trackInsertionAt(rows,79,'visual').index,1);assert.equal(m.trackInsertionAt(rows,140,'visual').index,0);assert.equal(m.trackInsertionAt(rows,55,'visual'),null);
 assert.equal(m.trackInsertionAt([{top:30,bottom:78,index:0}],80,'audio').index,1);
});
