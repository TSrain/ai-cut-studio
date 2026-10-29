import test from 'node:test';import assert from 'node:assert/strict';
import {presenterFrame,validatePresenterLayer} from '../../templates/remotion-base/src/editor/presenter-layer.mjs';
import {planNativeComposite} from '../lib/editor-native-composite.mjs';
const m={version:1,sourcePath:'a',sourcePublicPath:'a.mov',sourceSha256:'a'.repeat(64),fps:30,sourceStartFrame:176,frameCount:180,width:1080,height:1920,framesPublicPath:'fg'};
const i={assetId:'number-beat',startFrame:0,durationFrames:60,props:{presenterLayer:'behind',presenterForeground:m,editorBackground:'transparent'}};
const d={canvas:{fps:{num:30,den:1},durationFrames:60},source:{path:'a',publicPath:'a.mov',startFrame:176},instances:[i]};
test('source trim and arbitrary seek select exact PNG',()=>{assert.equal(presenterFrame(d,i,0),'fg/000000.png');assert.equal(presenterFrame(d,i,59),'fg/000059.png');});
test('edited split source map is shared',()=>{const doc={...d,source:{...d.source,clips:[{startFrame:0,durationFrames:30,sourceInFrame:206},{startFrame:30,durationFrames:30,sourceInFrame:176}]}};assert.equal(presenterFrame(doc,i,0),'fg/000030.png');assert.equal(presenterFrame(doc,i,30),'fg/000000.png');});
test('stale source, unprepared trim and opaque assets rejected',()=>{assert.throws(()=>validatePresenterLayer({...d,source:{...d.source,path:'b'}},i),/不匹配/);assert.throws(()=>validatePresenterLayer({...d,source:{...d.source,startFrame:350}},i),/未覆盖/);assert.throws(()=>validatePresenterLayer(d,{...i,props:{...i.props,editorBackground:'original'}}),/透明/);});
test('native composite cannot bypass foreground',()=>assert.equal(planNativeComposite(d,{renderMode:'full',extension:'mp4'}),null));
import {mkdtempSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {validatePresenterAssets,sourceDigest} from '../lib/presenter-foreground.mjs';
test('actual changed source and missing PNG fail before export',()=>{
 const root=mkdtempSync(join(tmpdir(),'presenter-test-'));try{writeFileSync(join(root,'a.mov'),'original');mkdirSync(join(root,'fg'));writeFileSync(join(root,'fg','000000.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'));const metadata={...m,sourceSha256:sourceDigest(join(root,'a.mov')),frameCount:1,width:1,height:1};const instance={...i,durationFrames:1,props:{...i.props,presenterForeground:metadata}};const document={...d,canvas:{...d.canvas,durationFrames:1},instances:[instance]};assert.equal(validatePresenterAssets(document,{publicRoot:root}),true);assert.throws(()=>validatePresenterAssets(document,{publicRoot:root,renderMode:'layer'}),/完整/);rmSync(join(root,'fg','000000.png'));assert.throws(()=>validatePresenterAssets(document,{publicRoot:root}),/缺帧/);assert.equal(validatePresenterAssets({...document,tracks:[{id:'hidden',disabled:true}],instances:[{...instance,trackId:'hidden'}]},{publicRoot:root}),true);writeFileSync(join(root,'a.mov'),'changed');assert.throws(()=>validatePresenterAssets(document,{publicRoot:root}),/变更/);}finally{rmSync(root,{recursive:true,force:true});}
});

import {validatePresenterSourceClock} from '../lib/presenter-foreground.mjs';
const clock=(timestamps)=>({streams:[{avg_frame_rate:'30/1',r_frame_rate:'30/1',sample_aspect_ratio:'1:1',time_base:'1/15360'}],frames:timestamps.map(t=>({best_effort_timestamp_time:t}))});
test('CFR requires actual uniform zero-based PTS even when both headers say 30 fps',()=>{
 assert.equal(validatePresenterSourceClock(clock(['0.000000','0.033333','0.066667']),30,{frameCount:3}).frameCount,3);
 for(const times of [['0.000000','0.020000','0.066667'],['0.010000','0.043333','0.076667'],['0.000000','0.033333','0.033333'],['0.000000','','0.066667']])assert.throws(()=>validatePresenterSourceClock(clock(times),30),/时间戳/);
 assert.throws(()=>validatePresenterSourceClock(clock(['0.000000']),30,{frameCount:2}),/超出/);
 assert.throws(()=>validatePresenterSourceClock({...clock(['0.000000']),frames:[]},30),/时间戳/);
 const coarse=clock(['0.000000','0.033333','0.100000']);coarse.streams[0].time_base='1/30';assert.throws(()=>validatePresenterSourceClock(coarse,30),/时间戳/);
 const quantized=clock(['0.000000','0.033000','0.067000']);quantized.streams[0].time_base='1/1000';assert.equal(validatePresenterSourceClock(quantized,30).frameCount,3);
});
