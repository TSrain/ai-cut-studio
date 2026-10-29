import test from 'node:test';
import assert from 'node:assert/strict';
import {diffValues,applyPatch,deepEqual} from '../editor/history-patch.mjs';
import {editHistory,undoHistory,redoHistory,commitHistory,pushPastHistory,materializeHistory,historyBytes,isHistoryPatch,HISTORY_LIMITS} from '../editor/history.mjs';
let seed=7;const rnd=()=>((seed=(seed*1103515245+12345)%2147483648)/2147483648);
const pick=a=>a[Math.floor(rnd()*a.length)];
const base=()=>({id:'doc',revision:1,canvas:{durationFrames:300},instances:Array.from({length:20},(_,i)=>({id:'i'+i,startFrame:i*10,props:{label:'L'+i,tags:['a','b']}})),captions:{cues:Array.from({length:30},(_,i)=>({id:'c'+i,text:'字'+i}))}});
function mutate(doc){
 const d=structuredClone(doc),r=rnd();
 if(r<.25)pick(d.instances).props.label='X'+Math.floor(rnd()*1e6);
 else if(r<.4)d.instances.splice(Math.floor(rnd()*(d.instances.length+1)),0,{id:'n'+Math.floor(rnd()*1e9),startFrame:1,props:{}});
 else if(r<.55&&d.instances.length>1)d.instances.splice(Math.floor(rnd()*d.instances.length),1);
 else if(r<.65)delete pick(d.instances).props.tags;
 else if(r<.75)d.captions?.cues.reverse();
 else if(r<.85)d.canvas={durationFrames:Math.floor(rnd()*900)+1,extra:{nested:[1,2,3]}};
 else if(r<.92)d.captions=null;
 else d.markers=[{id:'m',frame:Math.floor(rnd()*100)}];
 if(d.captions===null&&rnd()<.5)d.captions={cues:[]};
 return d;
}
test('diff/apply round-trips random JSON edits and shares untouched subtrees',()=>{
 let a=base();
 for(let i=0;i<300;i++){
  const b=mutate(a),frozen=JSON.stringify(a),ops=diffValues(a,b),out=applyPatch(a,ops);
  assert.ok(deepEqual(out,b),'forward');assert.equal(JSON.stringify(a),frozen,'input untouched');
  const back=applyPatch(b,diffValues(b,a));assert.ok(deepEqual(back,a),'inverse');
  if(deepEqual(a.captions,b.captions)&&a.captions)assert.equal(out.captions,a.captions,'unchanged subtree shared');
  a=b;
 }
});
// Reference: the previous snapshot implementation (full copies), for behavioural equivalence.
const restore=(s,l)=>s.id&&s.id===l.id?{...s,revision:l.revision,...(l.assetSourceHash?{assetSourceHash:l.assetSourceHash}:{})}:s;
const ref={edit:(h,n)=>({past:[...h.past,h.present].slice(-100),present:structuredClone(n),future:[]}),
 undo:h=>h.past.length?{past:h.past.slice(0,-1),present:restore(h.past.at(-1),h.present),future:[h.present,...h.future]}:h,
 redo:h=>h.future.length?{past:[...h.past,h.present],present:restore(h.future[0],h.present),future:h.future.slice(1)}:h,
 push:(h,b)=>({...h,past:[...h.past,b].slice(-100),future:[]}),commit:(h,b,n)=>({past:[...h.past,b].slice(-100),present:n,future:[]})};
test('random sequences (edits, undo/redo, live gestures, saves) match the snapshot implementation',()=>{
 for(let run=0;run<20;run++){
  let h={past:[],present:base(),future:[]},r={past:[],present:base(),future:[]},gesture=null;
  for(let step=0;step<250;step++){
   const x=rnd();
   if(gesture){ // live gesture: present streams without history, then commits base
    if(x<.6){const n=mutate(h.present);h={...h,present:n};r={...r,present:n};}
    else if(x<.8){h=pushPastHistory(h,gesture);r=ref.push(r,gesture);gesture=null;}
    else {const n=mutate(h.present);h=commitHistory(h,gesture,n);r=ref.commit(r,gesture,n);gesture=null;}
   }
   else if(x<.4){const n=mutate(h.present);h=editHistory(h,n);r=ref.edit(r,n);}
   else if(x<.6){h=undoHistory(h);r=ref.undo(r);}
   else if(x<.75){h=redoHistory(h);r=ref.redo(r);}
   else if(x<.85){gesture=h.present;}
   else {const rev=h.present.revision+1;h={...h,present:{...h.present,revision:rev}};r={...r,present:{...r.present,revision:rev}};} // save ack
   assert.ok(deepEqual(h.present,r.present),`present run ${run} step ${step}`);
   assert.equal(h.past.length,r.past.length);assert.equal(h.future.length,r.future.length);
  }
  const m=materializeHistory(h);
  m.past.forEach((d,i)=>assert.ok(deepEqual(d,r.past[i]),'past '+i));m.future.forEach((d,i)=>assert.ok(deepEqual(d,r.future[i]),'future '+i));
 }
});
test('many steps: undo everything then redo everything',()=>{
 const docs=[base()];let h={past:[],present:docs[0],future:[]};
 for(let i=0;i<99;i++){docs.push(mutate(docs.at(-1)));h=editHistory(h,docs.at(-1));}
 assert.ok(h.past.every(isHistoryPatch));
 for(let i=98;i>=0;i--){h=undoHistory(h);assert.ok(deepEqual(h.present,docs[i]));}
 assert.equal(undoHistory(h),h);
 for(let i=1;i<100;i++){h=redoHistory(h);assert.ok(deepEqual(h.present,docs[i]));}
 assert.equal(redoHistory(h),h);
});
test('history is capped by count and by retained bytes, keeping the newest step',()=>{
 let h={past:[],present:base(),future:[]};
 for(let i=0;i<150;i++)h=editHistory(h,mutate(h.present));
 assert.equal(h.past.length,100);
 const big=()=>({...h.present,blob:'x'.repeat(1024*1024)+Math.random()});
 const limit=HISTORY_LIMITS.bytes;HISTORY_LIMITS.bytes=3*1024*1024;
 try{for(let i=0;i<6;i++)h=editHistory(h,big());assert.ok(historyBytes(h)<=HISTORY_LIMITS.bytes+2.2*1024*1024);assert.ok(h.past.length>=1&&h.past.length<10);
  const prev=structuredClone(h.present);h=editHistory(h,{...h.present,blob:'y'.repeat(5*1024*1024)});assert.equal(h.past.length,1);assert.ok(deepEqual(undoHistory(h).present,prev));}
 finally{HISTORY_LIMITS.bytes=limit;}
});
test('literal snapshot entries (sync output) still undo and are compacted on the next edit',()=>{
 const a=base(),b=mutate(a),c=mutate(b);let h={past:[a],present:b,future:[]};
 assert.ok(deepEqual(undoHistory(h).present,{...a,revision:b.revision}));
 h=editHistory(h,c);assert.ok(h.past.every(isHistoryPatch));
 h=undoHistory(undoHistory(h));assert.ok(deepEqual(h.present,{...a,revision:c.revision}));
});
test('a step retains a small patch, not a document copy',()=>{
 let h={past:[],present:{...base(),payload:'p'.repeat(500000)},future:[]};
 for(let i=0;i<50;i++){const n=structuredClone(h.present);n.instances[0].props.label='v'+i;h=editHistory(h,n);}
 assert.ok(historyBytes(h)<50*400,`retained ${historyBytes(h)} bytes`);
});
