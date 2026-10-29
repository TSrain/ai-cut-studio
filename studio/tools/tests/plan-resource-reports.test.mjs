import test from 'node:test';import assert from 'node:assert/strict';
const {mergeFootageReports}=await import('../editor/plan-resource-reports.mjs').catch(()=>({}));
test('single-shot report supersedes its old candidates while preserving other segments and source reports',()=>{
 assert.equal(typeof mergeFootageReports,'function');
 const full={projectId:'p',sourceSrtPath:'/shared.srt',sourceVideoPath:'/video.mov',sections:[{id:'s',visualTargets:[{description:'纸面原型'}]},{id:'other',reason:'保留'}],candidates:[{id:'old',matchedSectionIds:['s']},{id:'shared',matchedSectionIds:['s','other']}],placements:[{id:'old-placement',sectionId:'s'},{id:'other-placement',sectionId:'other'}]};
 const scoped={...full,sections:[{id:'s',visualTargets:[{description:'电脑操作'}]}],candidates:[{id:'new',matchedSectionIds:['s']}],placements:[{id:'new-placement',sectionId:'s'}]};
 const before=structuredClone(full),v=mergeFootageReports(full,[{shotId:'s',report:scoped}]);
 assert.deepEqual(full,before);assert.equal(v.sections.find(x=>x.id==='s').visualTargets[0].description,'电脑操作');assert.deepEqual(v.sections.find(x=>x.id==='other'),before.sections[1]);
 assert.deepEqual(v.candidates.map(c=>c.id),['shared','new']);assert.deepEqual(v.candidates[0].matchedSectionIds,['other']);assert.deepEqual(v.placements.map(p=>p.id),['other-placement','new-placement']);
});
test('foreign source or cross-shot report never changes current resource projection',()=>{
 const full={projectId:'p',sourceSrtPath:'srt',sourceVideoPath:'video',sections:[{id:'s'}],candidates:[],placements:[]};
 for(const report of [{...full,projectId:'other'},{...full,sourceSrtPath:'wrong'},{...full,sections:[{id:'other'}]}])assert.deepEqual(mergeFootageReports(full,[{shotId:'s',report}]),full);
});
