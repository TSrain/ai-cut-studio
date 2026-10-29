import test from 'node:test';
import assert from 'node:assert/strict';
import * as media from '../editor/media-clip.mjs';
import {placeInstance} from '../editor/timeline-model.mjs';
const doc={canvas:{width:1920,height:1080,fps:{num:30,den:1},durationFrames:300},source:{path:'main.mp4',clips:[{id:'source-main',name:'主视频',startFrame:0,sourceInFrame:0,durationFrames:300}]},instances:[],tracks:[]};
const base={id:'asset-1',assetId:'source-pip',assetVersion:1,startFrame:90,durationFrames:180,zIndex:0,props:{}};
test('image insertion preserves whole image and uses three seconds at playhead',()=>{
 assert.equal(typeof media.configureMediaClip,'function');
 const clip=media.configureMediaClip(base,{publicPath:'project/a.png',width:800,height:1200},'image',doc,'图片');
 assert.equal(clip.startFrame,90);assert.equal(clip.durationFrames,90);
 assert.deepEqual(clip.props.crop,{x:0,y:0,width:1,height:1,sourceAspect:2/3});
 assert.equal(clip.props.radius,0);assert.equal(clip.props.entrance,'none');assert.equal(clip.props.mediaName,'图片');
 const next=placeInstance(doc,clip);assert.deepEqual(next.source,doc.source);assert.equal(next.instances.length,1);
});
test('video uses its duration, clipped by remaining timeline and source starts at zero',()=>{
 assert.equal(typeof media.configureMediaClip,'function');
 const meta={publicPath:'project/a.mp4',canvas:{width:1920,height:1080},durationSeconds:2};
 const clip=media.configureMediaClip(base,meta,'video',doc,'录屏');
 assert.equal(clip.durationFrames,60);assert.equal(clip.props.media.startSeconds,0);
 const end=media.configureMediaClip({...base,startFrame:290},meta,'video',doc,'录屏');assert.equal(end.durationFrames,10);
 assert.equal(end.props.durationSeconds,10/30);assert.equal(clip.props.sourceMode,'media');
});
test('invalid media fails before it can enter the document',()=>{
 assert.equal(typeof media.configureMediaClip,'function');
 assert.throws(()=>media.configureMediaClip(base,{publicPath:'a.png',width:0,height:10},'image',doc,'bad'),/尺寸/);
 assert.throws(()=>media.configureMediaClip(base,{publicPath:'a.mp4',width:10,height:10,durationSeconds:NaN},'video',doc,'bad'),/时长/);
});

import {trimClip,splitSelection} from '../editor/timeline-model.mjs';
test('image edges can extend beyond initial duration in both directions and extend the canvas',()=>{
 const clip=media.configureMediaClip(base,{publicPath:'project/a.png',width:800,height:1200},'image',doc,'图片');
 const original=placeInstance(doc,clip);
 const longer=trimClip(original,clip.id,'right',180);
 assert.equal(longer.instances[0].durationFrames,270);
 assert.equal(longer.canvas.durationFrames,360);
 assert.equal(longer.instances[0].sourceOffsetFrames,0);
 assert.equal(longer.instances[0].sourceDurationFrames,270);
 const left=trimClip(original,clip.id,'left',-30);
 assert.equal(left.instances[0].startFrame,60);assert.equal(left.instances[0].durationFrames,120);
 const short=trimClip(longer,clip.id,'right',-240);
 assert.equal(short.instances[0].durationFrames,30);
 assert.equal(short.instances[0].props.durationSeconds,1);
 assert.deepEqual(original.source,doc.source);
 assert.equal(original.instances[0].durationFrames,90);
});
test('split images remain extendable and image extension respects neighbors and locks',()=>{
 const clip=media.configureMediaClip(base,{publicPath:'a.png',width:800,height:1200},'image',doc,'图片');
 const original=placeInstance(doc,clip);
 const split=splitSelection(original,[clip.id],120,()=> 'split-image');
 assert.equal(trimClip(split,'split-image','right',60).instances[1].durationFrames,120);
 assert.throws(()=>trimClip(split,clip.id,'right',30),/重叠/);
 const locked=structuredClone(original);locked.tracks[0].locked=true;
 assert.equal(trimClip(locked,clip.id,'right',90).instances[0].durationFrames,90);
});
test('video trims still respect finite source duration',()=>{
 const clip=media.configureMediaClip(base,{publicPath:'a.mp4',width:800,height:1200,durationSeconds:2},'video',doc,'视频');
 const original=placeInstance(doc,clip);
 assert.equal(trimClip(original,clip.id,'right',180).instances[0].durationFrames,60);
});
