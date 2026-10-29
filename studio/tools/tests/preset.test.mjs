// tools/tests/preset.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile, readFile, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {
  FIT_COEFF,
  WRAP_SAFETY,
  SHRINK_TOLERANCE,
  EMPHASIS_RATIO_DEFAULT,
  NO_LINE_START,
  estimateTextWidth,
  layoutEmphasisText,
  validatePresetDef,
  loadPreset,
  validateProps,
} from '../lib/preset.mjs';
import {validateVisualContract} from '../lib/visual-contract.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------------------------------------------------------------------------
// 估宽:期望值对拍。这些数字是「系数 × 字号」的手算结果——
// 谁改了 FIT_COEFF(JS 或 TS 任一份)而没同步另一份+这里,测试就会喊。
// templates/remotion-base/src/style/fit.ts 持有同一组系数(TS 手抄份)。
// ---------------------------------------------------------------------------

test('估宽系数没有被单边改动', () => {
  assert.deepEqual(FIT_COEFF, {cjk: 1.0, latin: 0.52, digit: 0.6, space: 0.3, mixedLatinBoost: 1.06});
});

test('估宽:纯中文/纯西文/中西混排样例', () => {
  // 纯中文 4 字 × 1.0 × 100
  assert.equal(Math.round(estimateTextWidth('上下文字', 100)), 400);
  // 纯西文无 CJK,不加 1.06:ab = 2 × 0.52 × 100
  assert.equal(Math.round(estimateTextWidth('ab', 100)), 104);
  // 混排:「10 年 = $2,000」digits×6、CJK×1、latin(=,$,逗号)×3、空格×3,西文段 ×1.06
  // = (6×0.6×1.06 + 1 + 3×0.52×1.06 + 3×0.3) × 150 ≈ 1105.4
  const w = estimateTextWidth('10 年 = $2,000', 150);
  assert.ok(w > 1100 && w < 1110, `期望 ~1105,得到 ${w}`);
});

test('TS 手抄份(fit.ts)与 JS 份系数一致', async () => {
  const ts = await readFile(join(ROOT, 'templates/remotion-base/src/style/fit.ts'), 'utf8');
  for (const [key, value] of Object.entries(FIT_COEFF)) {
    const re = new RegExp(`${key === 'mixedLatinBoost' ? 'mixedLatinBoost' : key}:\\s*${String(value).replace('.', '\\.')}`);
    assert.match(ts, re, `fit.ts 里 ${key} 应为 ${value}`);
  }
  // 折行常量同样是双源手抄(recede v2 起):任一边单独改动都会让展开器与组件排出不同版式
  assert.match(ts, new RegExp(`WRAP_SAFETY = ${String(WRAP_SAFETY).replace('.', '\\.')}`));
  assert.match(ts, new RegExp(`SHRINK_TOLERANCE = ${String(SHRINK_TOLERANCE).replace('.', '\\.')}`));
  assert.match(ts, new RegExp(`EMPHASIS_RATIO_DEFAULT = ${String(EMPHASIS_RATIO_DEFAULT).replace('.', '\\.')}`));
  assert.ok(ts.includes(`NO_LINE_START = '${NO_LINE_START}'`), 'fit.ts 的避头标点表必须与 JS 份一致');
});

// ---------------------------------------------------------------------------
// 折行 + 主焦点排版(recede v2)
// ---------------------------------------------------------------------------

const LINE_FIT = {fontSize: 94, maxWidthPx: 936, maxLines: 3, shrinkFloorPx: 60};
const render = (layout) => layout.lines.map((l) => l.map((r) => r.text).join('')).join(' / ');

test('无 hero:优先缩字保住单行(等同 v1 的 shrink-to-fit)', () => {
  const layout = layoutEmphasisText('最慢的生产资料', LINE_FIT);
  assert.equal(layout.lineCount, 1, '七个字不该被折成两行');
  assert.equal(render(layout), '最慢的生产资料');
  assert.ok(layout.emphasisSize < 150 && layout.emphasisSize > 110, `实得 ${layout.emphasisSize}`);
  assert.ok(layout.lines[0].every((run) => run.em), '无 hero 时整句都是主焦点');
});

test('有 hero:满字号折行,主焦点放大 1.6 倍且不被折断', () => {
  const layout = layoutEmphasisText('知识，是人类最慢的生产资料', {...LINE_FIT, emphasis: '最慢'});
  assert.equal(layout.lineCount, 2);
  assert.equal(layout.baseSize, 94);
  assert.equal(layout.emphasisSize, 150);
  const flat = layout.lines.flat();
  const hero = flat.filter((run) => run.em);
  assert.equal(hero.length, 1, 'hero 必须是完整一段,不许被折行拆开');
  assert.equal(hero[0].text, '最慢');
  assert.equal(render(layout), '知识，是人类 / 最慢的生产资料');
});

test('折行容量:14 个中文字排得下,超长排不下时返回 null', () => {
  const fourteen = layoutEmphasisText('一二三四五六七八九十十一十二', LINE_FIT);
  assert.ok(fourteen && fourteen.lineCount <= 3, '14 字必须排得下');
  assert.equal(layoutEmphasisText('一二三'.repeat(12), LINE_FIT), null);
});

test('折行:\\n 是硬断行,行宽不超预算,避头标点不在行首', () => {
  const hard = layoutEmphasisText('先看结果\n再看代价', LINE_FIT);
  assert.equal(hard.lineCount, 2);
  assert.equal(render(hard), '先看结果 / 再看代价');

  const budget = LINE_FIT.maxWidthPx * WRAP_SAFETY;
  const wrapped = layoutEmphasisText('算力便宜了，知识没有跟着便宜', {...LINE_FIT, emphasis: '没有'});
  assert.ok(wrapped.maxLineWidthPx <= budget, `最宽行 ${wrapped.maxLineWidthPx} 超预算 ${budget}`);
  for (const line of wrapped.lines) {
    assert.ok(!NO_LINE_START.includes(line[0].text[0]), `行首出现避头标点:${render(wrapped)}`);
  }
});

// ---------------------------------------------------------------------------
// preset 定义与槽位校验
// ---------------------------------------------------------------------------

test('仓库里的 recede / key-concept 定义合法', async () => {
  for (const id of ['recede', 'key-concept']) {
    const def = await loadPreset(ROOT, id);
    assert.equal(def.id, id);
  }
});

test('validatePresetDef 拒绝缺信号的定义', () => {
  const result = validatePresetDef({version: 1, id: 'x', name: 'x', engine: 'remotion', compositionId: 'X', status: 'draft', baselineVersion: 1, duration: {min: 1, max: 2, default: 1}, tags: ['t'], signals: {}, slots: {a: {type: 'enum', values: [1]}}, anchors: {start: 's', end: 'e'}, objectiveTemplate: 'o'});
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('signals.')));
});

test('槽位校验:爆槽给出"最多约 N 字",槽外字段报 slot mismatch', async () => {
  const def = await loadPreset(ROOT, 'recede');
  const overflow = await validateProps(def, {durationSeconds: 3, slots: {line: '这一行字实在是太长太长太长太长太长太长了根本装不下'}});
  assert.equal(overflow.ok, false);
  assert.ok(overflow.errors[0].includes('最多约'), overflow.errors[0]);

  const mismatch = await validateProps(def, {durationSeconds: 3, slots: {line: '正常', bogus: 'x'}});
  assert.equal(mismatch.ok, false);
  assert.ok(mismatch.errors.some((e) => e.includes('slot mismatch')));

  const badDuration = await validateProps(def, {durationSeconds: 30, slots: {line: '正常'}});
  assert.equal(badDuration.ok, false);
  assert.ok(badDuration.errors.some((e) => e.includes('区间')));
});

// ---------------------------------------------------------------------------
// 展开器端到端:展开 → 合同过校验 → 幂等;负例 exit 1
// ---------------------------------------------------------------------------

const CONTRACT_BASE = {
  version: 1,
  project: 'preset-test',
  mode: 'visual-first',
  profile: 'visual-max',
  canvas: {width: 1080, height: 1920, fps: 30, durationSeconds: 6.5},
  density: {target: 7, occupancyMin: 0.5, occupancyMax: 0.85, layerCount: 3},
  focus: {primary: '关键概念', secondary: []},
  typography: {kit: 'modern', displayRole: 'display 承担关键词', bodyRole: 'body 承担解释', dataRole: 'data 承担数字'},
  assets: {allowBrandLogos: true, allowScreenshots: true, allowUnknownNetworkImages: true, cacheSelectedLocally: true},
  facts: {mode: 'illustrative'},
};

const runExpand = (projectDir) =>
  spawnSync('node', [join(ROOT, 'tools/expand-presets.mjs'), projectDir], {encoding: 'utf8'});

test('展开器:回填合同 + props/signals/route 落盘 + 幂等', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'preset-expand-'));
  const contract = {
    ...CONTRACT_BASE,
    shots: [
      {id: 'shot-001', preset: {id: 'recede', version: 2}, presetProps: {durationSeconds: 3, variant: {level: 4}, slots: {line: '慢就是快'}}},
      {id: 'shot-002', durationSeconds: 3.5, engine: 'remotion', objective: 'custom 占位', startAnchor: 'a', endAnchor: 'b'},
    ],
  };
  await writeFile(join(dir, 'visual-contract.json'), JSON.stringify(contract, null, 2));

  const first = runExpand(dir);
  assert.equal(first.status, 0, first.stderr);

  const expanded = JSON.parse(await readFile(join(dir, 'visual-contract.json'), 'utf8'));
  assert.equal(validateVisualContract(expanded).ok, true);
  const shot = expanded.shots[0];
  assert.equal(shot.engine, 'remotion');
  assert.ok(shot.objective.includes('慢就是快'));
  assert.ok(shot.objective.includes('亮度档 4'));
  assert.deepEqual(shot.tags, ['type', 'background', 'preset']);

  const props = JSON.parse(await readFile(join(dir, 'shots/shot-001/props.json'), 'utf8'));
  assert.equal(props.compositionId, 'PresetRecede');
  assert.equal(props.slots.line, '慢就是快');
  const route = JSON.parse(await readFile(join(dir, 'shots/shot-001/route.json'), 'utf8'));
  assert.equal(route.engine, 'remotion');
  assert.equal(route.override, null, 'preset 预填信号本应路由到自家引擎,不该出现 override');

  const snapshot = await readFile(join(dir, 'visual-contract.json'), 'utf8');
  const second = runExpand(dir);
  assert.equal(second.status, 0);
  assert.equal(await readFile(join(dir, 'visual-contract.json'), 'utf8'), snapshot, '重跑必须零 diff');

  await rm(dir, {recursive: true});
});

test('展开器:爆槽 / 版本不符 → exit 1 且不写回合同', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'preset-expand-neg-'));
  const contract = {
    ...CONTRACT_BASE,
    shots: [
      {id: 'shot-001', preset: {id: 'recede', version: 2}, presetProps: {slots: {line: '这一行字实在是太长太长太长太长太长太长了根本装不下'}}},
      {id: 'shot-002', preset: {id: 'recede', version: 99}, presetProps: {slots: {line: '正常'}}},
    ],
  };
  const raw = JSON.stringify(contract, null, 2);
  await writeFile(join(dir, 'visual-contract.json'), raw);
  const result = runExpand(dir);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes('最多约'));
  assert.ok(result.stderr.includes('v99'));
  assert.equal(await readFile(join(dir, 'visual-contract.json'), 'utf8'), raw, '失败时不许写回合同');
  await rm(dir, {recursive: true});
});

// ---------------------------------------------------------------------------
// 合同 schema ↔ JS 校验器 防漂移(双源有前科)
// ---------------------------------------------------------------------------

test('visual-contract.schema.json 与 JS 校验器同步持有 preset/tags/profile', async () => {
  const schema = JSON.parse(await readFile(join(ROOT, 'docs/visual-contract.schema.json'), 'utf8'));
  const shotProps = schema.$defs.shot.properties;
  for (const key of ['tags', 'preset', 'presetProps']) {
    assert.ok(shotProps[key], `schema $defs.shot 缺 ${key}`);
  }
  assert.deepEqual(schema.properties.profile.enum, ['visual-max', 'editorial-luxe', 'brand-energy', 'data-cinematic']);

  // JS 侧行为对拍:profile 非法值必须报错;preset 缺 presetProps 必须报错
  const bad = validateVisualContract({...CONTRACT_BASE, profile: 'safe', shots: [{id: 's', durationSeconds: 1, engine: 'remotion', objective: 'o', startAnchor: 'a', endAnchor: 'b'}]});
  assert.ok(bad.errors.some((e) => e.includes('profile')));
  const noProps = validateVisualContract({...CONTRACT_BASE, shots: [{id: 's', durationSeconds: 1, engine: 'remotion', objective: 'o', startAnchor: 'a', endAnchor: 'b', preset: {id: 'recede', version: 2}}]});
  assert.ok(noProps.errors.some((e) => e.includes('presetProps')));
});
