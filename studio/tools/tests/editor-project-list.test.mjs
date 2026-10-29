import assert from 'node:assert/strict';
import test from 'node:test';
import {groupProjects} from '../editor/project-list.mjs';
test('groups by local calendar date and sorts newest first without mutating input',()=>{
  const now=new Date(2026,0,1,0,30);
  const docs=[{id:'a',name:'Old',updatedAt:new Date(2025,11,30,22).toISOString()},{id:'b',name:'Yesterday',updatedAt:new Date(2025,11,31,23,59).toISOString()},{id:'c',name:'SC-0032',updatedAt:new Date(2026,0,1,0,20).toISOString()},{id:'d',name:'SC-0032 newer',updatedAt:new Date(2026,0,1,0,25).toISOString()}];
  const groups=groupProjects(docs,'',now);
  assert.deepEqual(groups.map(g=>g.label),['今天','昨天','2025年12月30日']);
  assert.deepEqual(groups[0].projects.map(d=>d.id),['d','c']);
  assert.equal(docs[0].id,'a');
  assert.deepEqual(groupProjects(docs,' sc-0032 ',now).flatMap(g=>g.projects.map(d=>d.id)),['d','c']);
  assert.deepEqual(groupProjects(docs,'absent',now),[]);
});
test('legacy entries with missing timestamps remain available at the end',()=>{
  const groups=groupProjects([{id:'old',name:'Legacy'},{id:'new',name:'New',updatedAt:'2026-01-01T00:00:00Z'}]);
  assert.equal(groups.at(-1).label,'日期未知');assert.equal(groups.at(-1).projects[0].id,'old');
});
