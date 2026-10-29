import test from 'node:test';import assert from 'node:assert/strict';
import {validateEditorProps} from '../lib/editor-props.mjs';
import {defaultMediaProps} from '../../templates/remotion-base/src/editor/media-layout.mjs';
import {editorAssetBackgroundMode,readPresetCatalog} from '../lib/preset-catalog.mjs';
import {coversSource} from '../../templates/remotion-base/src/editor/source-occlusion.mjs';
const instance=bg=>({assetId:'media-stack',startFrame:0,durationFrames:180,props:{...defaultMediaProps('media-stack'),sceneBackground:bg}});
test('invalid scene backgrounds cannot be saved',()=>{for(const bg of [{type:'bad'},{type:'solid',color:'url(http://x)'},{type:'wall-a',name:'',strength:4},{type:'wall-b',speed:-1}])assert.throws(()=>validateEditorProps(instance(bg),180,{fps:30}),/背景/);});
test('custom opaque backgrounds override otherwise transparent preset export contracts',()=>{assert.equal(editorAssetBackgroundMode('number-beat',{variant:{layout:'side'},sceneBackground:{type:'wall-a'}}),'opaque');assert.equal(editorAssetBackgroundMode('number-beat',{editorBackground:'transparent',sceneBackground:{type:'wall-a'}}),'transparent');});
test('custom background covers full source even for scaled nonresponsive foregrounds, within clip only',()=>{const i={...instance({type:'solid'}),props:{sceneBackground:{type:'solid'},tune:{scale:.5}}};assert.equal(coversSource(i,{},false,90),true);assert.equal(coversSource(i,{},false,180),false);assert.equal(coversSource({...i,props:{...i.props,editorBackground:'transparent'}},{},false,90),false);});

test('permanent wall controls reject invalid masks and signatures',()=>{
 for(const setting of [{centerStrength:-.1},{contentWidth:101},{contentHeight:0},{feather:0},{signatureScale:5},{signatureVisible:'yes'},{accent:'yellow'},{signatureX:-1}])
  assert.throws(()=>validateEditorProps(instance({type:'wall-a',...setting}),180,{fps:30}),/背景/);
 assert.doesNotThrow(()=>validateEditorProps(instance({type:'wall-a',centerStrength:1/3,contentWidth:65,contentHeight:60,feather:12,signatureVisible:true,signatureScale:1,signatureX:4.5,signatureY:4.5,accent:'#E8B45B'}),180,{fps:30}));
});

test('gradient backgrounds validate colors, geometry and type',()=>{
 assert.doesNotThrow(()=>validateEditorProps(instance({type:'gradient',color:'#10151C',color2:'#314966',gradientType:'linear',angle:135}),180,{fps:30}));
 for(const bg of [{color2:'url(x)'},{angle:Infinity},{angle:361},{gradientType:'unknown'}])assert.throws(()=>validateEditorProps(instance({type:'gradient',...bg}),180,{fps:30}),/背景/);
});
test('every catalog template including source PiP exports its selected background',()=>{
 for(const id of [...readPresetCatalog().map(p=>p.id),'source-pip','chapter-progress','media-stack','media-split'])
  for(const type of ['solid','gradient','wall-a']){
   assert.equal(editorAssetBackgroundMode(id,{editorBackground:'original',sceneBackground:{type}}),'opaque',id+' '+type);
   assert.equal(editorAssetBackgroundMode(id,{editorBackground:'transparent',sceneBackground:{type}}),'transparent',id+' transparent');
  }
});
