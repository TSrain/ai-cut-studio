import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRanges, recedeRanges, rangeRuns, markRecedeRange, updateRecedeText, recedeMotion, RECEDE_EFFECTS} from '../../templates/remotion-base/src/presets/recede-controls.mjs';

test('independent repeated words, disjoint marks, removal and explicit empty selection', () => {
  const slots = {line:'知识与知识', emphasisRanges:[]};
  slots.emphasisRanges = markRecedeRange(slots, 3, 5, true);
  assert.deepEqual(rangeRuns(slots.line, slots.emphasisRanges), [{text:'知识与', em:false}, {text:'知识', em:true}]);
  slots.emphasisRanges = markRecedeRange(slots, 0, 2, true);
  assert.equal(slots.emphasisRanges.length, 2);
  slots.emphasisRanges = markRecedeRange(slots, 0, 5, false);
  assert.deepEqual(recedeRanges(slots), []);
  assert.deepEqual(recedeRanges({line:'知识与知识', hero:'知识'}), [{start:0,end:2}]);
  assert.deepEqual(recedeRanges({line:'知识'}), [{start:0,end:2}]);
});
test('text edits preserve unchanged copy and never mark inserted copy or half an emoji', () => {
  const initial = {line:'A😀重点\n末尾', emphasisRanges:[{start:1,end:5},{start:6,end:8}]};
  assert.deepEqual(normalizeRanges(initial.line,[{start:2,end:3}]),[{start:1,end:3}]);
  const inserted = updateRecedeText(initial,'新A😀重点\n末尾');
  assert.deepEqual(inserted.emphasisRanges,[{start:2,end:6},{start:7,end:9}]);
  const replaced = updateRecedeText(initial,'A😀普通\n末尾');
  assert.deepEqual(replaced.emphasisRanges,[{start:1,end:3},{start:6,end:8}]);
  assert.deepEqual(updateRecedeText(initial,'').emphasisRanges,[]);
  assert.deepEqual(markRecedeRange(initial,3,4,false),[{start:1,end:3},{start:4,end:5},{start:6,end:8}]);
});
test('none is stationary through final frame; every effect has local endpoints and bounded windows', () => {
  for (const fps of [24,30,60]) for (const duration of [.2,2,3,5]) {
    const last = Math.round(fps*duration)-1;
    for (const frame of [0,Math.floor(last/2),last]) {
      const state = recedeMotion(frame,fps,duration,{enterFx:'none',exitFx:'none'});
      assert.equal(state.opacity,1); assert.equal(state.y,0); assert.equal(state.scale,1);
    }
    for (const fx of RECEDE_EFFECTS.filter(f=>f!=='none')) {
      const slots = {enterFx:fx,exitFx:fx,enterSeconds:2,exitSeconds:2};
      assert.equal(recedeMotion(0,fps,duration,slots).opacity,0);
      assert.equal(recedeMotion(last,fps,duration,slots).opacity,0);
      const middle = recedeMotion(Math.floor(last/2),fps,duration,slots);
      assert.equal(middle.opacity,1);
      assert.ok(middle.enterFrames+middle.exitFrames<=last);
    }
  }
});

import {build} from '../../templates/remotion-base/node_modules/esbuild/lib/main.js';
import {layoutEmphasisText, validateProps} from '../lib/preset.mjs';
import {validateEditorProps} from '../lib/editor-props.mjs';
import {readFileSync} from 'node:fs';

test('render and production layouts agree for disjoint ranges, blank copy and explicit sizes', async () => {
  const built = await build({entryPoints:[new URL('../../templates/remotion-base/src/style/fit.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',write:false});
  const {layoutEmphasisText: renderLayout} = await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
  for (const text of ['知识与知识\n选择重点','A😀 B 2026','']) for (const ranges of [[],[{start:0,end:2}],[{start:3,end:5},{start:8,end:10}]]) {
    const spec={fontSize:100,maxWidthPx:936,maxLines:3,shrinkFloorPx:30,emphasisRatio:2,emphasisRanges:ranges};
    const layout=renderLayout(text,spec);
    assert.deepEqual(layout,layoutEmphasisText(text,spec));
    if (!ranges.length) assert.ok(layout.lines.flat().every(r=>!r.em));
    assert.equal(layout.emphasisSize,layout.baseSize*2);
    assert.ok(layout.maxLineWidthPx<=936*.92+1);
  }
});

test('new controls survive production normalization and reject malformed ranges/effects', async () => {
  const def=JSON.parse(readFileSync(new URL('../../docs/presets/recede/preset.json',import.meta.url)));
  const props={durationSeconds:3,slots:{line:'知识与知识',emphasisRanges:[{start:3,end:5}],fontSize:80,emphasisRatio:2,enterFx:'rise',exitFx:'none',enterSeconds:.4,exitSeconds:.2}};
  const checked=await validateProps(def,props);
  assert.equal(checked.ok,true,JSON.stringify(checked.errors));
  assert.deepEqual(checked.normalized.slots,props.slots);
  assert.doesNotThrow(()=>validateEditorProps({assetId:'recede',props},90));
  for (const patch of [{emphasisRanges:[{start:0,end:99}]},{emphasisRanges:[{start:2,end:1}]},{enterFx:'invalid'},{emphasisRatio:0},{fontSize:500},{enterSeconds:3}]) {
    assert.throws(()=>validateEditorProps({assetId:'recede',props:{...props,slots:{...props.slots,...patch}}},90));
    assert.equal((await validateProps(def,{...props,slots:{...props.slots,...patch}})).ok,false);
  }
});
