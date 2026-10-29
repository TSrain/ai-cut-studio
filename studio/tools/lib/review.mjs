// tools/lib/review.mjs — 结构化视觉评审的加权计分与三条否决线
//
// 规格 §13.1 的 100 分表。这里只做**算术和门禁**,不做审美判断——
// 分数由 visual-reviewer / continuity-reviewer 看实际像素给出(见 docs/subagents/)。
//
// 三条否决线彼此独立,任何一条不过就是不过:
//   1. 加权总分 ≥80          —— 挡「哪儿都平庸」
//   2. 任一维度 ≥6           —— 挡「靠一两个维度刷高总分,某一维塌了」
//   3. 英雄帧 ≥8 且技术项全 true —— 挡「好看但错了」/「分够但首帧是空的」
// 第 2 条存在的理由:总分 92.5 也可能藏着一个 5 分的排版,那一版交出去就是「字很土」。

// 2026-08-03 改权重。改之前是 density 15 / distinctiveness 15 / clarity 10 ——
// 密度和"独特性"加起来 30 分,而"能不能一眼看懂"只值 10 分。
// round-01 盲评暴露了这个激励的后果:案例 03 把五个数值印两遍、差值印三遍、
// 加上 n=5 之类的学术脚注,密度和细节都上去了,观众却更难一眼读到结论,排名第 3。
// 现在 clarity 与 composition 并列最高(各 20),density 与 distinctiveness 各降到 10。
// 总和仍是 100。
const WEIGHTS = {
  composition: 20,
  typography: 15,
  density: 10,
  motion: 15,
  distinctiveness: 10,
  clarity: 20,
  continuity: 10,
};

export const scoreReview = (review) => {
  const errors = [];
  for (const key of Object.keys(WEIGHTS)) {
    const value = review.scores?.[key];
    if (!(value >= 0 && value <= 10)) errors.push(`${key} must be between 0 and 10`);
  }
  if (errors.length) return {passed: false, total: 0, errors};
  const total = Object.entries(WEIGHTS).reduce((sum, [key, weight]) => sum + review.scores[key] * weight / 10, 0);
  const weak = Object.entries(review.scores).filter(([, value]) => value < 6).map(([key]) => key);
  const technicalFailed = Object.entries(review.technical ?? {}).filter(([, value]) => value !== true).map(([key]) => key);
  return {
    passed: total >= 80 && weak.length === 0 && review.heroFrame >= 8 && technicalFailed.length === 0,
    total,
    errors: [...weak.map((key) => `${key} is below 6`), ...technicalFailed.map((key) => `technical.${key} failed`)],
  };
};

export const REVIEW_WEIGHTS = WEIGHTS;

// 四份 profile 的占屏区间(取自 docs/styles/*.md 的「占屏率」一行)。
// 密度维度的客观证据(check-density.sh / lint-shot.mjs)都按这张表取阈值,
// **不再有一个普适的墨量数字**。tools/check-density.sh 里有一份 bash 侧副本,改这里要同步改那边。
export const DENSITY_PROFILES = {
  'visual-max': {occupancyMin: 0.6, occupancyMax: 0.85},
  'brand-energy': {occupancyMin: 0.55, occupancyMax: 0.8},
  'data-cinematic': {occupancyMin: 0.5, occupancyMax: 0.75},
  'editorial-luxe': {occupancyMin: 0.4, occupancyMax: 0.65},
};
