import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_CAPTION_STYLE,validateCaptionTrack} from '../../templates/remotion-base/src/editor/captions.mjs';
import {editHistory,amendHistory,undoHistory,redoHistory} from '../editor/history.mjs';
import * as model from '../editor/roughcut-model.mjs';
import {transcriptWords,transcriptEdit,runSourceRange,selectionRuns,wordAtFrame,shouldGroupTranscriptEdit,editSpan,transcriptKeyCommand,joinWords} from '../editor/transcript-model.mjs';
import {composeDragHint,snapHintText} from '../editor/roughcut-snap.mjs';

const doc=(frames=300)=>({schemaVersion:1,id:'tx',name:'原片',revision:0,canvas:{width:1920,height:1080,fps:{num:30,den:1},durationFrames:frames},source:{path:'voice.mp4',publicPath:'voice.mp4',startFrame:0,durationFrames:frames,clips:[{id:'source-main',name:'主视频',startFrame:0,durationFrames:frames,sourceInFrame:0}]},instances:[],tracks:[],captions:{version:1,enabled:true,style:{...DEFAULT_CAPTION_STYLE},cues:[{id:'c1',startFrame:30,endFrame:150,text:'我不喜欢你',originalText:'我不喜欢你'},{id:'c2',startFrame:240,endFrame:270,text:'真的',originalText:'真的'}]}});
const units=()=>[...['我','不','喜欢','你'].map((text,i)=>({id:`u${i+1}`,text,startSeconds:i+1,endSeconds:i+2,timing:'word',groupId:'c1'})),{id:'u5',text:'真',startSeconds:8,endSeconds:8.5,timing:'word',groupId:'c2'},{id:'u6',text:'的',startSeconds:8.5,endSeconds:9,timing:'word',groupId:'c2'}];
const analysis=(d,extra={})=>({version:1,sourceKey:model.roughcutSourceKey(d),sourceDurationSeconds:10,timing:'word',units:units(),silences:[{startSeconds:5.2,endSeconds:7.6}],decisions:[{id:'remove-no',unitIds:['u2'],action:'delete',kind:'retake',reason:'删除口误',keepUnitIds:[],confidence:0.98}],warnings:[],...extra});
const rc=(extra)=>{const d=doc();return model.createRoughcut(d,analysis(d,extra));};
const exposure=d=>{const out=[];for(const c of [...d.source.clips].sort((a,b)=>a.startFrame-b.startFrame)){const l=out.at(-1);if(l&&l[0]+l[2]===c.startFrame&&l[1]+l[2]===c.sourceInFrame)l[2]+=c.durationFrames;else out.push([c.startFrame,c.sourceInFrame,c.durationFrames]);}return out;};
const text=d=>d.captions.cues.map(c=>c.text).join('|');
const kept=d=>transcriptWords(d).words.map(w=>w.kept?w.text:`[${w.text}]`).join('');

test('view model: words from analysis units, kept/cut by exposed footage, candidate ownership, paragraphs and playhead lookup',()=>{
 const d=rc(),{words,groups}=transcriptWords(d);
 assert.equal(kept(d),'我[不]喜欢你真的');
 assert.deepEqual(groups.map(g=>[g.id,g.start,g.end]),[['c1',0,4],['c2',4,6]]);
 assert.equal(words[1].cutEnabled,true);assert.equal(words[1].cutId,model.roughcutRows(d)[0].id);
 assert.deepEqual(words.map(w=>w.projectFrame),[30,60,60,90,154,169]);
 assert.equal(transcriptWords(d),transcriptWords(d),'memoized per document object');
 assert.equal(wordAtFrame(words,95),3);assert.equal(wordAtFrame(words,156),4);assert.equal(wordAtFrame(words,5),-1);
 assert.deepEqual(selectionRuns(words,0,5,true).map(r=>r.map(w=>w.id)),[['u1'],['u3','u4','u5','u6']]);
 assert.deepEqual(selectionRuns(words,5,0,false).map(r=>r.map(w=>w.id)),[['u2']]);
});

test('mapping: whole-unit range padded into the gap (silence midpoint, ≤0.25 s), never into neighbouring words',()=>{
 const d=rc(),{words}=transcriptWords(d);
 assert.deepEqual(runSourceRange(d,words,[words[3]]),{startFrame:120,endFrame:158});// next gap holds a silence: pad capped at 8 frames
 assert.deepEqual(runSourceRange(d,words,[words[4],words[5]]),{startFrame:232,endFrame:278});
 assert.deepEqual(runSourceRange(d,words,[words[0]]),{startFrame:22,endFrame:60});
});

test('cut → manual ripple removal with captions rebuilt from kept words; restore is the exact inverse',()=>{
 const d=rc(),cut=transcriptEdit(d,3,3,'cut');
 assert.equal(cut.kind,'cut');assert.deepEqual(cut.ranges,[{startFrame:120,endFrame:158}]);assert.deepEqual(cut.enabled,[]);
 assert.equal(kept(cut.document),'我[不]喜欢[你]真的');assert.equal(cut.document.canvas.durationFrames,d.canvas.durationFrames-38);
 assert.equal(text(cut.document),'我喜欢|真的');validateCaptionTrack(cut.document.captions,{durationFrames:cut.document.canvas.durationFrames});
 assert.equal(model.validateRoughcut(cut.document.roughcut),true);assert.ok(cut.document.roughcut.manualTimeline);
 assert.match(cut.message,/已删除「你」/);
 const back=transcriptEdit(cut.document,3,3,'restore');
 assert.deepEqual(exposure(back.document),exposure(d));assert.equal(back.document.canvas.durationFrames,d.canvas.durationFrames);
 assert.equal(text(back.document),text(d));
 assert.equal(transcriptEdit(cut.document,3,3,'cut').blocked,'所选文字已删除');assert.equal(transcriptEdit(d,3,3,'restore').blocked,'所选文字未被删除');
});

test('candidates fully covered by the text keep their status in sync (restore disables, cut re-enables)',()=>{
 const d=rc(),id=model.roughcutRows(d)[0].id;
 const restored=transcriptEdit(d,1,1,'restore');
 assert.deepEqual(restored.disabled,[id]);assert.equal(model.roughcutRows(restored.document)[0].enabled,false);
 assert.equal(kept(restored.document),'我不喜欢你真的');assert.equal(restored.document.canvas.durationFrames,d.canvas.durationFrames+30);assert.equal(text(restored.document).replace(/\|/g,''),'我不喜欢你真的');
 const again=transcriptEdit(restored.document,1,1,'cut');
 assert.deepEqual(again.enabled,[id]);assert.equal(model.roughcutRows(again.document)[0].enabled,true);assert.deepEqual(exposure(again.document),exposure(d));
 // A selection mixing kept and cut words cuts only the kept runs in one operation.
 const mixed=transcriptEdit(d,0,2,'cut');assert.equal(kept(mixed.document),'[我][不][喜欢]你真的');assert.equal(mixed.ranges.length,2);
});

test('protection: explicit protected ranges block, uncertain transcript warns, cutting everything is refused, padding avoids protected time',()=>{
 const locked=rc({protectedRanges:[{startSeconds:8,endSeconds:8.5,reason:'品牌名'}]});
 assert.equal(transcriptEdit(locked,4,5,'cut').blocked,'所选文字包含明确保护的原话，不能删除');
 const {words}=transcriptWords(locked);assert.equal(words[4].locked,true);
 assert.deepEqual(runSourceRange(locked,words,[words[3]]),{startFrame:120,endFrame:158});
 assert.equal(transcriptEdit(rc(),0,5,'cut').blocked,'不能删除全部文字');
 const d=doc(),a=analysis(d);a.units[4].protectionReasons=['possible_missing_transcript'];
 const warned=transcriptEdit(model.createRoughcut(d,a),4,4,'cut');assert.deepEqual(warned.warnings,['附近可能缺字，删除后请试听']);assert.match(warned.message,/请试听/);
});

test('undo grouping: rapid adjacent same-kind edits fold into one undo step; anything else starts a new step',()=>{
 const d=rc(),a=transcriptEdit(d,3,3,'cut'),b=transcriptEdit(a.document,2,2,'cut');
 const prev={kind:'cut',at:1000,document:a.document,span:editSpan(a.ranges)};
 assert.equal(shouldGroupTranscriptEdit(prev,{kind:'cut',span:editSpan(b.ranges)},{now:1800,present:a.document}),true);
 assert.equal(shouldGroupTranscriptEdit(prev,{kind:'restore',span:editSpan(b.ranges)},{now:1800,present:a.document}),false);
 assert.equal(shouldGroupTranscriptEdit(prev,{kind:'cut',span:editSpan(b.ranges)},{now:4000,present:a.document}),false);
 assert.equal(shouldGroupTranscriptEdit(prev,{kind:'cut',span:editSpan(b.ranges)},{now:1800,present:b.document}),false,'another edit happened in between');
 assert.equal(shouldGroupTranscriptEdit(prev,{kind:'cut',span:{startFrame:900,endFrame:930}},{now:1800,present:a.document}),false,'far away text');
 assert.equal(shouldGroupTranscriptEdit(prev,{kind:'cut',span:editSpan(b.ranges)},{now:1800,present:structuredClone(a.document),same:(x,y)=>JSON.stringify(x)===JSON.stringify(y)}),true);
 let h=editHistory({past:[],present:d,future:[]},a.document);h=amendHistory(h,b.document);
 assert.equal(h.past.length,1);assert.deepEqual(h.present,b.document);
 const undone=undoHistory(h);assert.deepEqual(undone.present,d);assert.deepEqual(redoHistory(undone).present,b.document);
 const separate=editHistory(editHistory({past:[],present:d,future:[]},a.document),b.document);
 assert.equal(separate.past.length,2);assert.deepEqual(undoHistory(separate).present,a.document);
 assert.deepEqual(amendHistory({past:[],present:d,future:[]},a.document).present,a.document,'no step to amend → new step');
});

test('text-view keys: ⌫ cuts, ⇧⌫/R restores, X toggles; transport, review and undo keys pass through',()=>{
 const k=(key,extra={})=>({key,shiftKey:false,metaKey:false,ctrlKey:false,altKey:false,isComposing:false,...extra});
 const sel={hasSelection:true},none={hasSelection:false};
 assert.equal(transcriptKeyCommand(k('Backspace'),sel),'cut');assert.equal(transcriptKeyCommand(k('Delete'),sel),'cut');
 assert.equal(transcriptKeyCommand(k('Backspace',{shiftKey:true}),sel),'restore');
 assert.equal(transcriptKeyCommand(k('Backspace'),none),'noop','never falls through to the timeline clip delete');
 assert.equal(transcriptKeyCommand(k('a'),sel),'cut');assert.equal(transcriptKeyCommand(k('r'),sel),'restore');assert.equal(transcriptKeyCommand(k('x'),sel),'toggle');
 for(const key of ['a','r','x','n','p'])assert.equal(transcriptKeyCommand(k(key),none),null,'row review keys keep working without a text selection');
 for(const key of ['j','k','l',' ','n','p','i','o','s','?'])assert.equal(transcriptKeyCommand(k(key),sel),null);
 assert.equal(transcriptKeyCommand(k('z',{metaKey:true}),sel),null);assert.equal(transcriptKeyCommand(k('a',{metaKey:true}),none),'select-all');
 assert.equal(transcriptKeyCommand(k('ArrowLeft'),none),'left');assert.equal(transcriptKeyCommand(k('ArrowRight',{shiftKey:true}),sel),'extend-right');
 assert.equal(transcriptKeyCommand(k('Escape'),sel),'clear');assert.equal(transcriptKeyCommand(k('Escape'),none),null);
 assert.equal(transcriptKeyCommand(k('Backspace',{isComposing:true}),sel),null);
});

test('helpers: latin word spacing and timeline trim hint keeps the snap label',()=>{
 assert.equal(joinWords(['用','AI','做','PPT','和','Excel']),'用AI做PPT和Excel');assert.equal(joinWords(['open','AI']),'open AI');
 const hint=composeDragHint(snapHintText({kind:'word-start',text:'喜欢'}),'1 个片段 · 2.00—4.00 秒 · 主轨连动裁切 +3 帧');
 assert.equal(hint,'吸附到字词边界「喜欢」 · 1 个片段 · 2.00—4.00 秒 · 主轨连动裁切 +3 帧 · 按住 Option 取消吸附');
 assert.equal(composeDragHint('','范围'),'范围');assert.equal(snapHintText({kind:'silence-mid'}),'吸附到停顿');
});
