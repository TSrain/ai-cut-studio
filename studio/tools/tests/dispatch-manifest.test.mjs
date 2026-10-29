// tools/tests/dispatch-manifest.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('creates isolated dispatch files from a valid contract', async () => {
  const root = await mkdtemp(join(tmpdir(), 'visual-dispatch-'));
  const project = join(root, 'project');
  assert.equal(spawnSync('node', ['tools/init-visual-project.mjs', project, 'smoke'], {encoding: 'utf8'}).status, 0);
  const example = JSON.parse(await readFile('docs/examples/visual-contract.example.json', 'utf8'));
  example.shots.push({...example.shots[0], id: 'shot-002', engine: 'remotion'});
  await writeFile(join(project, 'visual-contract.json'), JSON.stringify(example, null, 2));
  const result = spawnSync('node', ['tools/build-dispatch-manifest.mjs', project], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  const one = await readFile(join(project, 'shots/shot-001/dispatch.md'), 'utf8');
  const two = await readFile(join(project, 'shots/shot-002/dispatch.md'), 'utf8');
  assert.match(one, /Writable scope: .*shots\/shot-001/);
  assert.doesNotMatch(one, /Writable scope: .*shot-002/);
  assert.match(two, /Engine: remotion/);
  await rm(root, {recursive: true});
});

test('inlines a tag-matched component shortlist instead of pointing at the full catalog', async () => {
  const root = await mkdtemp(join(tmpdir(), 'visual-dispatch-'));
  const project = join(root, 'project');
  assert.equal(spawnSync('node', ['tools/init-visual-project.mjs', project, 'smoke'], {encoding: 'utf8'}).status, 0);
  const example = JSON.parse(await readFile('docs/examples/visual-contract.example.json', 'utf8'));
  example.shots[0] = {...example.shots[0], engine: 'remotion', tags: ['data', 'chart']};
  await writeFile(join(project, 'visual-contract.json'), JSON.stringify(example, null, 2));
  assert.equal(spawnSync('node', ['tools/build-dispatch-manifest.mjs', project], {encoding: 'utf8'}).status, 0);

  const dispatch = await readFile(join(project, 'shots/shot-001/dispatch.md'), 'utf8');
  const shortlist = dispatch.split('## Component shortlist')[1].split('## Guardrails')[0];
  const picks = shortlist.split('\n').filter((line) => line.startsWith('- '));
  assert.ok(picks.length > 0 && picks.length <= 10, `shortlist size ${picks.length}`);
  // 每一条都要和本镜标签有重合,否则清单等于噪音
  for (const pick of picks) assert.match(pick, /data|chart/);
  // 全表不再占一个知识名额;它只作为「不够用时」的兜底出现一次
  const knowledge = dispatch.split('## Routed knowledge')[1].split('## Component shortlist')[0];
  assert.doesNotMatch(knowledge, /components\.json/);
  await rm(root, {recursive: true});
});

test('refuses to overwrite a non-empty project directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'visual-init-'));
  await writeFile(join(root, 'keep.txt'), 'owned by user');
  const result = spawnSync('node', ['tools/init-visual-project.mjs', root, 'smoke'], {encoding: 'utf8'});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /refuse to overwrite/i);
  await rm(root, {recursive: true});
});
