import test from 'node:test';import assert from 'node:assert/strict';
import {captionSelectionForClick,moveCaptionSelection,captionSelectionCommand} from '../editor/caption-selection.mjs';
import {DEFAULT_CAPTION_STYLE} from '../../templates/remotion-base/src/editor/captions.mjs';
const cues=[{id:'a',startFrame:0,endFrame:10},{id:'b',startFrame:20,endFrame:30},{id:'c',startFrame:40,endFrame:50}].map(c=>({...c,text:c.id,originalText:c.id,style:{bottomPercent:30}}));
const doc=()=>({canvas:{durationFrames:200,fps:{num:30,den:1}},captions:{version:1,enabled:true,style:{...DEFAULT_CAPTION_STYLE},cues:structuredClone(cues)}});
test('single, toggle, anchored range, preserve and deleted anchor are deterministic',()=>{
 assert.deepEqual(captionSelectionForClick(cues,['a'],'a','c',{toggle:true}).ids,['a','c']);
 assert.deepEqual(captionSelectionForClick(cues,['a','c'],'a','c',{range:true}).ids,['a','b','c']);
 assert.deepEqual(captionSelectionForClick(cues,['a','c'],'a','a',{toggle:true}).ids,['c']);
 assert.deepEqual(captionSelectionForClick(cues,['a','c'],'a','a',{preserve:true}).ids,['a','c']);
 assert.deepEqual(captionSelectionForClick(cues,['a'],'gone','c',{range:true}).ids,['c']);
 assert.deepEqual(captionSelectionForClick(cues,['a','c'],'a','b',{}).ids,['b']);
});
test('group moves clamp at unselected neighbours and preserve offsets/style',()=>{const d=doc();let n=moveCaptionSelection(d,['a','c'],99);assert.deepEqual(n.captions.cues.map(c=>c.startFrame),[10,20,50]);assert.equal(n.captions.cues[0].style.bottomPercent,30);assert.equal(d.captions.cues[0].startFrame,0);});
test('group commands copy/paste/delete/split retain all cue overrides',()=>{const d=doc();let num=0;const uid=()=>`new${++num}`;const cp=captionSelectionCommand(d,['a','c'],'copy',0,null,uid);const pasted=captionSelectionCommand(d,[],'paste',90,cp.payload,uid);assert.deepEqual(pasted.document.captions.cues.slice(-2).map(c=>c.startFrame),[90,130]);assert.equal(pasted.document.captions.cues.at(-1).style.bottomPercent,30);assert.throws(()=>captionSelectionCommand(d,[],'paste',20,cp.payload,uid),/重叠/);assert.equal(captionSelectionCommand(d,['a','c'],'delete',0,null,uid).document.captions.cues.length,1);const split=captionSelectionCommand(d,['a','c'],'split',45,null,uid);assert.equal(split.ids.length,3);assert.equal(split.document.captions.cues.at(-1).style.bottomPercent,30);const dup=captionSelectionCommand(d,['a','c'],'duplicate',0,null,uid);assert.deepEqual(dup.document.captions.cues.slice(-2).map(c=>c.startFrame),[50,90]);});
