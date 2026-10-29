import test from 'node:test';
import assert from 'node:assert/strict';
import {validateShotPlan,compileShotPlan,DEFAULT_LEVELS} from '../lib/aroll-shot-plan.mjs';
const e=(x)=>({purpose:'emphasis',cue:'这是重点',reason:'强调判断，随后回到解释',...x});
const plan={version:2,duration:60,levels:{A:1,B:1.12,C:1.18},events:[e({at:0,to:'A',transition:'cut'}),... [5,20,35].flatMap(t=>[e({from:t,toTime:t+2,to:'B',transition:'slow',easing:'ramped'}),e({from:t+3,toTime:t+3.3,to:'A',transition:'slow',easing:'linear'})])]};
test('visible pushes and quick returns have no frequency or 10% delta ceiling',()=>{
 const r=validateShotPlan(plan);assert.deepEqual(r.errors,[]);assert.equal(r.stats.changeCount,6);assert.equal(r.stats.maxChangesIn60Seconds,6);assert.equal(r.stats.baseCoveragePct,83.5);assert.equal(r.stats.closeHoldCoveragePct,5);assert.equal(r.stats.movementCoveragePct,11.5);assert.equal(compileShotPlan(plan).filter(s=>s.transition==='slow').length,6);
});
test('counts long close holds even with almost no movement',()=>{
 const p={...plan,events:[e({at:0,to:'A',transition:'cut'}),e({from:5,toTime:5.3,to:'B',transition:'slow'})]};
 const r=validateShotPlan(p);assert.equal(r.stats.baseCoveragePct,8.33);assert.equal(r.stats.closeHoldCoveragePct,91.17);assert.match(r.warnings.join('\n'),/base framing.*majority/);
});
test('defaults are visible trial levels; explicit legacy levels remain intact',()=>{
 assert.deepEqual(DEFAULT_LEVELS,{A:1,B:1.12,C:1.18});
 assert.equal(compileShotPlan({...plan,levels:{A:1,B:1.04,C:1.06}}).find(s=>s.transition==='slow').zoomTo,1.04);
});
test('safety errors remain for overlap, zero moves and excessive levels',()=>{
 assert.match(validateShotPlan({...plan,levels:{A:1,B:1.5,C:1.5}}).errors.join('\n'),/1.35/);
 assert.match(validateShotPlan({...plan,events:[e({from:0,toTime:2,to:'A',transition:'slow'})]}).errors.join('\n'),/greater than zero/);
 assert.match(validateShotPlan({...plan,events:[e({from:1,toTime:3,to:'B',transition:'slow'}),e({at:2,to:'A',transition:'cut'})]}).errors.join('\n'),/overlap/);
});
