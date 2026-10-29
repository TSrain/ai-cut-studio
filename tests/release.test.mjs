import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {allowLocalRequest} from '../studio/tools/lib/local-request.mjs';
import {resolvePanelStatic} from '../studio/tools/lib/panel-static.mjs';
import {workflowRoot, codexModelArgs} from '../studio/tools/lib/codex-cli.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
test('reject external hosts, foreign origins and cross-site browser requests', () => {
  for (const headers of [{host:'example.com'}, {host:'127.0.0.1:4321',origin:'https://example.com'}, {host:'localhost:4321','sec-fetch-site':'cross-site'}]) {
    assert.equal(allowLocalRequest({headers}), false);
  }
  assert.equal(allowLocalRequest({headers:{host:'localhost:4321',origin:'http://localhost:4321'}}), true);
});
test('deny hidden configuration and keys via static files', () => {
  for (const path of ['.git/config', '.devin/cover.json', 'workflow/.env', 'assets/key.pem']) {
    assert.equal(resolvePanelStatic(path,{repoRoot:root,publicRoot:root}), null);
  }
});
test('portable module discovery and no forced model', () => {
  assert.equal(workflowRoot().replace(/\/$/, ''), join(root, 'workflow'));
  assert.deepEqual(codexModelArgs({model:null,reasoningEffort:null}), []);
});
test('cloud upload is opt-in and empty portrait configuration does not scan cwd', () => {
  execFileSync('python3', ['-c', `
import os,sys,tempfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, sys.argv[1])
import transcribe, cover, codex_cli
os.environ.pop('TRANSCRIBE_PROVIDER', None)
with patch.object(transcribe,'run_lark',side_effect=AssertionError('network must not run')):
    try: transcribe._upload_audio(Path('/nonexistent/audio.wav'),'test')
    except transcribe.TranscribeError: pass
    else: raise AssertionError('upload was not blocked')
data={}
cover.bind_package_cover(data)
assert data['coverReferences']==[] and not data['coverContract']['requirePerson']
assert codex_cli.model_args()==[]
`, join(root, 'workflow/tools')], {env:{...process.env,CODEX_MODEL:'',CODEX_REASONING_EFFORT:''}});
});
