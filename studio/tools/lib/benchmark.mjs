// tools/lib/benchmark.mjs
//
// Fixed blind A/B benchmark primitives (spec §14).
//
// Two hard rules live in this file and must not be relaxed:
//   1. Determinism. Nothing here or in the two CLIs that import it may call an
//      unseeded Math.random(). Blind labels are derived from a seed string, so
//      the same round/case/seed always produces the same A/B/C/D mapping and a
//      scoring session can be reproduced or audited after the fact.
//   2. Whole-round reporting. summarizeRound() always returns every category,
//      including losses. Cherry-picking is the single easiest way to fake
//      progress against auto-motion, so the data structure refuses to hide it.

/** The four configurations under test. Order here is the canonical order. */
export const CONFIGS = ['blank-context', 'legacy-current', 'visual-first-c', 'auto-motion'];

/** Seeds per case. Two seeds per category is the spec minimum. */
export const SEEDS = ['seed-01', 'seed-02'];

/** Blind labels shown to the reviewer, in presentation order. */
export const BLIND_LABELS = ['A', 'B', 'C', 'D'];

/** The six fixed categories. `id` doubles as the case file / output basename. */
export const CASES = [
  {id: '01-brand-launch', category: 'brand-launch', durationSeconds: 8, canvas: '1080x1920'},
  {id: '02-app-showcase', category: 'app-showcase', durationSeconds: 10, canvas: '1080x1920'},
  {id: '03-data-explainer', category: 'data-explainer', durationSeconds: 10, canvas: '1080x1920'},
  {id: '04-kinetic-type', category: 'kinetic-type', durationSeconds: 6, canvas: '1080x1920'},
  {id: '05-concept-narrative', category: 'concept-narrative', durationSeconds: 12, canvas: '1080x1920'},
  {id: '06-flow-network', category: 'flow-network', durationSeconds: 10, canvas: '1080x1920'},
];

/** Win when the visual score difference reaches this. */
export const WIN_MARGIN = 3;
/** Tie while the absolute visual score difference stays at or under this. */
export const TIE_MARGIN = 2;
/** Parity needs this many categories won or tied. */
export const PARITY_MIN_CATEGORIES = 4;
/** Surpass needs this many categories won outright. */
export const SURPASS_MIN_WINS = 4;
/** Surpass needs the visual mean lead to exceed this. */
export const SURPASS_MEAN_LEAD = 2;
/** Surpass needs this many consecutive full rounds meeting the round condition. */
export const SURPASS_CONSECUTIVE_ROUNDS = 2;

/**
 * 32-bit FNV-1a plus a murmur3 finalizer.
 *
 * The finalizer matters: plain FNV-1a over strings that share a long prefix
 * (every seed string here starts with the same round id) leaves the low bits
 * poorly mixed, which made one config land on label A far too often in an
 * earlier draft. Avalanche the whole word before using it as a sort key.
 */
export const hashSeed = (input) => {
  if (typeof input !== 'string') throw new TypeError('hashSeed expects a string');
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
};

/**
 * Deterministically assign blind labels to configs.
 *
 * @param {string[]} configs  configs to blind; each appears exactly once
 * @param {string} seedString e.g. `round-01|01-brand-launch|seed-01`
 * @returns {Record<string,string>} label -> config, e.g. {A: 'auto-motion', ...}
 */
export const blindOrder = (configs, seedString) => {
  if (!Array.isArray(configs) || configs.length === 0) {
    throw new TypeError('blindOrder expects a non-empty array of configs');
  }
  if (new Set(configs).size !== configs.length) {
    throw new TypeError('blindOrder expects unique config names');
  }
  if (configs.length > BLIND_LABELS.length) {
    throw new RangeError(`blindOrder supports at most ${BLIND_LABELS.length} configs`);
  }
  if (typeof seedString !== 'string' || seedString.length === 0) {
    throw new TypeError('blindOrder expects a non-empty seed string');
  }

  const ranked = configs
    .map((config) => ({config, key: hashSeed(`${seedString}|${config}`)}))
    // Hash collisions are astronomically unlikely but must not make the order
    // depend on input array order, so break ties by name.
    .sort((a, b) => (a.key - b.key) || (a.config < b.config ? -1 : 1));

  const mapping = {};
  ranked.forEach((entry, index) => {
    mapping[BLIND_LABELS[index]] = entry.config;
  });
  return mapping;
};

/** Inverse of blindOrder's result: config -> label. */
export const invertMapping = (mapping) => {
  const inverted = {};
  for (const [label, config] of Object.entries(mapping)) inverted[config] = label;
  return inverted;
};

const round2 = (value) => Math.round(value * 100) / 100;
const mean = (values) => (values.length === 0 ? 0 : round2(values.reduce((a, b) => a + b, 0) / values.length));

/**
 * Classify one category from the visual score difference.
 * Exactly +3 is a win, exactly +/-2 is a tie, -3 or worse is a loss.
 */
export const classifyCategory = (cScore, autoScore) => {
  const diff = round2(cScore - autoScore);
  if (diff >= WIN_MARGIN) return {result: 'win', diff};
  if (Math.abs(diff) <= TIE_MARGIN) return {result: 'tie', diff};
  return {result: 'loss', diff};
};

/**
 * Summarize one full round.
 *
 * @param {Array<{category:string, cScore:number, autoScore:number, technicalPass:boolean,
 *                blankScore?:number, legacyScore?:number, cMinutes?:number,
 *                autoMinutes?:number, technicalFailures?:string[]}>} cases
 * @returns {object} per-category rows plus round-level aggregates
 */
export const summarizeRound = (cases) => {
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new TypeError('summarizeRound expects a non-empty array of category rows');
  }

  const categories = cases.map((row, index) => {
    if (typeof row?.category !== 'string' || row.category.length === 0) {
      throw new TypeError(`case ${index}: category must be a non-empty string`);
    }
    if (!Number.isFinite(row.cScore) || !Number.isFinite(row.autoScore)) {
      throw new TypeError(`case ${row.category}: cScore and autoScore must be finite numbers`);
    }
    if (typeof row.technicalPass !== 'boolean') {
      throw new TypeError(`case ${row.category}: technicalPass must be a boolean`);
    }
    const {result, diff} = classifyCategory(row.cScore, row.autoScore);
    return {
      category: row.category,
      cScore: round2(row.cScore),
      autoScore: round2(row.autoScore),
      blankScore: Number.isFinite(row.blankScore) ? round2(row.blankScore) : null,
      legacyScore: Number.isFinite(row.legacyScore) ? round2(row.legacyScore) : null,
      diff,
      result,
      technicalPass: row.technicalPass,
      technicalFailures: Array.isArray(row.technicalFailures) ? [...row.technicalFailures] : [],
      cMinutes: Number.isFinite(row.cMinutes) ? round2(row.cMinutes) : null,
      autoMinutes: Number.isFinite(row.autoMinutes) ? round2(row.autoMinutes) : null,
    };
  });

  const wins = categories.filter((c) => c.result === 'win').length;
  const ties = categories.filter((c) => c.result === 'tie').length;
  const losses = categories.filter((c) => c.result === 'loss').length;

  const technicalFailureCategories = categories.filter((c) => !c.technicalPass).map((c) => c.category);
  const technicalFailures = technicalFailureCategories.length;
  const allTechnicalPass = technicalFailures === 0;

  const cVisualMean = mean(categories.map((c) => c.cScore));
  const autoVisualMean = mean(categories.map((c) => c.autoScore));
  const blankScores = categories.map((c) => c.blankScore).filter((v) => v !== null);
  const legacyScores = categories.map((c) => c.legacyScore).filter((v) => v !== null);
  const visualMeanDelta = round2(cVisualMean - autoVisualMean);

  // Parity: C wins or ties at least four of six categories AND every technical
  // gate passes. A technical failure anywhere voids parity for the whole round,
  // because a score bought by breaking duration/captions/facts is not a score.
  const parity = (wins + ties) >= PARITY_MIN_CATEGORIES && allTechnicalPass;

  // Round-level half of the surpass condition. The "two consecutive rounds"
  // half is decided by summarize-benchmark.mjs, which reads the previous
  // full report; a single round can never declare surpass on its own.
  const surpassThisRound = wins >= SURPASS_MIN_WINS
    && visualMeanDelta > SURPASS_MEAN_LEAD
    && allTechnicalPass;

  return {
    categories,
    categoryCount: categories.length,
    wins,
    ties,
    losses,
    cVisualMean,
    autoVisualMean,
    blankVisualMean: blankScores.length ? mean(blankScores) : null,
    legacyVisualMean: legacyScores.length ? mean(legacyScores) : null,
    visualMeanDelta,
    technicalFailures,
    technicalFailureCategories,
    allTechnicalPass,
    parity,
    surpassThisRound,
    surpassRoundsRequired: SURPASS_CONSECUTIVE_ROUNDS,
    thresholds: {
      winMargin: WIN_MARGIN,
      tieMargin: TIE_MARGIN,
      parityMinCategories: PARITY_MIN_CATEGORIES,
      surpassMinWins: SURPASS_MIN_WINS,
      surpassMeanLead: SURPASS_MEAN_LEAD,
      surpassConsecutiveRounds: SURPASS_CONSECUTIVE_ROUNDS,
    },
  };
};

/**
 * Fold per-seed records into one row per category.
 * Every seed of a case is averaged; a technical failure on any seed fails the
 * category. Used by summarize-benchmark.mjs before calling summarizeRound.
 *
 * @param {Array<{caseId:string, category:string, seed:string, config:string,
 *                visual:number, technicalPass:boolean, productionMinutes?:number,
 *                failureTags?:string[]}>} records
 */
export const foldSeedsIntoCategories = (records) => {
  const byCategory = new Map();
  for (const record of records) {
    const key = record.category;
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(record);
  }

  const rows = [];
  for (const [category, group] of byCategory) {
    const pick = (config) => group.filter((r) => r.config === config);
    const scoreOf = (config) => {
      const values = pick(config).map((r) => r.visual).filter(Number.isFinite);
      return values.length ? mean(values) : null;
    };
    const minutesOf = (config) => {
      const values = pick(config).map((r) => r.productionMinutes).filter(Number.isFinite);
      return values.length ? mean(values) : null;
    };
    const cRecords = pick('visual-first-c');
    const failures = [];
    for (const record of cRecords) {
      if (record.technicalPass === false) {
        failures.push(...(record.failureTags?.length ? record.failureTags : [`${record.seed}: unspecified technical failure`]));
      }
    }
    rows.push({
      category,
      caseId: group[0]?.caseId ?? category,
      cScore: scoreOf('visual-first-c') ?? 0,
      autoScore: scoreOf('auto-motion') ?? 0,
      blankScore: scoreOf('blank-context') ?? undefined,
      legacyScore: scoreOf('legacy-current') ?? undefined,
      cMinutes: minutesOf('visual-first-c') ?? undefined,
      autoMinutes: minutesOf('auto-motion') ?? undefined,
      technicalPass: cRecords.length > 0 && cRecords.every((r) => r.technicalPass === true),
      technicalFailures: failures,
    });
  }
  // Stable, canonical category order regardless of input order.
  const order = CASES.map((c) => c.category);
  rows.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));
  return rows;
};

/** Count failure tags across all records; the round report clusters on this. */
export const clusterFailures = (records) => {
  const counts = new Map();
  for (const record of records) {
    for (const tag of record.failureTags ?? []) {
      if (!counts.has(tag)) counts.set(tag, {tag, count: 0, configs: new Set(), cases: new Set()});
      const entry = counts.get(tag);
      entry.count += 1;
      entry.configs.add(record.config);
      entry.cases.add(record.caseId);
    }
  }
  return [...counts.values()]
    .map((e) => ({tag: e.tag, count: e.count, configs: [...e.configs].sort(), cases: [...e.cases].sort()}))
    .sort((a, b) => (b.count - a.count) || (a.tag < b.tag ? -1 : 1));
};
