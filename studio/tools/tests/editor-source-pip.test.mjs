import {pipFitSize,pipDimensions,pipPositionPercent,pipMediaTiming} from '../../templates/remotion-base/src/editor/source-pip.mjs';
import {applyImportedSource} from '../editor/import-document.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {pipGeometry, pipTrimBefore, activePip, PIP_DEFAULTS, cropRect, editCropRect} from '../../templates/remotion-base/src/editor/source-pip.mjs';
import {validateEditorProps} from '../lib/editor-props.mjs';
import {planEditorExport} from '../lib/editor-export.mjs';
const shot = {id:'pip', assetId:'source-pip', startFrame:150, durationFrames:30, zIndex:2, props:{...PIP_DEFAULTS, cropRect, editCropRect}};
test('source offset plus instance start; moved instance follows main timeline',()=>{
 assert.equal(pipTrimBefore({startFrame:90},shot),240);
 assert.equal(pipTrimBefore({startFrame:90},{...shot,startFrame:300}),390);
 // Sequence local frame is globalFrame - instance.startFrame, including range exports.
 assert.equal(pipTrimBefore({startFrame:90},shot) + (167-shot.startFrame),257);
});
test('missing source is empty; half-open interval; top pip wins overlaps',()=>{
 assert.equal(activePip(null,[shot],160),null);
 assert.equal(activePip({},[shot],149),null);
 assert.equal(activePip({},[shot],180),null);
 assert.equal(activePip({},[shot,{...shot,id:'top',zIndex:3}],160).id,'top');
});
test('shrink starts and ends fullscreen with square hold, no overlap on short clips',()=>{
 const g=f=>pipGeometry(1920,1080,180,f,30,PIP_DEFAULTS);
 assert.equal(g(0).width,1920); assert.equal(g(179).width,1920);
 assert.equal(g(60).width,g(60).height); assert.equal(g(60).radius,32);
 for(let f=0;f<8;f++) assert.ok(Number.isFinite(pipGeometry(1920,1080,8,f,30,PIP_DEFAULTS).width));
});
test('static has square shape and editable crop; invalid props rejected',()=>{
 assert.equal(pipGeometry(1080,1920,30,0,30,{...PIP_DEFAULTS,entrance:'none',exit:'none'}).width,324);
 assert.doesNotThrow(()=>validateEditorProps(shot,600));
 assert.throws(()=>validateEditorProps({...shot,props:{...PIP_DEFAULTS,cropX:101}},600));
});
test('isolated export preserves start frame and uses alpha',()=>{
 const row=planEditorExport({canvas:{fps:{num:30,den:1}},instances:[shot]},'instances')[0];
 assert.equal(row.rangeStartFrame,150); assert.equal(row.extension,'mov');
});

test('free crop preserves source proportions and is bounded when moved or resized',()=>{
 const crop={x:.25,y:.1,width:.4,height:.7,sourceAspect:16/9};
 const rect=cropRect({crop},16/9);
 assert.deepEqual(rect,crop);
 const g=pipGeometry(1920,1080,180,60,30,{crop});
 assert.ok(Math.abs(g.width/g.height-(.4*16/9/.7))<1e-8);
 const moved=editCropRect(crop,'move',2,-2);
 assert.equal(moved.x,.6); assert.equal(moved.y,0);
 const resized=editCropRect(crop,'se',2,2);
 assert.equal(resized.width,.75); assert.equal(resized.height,.9);
 const min=editCropRect(crop,'nw',2,2);
 assert.ok(min.width>=.05-1e-8 && min.height>=.05-1e-8);
});
test('legacy centered square crop survives and all motion modes settle without distortion',()=>{
 const c=cropRect({cropX:50,cropY:50},16/9);
 assert.equal(c.width,9/16); assert.equal(c.height,1);
 for (const mode of ['slide-left','slide-right','slide-up','slide-down','pop','flip']) {
  const props={entrance:mode,exit:mode};
  assert.doesNotThrow(()=>validateEditorProps({...shot,props},600));
  const start=pipGeometry(1920,1080,60,0,30,props), hold=pipGeometry(1920,1080,60,30,30,props), end=pipGeometry(1920,1080,60,59,30,props);
  assert.equal(hold.scale,1); assert.equal(hold.rotateY,0); assert.equal(hold.opacity,1);
  assert.ok(start.opacity===0 || start.scale===0 || start.left<0 || start.left>=1920 || start.top<0 || start.top>=1080 || Math.abs(start.rotateY)===90);
  assert.equal(start.opacity,end.opacity);
 }
});
test('crop validation rejects overflowing and nonfinite coordinates; wider borders supported',()=>{
 assert.doesNotThrow(()=>validateEditorProps({...shot,props:{borderWidth:50,crop:{x:0,y:0,width:.4,height:.8,sourceAspect:16/9}}},600));
 for (const crop of [{x:.8,y:0,width:.5,height:1,sourceAspect:1},{x:0,y:0,width:0,height:1,sourceAspect:1},{x:0,y:0,width:1,height:1,sourceAspect:NaN}]) assert.throws(()=>validateEditorProps({...shot,props:{crop}},600));
});

test('replacing the source updates explicit crop aspect without moving its normalized bounds',()=>{
 const doc={canvas:{width:1920,height:1080,fps:{num:30,den:1},durationFrames:600},source:null,instances:[{...shot,props:{crop:{x:.2,y:.1,width:.5,height:.7,sourceAspect:16/9}}}]};
 const next=applyImportedSource(doc,{path:'portrait.mp4',durationSeconds:20,canvas:{width:1080,height:1920,fps:{num:30,den:1},durationFrames:600}});
 assert.equal(next.instances[0].props.crop.sourceAspect,9/16);
 assert.equal(next.instances[0].props.crop.x,.2);
});

test('independent footage never takes over the main synchronized window',()=>{
 const footage={...shot,id:'footage',zIndex:8,props:{sourceMode:'media',media:{kind:'video',publicPath:'editor-imports/demo.mp4',width:1920,height:1080,durationSeconds:20,startSeconds:2}}};
 assert.equal(activePip({},[shot,footage],160).id,shot.id);
 assert.equal(activePip({},[footage],160),null);
 assert.doesNotThrow(()=>validateEditorProps(footage,600));
 for (const media of [{...footage.props.media,publicPath:'../secret.mp4'},{...footage.props.media,startSeconds:20},{...footage.props.media,width:0},{...footage.props.media,kind:'audio'}]) assert.throws(()=>validateEditorProps({...footage,props:{sourceMode:'media',media}},600));
});

test('independent media timing starts locally, freezes the actual last frame, and handles short clips',()=>{
 const media={startSeconds:2,durationSeconds:8};
 assert.deepEqual(pipMediaTiming(media,0,30),{trim:60,available:180,sourceFrame:60});
 assert.equal(pipMediaTiming(media,1000,30).sourceFrame,239);
 assert.equal(pipMediaTiming({durationSeconds:.133333},3,30).sourceFrame,3);
 assert.equal(pipMediaTiming({durationSeconds:.15},4,30).available,5);
 assert.equal(pipMediaTiming({durationSeconds:.1,startSeconds:.099},0,30).trim,2);
});

test('large windows validate, fit the canvas without changing crop, and keep legacy size semantics',()=>{
 for(const size of [70,180,300]) assert.doesNotThrow(()=>validateEditorProps({...shot,props:{size}},600));
 assert.throws(()=>validateEditorProps({...shot,props:{size:301}},600));
 const props={crop:{x:0,y:0,width:1,height:1,sourceAspect:16/9}};
 assert.equal(pipDimensions(1920,1080,{...props,size:70}).width,756);
 const fit=pipFitSize(1920,1080,props);
 const dims=pipDimensions(1920,1080,{...props,size:fit});
 assert.ok(Math.abs(dims.width-1920)<1e-8 && Math.abs(dims.height-1080)<1e-8);
 assert.equal(pipFitSize(1920,1080,{}),100);
 const portrait={crop:{...props.crop,sourceAspect:9/16}};
 assert.ok(Math.abs(pipFitSize(1080,1920,portrait)-fit)<1e-8);
 assert.equal(pipFitSize(5000,1000,{crop:{...props.crop,sourceAspect:5}}),300);
});
test('dragging fitted or oversized windows preserves finite positions',()=>{
 assert.equal(pipPositionPercent(0,0,78),78);
 assert.equal(pipPositionPercent(20,1e-10,50),50);
 assert.equal(pipPositionPercent(-100,-200),50);
 assert.equal(pipPositionPercent(150,200),75);
 assert.equal(pipPositionPercent(300,200),100);
});
