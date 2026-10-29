import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaRecognitionStatus} from '../editor/media-recognition-status.mjs';
const item={id:'a',scope:'project',path:'templates/remotion-base/public/editor-project-media/p/a.mov'};
const other={id:'b',scope:'project',path:'templates/remotion-base/public/editor-project-media/p/b.mov'};
const document={id:'p',instances:[],productionPlan:{shots:[]}};
const job={projectId:'p',kind:'recognize',status:'running',mediaIds:['a','b'],mediaPaths:['/archive/a.mov','/archive/b.mov'],processed:0,results:[]};
const status=(asset=item,jobs=[job],doc=document,submitting=[])=>mediaRecognitionStatus(asset,{jobs,document:doc,submitting});
test('queued and running batch inputs show recognition individually',()=>{
 assert.equal(status(),'recognizing');assert.equal(status(other),'recognizing');
 assert.equal(status(item,[{...job,status:'queued'}]),'recognizing');
 assert.equal(status(item,[],document,[{projectId:'p',mediaIds:['a']}]),'recognizing');
});
test('processed unmatched files remain visible while remaining batch continues',()=>{
 assert.equal(status(item,[{...job,processed:1}]),'unmatched');
 assert.equal(status(other,[{...job,processed:1}]),'recognizing');
});
test('completed uncertain or unmatched results and failures remain visible',()=>{
 for(const [state,expected] of [['complete','unmatched'],['partial','unmatched'],['failed','failed'],['cancelled','cancelled'],['interrupted','failed']])assert.equal(status(item,[{...job,status:state,results:[{id:'r',state:'pending',media:{path:'/archive/a.mov'}}]}]),expected);
});
test('only current timeline use shows filled, including public path aliases',()=>{
 const doc={...document,instances:[{id:'i',assetReferences:{media:item.path}}]};
 assert.equal(status(item,[],doc),'filled');
 assert.equal(status(item,[],{...doc,instances:[{id:'i',assetReferences:{media:'/repo/'+item.path}}]}),'filled');
 assert.equal(status(item,[],document),null);
});
test('archived recognition output maps back to original input only while its bound instance exists',()=>{
 const result={id:'r',state:'applied',media:{path:'/archive/a.mov'}};
 const completed={...job,status:'complete',results:[result]};
 const instance={id:'i',assetReferences:{media:'templates/remotion-base/public/staged/copy.mov'}};
 const binding={resultId:'r',instanceId:'i',path:instance.assetReferences.media,status:'current'};
 const doc={...document,instances:[instance],productionPlan:{shots:[{bindings:[binding]}]}};
 assert.equal(status(item,[completed],doc),'filled');assert.equal(status(other,[completed],doc),'unmatched');
 assert.equal(status(item,[completed],{...doc,instances:[]}),'unmatched');
 assert.equal(status(item,[completed],{...doc,instances:[{...instance,assetReferences:{media:'different.mov'}}]}),'unmatched');
});
test('completed results do not claim filled without an instance',()=>{
 assert.equal(status(item,[{...job,status:'complete',results:[{id:'r',state:'applied',media:{path:'/archive/a.mov'}}]}]),'unmatched');
});
test('other projects, shared library and unrelated filenames are isolated',()=>{
 assert.equal(status(item,[{...job,projectId:'other'}]),null);
 assert.equal(status({...item,scope:'shared'}),null);
 assert.equal(status({id:'c',scope:'project',path:'another/a.mov'}),null);
});
test('current fill wins over repeat analysis',()=>{
 assert.equal(status(item,[job],{...document,instances:[{assetReferences:{media:item.path}}]}),'filled');
});
