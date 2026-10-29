import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultCoverRatio,showCoverAtFrame} from '../../templates/remotion-base/src/editor/cover-frame.mjs';
test('preview follows original display orientation, older documents fall back to canvas',()=>{
 assert.equal(defaultCoverRatio({canvas:{width:1920,height:1080}}),'4:3');
 assert.equal(defaultCoverRatio({canvas:{width:1080,height:1920}}),'3:4');
 assert.equal(defaultCoverRatio({canvas:{width:1080,height:1920},source:{displaySize:{width:1920,height:1080}}}),'4:3');
});
test('cover occupies only global frame zero in composed video; no layer exports or duration change',()=>{
 const doc={canvas:{durationFrames:300},cover:{publicPath:'editor-covers/a.png'}};
 assert.equal(showCoverAtFrame(doc,'full',0),true);
 assert.equal(showCoverAtFrame(doc,'full',1),false);
 assert.equal(showCoverAtFrame(doc,'full',50),false);
 assert.equal(showCoverAtFrame(doc,'layer',0),false);
 assert.equal(showCoverAtFrame(doc,'instances',0),false);
 assert.equal(showCoverAtFrame({canvas:doc.canvas},'full',0),false);
 assert.equal(doc.canvas.durationFrames,300);
});
