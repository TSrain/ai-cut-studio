import test from 'node:test';
import assert from 'node:assert/strict';
import {editorDeliveryDirectory} from '../lib/editor-delivery.mjs';
test('episode survives editor save-as through explicit name or contract reference',()=>{
 assert.equal(editorDeliveryDirectory({id:'SC-0032-broll',name:'test'},'clip','/output'),'/output/SC-0032/片段');
 assert.equal(editorDeliveryDirectory({id:'uuid',name:'SC-0032 · 本期'},'single-layer','/output'),'/output/SC-0032/片段');
 assert.equal(editorDeliveryDirectory({id:'uuid',styleReference:{contractPath:'projects/SC-0032/visual-contract.json'}},'full','/output'),'/output/SC-0032/成片');
});
test('unknown or conflicting episode uses outer directory without arbitrary project folders',()=>{
 assert.equal(editorDeliveryDirectory({id:'uuid',name:'新建项目'},'clip','/output'),'/output');
 assert.equal(editorDeliveryDirectory({id:'SC-0032',name:'SC-0040'},'clip','/output'),'/output');
 assert.equal(editorDeliveryDirectory({id:'uuid',name:'../escape'},'full','/output'),'/output');
});
