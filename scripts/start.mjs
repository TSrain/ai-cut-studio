import {spawn} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
for (const path of ['studio/assets', 'studio/workspace', 'output']) mkdirSync(join(root, path), {recursive: true});
const env = {
  ...process.env,
  CONTENT_WORKFLOW_ROOT: join(root, 'workflow'),
  EDITOR_WORKFLOW_ROOT: join(root, 'workflow'),
  EDITOR_TRANSCRIBE_SCRIPT: join(root, 'workflow/tools/transcribe.py'),
  VISUALIZATION_ROOT: join(root, 'studio'),
  PRODUCTION_PLAN_ARTIFACT_ROOT: process.env.PRODUCTION_PLAN_ARTIFACT_ROOT || join(root, 'output'),
  PANEL_SKIP_REAP: '1',
  PANEL_NO_OPEN: process.env.PANEL_NO_OPEN ?? (process.platform === 'darwin' ? '0' : '1'),
};
const child = spawn(process.execPath, ['tools/build-asset-browser.mjs', '--serve', '--no-autoloop'], {cwd: join(root, 'studio'), env, stdio: 'inherit'});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
