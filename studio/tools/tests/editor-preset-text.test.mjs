import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {build} from '../../templates/remotion-base/node_modules/esbuild/lib/main.js';

const project = new URL('../../templates/remotion-base/', import.meta.url).pathname;
const helper = path.join(project, 'src/editor/preset-editing.tsx');

test('preset text edits are rendered on the actual node and preserve animation and other content', async () => {
  assert.ok(existsSync(helper), 'shared render-time preset editing support exists');
  const result = await build({stdin: {contents: `
    import React from 'react';
    import {renderToStaticMarkup} from 'react-dom/server';
    import {EditableText, PresetEditingProvider, EditorScene, EditorBackground} from './src/editor/preset-editing';
    export const render = (transparent) => renderToStaticMarkup(
      <PresetEditingProvider elements={{title: {fontSize: 77, fontFamily: 'Inter', x: 31, y: -12}}} background={transparent ? 'transparent' : 'original'}>
        <EditorScene style={{backgroundColor: '#123456', overflow: 'hidden'}}>
          <EditorBackground><div data-backdrop="yes">background texture</div></EditorBackground>
          <div data-card="yes" style={{background: '#abcdef'}}>
            <EditableText part="title" style={{fontSize: 40, transform: 'rotate(5deg)', opacity: 0.5}}>真实标题</EditableText>
            <EditableText part="caption" style={{fontSize: 22}}>说明</EditableText>
          </div>
        </EditorScene>
      </PresetEditingProvider>);
    export const svg = renderToStaticMarkup(<PresetEditingProvider elements={{title:{opacity:0.5}}}><EditableText as="text" part="title" opacity={0.2}>轮廓</EditableText></PresetEditingProvider>);
    export const plain = renderToStaticMarkup(<EditableText as="span" part="title" style={{fontSize: 40}}>原样</EditableText>);
  `, loader: 'tsx', resolveDir: project}, bundle: true, platform: 'node', format: 'esm', banner: {js: "import {createRequire} from 'node:module'; const require = createRequire(import.meta.url);"}, write: false});
  const dir = mkdtempSync(path.join(tmpdir(), 'editor-preset-text-'));
  try {
    const file = path.join(dir, 'entry.mjs');
    writeFileSync(file, result.outputFiles[0].text);
    const {render, plain, svg} = await import(pathToFileURL(file).href);
    assert.match(svg, /style="opacity:0.1"/);
    const transparent = render(true);
    assert.match(transparent, /data-editor-part="title"[^>]+font-size:77px/);
    assert.match(transparent, /font-family:Inter, &quot;Noto Sans SC&quot;/);
    assert.match(transparent, /transform:rotate\(5deg\)/);
    assert.match(transparent, /translate:31px -12px/);
    assert.match(transparent, /opacity:0.5/);
    assert.match(transparent, /data-editor-part="caption"[^>]+font-size:22px/);
    assert.match(transparent, /data-card="yes"[^>]+background:#abcdef/);
    assert.doesNotMatch(transparent, /data-backdrop|#123456/);
    assert.match(render(false), /data-backdrop="yes"/);
    assert.match(render(false), /background-color:#123456/);
    assert.equal(plain, '<span data-editor-part="title" style="font-size:40px">原样</span>');
  } finally {rmSync(dir, {recursive: true, force: true});}
});

test('text part metadata expands compound rows without confusing derived chart labels with content', async () => {
  const result = await build({entryPoints: [path.join(project, 'src/editor/preset-parts.ts')], bundle: true, platform: 'node', format: 'esm', write: false});
  const {EDITABLE_PRESET_PARTS, resolveEditableParts, RESPONSIVE_PRESET_IDS} = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
  for (const id of ['step-flow', 'trend-chart', 'aspect-embed', 'key-concept']) assert.ok(EDITABLE_PRESET_PARTS[id]?.length, `${id} exposes editable text parts`);
  const parts = resolveEditableParts('step-flow', {slots: {steps: ['第一步 | 说明一', '第二步 | 说明二']}});
  assert.deepEqual(parts.filter(p => p.index === 1).map(({id, slotKey, index, segment}) => ({id, slotKey, index, segment})), [
    {id: 'step-1-head', slotKey: 'steps', index: 1, segment: 0},
    {id: 'step-1-note', slotKey: 'steps', index: 1, segment: 1},
  ]);
  const blankRows = resolveEditableParts('step-flow', {slots: {steps: ['', '第一步 | 说明一', ' ', '第二步 | 说明二']}});
  assert.deepEqual(blankRows.filter(p => p.id.endsWith('-head')).map(({id, index}) => ({id, index})), [{id: 'step-0-head', index: 1}, {id: 'step-1-head', index: 3}]);
  const chart = resolveEditableParts('trend-chart', {slots: {xLabels: '第一月，第二月、第三月', unit: '%'}});
  assert.deepEqual(chart.filter(p => p.id.startsWith('xLabel')).map(p => p.index), [0, 1, 2]);
  assert.ok(chart.filter(p => p.id.startsWith('xLabel')).every(p => p.listSeparator === ','));
  assert.equal(chart.find(p => p.id === 'value-labels').slotKey, undefined);
  assert.equal(chart.find(p => p.id === 'y-labels').slotKey, undefined);
  assert.ok(RESPONSIVE_PRESET_IDS.has('aspect-embed'));
  assert.ok(RESPONSIVE_PRESET_IDS.has('key-concept'));
});
