import test from 'node:test';import assert from 'node:assert/strict';
import {createProjectAutosave,documentContentKey,shareContentKey} from '../editor/autosave.mjs';
test('content key is computed once per document object and excludes revision',()=>{
 let serialized=0;const doc={id:'a',revision:1,payload:{toJSON(){serialized++;return 'x';}}};
 const k=documentContentKey(doc);assert.equal(documentContentKey(doc),k);assert.equal(serialized,1);
 const copy=shareContentKey(doc,{...doc});assert.equal(documentContentKey(copy),k);assert.equal(serialized,1);
 assert.equal(documentContentKey({...doc,revision:9}),k);
});
test('schedule only arms the debounce timer when content is dirty',async()=>{
 let current={id:'a',revision:0,name:'x'},timers=0,writes=0,fire;const statuses=[];
 const s=createProjectAutosave({read:()=>current,write:async d=>{writes++;return {...d,revision:d.revision+1};},accept:r=>{current={...current,revision:r.revision};},onStatus:v=>statuses.push(v.state),setTimer:fn=>{timers++;fire=fn;return timers;},clearTimer:()=>{}});
 assert.equal(s.isDirty(),true);s.schedule();assert.equal(timers,1);await fire();assert.equal(writes,1);
 assert.equal(s.isDirty(),false);s.schedule();s.schedule();assert.equal(timers,1,'clean document: no timer, no serialization loop');assert.equal(statuses.at(-1),'saved');
 current={...current,name:'y'};assert.equal(s.isDirty(),true);s.schedule();assert.equal(timers,2);await fire();assert.equal(writes,2);
 current={...current};s.schedule();assert.equal(timers,2,'new object, same content: still clean');
});
