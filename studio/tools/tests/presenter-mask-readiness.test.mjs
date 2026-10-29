import test from 'node:test';import assert from 'node:assert/strict';import{createRequire}from'node:module';import{fileURLToPath}from'node:url';
const require=createRequire(new URL('../../templates/remotion-base/package.json',import.meta.url));
const compiled=require('esbuild').buildSync({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import{PresenterMask}from'./src/editor/PresenterForeground';import{Player}from'@remotion/player';const Content=(props)=>React.createElement(PresenterMask,props,React.createElement('span',null,'TITLE'));export const render=(props)=>renderToStaticMarkup(React.createElement(Player,{component:Content,inputProps:props,compositionWidth:1080,compositionHeight:1920,durationInFrames:90,fps:30}));`,resolveDir:fileURLToPath(new URL('../../templates/remotion-base',import.meta.url)),loader:'tsx'},bundle:true,platform:'node',format:'cjs',write:false,define:{'process.env.NODE_ENV':'"production"'}});
const m={exports:{}};new Function('require','module','exports',compiled.outputFiles[0].text)(require,m,m.exports);
const metadata={version:1,sourcePath:'source',sourcePublicPath:'source.mp4',sourceSha256:'a'.repeat(64),fps:30,sourceStartFrame:0,frameCount:90,width:1080,height:1920,framesPublicPath:'fg'};
const instance={id:'title',assetId:'behind-title',startFrame:0,durationFrames:90,props:{presenterLayer:'behind',presenterForeground:metadata,editorBackground:'transparent'}};
const document={canvas:{width:1080,height:1920,fps:{num:30,den:1},durationFrames:90},source:{path:'source',publicPath:'source.mp4',startFrame:0},instances:[instance]};
test('cold mask never exposes text through an undecoded CSS image',()=>{
 const html=m.exports.render({document,instance,frame:0});
 assert.match(html,/visibility:hidden/);
 assert.doesNotMatch(html,/mask-image:[^;]*\.png/);
 assert.match(html,/mask-image:url\(#presenter-mask-/);
});

test('Player uses the same lightweight atlas URL across consecutive frames',()=>{
 const first=m.exports.render({document,instance,frame:0}),later=m.exports.render({document,instance,frame:30});
 const urls=html=>[...html.matchAll(/href="([^" ]+)"/g)].map(match=>match[1]);
 assert.deepEqual(urls(first),urls(later));assert.ok(urls(first).every(url=>url.includes('/preview-mask-v1/')));
 assert.doesNotMatch(later,/feColorMatrix|\/000030\.png/);
});
