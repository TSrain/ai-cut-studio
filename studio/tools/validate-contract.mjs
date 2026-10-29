#!/usr/bin/env node
// tools/validate-contract.mjs —— VisualContract 门禁
//
// 用法:
//   node tools/validate-contract.mjs <visual-contract.json>
//     基础校验(/motion、/motion-srt、候选合同)
//   node tools/validate-contract.mjs <visual-contract.json> --require-preset-matching
//     追加 B-roll 门:每镜必须留下 preset 匹配记录(presetCandidates / selectedPreset /
//     matchReason / unmatchedReason),非 remotion 引擎必须写 engineReason
//   node tools/validate-contract.mjs <visual-contract.json> --require-preset-matching --preset-resolved
//     再追加:并列候选(presetAlternatives)已被用户二选一并清空 —— 渲视频前跑这一版
import {readVisualContract, validatePresetArtifacts} from './lib/visual-contract.mjs';
import {dirname} from 'node:path';

const args = process.argv.slice(2);
const path = args.find((a) => !a.startsWith('--'));
const flags = new Set(args.filter((a) => a.startsWith('--')));
const unknown = [...flags].filter((f) => !['--require-preset-matching', '--preset-resolved', '--require-preset-artifacts'].includes(f));

if (!path || unknown.length > 0) {
  if (unknown.length > 0) console.error(`未知参数: ${unknown.join(' ')}`);
  console.error('Usage: node tools/validate-contract.mjs <visual-contract.json> [--require-preset-matching] [--preset-resolved] [--require-preset-artifacts]');
  process.exit(2);
}

const options = {
  requirePresetMatching: flags.has('--require-preset-matching'),
  requirePresetResolved: flags.has('--preset-resolved'),
  requirePresetArtifacts: flags.has('--require-preset-artifacts'),
};

try {
  const contract = await readVisualContract(path, options);
  if (options.requirePresetArtifacts) {
    const artifactResult = await validatePresetArtifacts(contract, dirname(path), {requirePreviewReceipt: true});
    if (!artifactResult.ok) throw new Error(artifactResult.errors.join('\n'));
  }
  const presetShots = contract.shots.filter((s) => s.preset).length;
  const mode = options.requirePresetMatching
    ? ` [preset-matching${options.requirePresetResolved ? ' + resolved' : ''}]`
    : '';
  console.log(
    `PASS visual contract: ${contract.project} (${contract.shots.length} shots, ` +
      `${presetShots} preset / ${contract.shots.length - presetShots} custom)${mode}`,
  );
} catch (error) {
  console.error(`FAIL visual contract\n${error.message}`);
  process.exit(1);
}
