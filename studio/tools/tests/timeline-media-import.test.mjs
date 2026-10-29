import test from 'node:test';
import assert from 'node:assert/strict';
import {placeImportedMedia} from '../editor/timeline-media-import.mjs';
import {editHistory,undoHistory,redoHistory} from '../editor/history.mjs';
const doc=()=>({id:'one',revision:0,canvas:{width:1920,height:1080,fps:{num:30,den:1},durationFrames:300},tracks:[{id:'old',name:'手动',locked:true}],instances:[{id:'old-clip',assetId:'source-pip',assetVersion:1,startFrame:0,durationFrames:300,trackId:'old',zIndex:0,props:{}}],source:{path:'main.mp4',startFrame:0}});
const image={kind:'image',name:'图片',publicPath:'a.png',path:'public/a.png',width:640,height:480};
const video={kind:'video',name:'视频',publicPath:'b.mp4',path:'public/b.mp4',width:1920,height:1080,durationSeconds:5};
let n=0;const create=(assetId,d,startFrame)=>({id:`new-${++n}`,assetId,assetVersion:1,startFrame,durationFrames:1,props:{},zIndex:0});
test('batch begins at captured playhead, preserves full durations and uses a new top track',()=>{
 const original=doc(),before=structuredClone(original),result=placeImportedMedia(original,[image,video],240,create),clips=result.document.instances.slice(1);
 assert.deepEqual(clips.map(c=>[c.startFrame,c.durationFrames]),[[240,90],[330,150]]);
 assert.equal(result.document.canvas.durationFrames,480);
 assert.equal(clips[0].trackId,clips[1].trackId);
 assert.equal(clips[0].trackId,result.document.tracks.at(-1).id);
 assert.notEqual(clips[0].trackId,'old');
 assert.equal(result.document.source.clips[0].durationFrames,300);
 assert.deepEqual(result.document.instances[0],before.instances[0]);
 assert.deepEqual(original,before);
 assert.equal(clips[0].assetReferences.media,image.path);
});
test('a batch is undoable and redoable as a single edit',()=>{
 const original=doc(),result=placeImportedMedia(original,[image,video],120,create);
 const history=editHistory({past:[],present:original,future:[]},result.document);
 assert.deepEqual(undoHistory(history).present,original);
 assert.deepEqual(redoHistory(undoHistory(history)).present,result.document);
});
test('image duration follows fractional project fps and empty/invalid batches cannot mutate source',()=>{
 const original=doc();original.canvas.fps={num:30000,den:1001};
 assert.equal(placeImportedMedia(original,[image],0,create).document.instances.at(-1).durationFrames,Math.round(3*30000/1001));
 assert.equal(placeImportedMedia(original,[],0,create).document,original);
 assert.throws(()=>placeImportedMedia(original,[{...video,durationSeconds:NaN}],0,create),/时长/);
 assert.equal(original.instances.length,1);
});
