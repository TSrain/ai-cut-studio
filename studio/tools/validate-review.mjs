#!/usr/bin/env node
// validate-review.mjs — 结构化视觉评审的硬门槛
//
// 用法:
//   node tools/validate-review.mjs projects/<name>/review.json
//
// 输入是一份 review JSON(格式见 docs/visual-scorecard.md):
//   {
//     "scores": {composition, typography, density, motion, distinctiveness, clarity, continuity},  // 各 0–10
//     "heroFrame": 8,                                   // 英雄帧主观分 0–10
//     "technical": {contract, output, fonts, assets, thumbnail},  // 全部必须 true
//     "mismatches": [...], "repairs": [...]             // mismatches 0–3 条留档;FAIL 时 repairs 至少一条
//   }
//
// 退出码: 0 = 过; 1 = 不过(或 JSON 不合法); 2 = 参数错
//
// 为什么要有它:此前「视觉合格」只存在于散文 review.md 里,谁也没法拦住一句
// 「整体不错,可以交付」。分数落成 JSON 之后,门禁才是客观的:
// 总分 <80、任一维 <6、英雄帧 <8、技术项有一条 false —— 四者任一即 exit 1。

import {readFileSync} from 'node:fs';
import {scoreReview, REVIEW_WEIGHTS} from './lib/review.mjs';

const path = process.argv[2];
if (!path) {
  console.error('用法: node tools/validate-review.mjs <review.json>');
  process.exit(2);
}

let review;
try {
  review = JSON.parse(readFileSync(path, 'utf8'));
} catch (err) {
  console.error(`读不出 review JSON: ${path}`);
  console.error(String(err.message ?? err));
  process.exit(1);
}

const result = scoreReview(review);

console.log(`视觉评审 ${path}`);
for (const [key, weight] of Object.entries(REVIEW_WEIGHTS)) {
  const value = review.scores?.[key];
  const shown = typeof value === 'number' ? value.toFixed(0).padStart(2) : ' ?';
  const mark = typeof value === 'number' && value >= 6 ? '✓' : '✗';
  console.log(`  ${mark} ${key.padEnd(16)} ${shown}/10  ×${String(weight).padStart(2)}`);
}
const hero = review.heroFrame;
const heroShown = (typeof hero === 'number' ? String(hero) : '?').padStart(2);
console.log(`  ${hero >= 8 ? '✓' : '✗'} ${'heroFrame'.padEnd(16)} ${heroShown}/10  (下限 8)`);
for (const [key, value] of Object.entries(review.technical ?? {})) {
  console.log(`  ${value === true ? '✓' : '✗'} technical.${key}`);
}
console.log(`  总分 ${result.total.toFixed(1)} / 100  (下限 80)`);

// scoreReview 的 errors 不含「英雄帧」「总分」「技术项整段缺失」三种情况:
// 前两者它只体现在 passed 上,第三者 `review.technical ?? {}` 会静默当作「没有失败项」。
// 缺检查不等于通过 —— CLI 在这里把五项技术检查的**存在性**也当成硬条件。
const REQUIRED_TECHNICAL = ['contract', 'output', 'fonts', 'assets', 'thumbnail'];
const errors = [...result.errors];
if (!(hero >= 8)) errors.push('heroFrame is below 8');
if (result.total < 80) errors.push(`total ${result.total.toFixed(1)} is below 80`);
for (const key of REQUIRED_TECHNICAL) {
  if (review.technical?.[key] === undefined) errors.push(`technical.${key} is missing (未检查 ≠ 通过)`);
}

// FAIL 必须可执行:不带修复清单的 FAIL 只会引发一轮盲目重渲。
// (mismatches 不设下限——合格镜 0 条是正常的,为凑数造的假问题比漏报更贵。)
if (errors.length > 0 && !(Array.isArray(review.repairs) && review.repairs.length > 0)) {
  errors.push('FAIL 结论必须附至少一条可直接动手的修复(repairs)');
}

if (result.passed && errors.length === 0) {
  console.log('PASS');
  process.exit(0);
}
for (const e of errors) console.log(`  ! ${e}`);
console.log('FAIL — 修画面再评一次;不许用旧规则替低分辩护(docs/quality-checklist.md)');
process.exit(1);
