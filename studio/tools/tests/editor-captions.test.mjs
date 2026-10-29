import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDocument,validateDocument,saveDocument,loadDocument} from '../lib/editor-store.mjs';
import {retimeEditorDocument} from '../lib/editor-framerate.mjs';
import {editHistory,undoHistory,redoHistory,resizeTimeline} from '../editor/history.mjs';
const style={fontFamily:'Noto Sans SC',fontSize:52,color:'#ffffff',backgroundColor:'#000000',backgroundOpacity:.45,bottomPercent:8,maxWidthPercent:84,paddingX:24,paddingY:10,borderRadius:8};
const track=()=>({version:1,enabled:true,style:{...style},cues:[{id:'c1',startFrame:30,endFrame:90,text:'改过的字幕',originalText:'原始转写'}]});
const doc=()=>({schemaVersion:1,id:'captions-test',name:'字幕测试',revision:0,canvas:{width:1920,height:1080,fps:{num:30,den:1},durationFrames:300},source:{path:'input.mp4',startFrame:60},instances:[],styleReference:{contractPath:null,styleframePath:null,allowedOverrides:{}},captions:track()});
test('创建和持久化独立字幕轨，历史保留原句与用户修改',()=>{
 const input=doc(),created=createDocument(input);assert.deepEqual(created.captions,input.captions);
 const root=mkdtempSync(join(tmpdir(),'caption-store-'));
 try{const saved=saveDocument(created,{rootDir:root});saved.captions.cues[0].text='再次改字';const second=saveDocument(saved,{rootDir:root});assert.equal(loadDocument(second.id,{rootDir:root}).captions.cues[0].text,'再次改字');const old=JSON.parse(readFileSync(join(root,created.id,'history/1.json'),'utf8'));assert.equal(old.captions.cues[0].originalText,'原始转写');assert.equal(old.captions.cues[0].text,'改过的字幕');}finally{rmSync(root,{recursive:true,force:true});}
});
test('文档校验拒绝坏字幕时间、重复ID、非有限样式与重叠',()=>{
 for(const mutate of [t=>t.cues[0].endFrame=30,t=>t.cues[0].endFrame=301,t=>t.cues.push({...t.cues[0]}),t=>t.style.backgroundOpacity=NaN,t=>t.cues[0].originalText=null,t=>t.enabled='false',t=>t.cues.push({id:'c2',startFrame:80,endFrame:100,text:'重叠',originalText:'重叠'})]){const d=doc();mutate(d.captions);assert.throws(()=>validateDocument(d),/caption|字幕/i);}
});
test('缩短时间轴不会悄悄删除字幕，撤销重做保存全文',()=>{
 const d=doc();assert.throws(()=>resizeTimeline(d,60),/字幕/);assert.deepEqual(resizeTimeline(d,360).captions,d.captions);
 const next=structuredClone(d);next.captions.cues[0].text='新的字';const history=editHistory({past:[],present:d,future:[]},next);assert.equal(undoHistory(history).present.captions.cues[0].text,'改过的字幕');assert.equal(redoHistory(undoHistory(history)).present.captions.cues[0].text,'新的字');
});
test('换帧率保存秒位置，不能把极短字幕折叠为零帧或静默删除',()=>{
 const d=doc();const changed=retimeEditorDocument(d,60);assert.deepEqual(changed.captions.cues.map(c=>[c.startFrame,c.endFrame]),[[60,180]]);assert.equal(changed.captions.cues[0].originalText,'原始转写');
 d.canvas.fps={num:60,den:1};d.captions.cues=[{id:'tiny',startFrame:0,endFrame:1,text:'短',originalText:'短'}];assert.throws(()=>retimeEditorDocument(d,24),/字幕/);
});

// Keep the import dynamic so an unimplemented API is an explicit assertion failure.
const captions=await import('../../templates/remotion-base/src/editor/captions.mjs');
test('源识别键与编辑样式无关，只在媒体或时间映射变化时改变',()=>{
 assert.equal(typeof captions.captionSourceKey,'function');const d=doc(),key=captions.captionSourceKey(d);
 d.captions.cues[0].text='只改字';d.name='改名';assert.equal(captions.captionSourceKey(d),key);
 d.source.startFrame++;assert.notEqual(captions.captionSourceKey(d),key);
});
test('全源秒级字幕正确减去源入点，不把裁剪前的声音映射到片中',()=>{
 assert.equal(typeof captions.cuesToCaptionTrack,'function');
 const result=captions.cuesToCaptionTrack([{start:0,end:1,text:'片前'},{start:2,end:3,text:'保留'},{start:11.5,end:13,text:'截尾'}],doc());
 assert.deepEqual(result.cues.map(c=>[c.startFrame,c.endFrame,c.text]),[[0,30,'保留'],[285,300,'截尾']]);assert.equal(result.cues[0].originalText,'保留');
});
test('显式source.clips按绝对源帧映射空隙、乱序与重复素材，空clips不回退全片',()=>{
 assert.equal(typeof captions.cuesToCaptionTrack,'function');const d=doc();d.source.clips=[{id:'later',startFrame:120,durationFrames:30,sourceInFrame:90},{id:'first',startFrame:0,durationFrames:30,sourceInFrame:90}];
 const result=captions.cuesToCaptionTrack([{start:3,end:4,text:'重复出现'}],d);assert.deepEqual(result.cues.map(c=>[c.startFrame,c.endFrame]),[[0,30],[120,150]]);assert.equal(new Set(result.cues.map(c=>c.id)).size,2);
 d.source.clips=[];assert.deepEqual(captions.cuesToCaptionTrack([{start:3,end:4,text:'无画面'}],d).cues,[]);
});
test('分数帧率映射按帧取整，避免结尾多一帧',()=>{
 assert.equal(typeof captions.cuesToCaptionTrack,'function');const d=doc();d.source.startFrame=0;d.canvas.fps={num:30000,den:1001};d.canvas.durationFrames=300;
 const result=captions.cuesToCaptionTrack([{start:1.001,end:2.002,text:'准确'}],d);assert.deepEqual(result.cues.map(c=>[c.startFrame,c.endFrame]),[[30,60]]);
});
test('长句清理只移除孤立语气词、按画幅拆分，所有段保留原始转写',()=>{
 assert.equal(typeof captions.cuesToCaptionTrack,'function');const d=doc();d.source.startFrame=0;d.canvas.width=1080;d.canvas.height=1920;
 const original='嗯，今天我们讨论字幕应该怎样断句，然后保留原始转写，就是方便以后核对。';
 const result=captions.cuesToCaptionTrack([{start:0,end:6,text:original}],d);assert.ok(result.cues.length>2);assert.ok(result.cues.every(c=>c.originalText===original&&!c.text.includes('\n')));
 const combined=result.cues.map(c=>c.text).join('');assert.ok(!combined.startsWith('嗯'));assert.ok(combined.includes('然后'));assert.ok(combined.includes('就是'));
 assert.equal(result.cues[0].startFrame,0);assert.equal(result.cues.at(-1).endFrame,180);assert.ok(result.cues.every(c=>Array.from(c.text).length<=10));
 assert.equal(captions.cuesToCaptionTrack([{start:0,end:1,text:'嗯'}],d).cues[0].originalText,'嗯');
});
test('字幕在exclusive结束帧隐藏，禁用及逐素材导出始终隐藏',()=>{
 assert.equal(typeof captions.captionAtFrame,'function');const d=doc();assert.equal(captions.captionAtFrame(d.captions,29),null);assert.equal(captions.captionAtFrame(d.captions,30)?.text,'改过的字幕');assert.equal(captions.captionAtFrame(d.captions,90),null);
 assert.equal(captions.hasVisibleCaptions(d,'full'),true);assert.equal(captions.hasVisibleCaptions(d,'layer'),true);assert.equal(captions.hasVisibleCaptions(d,'instances'),false);
 d.captions.enabled=false;assert.equal(captions.captionAtFrame(d.captions,30),null);assert.equal(captions.hasVisibleCaptions(d,'full'),false);
});

test('CaptionLayer实际React渲染使用参考高字号和独立背景透明度，文本安全且逐素材不显示',async()=>{
 const {existsSync}=await import('node:fs');const {createRequire}=await import('node:module');const {fileURLToPath}=await import('node:url');
 const path=fileURLToPath(new URL('../../templates/remotion-base/src/editor/CaptionLayer.tsx',import.meta.url));assert.equal(existsSync(path),true,'CaptionLayer must exist');
 const require=createRequire(new URL('../../templates/remotion-base/package.json',import.meta.url));const esbuild=require('esbuild');
 const compiled=esbuild.buildSync({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {CaptionLayer} from './src/editor/CaptionLayer';export const render=(props)=>renderToStaticMarkup(React.createElement(CaptionLayer,props));`,resolveDir:fileURLToPath(new URL('../../templates/remotion-base',import.meta.url)),loader:'tsx'},bundle:true,platform:'node',format:'cjs',write:false});
 const module={exports:{}};new Function('require','module','exports',compiled.outputFiles[0].text)(require,module,module.exports);
 const t=track();t.cues[0].text='<script>文字</script>';
 const props={track:t,frame:30,width:960,height:540,renderMode:'full'};
 const html=module.exports.render(props);assert.match(html,/font-size:26px/);assert.match(html,/rgba\(0, ?0, ?0, ?0.45\)/);assert.match(html,/&lt;script&gt;文字&lt;\/script&gt;/);assert.doesNotMatch(html,/<script>/);
 t.cues[0].text='句中，保留、';assert.match(module.exports.render(props),/>句中，保留<\/div>/);t.cues[0].text='<script>文字</script>';
 assert.equal(module.exports.render({...props,frame:90}),'');assert.equal(module.exports.render({...props,renderMode:'instances'}),'');assert.equal(module.exports.render({...props,track:{...t,enabled:false}}),'');assert.match(module.exports.render({...props,renderMode:'layer'}),/文字/);
});

test('拆分字幕保存段级initialText，恢复本段不重复整句，旧轨仍兼容',()=>{
 const d=doc();d.source.startFrame=0;d.canvas.width=1080;d.canvas.height=1920;
 const original='今天我们讨论字幕应该怎样断句，然后保留原始转写，方便以后逐句核对。';
 const generated=captions.cuesToCaptionTrack([{start:0,end:6,text:original}],d);
 assert.ok(generated.cues.length>1);assert.ok(generated.cues.every(c=>c.initialText===c.text&&c.originalText===original));
 const baseline=generated.cues.map(c=>c.text);generated.cues[0].text='用户改过';generated.cues[0].text=generated.cues[0].initialText;
 assert.deepEqual(generated.cues.map(c=>c.text),baseline);
 assert.equal(captions.validateCaptionTrack(track(),{durationFrames:300}),true);
 for(const value of ['',null,12,'   ']){const invalid=track();invalid.cues[0].initialText=value;assert.throws(()=>captions.validateCaptionTrack(invalid),/initialText/);}
});
test('宽屏仍保持短句，中文词语不在中间断开',()=>{
 const d=doc();d.source.startFrame=0;d.canvas.durationFrames=600;
 const generated=captions.cuesToCaptionTrack([{start:0,end:10,text:'我觉得人工智能现在也可以帮助普通人在人生这么关键的节点去通过这种方式表达自己真的很有意义'}],d);
 assert.ok(captions.captionLineCapacity(d.canvas)<=24);
 assert.ok(generated.cues.every(c=>!c.text.endsWith('通')&&!c.text.startsWith('过')));
 const punctuated=captions.cuesToCaptionTrack([{start:0,end:10,text:'我们只需要把自己的剧情和这个提示词的结构告诉豆包，每一段都可以让它去帮我们去写'}],d);
 assert.ok(punctuated.cues.every(c=>!/^([，。！？、；：])/.test(c.text)));
});
test('字幕断句保持语法、数字单位完整，去掉句尾标点且不留下片尾碎词',()=>{
 const d=doc();d.source.startFrame=0;d.canvas.durationFrames=900;
 for(const text of ['首先是脚本设计，我觉得最终拉开视频真正的水平差异的，并不是提示词写的有多好，而是你这个脚本设计到底有没有够吸引人','但说实话，每次点击生成，5 到 10 秒的视频就要将近 10 块钱，还是挺惊心动魄的','第三部分是详细分镜，比如 0 到 2 秒讲什么，2 到 5 秒讲什么，可以尽量写详细一点','有问题可以给我留言，希望你能做出自己满意的 AI 短片']){
  const result=captions.cuesToCaptionTrack([{start:0,end:20,text}],d).cues;
  assert.ok(result.every(c=>!/[，。！？、；：,.!?;:]$/.test(c.text)),JSON.stringify(result));
  assert.ok(result.every(c=>!/^的[，,\s]/.test(c.text)),JSON.stringify(result));
  assert.ok(result.every(c=>c.text!=='短片'),JSON.stringify(result));
  if(text.includes('5 到 10 秒'))assert.ok(result.some(c=>c.text.includes('5 到 10 秒')));
  if(text.includes('2 到 5 秒'))assert.ok(result.some(c=>c.text.includes('2 到 5 秒')));
 }
});

test('原始识别块在半句结束时接回续句，保持源时间范围和原文',()=>{
 const d=doc();d.source.startFrame=0;d.canvas.durationFrames=600;
 const input=[{start:0,end:4,text:'价格上，一秒钟一块钱，但实际我'},{start:4.3,end:10,text:'觉得婚礼毕竟用大屏播放，清晰度还是重要的'}];
 const before=structuredClone(input),out=captions.cuesToCaptionTrack(input,d).cues;
 assert.deepEqual(input,before);assert.equal(out[0].startFrame,0);assert.equal(out.at(-1).endFrame,300);
 assert.ok(out.some(c=>c.text.includes('但实际我觉得')));assert.ok(out.every(c=>!c.text.endsWith('但实际我')));
 assert.ok(out.some(c=>c.originalText.includes(input[0].text)&&c.originalText.includes(input[1].text)));
});
test('完整分句、专业词和列举不被任意截断，清理保留句中标点',()=>{
 const d=doc();d.source.startFrame=0;d.canvas.durationFrames=600;
 const out=captions.cuesToCaptionTrack([{start:0,end:10,text:'首先是脚本设计，我觉得最终拉开视频真正的水平差异的，并不是提示词写的有多好'}],d).cues;
 assert.ok(out.some(c=>c.text==='我觉得最终拉开视频真正的水平差异的'));
 assert.ok(out.some(c=>c.text.includes('提示词')));
 assert.equal(captions.cleanCaptionText(' 让大家弄懂，怎么效果更好、 '),'让大家弄懂，怎么效果更好');
});
