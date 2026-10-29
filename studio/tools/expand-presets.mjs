#!/usr/bin/env node
// tools/expand-presets.mjs —— 把合同里的 preset 镜展开成完整镜头条目
//
// 用法: node tools/expand-presets.mjs <project-dir>
//
// 对每个带 `preset` 字段的镜:
//   1. 读 docs/presets/<id>/preset.json,核对版本(合同 v ≠ 当前 v → 硬失败,给两条出路)
//   2. 校验 presetProps(必填/类型/估宽/enum/图片存在;槽外需求 = slot mismatch → 硬失败,
//      该镜应降级为 custom 镜走全流程,展开器不做兜底)
//   3. 回填合同字段 engine/tags/durationSeconds/objective/startAnchor/endAnchor(幂等:
//      每次从 preset.json 重算,preset+presetProps 是唯一事实源)
//   4. 落 shots/<id>/props.json(`npx remotion render <compositionId> --props=<它>` 直接吃)
//   5. 落 signals.json + route.json(真跑 engine-router;路由结果 ≠ preset.engine 时自动带
//      override,保住「合同 engine == route.json engine」「改路由必写 override」两条审计不变量)
//
// 顺序被门禁强制:本工具跑在 validate-contract **之前**——没展开的 preset 镜缺
// objective/anchors/engine,validate-contract 本来就过不了。
//
// 退出码: 0 = 全部展开并落盘; 1 = 任何一镜失败(会列出所有错误,不是遇错即停); 2 = 参数错误

import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadPreset, expandShot} from './lib/preset.mjs';
import {routeShot} from './lib/engine-router.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const projectDir = process.argv[2];
if (!projectDir) {
  console.error('用法: node tools/expand-presets.mjs <project-dir>');
  process.exit(2);
}

const contractPath = join(projectDir, 'visual-contract.json');
let contract;
try {
  contract = JSON.parse(await readFile(contractPath, 'utf8'));
} catch (error) {
  console.error(`读不到合同 ${contractPath}: ${error.message}`);
  process.exit(2);
}

const shots = Array.isArray(contract.shots) ? contract.shots : [];
const presetShots = shots.filter((s) => s && s.preset);
if (presetShots.length === 0) {
  console.log('[expand-presets] 合同里没有 preset 镜,无事可做');
  process.exit(0);
}

const failures = [];
let expanded = 0;
let alternatives = 0;

for (const shot of presetShots) {
  const label = shot.id ?? '(缺 id)';
  try {
    const def = await loadPreset(ROOT, shot.preset.id);
    if (shot.preset.version !== def.version) {
      failures.push(
        `${label}: 合同要 preset「${def.id}」v${shot.preset.version},当前定义是 v${def.version}。` +
          `两条出路:①把合同版本号改成 ${def.version}(接受当前版);②如果确要旧版,去 preset changelog 查差异后改文案`,
      );
      continue;
    }
    const result = await expandShot(def, shot, {projectDir});
    if (!result.ok) {
      failures.push(`${label}:\n  - ${result.errors.join('\n  - ')}`);
      continue;
    }
    for (const note of result.notes) console.log(`[expand-presets] ${label}: ${note}`);

    Object.assign(shot, result.contractPatch);

    const shotDir = join(projectDir, 'shots', label);
    await mkdir(shotDir, {recursive: true});
    await writeFile(join(shotDir, 'props.json'), `${JSON.stringify(result.props, null, 2)}\n`);
    await writeFile(join(shotDir, 'signals.json'), `${JSON.stringify(result.signals, null, 2)}\n`);

    const router = routeShot(result.signals);
    const route = {
      shot: label,
      signals: result.signals,
      router,
      engine: def.engine,
      override:
        router.engine === def.engine
          ? null
          : {
              from: router.engine,
              to: def.engine,
              reason: `preset ${def.id}@v${def.version} 钉死 engine:时序与组件已按该引擎冻结`,
              by: 'tools/expand-presets.mjs',
              at: new Date().toISOString().slice(0, 10),
            },
    };
    await writeFile(join(shotDir, 'route.json'), `${JSON.stringify(route, null, 2)}\n`);
    expanded += 1;

    // 并列候选:两个 preset 一样合适时,各自也要用**真实文案**渲一张预览让用户二选一。
    // 只落 props(预览用),不碰合同/signals/route —— 选中之前它们不是这镜的实现。
    for (const alt of shot.presetAlternatives ?? []) {
      const altDef = await loadPreset(ROOT, alt.id);
      if (alt.version !== altDef.version) {
        failures.push(`${label} 并列候选 ${alt.id}: 合同要 v${alt.version},当前定义是 v${altDef.version}`);
        continue;
      }
      const altResult = await expandShot(altDef, {presetProps: alt.presetProps}, {projectDir});
      if (!altResult.ok) {
        failures.push(`${label} 并列候选 ${alt.id}:\n  - ${altResult.errors.join('\n  - ')}`);
        continue;
      }
      for (const note of altResult.notes) console.log(`[expand-presets] ${label}(候选 ${alt.id}): ${note}`);
      await writeFile(
        join(shotDir, `alt-${alt.id}.props.json`),
        `${JSON.stringify(altResult.props, null, 2)}\n`,
      );
      alternatives += 1;
    }
  } catch (error) {
    failures.push(`${label}: ${error.message}`);
  }
}

if (failures.length > 0) {
  console.error(`[expand-presets] ${failures.length} 镜展开失败:\n${failures.join('\n')}`);
  process.exit(1);
}

await writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
console.log(
  `[expand-presets] 展开 ${expanded} 镜${alternatives > 0 ? ` + ${alternatives} 个并列候选(alt-*.props.json,只用于预览二选一)` : ''},` +
    `合同已回填:${contractPath}`,
);
console.log('[expand-presets] 下一步:node tools/preset-preview.mjs <project> —— 渲真实文案预览,拼接触印张,拿那一次确认');
