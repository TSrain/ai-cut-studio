import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync, readFileSync} from 'node:fs';
import {readPresetCatalog} from '../lib/preset-catalog.mjs';
const EDITOR_PRESET_SCHEMAS = JSON.parse(readFileSync(new URL('../lib/editor-preset-schemas.generated.json', import.meta.url), 'utf8'));

test('generated editor catalog covers every documented Remotion preset', () => {
  const documented = readPresetCatalog();
  // 2026-09-07: existing 25 presets plus the reusable SC-0030 chapter navigation.
  assert.ok(documented.some(p=>p.id==='media-stage'));
  assert.equal(new Set(documented.map(p=>p.id)).size, documented.length);
  const generated = readFileSync(new URL('../../templates/remotion-base/src/editor/preset-catalog.generated.ts', import.meta.url), 'utf8');
  for (const preset of documented) {
    assert.match(generated, new RegExp(`"id": "${preset.id}"`));
    assert.match(generated, new RegExp(`"compositionId": "${preset.compositionId}"`));
  }
  assert.match(generated, /"focusX"[\s\S]*?"min": 0,[\s\S]*?"max": 1/);
  assert.equal(EDITOR_PRESET_SCHEMAS.PresetScreenPush.properties.slots.properties.focusX.maximum, 1);
  const actual = JSON.parse(generated.slice(generated.indexOf('=') + 1, generated.lastIndexOf('as const')).trim());
  const expected = documented.map((preset) => {
    const slotSchemas = EDITOR_PRESET_SCHEMAS[preset.compositionId].properties.slots.properties;
    const slots = Object.fromEntries(Object.entries(preset.slots ?? {}).map(([key, descriptor]) => {
      const schema = slotSchemas[key] ?? {};
      return [key, {...descriptor, ...(schema.minimum === undefined ? {} : {min: schema.minimum}), ...(schema.maximum === undefined ? {} : {max: schema.maximum}), ...(schema.type === 'integer' ? {integer: true} : {})}];
    }));
    return {id: preset.id, name: preset.name, compositionId: preset.compositionId, version: preset.version, status: preset.status, description: preset.description ?? preset.objectiveTemplate ?? '', thumbnail: existsSync(new URL(`../../docs/catalog/thumbnails/remotion/preset-${preset.id}.png`, import.meta.url)) ? `/docs/catalog/thumbnails/remotion/preset-${preset.id}.png` : null, preview: `/assets/previews/presets/${preset.id}.mp4`, canvas: preset.canvas, duration: preset.duration, slots, variants: preset.variants ?? {}, output: preset.output ?? {mode: 'opaque'}};
  });
  assert.deepEqual(actual, expected);
});
