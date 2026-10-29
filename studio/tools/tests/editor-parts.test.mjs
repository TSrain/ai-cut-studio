import test from 'node:test';import assert from 'node:assert/strict';import {readPartText,writePartText} from '../editor/parts.mjs';
test('编辑卡片副标题保留标题与其他卡片',()=>{const p={slots:{cards:['标题|说明','第二张|保留']}};const part={slotKey:'cards',index:0,segment:1};assert.equal(readPartText(p,part),'说明');writePartText(p,part,'新版');assert.deepEqual(p.slots.cards,['标题|新版','第二张|保留']);});
test('字符串列表保持原字段类型，装饰节点不修改内容',()=>{const p={slots:{faces:'一|二|三'}};writePartText(p,{slotKey:'faces',index:1},'新');assert.equal(p.slots.faces,'一|新|三');assert.equal(readPartText(p,{}),undefined);});

test('图表横轴文字按实际逗号分隔定位并保留其他标签',()=>{const p={slots:{xLabels:'一月，二月、三月'}};const part={slotKey:'xLabels',index:1,listSeparator:','};assert.equal(readPartText(p,part),'二月');writePartText(p,part,'四月');assert.equal(p.slots.xLabels,'一月,四月,三月');});
