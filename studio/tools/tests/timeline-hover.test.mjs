import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaybackClock} from '../editor/playback-clock.mjs';
import {createTimelineHover} from '../editor/timeline-hover.mjs';

function setup(){
 const clock=createPlaybackClock();clock.setFrame(30);
 const seeks=[];let playing=false;
 const hover=createTimelineHover({clock,seekTo:f=>seeks.push(f),getDuration:()=>300,isPlaying:()=>playing});
 return {clock,hover,seeks,setPlaying:v=>playing=v};
}
test('skimming changes only temporary position, and leaving restores the committed frame',()=>{
 const {clock,hover,seeks}=setup();hover.preview(90);hover.receiveFrame(90);
 assert.equal(hover.getSnapshot(),90);assert.equal(clock.getSnapshot(),30);
 hover.cancel();assert.equal(hover.getSnapshot(),null);assert.deepEqual(seeks,[90,30]);
 hover.receiveFrame(90);assert.equal(clock.getSnapshot(),30);
 hover.receiveFrame(30);assert.equal(clock.getSnapshot(),30);
});
test('click or keyboard seek commits explicitly, ignoring queued preview frames',()=>{
 const {clock,hover}=setup();hover.preview(90);hover.seek(60);
 hover.receiveFrame(90);assert.equal(clock.getSnapshot(),60);assert.equal(hover.getSnapshot(),null);
 hover.receiveFrame(60);assert.equal(clock.getSnapshot(),60);
});
test('space promotes the preview to the playback start; playing disables skimming',()=>{
 const {clock,hover,setPlaying,seeks}=setup();hover.preview(90);hover.startPlayback();setPlaying(true);
 assert.deepEqual(seeks,[90],'starting from the displayed preview must not re-seek media');
 assert.equal(clock.getSnapshot(),90);assert.equal(hover.getSnapshot(),null);
 hover.receiveFrame(91);hover.preview(150);assert.equal(clock.getSnapshot(),91);assert.equal(hover.getSnapshot(),null);
});
test('repeated cancellation is harmless, preview clamps and does not seek the same frame twice',()=>{
 const {hover,seeks,clock}=setup();hover.preview(900);hover.preview(900);
 assert.deepEqual(seeks,[299]);hover.cancel();hover.cancel();assert.deepEqual(seeks,[299,30]);
 hover.preview(-2);assert.equal(hover.getSnapshot(),0);assert.equal(clock.getSnapshot(),30);
});
test('project reset drops temporary state without seeking the old project',()=>{
 const {hover,seeks,clock}=setup();hover.preview(90);hover.reset();clock.setFrame(0);
 assert.equal(hover.getSnapshot(),null);assert.deepEqual(seeks,[90]);hover.receiveFrame(0);assert.equal(clock.getSnapshot(),0);
});
