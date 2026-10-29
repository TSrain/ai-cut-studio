import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../..',import.meta.url));
const require=createRequire(resolve(root,'templates/remotion-base/package.json'));
const React=require('react'),remotion=require('remotion');
const componentPath=resolve(root,'templates/remotion-base/src/editor/SourcePip.tsx');
const localRequire=createRequire(componentPath);
const compiled=require('esbuild').transformSync(readFileSync(componentPath,'utf8'),{loader:'tsx',format:'cjs'}).code;
let frame=0,rendering=false;
const hooks={...React,useMemo:fn=>fn(),useState:()=>[null,()=>{}]};
const runtime={...remotion,useCurrentFrame:()=>frame,useVideoConfig:()=>({width:1080,height:1920,fps:30}),useRemotionEnvironment:()=>({isPlayer:!rendering,isRendering:rendering}),staticFile:p=>'/original/'+p};
const module={exports:{}};
new Function('require','module','exports',compiled)(id=>id==='react'?hooks:id==='remotion'?runtime:localRequire(id),module,module.exports);
const {SourcePip}=module.exports;
const doc={canvas:{durationFrames:500},source:{path:'source.mov',publicPath:'source.mov',startFrame:0,durationFrames:1000,clips:[{id:'a',startFrame:0,durationFrames:231,sourceInFrame:20},{id:'b',startFrame:231,durationFrames:150,sourceInFrame:400},{id:'c',startFrame:381,durationFrames:119,sourceInFrame:700}]}};
const sequences=(at,document=doc)=>{frame=at;return SourcePip({document,instance:null,previewSource:{path:'source.mov',url:'/proxy.mp4'}}).props.children;};
const remotionCjs=dirname(require.resolve('remotion'));
const envModule=require(resolve(remotionCjs,'use-remotion-environment.js'));
const configModule=require(resolve(remotionCjs,'use-video-config.js'));
const sequence=require(resolve(remotionCjs,'Sequence.js')).SequenceWithoutSchema;

test('prewarmed next video retains the real Remotion wrapper type on its first active frame',()=>{
 const oldEnv=envModule.useRemotionEnvironment,oldConfig=configModule.useVideoConfig;
 envModule.useRemotionEnvironment=()=>({isRendering:false});configModule.useVideoConfig=()=>({fps:30});
 try{
  const before=sequences(230).find(e=>e.key==='b'),after=sequences(231).find(e=>e.key==='b');
  assert.ok(before.props.premountFor>0);
  const oldTree=sequence.render(before.props,null),newTree=sequence.render(after.props,null);
  assert.equal(newTree.type,oldTree.type,'switching wrappers discards the video that was just warmed');
 }finally{envModule.useRemotionEnvironment=oldEnv;configModule.useVideoConfig=oldConfig;}
});
test('dense short source cuts keep only active and immediately next decoders eligible',()=>{
 const document={...doc,source:{...doc.source,clips:Array.from({length:40},(_,i)=>({id:String(i),startFrame:i,durationFrames:1,sourceInFrame:i*10}))}};
 for(let f=0;f<39;f++){
  const mounted=sequences(f,document).filter(e=>f>=e.props.from-(e.props.premountFor??0)&&f<e.props.from+e.props.durationInFrames);
  assert.deepEqual(mounted.map(e=>e.key),[String(f),String(f+1)]);
 }
});
test('rendering continues to use original media and no preview prewarming',()=>{
 rendering=true;
 try{for(const e of sequences(231)){assert.equal(e.props.layout,'none');assert.equal(e.props.premountFor,undefined);assert.equal(e.props.children.props.src,'/original/source.mov');}}
 finally{rendering=false;}
});

const {appendVideoFragment}=require(resolve(remotionCjs,'video/video-fragment.js'));
const browserSrc=(element)=>appendVideoFragment({actualSrc:element.props.children.props.src,actualFrom:-element.props.children.props.trimBefore,duration:element.props.children.props.trimBefore+element.props.durationInFrames,fps:30});
test('restoring either source edge does not change the browser media URL or restart its decoder',()=>{
 const before=sequences(100)[0];
 for(const patch of [{durationFrames:261},{sourceInFrame:5,durationFrames:246}]){
  const document={...doc,source:{...doc.source,clips:doc.source.clips.map((c,i)=>i?c:{...c,...patch})}};
  const after=sequences(100,document)[0];
  assert.equal(browserSrc(after),browserSrc(before),'expanding the media fragment reloads the video while dragging');
  assert.equal(after.props.children.props.trimBefore,patch.sourceInFrame??20,'source timing must still follow the trim');
 }
});
test('preview original fallback also has a stable URL when restoring footage',()=>{
 frame=100;
 const element=document=>SourcePip({document,instance:null}).props.children[0];
 const extended={...doc,source:{...doc.source,clips:doc.source.clips.map((c,i)=>i?c:{...c,durationFrames:261})}};
 assert.equal(browserSrc(element(extended)),browserSrc(element(doc)));
});
