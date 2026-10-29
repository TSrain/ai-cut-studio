import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {freezeProjectTranscript} from '../lib/package-edit-transcript.mjs';
import {mergePlans,changePlan} from '../lib/production-plan-model.mjs';

test('metadata survives three way plan merge and protects concurrent timebase change',()=>{
 const base={shots:[],script:'old'},incoming={...base,transcriptTimeBase:'project',transcriptProvenancePath:'/p.json'};
 const got=mergePlans(base,base,incoming);assert.equal(got.transcriptTimeBase,'project');assert.equal(got.transcriptProvenancePath,'/p.json');
 const conflicting=mergePlans({...base,transcriptTimeBase:'source'},{...base,transcriptTimeBase:'user'},incoming);
 assert.equal(conflicting.transcriptTimeBase,'user');assert.ok(conflicting.conflicts.some(c=>c.field==='transcriptTimeBase'));
});
test('freeze latest saved edited captions without restoring deleted narration',()=>{
 const root=mkdtempSync(join(tmpdir(),'project-transcript-'));
 try {
 const source=join(root,'raw.mp4');writeFileSync(source,'source');
 const document={id:'p',revision:5,canvas:{fps:{num:30,den:1},durationFrames:60},source:{path:source,clips:[{id:'cut',sourceInFrame:300,startFrame:0,durationFrames:60}]},captions:{cues:[{id:'a',startFrame:0,endFrame:30,text:'人工纠正。',originalText:'旧字'},{id:'deleted',startFrame:65,endFrame:90,text:'删除句。'}]}};
 const frozen=freezeProjectTranscript(document,join(root,'frozen'));
 assert.equal(frozen.script,'## 完整口播脚本\n\n人工纠正。');assert.equal(frozen.transcriptTimeBase,'project');
 const srt=readFileSync(frozen.sourceSrtPath,'utf8');assert.match(srt,/00:00:00,000 --> 00:00:01,000/);assert.doesNotMatch(srt,/删除句/);
 const evidence=JSON.parse(readFileSync(frozen.transcriptProvenancePath,'utf8'));assert.equal(evidence.projectId,'p');assert.equal(evidence.timeBase,'project');assert.equal(evidence.documentRevision,5);
 assert.deepEqual(freezeProjectTranscript(document,join(root,'frozen')),frozen);
 document.captions.cues[0].text='changed';assert.throws(()=>freezeProjectTranscript(document,join(root,'frozen')),/immutable/);
 } finally {rmSync(root,{recursive:true,force:true});}
});
test('transcript metadata merges atomically and conflict resolution cannot mix SRT identity',()=>{
 const base={shots:[],sourceSrtPath:'/base.srt',transcriptTimeBase:'source',transcriptProvenancePath:'/base.json',transcriptBinding:{transcriptSha256:'base'}};
 const current={...base,sourceSrtPath:'/manual.srt',transcriptProvenancePath:'/manual.json',transcriptBinding:{transcriptSha256:'manual'}};
 const incoming={...base,sourceSrtPath:'/new.srt',transcriptTimeBase:'project',transcriptProvenancePath:'/new.json',transcriptBinding:{transcriptSha256:'new'}};
 const got=mergePlans(base,current,incoming);for(const key of ['sourceSrtPath','transcriptTimeBase','transcriptProvenancePath','transcriptBinding'])assert.deepEqual(got[key],current[key]);
 assert.equal(got.conflicts.length,1);
 const resolved=changePlan({id:'p',revision:1,canvas:{fps:30,durationFrames:60},instances:[],productionPlan:got},{type:'resolve-conflict',conflictId:got.conflicts[0].id,choice:'incoming'}).productionPlan;
 for(const key of ['sourceSrtPath','transcriptTimeBase','transcriptProvenancePath','transcriptBinding'])assert.deepEqual(resolved[key],incoming[key]);
});
