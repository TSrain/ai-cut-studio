import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {isInstanceVisible, localSequenceStart, sortInstances} from '../../templates/remotion-base/src/editor/timing.mjs';

test('instance interval is start-inclusive and end-exclusive', () => {
  const instance = {startFrame: 10, durationFrames: 5};
  assert.equal(isInstanceVisible(instance, 9), false);
  assert.equal(isInstanceVisible(instance, 10), true);
  assert.equal(isInstanceVisible(instance, 14), true);
  assert.equal(isInstanceVisible(instance, 15), false);
});

test('sequence offset preserves global timing for ranged exports', () => {
  assert.equal(localSequenceStart({startFrame: 42}, 40), 2);
  assert.equal(localSequenceStart({startFrame: 20}, 40), -20);
});

test('z sort is stable for equal layers', () => {
  const values = [{id: 'a', zIndex: 2}, {id: 'b', zIndex: 1}, {id: 'c', zIndex: 2}];
  assert.deepEqual(sortInstances(values).map((v) => v.id), ['b', 'a', 'c']);
});

test('PillStack applies each item edit once across container and text', async () => {
  const source = await readFile(new URL('../../templates/remotion-base/src/presets/PillStack.tsx', import.meta.url), 'utf8');
  assert.equal((source.match(/editorBoxStyle\(itemEdit\)/g) ?? []).length, 1);
  assert.equal((source.match(/editorTextStyle\(itemEdit\)/g) ?? []).length, 1);
});

test('NumberBeat only splits the scene unit after a real unit edit', async () => {
  const source = await readFile(new URL('../../templates/remotion-base/src/presets/NumberBeat.tsx', import.meta.url), 'utf8');
  assert.match(source, /unitEdits && Object\.keys\(unitEdits\)\.length > 0/);
  assert.match(source, /hasUnitEdits && slots\.suffix/);
});

test('NumberBeat composes label opacity and offsets with its entry animation', async () => {
  const source = await readFile(new URL('../../templates/remotion-base/src/presets/NumberBeat.tsx', import.meta.url), 'utf8');
  assert.match(source, /opacity:\s*labelIn\s*\*\s*\(elements\?\.label\?\.opacity\s*\?\?\s*1\)/);
  assert.match(source, /translate:\s*`\$\{elements\?\.label\?\.x\s*\?\?\s*0\}px \$\{16 \* \(1 - labelIn\) \+ \(elements\?\.label\?\.y\s*\?\?\s*0\)\}px`/);
  assert.match(source, /transform:\s*`translate\(\$\{elements\?\.label\?\.x\s*\?\?\s*0\}px, \$\{20 \* \(1 - labelIn\) \+ \(elements\?\.label\?\.y\s*\?\?\s*0\)\}px\)`/);
  assert.match(source, /const \{translate: _labelTranslate, \.\.\.sceneLabelStyle\} = editorStyle\(elements\?\.label\)/);
  assert.match(source, /\.\.\.sceneLabelStyle,[\s\S]*?transform: `translate/);
});

test('edited chapter and pill widths opt into wrapping without changing defaults', async () => {
  const chapter = await readFile(new URL('../../templates/remotion-base/src/editor/ChapterProgress.tsx', import.meta.url), 'utf8');
  const pill = await readFile(new URL('../../templates/remotion-base/src/presets/PillStack.tsx', import.meta.url), 'utf8');
  assert.match(chapter, /whiteSpace: edited\?\.width === undefined \? 'nowrap' : 'normal'/);
  assert.match(chapter, /flex: `\$\{duration\} 1 0`/);
  assert.match(pill, /height: flexibleText \? 'auto' : pillH/);
  assert.match(pill, /whiteSpace: flexibleText \? 'normal' : 'pre'/);
});

test('Latin editor fonts append the bundled Chinese fallback', async () => {
  const paths = ['../../templates/remotion-base/src/editor/ChapterProgress.tsx', '../../templates/remotion-base/src/presets/NumberBeat.tsx', '../../templates/remotion-base/src/presets/PillStack.tsx'];
  for (const path of paths) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.match(source, /style\.fontFamily === 'Inter' \|\| style\.fontFamily === 'Archivo'/);
    assert.match(source, /"Noto Sans SC"/);
  }
});
