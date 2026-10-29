import test from 'node:test';
import assert from 'node:assert/strict';
import * as pip from '../../templates/remotion-base/src/editor/source-pip.mjs';
import {defaultMediaProps,validateMediaProps} from '../../templates/remotion-base/src/editor/media-layout.mjs';
import {validateEditorProps} from '../lib/editor-props.mjs';

const full={size:100*1920/1080,x:50,y:50,crop:{x:0,y:0,width:1,height:1,sourceAspect:1920/1080},entrance:'none',exit:'none'};
test('full-canvas media can move horizontally and vertically without zero-span division',()=>{
 const g=pip.pipGeometry(1920,1080,90,45,30,{...full,offsetX:144,offsetY:-80});
 assert.equal(g.left,144);assert.equal(g.top,-80);assert.equal(g.width,1920);assert.equal(g.height,1080);
});
test('position editing preserves legacy placement and handles oversized media',()=>{
 assert.equal(typeof pip.pipPosition,'function');assert.equal(typeof pip.positionPip,'function');
 for(const size of [30,full.size,240]){
  const p={...full,size,x:78,y:72};
  const before=pip.pipGeometry(1920,1080,90,45,30,p);
  assert.deepEqual(pip.pipPosition(1920,1080,p),{x:before.left,y:before.top});
  const moved={...p,...pip.positionPip(1920,1080,p,{x:before.left+125,y:before.top-90})};
  const after=pip.pipGeometry(1920,1080,90,45,30,moved);
  assert.equal(after.left,before.left+125);assert.equal(after.top,before.top-90);
  assert.equal(after.width,before.width);assert.equal(after.height,before.height);
 }
});
test('pip offsets are validated before save and export',()=>{
 const instance={assetId:'source-pip',durationFrames:90,props:{offsetX:NaN}};
 assert.throws(()=>validateEditorProps(instance,90),/offsetX/);
 instance.props={offsetY:Infinity};assert.throws(()=>validateEditorProps(instance,90),/offsetY/);
 instance.props={offsetX:-144,offsetY:90};validateEditorProps(instance,90);
});
test('per-item media frame rejects invalid radius, border and color, accepts old projects',()=>{
 for(const asset of ['media-stack','media-split']){
  const p=defaultMediaProps(asset);validateMediaProps(asset,p);
  for(const bad of [{radius:-1},{radius:NaN},{borderWidth:81},{borderColor:'broken'}]){
   const next=structuredClone(p);Object.assign(next.items[0],bad);
   assert.throws(()=>validateMediaProps(asset,next));
  }
  Object.assign(p.items[0],{radius:60,borderWidth:12,borderColor:'#ffcc00'});validateMediaProps(asset,p);
 }
});
