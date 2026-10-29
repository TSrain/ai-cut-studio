import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const template = fileURLToPath(new URL('../../templates/remotion-base/', import.meta.url));
const require = createRequire(template + 'package.json');
const {build} = require('esbuild');

test('fonts remain gated and clear their timeout when no-react is imported later', async () => {
  // Use the installed Remotion entrypoints: both initialize the global handle list.
  const bundle = await build({
    stdin: {contents: "import './src/lib/fonts'; import 'remotion/no-react';", resolveDir: template},
    bundle: true, write: false, platform: 'browser', format: 'iife',
  });
  const timers = new Map();
  const pending = [];
  const loaded = [];
  let timerId = 0;
  const window = {process: {env: {NODE_ENV: 'test'}}, remotion_puppeteerTimeout: 30000,
    remotion_staticBase: '/static', location: {pathname: '/'}};
  vm.runInNewContext(bundle.outputFiles[0].text, {
    window, console, process: {env: {NODE_ENV: 'production'}},
    document: {fonts: {add: (face) => loaded.push(face)}},
    FontFace: class {load() {return new Promise(resolve => pending.push(() => resolve(this)));}},
    setTimeout: (fn) => {timers.set(++timerId, fn); return timerId;},
    clearTimeout: (id) => timers.delete(id),
  });
  assert.ok(window.remotion_delayRenderHandles.length > 0, 'font gate was lost during module initialization');
  pending.forEach(resolve => resolve());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(loaded.length, pending.length);
  assert.equal(window.remotion_delayRenderHandles.length, 0);
  assert.equal(timers.size, 0, 'orphan font timer would abort an otherwise healthy render');
});
