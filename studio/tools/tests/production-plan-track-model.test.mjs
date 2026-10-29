import test from 'node:test';
import assert from 'node:assert/strict';
import {needsProductionWork} from '../editor/production-plan-track-model.mjs';
const original = () => ({visualRequirement:'保留真人',mediaDescription:'保留真人',upstream:{packageShot:{keepOriginal:true,'理想画面':'保留真人','创意方案':'保留真人',soundDesign:{decision:'silence',cues:[]},'声音意图':'不加音效；人声优先。'}}});
test('only explicit untouched footage is omitted; unknown requirements remain visible',()=>{
 assert.equal(needsProductionWork(original()),false);
 assert.equal(needsProductionWork({slots:[]}),true);
 const old=original();delete old.upstream.packageShot.keepOriginal;
 Object.assign(old.upstream.packageShot,{'关键帧描述':'原口播画面，不新增关键帧。','切法':'无'});
 assert.equal(needsProductionWork(old),false);
 assert.equal(needsProductionWork({...old,visualRequirement:'缓慢推近真人'}),true);
 assert.equal(needsProductionWork({...old,mediaDescription:'补充真人录屏'}),true);
});
test('every planned addition wins over stale keep-original metadata',()=>{
 for(const kind of ['sound','camera','animation','network','screen']) {
  const s=original();s.upstream.packageShot.productionActions=[kind];
  assert.equal(needsProductionWork(s),true,kind);
 }
 for(const key of ['slots','bindings','candidates','keyframes']) {
  assert.equal(needsProductionWork({...original(),[key]:[{}]}),true,key);
 }
 for(const key of ['cameraPlan','cameraDesign','camera','cameraActions']) {
  const s=original();s.upstream.packageShot[key]={action:'push'};
  assert.equal(needsProductionWork(s),true,key);
 }
 const s=original();s.upstream.packageShot.soundDesign.cues=[{id:'hit'}];
 assert.equal(needsProductionWork(s),true);
});
test('audio-only and music adjustments are work even without visual slots',()=>{
 const s=original();s.upstream.packageShot['声音意图']='音乐压低或抽掉，不新增冲击声。';
 s.upstream.packageShot.soundDesign={decision:'duck',cues:[]};
 assert.equal(needsProductionWork(s),true);
 const d=original();d.upstream.packageShot.soundDesign={decision:'cues',cues:[]};
 assert.equal(needsProductionWork(d),true);
});
test('display filtering does not mutate source plan or range IDs',()=>{
 const shots=[original(),{...original(),slots:[{type:'screen'}]}];const before=structuredClone(shots);
 assert.equal(shots.filter(needsProductionWork).length,1);assert.deepEqual(shots,before);
 assert.equal(needsProductionWork({...shots[1],cancelled:true}),false);
});

test('returning from an insert to unchanged footage is not another effect block',()=>{
 const s=original();delete s.upstream.packageShot.keepOriginal;
 Object.assign(s.upstream.packageShot,{'关键帧描述':'原口播画面，不新增关键帧。','切法':'硬切','动作':'实录','理想画面':'硬切回真人，保留原片'});
 s.visualRequirement=s.upstream.packageShot['理想画面'];
 assert.equal(needsProductionWork(s),false);
 s.upstream.packageShot.cameraDesign={action:'push'};
 assert.equal(needsProductionWork(s),true);
});

test('explicit sound silence overrides generic historical music advice, not new actions',()=>{
 const s=original();s.upstream.packageShot['声音意图']='音乐压低或抽掉，让核心判断/转折由人声落定；不新增冲击声。';
 assert.equal(needsProductionWork(s),false);
 delete s.upstream.packageShot.soundDesign;
 assert.equal(needsProductionWork(s),true,'legacy plans without a structured sound decision remain visible');
 const updated=original();updated.soundIntent='新增一次轻提示音';
 assert.equal(needsProductionWork(updated),true,'current explicit instructions take precedence');
});

test('legacy return to quiet presenter has no extra effect without a camera instruction',()=>{
 const s=original();delete s.upstream.packageShot.keepOriginal;
 Object.assign(s.upstream.packageShot,{'关键帧描述':'原口播画面，不新增关键帧。','切法':'硬切','动作':'定格','理想画面':'真人完整说出观点；画面归静。'});
 s.visualRequirement=s.upstream.packageShot['理想画面'];
 assert.equal(needsProductionWork(s),false);
 s.upstream.packageShot.productionActions=['camera'];
 assert.equal(needsProductionWork(s),true);
});

test('only actionable camera or presenter intents add a production block',()=>{
 for(const intent of [{},{mode:'none'},{action:'keep-original'},{placement:'none'}]) {
  for(const key of ['cameraIntent','presenterLayerIntent']) {
   const s=original();s[key]=intent;assert.equal(needsProductionWork(s),false,JSON.stringify(intent));
  }
 }
 for(const [key,intent] of [['cameraIntent',{action:'push'}],['presenterLayerIntent',{placement:'behind-presenter'}]]) {
  const s=original();s[key]=intent;assert.equal(needsProductionWork(s),true);
 }
});
