import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readBody} from '../lib/panel-api.mjs';
test('preserves Chinese and emoji across every byte boundary',async()=>{
 const text=JSON.stringify({text:'你大概率不知道 AI 中文😀'});const bytes=Buffer.from(text);
 for(let i=1;i<bytes.length;i++){
  const req=new EventEmitter();const result=readBody(req);
  req.emit('data',bytes.subarray(0,i));req.emit('data',bytes.subarray(i));req.emit('end');
  assert.equal(await result,text,`byte boundary ${i}`);
 }
});
test('enforces byte limit and handles errors',async()=>{
 const req=new EventEmitter();const result=readBody(req,4);
 req.emit('data',Buffer.from('中文'));req.emit('end');await assert.rejects(result,/请求体过大/);
 const failed=new EventEmitter();const p=readBody(failed);failed.emit('error',new Error('disconnected'));await assert.rejects(p,/disconnected/);
});
