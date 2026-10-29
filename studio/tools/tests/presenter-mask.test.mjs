import test from 'node:test';
import assert from 'node:assert/strict';
import {presenterMaskGeometry} from '../../templates/remotion-base/src/editor/presenter-layer.mjs';
test('person mask keeps source cover fit and camera anchor',()=>{
 assert.deepEqual(presenterMaskGeometry({width:1080,height:1920},{width:2160,height:3840},1,{x:.5,y:.5}),{width:1080,height:1920,left:0,top:0});
 const g=presenterMaskGeometry({width:1080,height:1920},{width:2160,height:3840},1.1,{x:.29,y:.38});
 assert.ok(Math.abs(g.width-1188)<1e-9);assert.ok(Math.abs(g.left+31.32)<1e-9);assert.ok(Math.abs(g.top+72.96)<1e-9);
});
test('landscape foreground uses centered cover crop before camera transform',()=>{
 assert.deepEqual(presenterMaskGeometry({width:100,height:200},{width:400,height:200},2,{x:.25,y:.75}),{width:800,height:400,left:-325,top:-150});
});
