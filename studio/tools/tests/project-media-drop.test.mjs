import test from 'node:test';
import assert from 'node:assert/strict';
import {bindProjectMediaDrop} from '../editor/project-media-drop.mjs';
function fixture() {
  const target = new EventTarget(), active = [], drops = [];
  let disabled = false;
  const cleanup = bindProjectMediaDrop(target, {isDisabled: () => disabled, onActive: v => active.push(v), onFiles: files => drops.push(files)});
  const fire = (type, types = ['Files'], files = []) => {
    const event = new Event(type, {cancelable: true});
    event.dataTransfer = {types, files, dropEffect: 'none'};
    target.dispatchEvent(event);
    return event;
  };
  return {active, drops, fire, cleanup, disable: () => {disabled = true;}};
}
test('OS files are accepted even while dragover hides file contents; batch survives drop', () => {
  const f = fixture();
  assert.equal(f.fire('dragenter').defaultPrevented, true);
  assert.equal(f.fire('dragover').dataTransfer.dropEffect, 'copy');
  const files = [{name: '中文.mp4'}, {name: 'B.MOV'}];
  assert.equal(f.fire('drop', ['Files'], files).defaultPrevented, true);
  assert.deepEqual(f.drops, [files]);
  assert.deepEqual(f.active, [true, false]);
});
test('moving between descendants does not clear the drop highlight', () => {
  const f = fixture(); f.fire('dragenter'); f.fire('dragenter'); f.fire('dragleave');
  assert.equal(f.active.at(-1), true);
  f.fire('dragleave'); assert.equal(f.active.at(-1), false);
});
test('internal media drags and links keep their existing behavior', () => {
  const f = fixture();
  for (const types of [['application/x-motion-media'], ['text/uri-list']]) {
    for (const type of ['dragenter', 'dragover', 'drop']) assert.equal(f.fire(type, types).defaultPrevented, false);
  }
  assert.deepEqual(f.drops, []); assert.deepEqual(f.active, []);
});
test('busy or missing project rejects files without navigating browser to them', () => {
  const f = fixture(); f.disable();
  assert.equal(f.fire('dragover').dataTransfer.dropEffect, 'none');
  assert.equal(f.fire('drop', ['Files'], [{name: 'test.mp4'}]).defaultPrevented, true);
  assert.deepEqual(f.drops, []);
});
test('empty drops are harmless and cleanup removes listeners', () => {
  const f = fixture(); f.fire('drop'); assert.deepEqual(f.drops, []);
  f.cleanup();
  assert.equal(f.fire('drop', ['Files'], [{name: 'test.mp4'}]).defaultPrevented, false);
});
