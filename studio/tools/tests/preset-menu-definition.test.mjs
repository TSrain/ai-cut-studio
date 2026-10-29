import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateMenuDefinition} from '../lib/preset-menu-definition.mjs';
const native=JSON.parse(readFileSync(new URL('../../docs/presets/behind-title/preset.json',import.meta.url),'utf8'));
test('editor-native emphasis definition belongs in agent menu',()=>assert.deepEqual(validateMenuDefinition(native),{ok:true,errors:[]}));
test('native menu schema rejects broken duration and enum',()=>{
 const broken=structuredClone(native);broken.duration.default=broken.duration.max+1;broken.slots.enterFx.values=[];
 assert.equal(validateMenuDefinition(broken).ok,false);
});
test('legacy preset definition retains existing validation',()=>{
 const legacy=JSON.parse(readFileSync(new URL('../../docs/presets/key-concept/preset.json',import.meta.url),'utf8'));
 assert.equal(validateMenuDefinition(legacy).ok,true);legacy.baselineVersion=0;assert.equal(validateMenuDefinition(legacy).ok,false);
});
