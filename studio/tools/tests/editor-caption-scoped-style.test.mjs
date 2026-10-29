import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import * as captions from '../../templates/remotion-base/src/editor/captions.mjs';
import {captionSpans,runHybrid} from '../lib/editor-hybrid.mjs';
import {createDocument,saveDocument,loadDocument} from '../lib/editor-store.mjs';
const track=()=>({version:1,enabled:true,style:{...captions.DEFAULT_CAPTION_STYLE},cues:[0,1,2].map(n=>({id:`c${n}`,startFrame:n*2,endFrame:n*2+2,text:'同一句',originalText:'同一句'}))});

test('effective styles resolve defaults, track, cue and mixed selections',()=>{
 assert.equal(typeof captions.resolveCaptionStyle,'function');
 const t=track();delete t.style.positionXPercent;t.cues[0].style={color:'#f00',bottomPercent:30};t.cues[1].style={color:'#f00',bottomPercent:20};
 assert.equal(captions.resolveCaptionStyle(t,t.cues[0]).positionXPercent,50);
 assert.equal(captions.resolveCaptionStyle(t,t.cues[0]).color,'#f00');
 const values=captions.captionStyleValues(t,['c0','c1']);assert.deepEqual(values.mixed,['bottomPercent']);assert.equal(values.style.bottomPercent,30);
 assert.deepEqual(captions.captionStyleValues(t,[]),{style:captions.resolveCaptionStyle(t),mixed:[]});
});

test('selected patches and resets preserve other cues and make no mutation',()=>{
 assert.equal(typeof captions.patchCaptionStyles,'function');
 const t=track();t.cues[0].style={bottomPercent:30};const before=structuredClone(t);
 const next=captions.patchCaptionStyles(t,['c0','c2'],{color:'#ff0'});
 assert.deepEqual(t,before);assert.deepEqual(next.cues[0].style,{bottomPercent:30,color:'#ff0'});assert.deepEqual(next.cues[2].style,{color:'#ff0'});assert.equal(next.cues[1].style,undefined);assert.deepEqual(next.style,t.style);
 assert.equal(captions.patchCaptionStyles(t,[],{color:'#ff0'}),t);
 const reset=captions.resetCaptionStyles(next,['c0']);assert.equal(reset.cues[0].style,undefined);assert.deepEqual(reset.cues[2].style,{color:'#ff0'});assert.deepEqual(reset.style,t.style);
});

test('global patches remove only matching local overrides across every cue',()=>{
 assert.equal(typeof captions.patchCaptionStyles,'function');
 const t=track();t.cues[0].style={color:'#f00',bottomPercent:30};t.cues[1].style={color:'#0f0'};
 const next=captions.patchCaptionStyles(t,[],{color:'#ff0'},'all');
 assert.equal(next.style.color,'#ff0');assert.deepEqual(next.cues[0].style,{bottomPercent:30});assert.equal(next.cues[1].style,undefined);
 assert.ok(next.cues.every(c=>captions.resolveCaptionStyle(next,c).color==='#ff0'));
});

test('strict local validation and batch patch rejection are atomic and keep legacy styles valid',()=>{
 const t=track();delete t.style.positionXPercent;assert.equal(captions.validateCaptionTrack(t),true);
 for(const style of [null,[],1,'bad',{unknown:1},{fontSize:NaN},{positionXPercent:-1},{positionXPercent:101},{positionXPercent:undefined},{color:'red'},{fontFamily:'missing'},{backgroundOpacity:2}]){
  const invalid=structuredClone(t);invalid.cues[1].style=style;assert.throws(()=>captions.validateCaptionTrack(invalid),/字幕/,JSON.stringify(style));
 }
 assert.equal(typeof captions.patchCaptionStyles,'function');const before=structuredClone(t);
 assert.throws(()=>captions.patchCaptionStyles(t,['c0','c1'],{fontSize:80,color:'bad'}),/字幕/);assert.deepEqual(t,before);
 assert.throws(()=>captions.patchCaptionStyles(t,['c0'],{color:'#fff'},'typo'),/字幕/);
});

test('saving and reopening preserves per-cue overrides',()=>{
 const root=mkdtempSync(join(tmpdir(),'caption-style-store-'));
 try{const t=track();t.cues[0].style={positionXPercent:25,color:'#f00'};
 const d=createDocument({schemaVersion:1,id:'style-test',name:'测试',revision:0,canvas:{width:1920,height:1080,fps:{num:30,den:1},durationFrames:6},source:null,instances:[],styleReference:{contractPath:null,styleframePath:null,allowedOverrides:{}},captions:t});
 const saved=saveDocument(d,{rootDir:root});assert.deepEqual(loadDocument(saved.id,{rootDir:root}).captions,t);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('actual React caption rendering uses local position and style only on its cue',()=>{
 const require=createRequire(new URL('../../templates/remotion-base/package.json',import.meta.url));
 const compiled=require('esbuild').buildSync({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {CaptionLayer} from './src/editor/CaptionLayer';export const render=(props)=>renderToStaticMarkup(React.createElement(CaptionLayer,props));`,resolveDir:fileURLToPath(new URL('../../templates/remotion-base',import.meta.url)),loader:'tsx'},bundle:true,platform:'node',format:'cjs',write:false});
 const module={exports:{}};new Function('require','module','exports',compiled.outputFiles[0].text)(require,module,module.exports);
 const t=track();t.cues[0].style={positionXPercent:25,color:'#ff0000',fontSize:80,bottomPercent:30};
 const props={track:t,frame:0,width:960,height:540,renderMode:'full'};
 const local=module.exports.render(props);assert.match(local,/left:25%/);assert.match(local,/bottom:30%/);assert.match(local,/font-size:40px/);assert.match(local,/color:#ff0000/);
 const global=module.exports.render({...props,frame:2});assert.match(global,/left:50%/);assert.match(global,/font-size:26px/);assert.match(global,/bottom:8%/);
});

test('hybrid spans coalesce equal effective styles but retain adjacent same-text style changes',()=>{
 const t=track();t.cues[0].style={color:'#ff0000'};t.cues[1].style={color:'#00ff00'};t.cues[2].style={color:'#00ff00'};
 assert.deepEqual(captionSpans(t,0,6).map(s=>[s.start,s.end,s.text]),[[0,2,'同一句'],[2,6,'同一句']]);
 t.cues[0].style={color:t.style.color};delete t.cues[1].style;delete t.cues[2].style;assert.equal(captionSpans(t,0,6).length,1);
});

test('hybrid export renders separate plates for same text with different styles and reuses identical styles',async()=>{
 const root=mkdtempSync(join(tmpdir(),'caption-style-export-'));
 try{const t=track();t.cues[0].style={color:'#ff0000',positionXPercent:25};t.cues[1].style={color:'#00ff00',positionXPercent:75};t.cues[2].style={...t.cues[0].style};
 const d={canvas:{width:64,height:36,fps:{num:30,den:1},durationFrames:6},source:null,instances:[],captions:t};let rendered=[];
 const result=await runHybrid({source:null,direct:[],groups:[],publicRoot:root},d,{renderMode:'full',extension:'mp4',rangeStartFrame:0,durationFrames:6},{outputPath:join(root,'out.mp4'),workRoot:root,hardware:false,renderPlate:async props=>{
  const c=props.document.captions.cues[0];rendered.push(c);const file=join(root,`plate-${rendered.length}.png`);
  execFileSync('/usr/bin/python3',['-c',"from PIL import Image;import sys;Image.new('RGBA',(64,36),sys.argv[2]).save(sys.argv[1])",file,c.style?.color??'#ffffff']);return file;
 }});
 assert.equal(rendered.length,2);assert.deepEqual(rendered.map(c=>c.style),[t.cues[0].style,t.cues[1].style]);assert.equal(result.captionPlates,2);
 const raw=execFileSync('ffmpeg',['-v','error','-i',join(root,'out.mp4'),'-f','rawvideo','-pix_fmt','rgb24','-']);
 const pixel=f=>[...raw.subarray(f*64*36*3,f*64*36*3+3)];assert.ok(pixel(0)[0]>200);assert.ok(pixel(2)[1]>200);assert.ok(pixel(4)[0]>200);
 }finally{rmSync(root,{recursive:true,force:true});}
});
