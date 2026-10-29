import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {createTimelineHover} from '../editor/timeline-hover.mjs';
import * as snapping from '../editor/timeline-snap.mjs';
const require=createRequire(new URL('../../templates/remotion-base/package.json',import.meta.url));
const code=require('esbuild').transformSync(readFileSync(new URL('../editor/TimelineHover.tsx',import.meta.url),'utf8'),{loader:'tsx',format:'cjs'}).code;
function harness(){
 const effects=[],layouts=[],cleanups=[],queue=new Map();let rafId=0,committed=30,target;
 const surface=()=>({events:new Map(),addEventListener(k,fn){if(!this.events.has(k))this.events.set(k,new Set());this.events.get(k).add(fn);},removeEventListener(k,fn){this.events.get(k)?.delete(fn);},emit(k,event={}){for(const fn of this.events.get(k)??[])fn(event);}});
 const window=surface(),document=surface(),el=Object.assign(surface(),{scrollLeft:0,clientWidth:600,clientHeight:200,getBoundingClientRect:()=>({left:10,top:20}),contains:n=>n===target});
 target={closest:()=>null};document.elementFromPoint=()=>target;
 const controller=createTimelineHover({clock:{getSnapshot:()=>committed,setFrame:f=>committed=f},seekTo:()=>{},getDuration:()=>300,isPlaying:()=>false});
 const react={useRef:value=>({current:value}),useState:value=>[value,()=>{}],useSyncExternalStore:(_,get)=>get(),useEffect:fn=>effects.push(fn),useLayoutEffect:fn=>layouts.push(fn)};
 const module={exports:{}};
 runInNewContext(code,{module,exports:module.exports,require:n=>n==='react'?react:n.endsWith('.css')?{}:n==='./timeline-snap.mjs'?snapping:{formatStudioTime:()=>''},window,document,requestAnimationFrame:fn=>{queue.set(++rafId,fn);return rafId;},cancelAnimationFrame:id=>queue.delete(id)});
 const props={controller,scrollRef:{current:el},enabled:true,blocked:false,px:1,labelWidth:100,duration:300,fps:30,documentId:'test',snap:true,snapPoints:[100,200],onPlay:()=>controller.startPlayback()};
 module.exports.TimelineHover(props);effects.forEach(fn=>cleanups.push(fn()));layouts.forEach(fn=>fn());
 const flush=()=>{const callbacks=[...queue.values()];queue.clear();callbacks.forEach(fn=>fn());};
 const event=raw=>({pointerType:'mouse',buttons:0,button:0,clientX:110+raw,clientY:80,altKey:false,target});
 const move=raw=>{el.emit('pointermove',event(raw));flush();};
 const key=(type,name,extra={})=>{window.emit(type,{key:name,code:name,target,preventDefault(){},stopImmediatePropagation(){},...extra});flush();};
 return {controller,el,window,document,props,flush,event,move,key,clock:()=>committed,cleanup:()=>cleanups.forEach(fn=>fn?.()),setTargetClosest:fn=>target.closest=fn};
}
test('component preserves sticky preview through pointerdown and click promotion',()=>{
 const h=harness();h.move(94);assert.equal(h.controller.getSnapshot(),100);
 h.move(112);assert.equal(h.controller.getSnapshot(),100);
 h.window.emit('pointerdown',h.event(112));
 assert.equal(h.controller.getSnapshot(),null);
 assert.equal(h.controller.resolvePointerSeek(222,112),100);
 assert.equal(h.clock(),30);h.cleanup();
});
test('Option bypass updates without moving the mouse; Space starts at the snapped point',()=>{
 const h=harness();h.move(106);assert.equal(h.controller.getSnapshot(),100);
 h.key('keydown','Alt',{altKey:true});assert.equal(h.controller.getSnapshot(),106);
 h.key('keyup','Alt',{altKey:false});assert.equal(h.controller.getSnapshot(),100);
 h.key('keydown',' ',{code:'Space'});assert.equal(h.clock(),100);
 assert.equal(h.controller.getSnapshot(),null);h.cleanup();
});
test('horizontal scroll recomputes raw position and leaving restores the committed clock',()=>{
 const h=harness();h.move(94);h.el.scrollLeft=40;h.el.emit('scroll');h.flush();
 assert.equal(h.controller.getSnapshot(),134);
 h.el.emit('pointerleave');assert.equal(h.controller.getSnapshot(),null);assert.equal(h.clock(),30);
 h.move(72);assert.equal(h.controller.getSnapshot(),112,'previous magnet must be reset');h.cleanup();
});
test('controls and active gestures suppress hover, while trim handles can still preview',()=>{
 const h=harness();
 h.setTargetClosest(s=>s.includes('[role="separator"]')?{}:null);
 h.move(100);assert.equal(h.controller.getSnapshot(),100);
 h.window.emit('pointerdown',h.event(100));assert.equal(h.controller.resolvePointerSeek(210,97),97,'trim handles retain their own gesture');
 h.setTargetClosest(()=>({}));h.move(100);assert.equal(h.controller.getSnapshot(),null);
 h.setTargetClosest(()=>null);h.props.blocked=true;h.move(100);assert.equal(h.controller.getSnapshot(),null);
 h.cleanup();for(const surface of [h.window,h.document,h.el])for(const listeners of surface.events.values())assert.equal(listeners.size,0);
});
