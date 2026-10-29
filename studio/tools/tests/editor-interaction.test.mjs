import test from 'node:test';import assert from 'node:assert/strict';import {keyboardCommand,frameAtClient,duplicateInstance} from '../editor/interaction.mjs';
test('删除选中实例但保留输入框中的退格与弹窗',()=>{assert.equal(keyboardCommand({key:'Backspace'},{selected:true}),'delete');assert.equal(keyboardCommand({key:'Delete'},{selected:true}),'delete');assert.equal(keyboardCommand({key:'Backspace'},{selected:true,editing:true}),null);assert.equal(keyboardCommand({key:'Backspace'},{selected:true,modal:true}),null);});
test('保存复制和时间快捷键',()=>{assert.equal(keyboardCommand({key:'s',metaKey:true}),'save');assert.equal(keyboardCommand({key:'d',ctrlKey:true},{selected:true}),'duplicate');assert.equal(keyboardCommand({key:'ArrowLeft',shiftKey:true}),'back10');});
test('滚动后播放头坐标仍以时间轴原点计算',()=>{assert.equal(frameAtClient(400,100,200,160,2,600),170);assert.equal(frameAtClient(0,100,0,160,2,600),0);assert.equal(frameAtClient(9999,0,0,160,2,600),599);});
test('复制为新实例且不修改原始嵌套参数',()=>{const d={instances:[{id:'a',props:{slots:{label:'原文'}},zIndex:2,startFrame:10,durationFrames:30}]};const out=duplicateInstance(d,'a','b');out.instances[1].props.slots.label='副本';assert.equal(d.instances[0].props.slots.label,'原文');assert.equal(out.instances[1].zIndex,3);});

test('保存可在文字输入时使用，弹窗不撤销背后的画布',()=>{assert.equal(keyboardCommand({key:'s',metaKey:true},{editing:true}),'save');assert.equal(keyboardCommand({key:'z',metaKey:true},{modal:true}),null);});

test('画布拖动阈值按屏幕像素判断，缩小预览后点击抖动不移动素材', async () => {
  const {canvasDragPosition} = await import('../editor/interaction.mjs');
  assert.equal(typeof canvasDragPosition, 'function');
  for (const scale of [0.15, 0.4, 1, 2]) {
    assert.equal(canvasDragPosition({dx: 2, dy: 1, scale}), null);
  }
});

test('整幅拖回中心附近时精确归零，按住 Alt 可精细调整', async () => {
  const {canvasDragPosition} = await import('../editor/interaction.mjs');
  assert.equal(typeof canvasDragPosition, 'function');
  assert.deepEqual(canvasDragPosition({dx: -38, dy: 20, scale: 0.4, x: 100, y: 0, snap: true}), {x: 0, y: 50});
  assert.deepEqual(canvasDragPosition({dx: -38, dy: 20, scale: 0.4, x: 100, y: 0, snap: false}), {x: 5, y: 50});
});

test('拖离后回到按下位置可以恢复原位，不残留最后一次偏移', async () => {
  const {canvasDragPosition} = await import('../editor/interaction.mjs');
  assert.equal(typeof canvasDragPosition, 'function');
  assert.deepEqual(canvasDragPosition({dx: 0, dy: 0, scale: 0.4, x: 100, y: 50, started: true}), {x: 100, y: 50});
  assert.deepEqual(canvasDragPosition({dx: 20, dy: -10, scale: 0.4, x: 100, y: 50}), {x: 150, y: 25});
});

test('时间轴批量快捷键与文本输入隔离',()=>{
 for(const [key,command] of [['c','copy'],['v','paste'],['x','cut'],['b','split']]){
  assert.equal(keyboardCommand({key,metaKey:true},{selected:true,timeline:true}),command);
  assert.equal(keyboardCommand({key,metaKey:true},{selected:true,editing:true}),null);
 }
 assert.equal(keyboardCommand({key:'a',metaKey:true},{timeline:true}),'selectAll');
 assert.equal(keyboardCommand({key:'a',metaKey:true},{timeline:false}),null);
});
