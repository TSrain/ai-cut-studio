import test from 'node:test';import assert from 'node:assert/strict';
const {calculatePlanPreviewLayout:layout}=await import('../editor/plan-preview-layout.mjs').catch(()=>({}));
const section=(kind,text)=>({kind,title:kind,items:[{text}]});
test('uses available side space without shrinking a short preview unnecessarily',()=>{
 assert.equal(typeof layout,'function');const value=layout({width:1600,height:500,ratio:16/9,sections:[section('narration','这一段的口播'),section('animation','实际动画安排'),section('footage','办公室素材') ]});
 assert.equal(value.overflow,false);assert.ok(Math.abs(value.mediaWidth-500*16/9)<1);
});
test('longer text is preserved while the preview yields space',()=>{
 const input={width:1000,height:550,ratio:16/9},short=layout({...input,sections:[section('narration','短口播'),section('animation','短说明')]}),long=layout({...input,sections:[section('narration','这一段口播需要完整显示。'.repeat(10)),section('animation','需要把价格与使用关系讲清楚。'.repeat(20))]});
 assert.ok(long.mediaWidth<short.mediaWidth);assert.ok(long.mediaWidth>0);assert.ok(long.leftSections.flatMap(s=>s.items).some(i=>i.text.endsWith('讲清楚。')));
});
test('narrow editors stack readable content instead of creating a tiny side thumbnail',()=>{
 const value=layout({width:320,height:550,ratio:16/9,sections:[section('narration','一段口播'),section('animation','动画说明'),section('aiVideo','AI生成场景')]});
 assert.equal(value.mode,'stack');assert.ok(value.mediaWidth>=250);assert.ok(value.mediaHeight+value.textHeight+value.gap<=550.1);
});
test('extreme content remains accessible with a scrolling area, never silently truncated',()=>{
 const text='需要完整保留的描述。'.repeat(300),value=layout({width:640,height:400,ratio:16/9,sections:[section('narration',text)]});
 assert.equal(value.overflow,true);assert.equal(value.leftSections[0].items[0].text,text);assert.ok(value.mediaHeight>0);assert.ok(value.textHeight>0);
});
test('all modes preserve the project aspect ratio and stay inside the available viewport',()=>{
 for(const width of [280,480,800,1600])for(const ratio of [9/16,16/9]){
  const value=layout({width,height:520,ratio,sections:[section('narration','逐段口播文案'.repeat(12)),section('footage','网络素材描述'.repeat(15))]});
  assert.ok(Math.abs(value.mediaWidth/value.mediaHeight-ratio)<.001);assert.ok(value.mediaWidth<=width);assert.ok(value.mediaHeight<=520);
 }
});
