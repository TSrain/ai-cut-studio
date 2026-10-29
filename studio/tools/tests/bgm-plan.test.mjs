import test from 'node:test';
import assert from 'node:assert/strict';
const moduleUrl=new URL('../lib/bgm-plan-model.mjs',import.meta.url);
const {getBgmRows,bgmDetail,validateBgmPlan}=await import(moduleUrl).catch(()=>({}));
const base=()=>({canvas:{durationFrames:300},audioClips:[{id:'real-audio'}],productionPlan:{bgmPlanVersion:1,bgmRecommendations:[{id:'r',title:'曲名',artist:'作者',url:'https://example.org/music',reason:'匹配说明',licenseStatus:'unknown',audition:'not_listened'}],shots:[{id:'s',title:'案例',requirementVersion:1,soundDesign:{decision:'silence'},bgmDesign:{requirementVersion:1,decision:'music',reason:'连续感',purpose:'continuity',musicType:'轻节拍',texture:'柔和',entry:'渐入',exit:'渐出',recommendationIds:['r']},timing:{status:'aligned',ranges:[{id:'a',startFrame:20,durationFrames:80}]}}]}});
test('music uses actual shot ranges, SFX silence does not suppress it and audio stays unchanged',()=>{const d=base(),snapshot=structuredClone(d);assert.equal(typeof getBgmRows,'function');assert.deepEqual(getBgmRows(d).map(r=>[r.shotId,r.startFrame,r.durationFrames]),[['s',20,80]]);assert.deepEqual(d,snapshot);d.productionPlan.shots[0].timing.ranges=[{id:'b',startFrame:55,durationFrames:20},{id:'c',startFrame:110,durationFrames:15}];assert.deepEqual(getBgmRows(d).map(r=>r.startFrame),[55,110]);});
test('silence, cancelled, estimated and stale decisions never paint blocks',()=>{for(const mutation of [s=>s.bgmDesign.decision='silence',s=>s.cancelled=true,s=>s.timing.status='estimated',s=>s.timing.status='review',s=>s.requirementVersion=2]){const d=base();mutation(d.productionPlan.shots[0]);assert.deepEqual(getBgmRows(d),[]);}});
test('detail explains silence and stale plans and resolves only safe recommendation links',()=>{const d=base(),s=d.productionPlan.shots[0];assert.equal(bgmDetail(d,s).recommendations[0].title,'曲名');d.productionPlan.bgmRecommendations[0].url='javascript:alert(1)';assert.equal(bgmDetail(d,s).recommendations.length,0);s.bgmDesign.decision='silence';assert.equal(bgmDetail(d,s).status,'silence');s.requirementVersion=2;assert.equal(bgmDetail(d,s).status,'stale');});
test('malformed recommendations and unknown references fail domain validation',()=>{const d=base();assert.doesNotThrow(()=>validateBgmPlan(d.productionPlan));d.productionPlan.bgmRecommendations[0].url='data:text/html,bad';assert.throws(()=>validateBgmPlan(d.productionPlan));const missing=base();missing.productionPlan.shots[0].bgmDesign.recommendationIds=['missing'];assert.throws(()=>validateBgmPlan(missing.productionPlan));});
test('historical plans without BGM remain valid and have no new rows',()=>{assert.doesNotThrow(()=>validateBgmPlan({shots:[]}));assert.deepEqual(getBgmRows({productionPlan:{shots:[]}}),[]);});
test('out-of-document ranges are clipped and nonfinite ranges omitted',()=>{const d=base();d.productionPlan.shots[0].timing.ranges=[{id:'a',startFrame:290,durationFrames:30},{id:'b',startFrame:NaN,durationFrames:3}];assert.deepEqual(getBgmRows(d).map(r=>[r.startFrame,r.durationFrames]),[[290,10]]);});
const {normalizePlan,mergePlans}=await import('../lib/production-plan-model.mjs');
test('package metadata survives three-way merge without changing animation version',()=>{const incoming=normalizePlan(base().productionPlan),old=normalizePlan({shots:incoming.shots.map(({bgmDesign,...s})=>s)});const result=mergePlans(old,old,incoming);assert.equal(result.bgmPlanVersion,1);assert.equal(result.bgmRecommendations[0].id,'r');assert.equal(result.shots[0].requirementVersion,1);});
test('concurrent local BGM edits are preserved with a conflict',()=>{const old=normalizePlan(base().productionPlan),local=structuredClone(old),remote=structuredClone(old);local.shots[0].bgmDesign.musicType='手调';remote.shots[0].bgmDesign.musicType='新建议';const result=mergePlans(old,local,remote);assert.equal(result.shots[0].bgmDesign.musicType,'手调');assert.ok(result.conflicts.some(c=>c.field==='bgmDesign'));});
test('an older worker cannot erase independent BGM decisions',()=>{const old=normalizePlan(base().productionPlan),remote=structuredClone(old);delete remote.shots[0].bgmDesign;delete remote.bgmPlanVersion;delete remote.bgmRecommendations;const result=mergePlans(old,old,remote);assert.equal(result.shots[0].bgmDesign.decision,'music');});
test('concurrent recommendation ID reuse never swaps the track under a local edit',()=>{const old=normalizePlan(base().productionPlan),local=structuredClone(old),remote=structuredClone(old);local.shots[0].bgmDesign.musicType='手调';remote.shots[0].bgmDesign.musicType='新建议';remote.bgmRecommendations[0].title='另一首曲';remote.bgmRecommendations[0].url='https://example.org/new';const result=mergePlans(old,local,remote),ref=result.shots[0].bgmDesign.recommendationIds[0];assert.equal(result.bgmRecommendations.find(r=>r.id===ref).title,'曲名');});

test('unified transition validates, displays and survives normalization without touching timing',()=>{
 const d=base(),s=d.productionPlan.shots[0];
 delete s.bgmDesign.entry;delete s.bgmDesign.exit;
 s.bgmDesign.transition='同曲延续；结论前自然停乐';
 const before=structuredClone(d);
 assert.doesNotThrow(()=>validateBgmPlan(d.productionPlan));
 assert.equal(bgmDetail(d,s).transition,s.bgmDesign.transition);
 assert.equal(normalizePlan(d.productionPlan).shots[0].bgmDesign.transition,s.bgmDesign.transition);
 assert.deepEqual(d,before);
 for(const invalid of ['', ' ', null, 42]){s.bgmDesign.transition=invalid;s.bgmDesign.entry='旧进入';s.bgmDesign.exit='旧退出';assert.throws(()=>validateBgmPlan(d.productionPlan));}
});
test('legacy transition display preserves both directions and explicit new text takes precedence',()=>{
 const d=base(),s=d.productionPlan.shots[0],before=structuredClone(d);
 assert.equal(bgmDetail(d,s).transition,'渐入；渐出');assert.deepEqual(d,before);
 s.bgmDesign.transition='自然收尾后留白';
 assert.equal(bgmDetail(d,s).transition,'自然收尾后留白');
});
