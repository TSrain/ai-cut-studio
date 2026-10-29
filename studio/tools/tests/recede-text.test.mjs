import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {build} from '../../templates/remotion-base/node_modules/esbuild/lib/main.js';
const project=new URL('../../templates/remotion-base/',import.meta.url).pathname;
test('Recede explicit text color reaches emphasis runs without changing default hierarchy',async()=>{
 const result=await build({stdin:{contents:`
 import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
 import {RecedeBlock} from './src/style/baseline';
 import {recedeBreathOpacity} from './src/presets/Recede';
 export const breath=recedeBreathOpacity;
 import {PresetEditingProvider} from './src/editor/preset-editing';
 export const render=(edit)=>renderToStaticMarkup(<PresetEditingProvider elements={{line:edit}}><RecedeBlock lines={[[{text:'知识是',em:false},{text:'最慢',em:true}]]} baseSize={94} emphasisSize={130} maxLineWidthPx={936} level={2}/></PresetEditingProvider>);
 `,loader:'tsx',resolveDir:project},bundle:true,platform:'node',format:'esm',banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);const FontFace=class{async load(){return this}};const document={fonts:{add(){}}};"},write:false});
 const dir=mkdtempSync(path.join(tmpdir(),'recede-text-'));try{
 const file=path.join(dir,'entry.mjs');writeFileSync(file,result.outputFiles[0].text);const {render,breath}=await import(pathToFileURL(file).href);
 assert.match(render({color:'#ffffff',opacity:1}),/<span style="font-size:130px;color:inherit">最慢<\/span>/);
 assert.equal(breath(45,30,true),1);assert.equal(breath(75,30,true),1);assert.ok(breath(75,30,false)<1);
 assert.match(render({color:'#ff0000'}),/color:#ff0000/);
 assert.doesNotMatch(render({}),/color:inherit/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
