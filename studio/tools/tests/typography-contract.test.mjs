// tools/tests/typography-contract.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {glob} from 'node:fs/promises';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('theme has no compatibility family alias', async () => {
  const source = await readFile('templates/remotion-base/src/lib/theme.ts', 'utf8');
  assert.doesNotMatch(source, /family:\s*FONT\.text/);
});

test('font module exposes all explicit kits', async () => {
  const source = await readFile('templates/remotion-base/src/lib/fonts.ts', 'utf8');
  for (const kit of ['impact', 'editorial', 'human', 'modern', 'tech-data']) {
    assert.match(source, new RegExp(`['\"]${kit}['\"]`));
  }
  assert.match(source, /createTypography/);
});

test('template code does not use font.family', async () => {
  const offenders = [];
  for await (const path of glob('templates/remotion-base/src/**/*.{ts,tsx}')) {
    const source = await readFile(path, 'utf8');
    if (/\bfont\.family\b|\btheme\.font\.family\b/.test(source)) offenders.push(path);
  }
  assert.deepEqual(offenders, []);
});

test('shot lint rejects implicit font APIs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'motion-font-lint-'));
  const shots = join(dir, 'shots');
  await mkdir(shots);
  await writeFile(join(shots, 'Bad.tsx'), `const x = {fontFamily: FONT.text}; const y = textStyle('h1');`);
  const result = spawnSync('node', ['tools/lint-shot.mjs', shots], {encoding: 'utf8'});
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /explicit typography kit/i);
  await rm(dir, {recursive: true});
});

test('shot lint scopes the system font check to font declarations', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'motion-font-scope-'));
  const shots = join(dir, 'shots');
  await mkdir(shots);

  // 只是**讨论** system-ui 的注释 —— 不该报 system font fallback
  await writeFile(
    join(shots, 'Comment.tsx'),
    `// 不要用 system-ui:它等于没有做选择\nconst s = textStyle(typography, 'h1');\n`,
  );
  const commented = spawnSync('node', ['tools/lint-shot.mjs', shots], {encoding: 'utf8'});
  assert.doesNotMatch(commented.stdout + commented.stderr, /system font fallback/i);

  // 真正声明 system-ui 字体 —— 必须拦住
  await writeFile(join(shots, 'Comment.tsx'), `const s = {fontFamily: 'system-ui, sans-serif'};\n`);
  const declared = spawnSync('node', ['tools/lint-shot.mjs', shots], {encoding: 'utf8'});
  assert.equal(declared.status, 1);
  assert.match(declared.stdout + declared.stderr, /system font fallback/i);

  await rm(dir, {recursive: true});
});

// 回归:计划原文的正则是 [a-zA-Z]+,放过了带数字的样式名。
// SIZE 的六个名字是 hero/h1/h2/body/label/caption,漏掉的恰好是两个标题级字号,
// 而上面那条 'rejects implicit font APIs' 只断言 /explicit typography kit/i,
// 由 FONT.text 规则就能满足 —— 所以这个洞不会被它暴露,必须单独钉住。
test('shot lint catches one-argument textStyle for every SIZE name', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'motion-textstyle-'));
  const shots = join(dir, 'shots');
  await mkdir(shots);
  for (const name of ['hero', 'h1', 'h2', 'body', 'label', 'caption']) {
    await writeFile(join(shots, 'One.tsx'), `const s = textStyle('${name}');\n`);
    const result = spawnSync('node', ['tools/lint-shot.mjs', shots], {encoding: 'utf8'});
    assert.equal(result.status, 1, `textStyle('${name}') 应被判为违规`);
    assert.match(
      result.stdout + result.stderr,
      /textStyle requires TypographyContext/i,
      `textStyle('${name}') 没有触发单参数规则`,
    );
  }
  await rm(dir, {recursive: true});
});
