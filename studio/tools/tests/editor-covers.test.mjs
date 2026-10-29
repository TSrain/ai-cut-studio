import {createHash} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync,realpathSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {listProjectCovers,resolveCoverImage} from '../lib/editor-covers.mjs';

function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'editor-covers-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const opts={coversRoot:join(root,'covers'),artifactRoot:join(root,'artifacts')};
 const make=(name,sourceId='SC-0032',ready=true)=>{
  const run=join(opts.coversRoot,'topic',name);mkdirSync(join(run,'A'),{recursive:true});
  for(const ratio of ['3x4','4x3'])writeFileSync(join(run,'A',`cover-${ratio}.png`),name+ratio);
  writeFileSync(join(run,'source.json'),JSON.stringify({source_id:sourceId,source_type:sourceId?'script':'file',original_path:'/article.md'}));
  writeFileSync(join(run,'manifest.json'),JSON.stringify({schema_version:2,status:'awaiting_selection',expected_groups:1,groups:[{id:'A',title:'测试封面',images:{'3:4':'A/cover-3x4.png','4:3':'A/cover-4x3.png'},visual_review:{passed:true},semantic_review:{passed:true}}]}));
  writeFileSync(join(run,'validation.json'),JSON.stringify({candidate_ready:ready,machine_passed:ready,agent_visual_attestation_passed:ready,agent_semantic_attestation_passed:ready,errors:[]}));
  return run;
 };
 return {root,opts,make,doc:{id:'test',name:'SC-0032 测试'}};
}
test('only matching, validated runs become candidates; no automatic approval',t=>{
 const f=fixture(t);f.make('correct');f.make('unrelated','SC-0099');f.make('unfinished','SC-0032',false);
 const result=listProjectCovers(f.doc,f.opts);
 assert.equal(result.runs.length,1);assert.equal(result.runs[0].status,'awaiting_selection');
 assert.equal(result.runs[0].groups[0].title,'测试封面');
 assert.equal(listProjectCovers({name:'SC-0032 and SC-0099'},f.opts).runs.length,0);
});
test('local article runs match exact explicit source or all delivered image hashes',t=>{
 const f=fixture(t),run=f.make('local',null);
 assert.equal(listProjectCovers(f.doc,f.opts).runs.length,0);
 assert.equal(listProjectCovers(f.doc,{...f.opts,source:'/article.md'}).runs.length,1);
 const delivered=join(f.opts.artifactRoot,'SC-0032','封面');mkdirSync(delivered,{recursive:true});
 writeFileSync(join(delivered,'封面一.png'),'local3x4');
 assert.equal(listProjectCovers(f.doc,f.opts).runs.length,0);
 writeFileSync(join(delivered,'封面二.png'),'local4x3');
 assert.equal(listProjectCovers(f.doc,f.opts).runs.length,1);
});
test('images resolve only from a matching run and reject traversal and escaped symlinks',t=>{
 const f=fixture(t),run=f.make('safe');const listing=listProjectCovers(f.doc,f.opts),id=listing.runs[0].id;
 assert.equal(resolveCoverImage(f.doc,{runId:id,groupId:'A',ratio:'3:4'},f.opts),realpathSync(join(run,'A','cover-3x4.png')));
 assert.throws(()=>resolveCoverImage({name:'SC-9999'},{runId:id,groupId:'A',ratio:'3:4'},f.opts));
 assert.throws(()=>resolveCoverImage(f.doc,{runId:'../safe',groupId:'A',ratio:'3:4'},f.opts));
 rmSync(join(run,'A','cover-3x4.png'));writeFileSync(join(f.root,'outside.png'),'private');symlinkSync(join(f.root,'outside.png'),join(run,'A','cover-3x4.png'));
 assert.equal(listProjectCovers(f.doc,f.opts).runs.length,0);
});

test('package-local cover candidates are visible only with bound receipt and files',t=>{
 const f=fixture(t),projectRoot=join(f.opts.artifactRoot,'episode'),runId='run-1';
 const output=join(projectRoot,'.制作资料','剪辑工程','p','任务',runId,'output');
 const run=join(output,'branches','cover','attempt');mkdirSync(run,{recursive:true});
 const groups=['A','B','C'].map(id=>{
  mkdirSync(join(run,id));for(const name of ['portrait.png','landscape.png'])writeFileSync(join(run,id,name),id+name);
  return {id,title:id,images:{'3:4':id+'/portrait.png','4:3':id+'/landscape.png'},visual_review:{passed:true},semantic_review:{passed:true}};
 });
 const values={'manifest.json':{schema_version:2,status:'awaiting_selection',expected_groups:3,groups},'source.json':{source_type:'file',original_path:'/script.md'},'validation.json':{candidate_ready:true,machine_passed:true,agent_visual_attestation_passed:true,agent_semantic_attestation_passed:true,errors:[]}};
 for(const [name,value] of Object.entries(values))writeFileSync(join(run,name),JSON.stringify(value));
 const files=[...Object.keys(values),...groups.flatMap(g=>Object.values(g.images))].map(name=>({path:join(run,name),sha256:createHash('sha256').update(readFileSync(join(run,name))).digest('hex')}));
 mkdirSync(join(output,'production'));
 writeFileSync(join(output,'production','cover-receipt.json'),JSON.stringify({schemaVersion:1,branch:'cover',projectId:'p',runId,status:'executed',coverCandidateManifestPath:join(run,'manifest.json'),files}));
 const doc={id:'p',projectBinding:{version:1,projectId:'p',projectRoot}};
 const listing=listProjectCovers(doc,f.opts);assert.equal(listing.runs.length,1);assert.equal(listing.runs[0].groups.length,3);
 assert.equal(resolveCoverImage(doc,{runId:listing.runs[0].id,groupId:'A',ratio:'3:4'},f.opts),realpathSync(join(run,'A/portrait.png')));
 writeFileSync(join(run,'A/portrait.png'),'changed');assert.equal(listProjectCovers(doc,f.opts).runs.length,0);
});
