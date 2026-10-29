import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveSceneBackground,validateSceneBackground} from '../../templates/remotion-base/src/editor/scene-background.mjs';
import {editorAssetBackgroundMode,readPresetCatalog} from '../lib/preset-catalog.mjs';
import {exportDocumentForItem,prepareExportDocument} from '../lib/editor-export.mjs';
const instance={id:'blur',assetId:'number-beat',assetVersion:1,startFrame:30,durationFrames:60,zIndex:1,props:{sceneBackground:{type:'video-blur'}}};
const doc={schemaVersion:1,id:'test',name:'test',revision:0,canvas:{width:1280,height:720,fps:{num:30,den:1},durationFrames:150},source:{path:'source.mp4',publicPath:'source.mp4',startFrame:15,clips:[{id:'cut-a',startFrame:0,durationFrames:60,sourceInFrame:15},{id:'cut-b',startFrame:60,durationFrames:90,sourceInFrame:300}]},instances:[instance],tracks:[]};
const item={renderMode:'instances',instanceId:'blur',rangeStartFrame:30,durationFrames:60};
test('video blur settings resolve, validate and respect transparent override',()=>{
 assert.equal(resolveSceneBackground(instance.props)?.type,'video-blur');
 assert.equal(resolveSceneBackground(instance.props)?.blur,20);
 for(const blur of [0,20,80])assert.doesNotThrow(()=>validateSceneBackground({type:'video-blur',blur}));
 for(const blur of [-1,81,NaN,Infinity,'20'])assert.throws(()=>validateSceneBackground({type:'video-blur',blur}),/背景/);
 assert.equal(resolveSceneBackground({...instance.props,editorBackground:'transparent'}),null);
 assert.throws(()=>validateSceneBackground({type:'wall-a',blur:21}),/背景/);
});
test('all background-capable assets classify video blur as opaque',()=>{
 for(const id of [...readPresetCatalog().map(p=>p.id),'source-pip','chapter-progress','media-stack','media-split'])assert.equal(editorAssetBackgroundMode(id,instance.props),'opaque',id);
});
test('isolated and layer exports keep the edited source clock for the video background',()=>{
 for(const renderMode of ['instances','layer','full'])assert.deepEqual(exportDocumentForItem(doc,{...item,renderMode}).source,doc.source);
 assert.deepEqual(prepareExportDocument(doc,'single-layer',{kind:'instance',id:'blur'}).source,doc.source);
 assert.equal(doc.source.clips[1].sourceInFrame,300);
});
test('missing video source fails explicitly rather than exporting a black background',()=>{
 assert.throws(()=>exportDocumentForItem({...doc,source:null},item),/动态模糊视频.*底片/);
});
test('transparent overrides and disabled backgrounds do not require the source',()=>{
 const transparent={...doc,source:null,instances:[{...instance,props:{...instance.props,editorBackground:'transparent'}}]};
 assert.equal(exportDocumentForItem(transparent,item).source,null);
 assert.doesNotThrow(()=>exportDocumentForItem({...doc,source:null,instances:[{...instance,disabled:true}]},item));
 assert.doesNotThrow(()=>exportDocumentForItem({...doc,source:null,tracks:[{id:'t',disabled:true}],instances:[{...instance,trackId:'t'}]},item));
});
