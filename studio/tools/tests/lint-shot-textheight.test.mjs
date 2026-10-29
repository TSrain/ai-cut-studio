// 判例 T1(最低有效字高)的双向测试。
//
// 为什么要有它:taste-rules 里这条判例的「落点」写的是 `门禁`,
// 而只要没有测试,门禁随时会在下一次重构里静默失效——那时判例就退回成一句空话。
//
// 双向都要拦得住:全墨小字必须报,肌理小字(弱墨 + 低透明)必须不报。
// 后者是判例 Q5 认可的手法(「卡片标题降到 20px、ink.muted、opacity 0.7 只当重复肌理读」),
// 误报它等于让两条判例互相打架。
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const HEAD = `import {createTypography, textStyle, scenePalette, ink} from '../lib/theme';
const T = createTypography('modern');
const P = scenePalette(250, 'dark');
export const Shot = () => (
  <div style={{background: 'linear-gradient(#000,#111)', boxShadow: '0 0 8px #000'}}>
`;
const TAIL = `  </div>
);
`;

const runLint = (body) => {
  const dir = mkdtempSync(join(tmpdir(), 'lint-shot-'));
  try {
    writeFileSync(join(dir, 'Shot.tsx'), HEAD + body + TAIL, 'utf8');
    let stdout = '';
    try {
      stdout = execFileSync('node', ['tools/lint-shot.mjs', dir], {encoding: 'utf8'});
    } catch (error) {
      stdout = error.stdout ?? '';
    }
    return stdout;
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
};

test('T1: 全墨小字被报出来', () => {
  const out = runLint(`    <p style={{...textStyle(T, 'body'), fontSize: 18, color: ink.primary}}>要被读的一句话</p>\n`);
  assert.match(out, /低于最低有效字高/);
  assert.match(out, /实到:18px/);
});

test('T1: 肌理小字(弱墨 + 低透明)不报,只记豁免数', () => {
  const out = runLint(
    `    <p style={{...textStyle(T, 'body'), fontSize: 18, color: ink.muted, opacity: 0.7}}>肌理</p>\n`,
  );
  assert.match(out, /肌理文字已豁免/);
  assert.doesNotMatch(out, /^ {2}[!✗] 低于最低有效字高/m);
});

test('T1: 达标字号完全不触发', () => {
  const out = runLint(`    <p style={{...textStyle(T, 'body'), fontSize: 44, color: ink.primary}}>正常正文</p>\n`);
  assert.match(out, /✓ 无低于最低有效字高/);
});
