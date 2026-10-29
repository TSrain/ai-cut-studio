import test from 'node:test';import assert from 'node:assert/strict';
import {encodeDraft} from '../editor/studio-state.mjs';
const m=await import('../editor/drafts.mjs').catch(()=>({}));
const d=id=>({schemaVersion:1,id,name:id,revision:0,canvas:{width:10,height:10,durationFrames:60,fps:{num:30,den:1}},instances:[],source:null});
const store=()=>{const map=new Map();return{get length(){return map.size},key:n=>[...map.keys()][n],getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};};
test('项目和标签页恢复槽相互隔离',()=>{assert.equal(typeof m.draftKey,'function');const s=store();s.setItem(m.draftKey('a','tab1'),encodeDraft(d('a'),1,100));s.setItem(m.draftKey('b','tab2'),encodeDraft(d('b'),2,200));assert.equal(m.findDraft(s,'a').document.id,'a');assert.equal(m.findDraft(s,'b').frame,2);assert.equal(m.findDraft(s,'c'),null);assert.notEqual(m.draftKey('a','tab1'),m.draftKey('a','tab2'));});
test('恢复保存不能删除别的窗口后写的草稿',()=>{const s=store(),key=m.draftKey('a','tab1'),raw=encodeDraft(d('a'),1,100);s.setItem(key,raw);const recovered=m.findDraft(s,'a');s.setItem(key,encodeDraft(d('a'),5,200));m.removeRecoveredDraft(s,recovered);assert.notEqual(s.getItem(key),null);});
test('旧版草稿可恢复但不能在无关项目弹出',()=>{const s=store();s.setItem('motion-studio:recovery:v1',encodeDraft(d('a'),1,100));assert.equal(m.findDraft(s,'b'),null);assert.equal(m.findDraft(s,null).document.id,'a');});
