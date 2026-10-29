import test from 'node:test';
import assert from 'node:assert/strict';
import * as organization from '../editor/track-organization.mjs';
import {editHistory,undoHistory,redoHistory} from '../editor/history.mjs';
const organize=d=>{assert.equal(typeof organization.organizeTracks,'function');return organization.organizeTracks(d);};
const track=(id,extra={})=>({id,name:id,...extra});
const clip=(id,trackId,startFrame,durationFrames,kind='animation',zIndex=0)=>({id,trackId,startFrame,durationFrames,zIndex,assetId:kind==='animation'?'number-beat':'source-pip',props:kind==='animation'?{label:id}:{media:{kind,path:`/${id}`}},assetVersion:1});
const doc=(instances,tracks)=>({id:'organize-test',revision:12,canvas:{width:1920,height:1080,fps:{num:30,den:1},durationFrames:300},instances,tracks,audioTracks:[],audioClips:[],source:{path:'/main.mp4',clips:[{id:'s',startFrame:0,durationFrames:300,sourceInFrame:0}]},captions:{cues:[{id:'c',text:'保留字幕'}]},productionPlan:{shots:[{id:'planned'}]}});
const withoutLane=i=>{const {trackId,autoPlacement,...rest}=i;return rest;};
test('touching native animations merge without changing clip data or auxiliary tracks; input is immutable and repeat is no-op',()=>{
 const d=doc([clip('a','a',0,10),clip('b','b',10,20)],[track('a'),track('b')]),before=structuredClone(d);
 const r=organize(d);assert.equal(r.document.tracks.length,1);assert.equal(r.removedTracks,1);assert.equal(r.movedClips,1);assert.deepEqual(d,before);
 assert.deepEqual(r.document.instances.map(withoutLane),d.instances.map(withoutLane));
 for(const key of ['source','captions','productionPlan','canvas','revision'])assert.deepEqual(r.document[key],d[key]);
 const repeated=organize(r.document);assert.equal(repeated.changed,false);assert.deepEqual(repeated.document,r.document);
});
test('one-frame overlap remains on separate tracks and heterogeneous media never merge',()=>{
 const d=doc([clip('a','a',0,10),clip('b','b',9,10),clip('v','v',20,10,'video'),clip('p','p',30,10,'image')],['a','b','v','p'].map(id=>track(id)));
 assert.deepEqual(organize(d).document,d);
});
test('locked and disabled tracks including empty protected tracks remain untouched',()=>{
 const d=doc([clip('a','a',0,10),clip('b','b',10,10),clip('c','c',20,10)],[track('a',{locked:true}),track('b',{disabled:true}),track('c'),track('empty',{locked:true}),track('hidden',{disabled:true})]);
 assert.deepEqual(organize(d).document,d);
});
test('try the other surviving lane when moving downward would reverse an overlapping external layer',()=>{
 const d=doc([clip('a','lower',0,10,'video',0),clip('b','middle',20,10,'animation',1000),clip('c','upper',20,10,'video',2000)],['lower','middle','upper'].map(id=>track(id)));
 const r=organize(d);assert.equal(r.document.tracks.length,2);assert.equal(r.document.instances[0].trackId,'upper');assert.equal(r.document.instances[2].trackId,'upper');assert.deepEqual(r.document.instances.map(withoutLane),d.instances.map(withoutLane));
});
test('keep both lanes when either direction would reverse the composite order',()=>{
 const d=doc([clip('a','lower',0,10,'video',0),clip('b','middle',0,30,'animation',1000),clip('c','upper',20,10,'video',2000)],['lower','middle','upper'].map(id=>track(id)));
 assert.deepEqual(organize(d).document,d);
});
test('reassign individual clips to reduce three mutually conflicting lanes to the two required by concurrent footage',()=>{
 const d=doc([clip('a1','a',0,10,'video',0),clip('a2','a',20,10,'video',0),clip('b1','b',0,10,'video',1000),clip('b2','b',40,10,'video',1000),clip('c1','c',20,10,'video',2000),clip('c2','c',40,10,'video',2000)],['a','b','c'].map(id=>track(id)));
 assert.equal(organize(d).document.tracks.length,2);
});
test('audio clips merge at adjacent boundaries preserving fades and volume, while overlap and mute are respected',()=>{
 const d=doc([],[]);d.audioTracks=[track('a'),track('b'),track('c'),track('mute',{disabled:true})];d.audioClips=[{id:'a',trackId:'a',startFrame:0,durationFrames:10,path:'/a.wav',volume:.4,fadeOutFrames:3},{id:'b',trackId:'b',startFrame:10,durationFrames:10,path:'/b.wav',volume:.7,fadeInFrames:2},{id:'c',trackId:'c',startFrame:5,durationFrames:10,path:'/c.wav'},{id:'m',trackId:'mute',startFrame:30,durationFrames:5,path:'/m.wav'}];
 const r=organize(d);assert.equal(r.document.audioTracks.length,3);assert.deepEqual(r.document.audioClips.map(withoutLane),d.audioClips.map(withoutLane));assert.equal(r.document.audioClips[3].trackId,'mute');
});
test('mixed track can release its video to an existing compatible video lane',()=>{
 const d=doc([clip('v1','mixed',0,10,'video'),clip('a','mixed',20,10),clip('v2','video',10,10,'video')],[track('video'),track('mixed')]);
 const r=organize(d);assert.equal(r.document.instances[0].trackId,r.document.instances[2].trackId);assert.notEqual(r.document.instances[1].trackId,r.document.instances[2].trackId);
});
test('manual organization clears automatic ownership for touched lanes only',()=>{
 const d=doc([clip('a','a',0,10),clip('b','b',10,10)],[track('a',{autoPlacement:{kind:'automatic-visual-v1',createdIndex:0,originalName:'a'}}),track('b')]);d.instances[0].autoPlacement={kind:'automatic-visual-v1',trackId:'a',instanceId:'a'};
 const r=organize(d);assert.equal(r.document.tracks[0].autoPlacement,undefined);assert.equal(r.document.instances[0].autoPlacement,undefined);
});
test('empty editable lanes removed, differing future track properties and invalid timings do not merge',()=>{
 const d=doc([clip('a','a',0,10),clip('b','b',10,10),clip('bad','bad',30,NaN)],[track('empty'),track('a',{blendMode:'multiply'}),track('b',{blendMode:'screen'}),track('bad')]);
 const r=organize(d);assert.equal(r.document.tracks.length,3);assert.equal(r.movedClips,0);
});
test('one atomic undo restores every lane and clip; redo restores organization',()=>{
 const d=doc([clip('a','a',0,10),clip('b','b',10,10)],[track('a'),track('b')]);const organized=organize(d).document;
 const h=editHistory({past:[],present:d,future:[]},organized);assert.equal(h.past.length,1);assert.deepEqual(undoHistory(h).present,d);assert.deepEqual(redoHistory(undoHistory(h)).present,organized);
});

test('matching future track settings transfer safely instead of leaving an empty destination for repeated packing',()=>{
 const d=doc([clip('a','a',0,10),clip('b','b',10,10)],[track('a',{blendMode:'multiply'}),track('b',{blendMode:'multiply'})]);
 const r=organize(d);assert.equal(r.document.tracks.length,1);assert.equal(r.document.tracks[0].blendMode,'multiply');assert.equal(organize(r.document).changed,false);
});
