#!/usr/bin/env node
// tools/summarize-benchmark.mjs
//
// Deblind a scored round and write the full report.
//
// Reads the score sheets under <blind>/review/ plus the hidden <blind>/.mapping.json,
// maps every A/B/C/D back to its config, and writes Markdown + JSON reports.
//
// The report is deliberately exhaustive: every case, both seeds, all four
// configs, visual means, technical failures, production time, per-category
// win/tie/loss, failure clusters and parity/surpass status. There is no flag to
// print only the wins. Spec §14: "不得只展示获胜案例".
//
// Two-round surpass is decided here, not in the library: pass --prev with the
// previous round's JSON report and this script requires surpassThisRound in both.
//
// Determinism: no Math.random() anywhere in this file.
//
// Usage:
//   node tools/summarize-benchmark.mjs --round round-01 \
//     --blind benchmarks/runs/round-01/blind \
//     --out-md benchmarks/reports/round-01.md \
//     --out-json benchmarks/reports/round-01.json \
//     [--prev benchmarks/reports/round-00.json]

import fs from 'node:fs';
import path from 'node:path';
import {
  CASES, CONFIGS, SEEDS,
  summarizeRound, foldSeedsIntoCategories, clusterFailures,
  SURPASS_CONSECUTIVE_ROUNDS,
} from './lib/benchmark.mjs';

const parseArgs = (argv) => {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`--${key} needs a value`);
    args[key] = value;
    i += 1;
  }
  return args;
};

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const fmt = (value, suffix = '') => (value === null || value === undefined ? '—' : `${value}${suffix}`);
const round2 = (value) => Math.round(value * 100) / 100;
const mean = (values) => (values.length === 0 ? null : round2(values.reduce((a, b) => a + b, 0) / values.length));

const usage = 'usage: node tools/summarize-benchmark.mjs --round <id> --blind <dir> --out-md <file> --out-json <file> [--prev <file>]';

const collect = (args) => {
  const blindDir = path.resolve(args.blind);
  const mappingPath = path.join(blindDir, '.mapping.json');
  if (!fs.existsSync(mappingPath)) throw new Error(`hidden mapping not found: ${mappingPath}`);
  const mapping = readJson(mappingPath);

  const records = [];
  const incomplete = [];

  for (const testCase of CASES) {
    for (const seed of SEEDS) {
      const sheetPath = path.join(blindDir, 'review', `${testCase.id}--${seed}.json`);
      if (!fs.existsSync(sheetPath)) {
        incomplete.push(`${testCase.id} / ${seed}: score sheet missing`);
        continue;
      }
      const sheet = readJson(sheetPath);
      const labels = mapping.cases?.[testCase.id]?.[seed]?.labels;
      if (!labels) throw new Error(`mapping has no entry for ${testCase.id} / ${seed}`);

      for (const [label, config] of Object.entries(labels)) {
        const score = sheet.scores?.[label];
        if (!score || !Number.isFinite(score.visual)) {
          incomplete.push(`${testCase.id} / ${seed} / label ${label}: no visual score`);
          continue;
        }
        records.push({
          caseId: testCase.id,
          category: testCase.category,
          seed,
          label,
          config,
          visual: score.visual,
          dimensions: score.dimensions ?? {},
          technicalPass: score.technicalPass === true,
          technicalScored: typeof score.technicalPass === 'boolean',
          productionMinutes: Number.isFinite(score.productionMinutes) ? score.productionMinutes : null,
          engines: Array.isArray(score.engines) ? score.engines : [],
          failureTags: Array.isArray(score.failureTags) ? score.failureTags : [],
          notes: typeof score.notes === 'string' ? score.notes : '',
        });
        if (typeof score.technicalPass !== 'boolean') {
          incomplete.push(`${testCase.id} / ${seed} / label ${label}: technicalPass not recorded`);
        }
      }
    }
  }
  return {mapping, records, incomplete};
};

const buildReport = (args, {mapping, records, incomplete}) => {
  const rows = foldSeedsIntoCategories(records);
  const summary = summarizeRound(rows);

  const perConfig = CONFIGS.map((config) => {
    const own = records.filter((r) => r.config === config);
    return {
      config,
      outputs: own.length,
      visualMean: mean(own.map((r) => r.visual)),
      visualMin: own.length ? Math.min(...own.map((r) => r.visual)) : null,
      visualMax: own.length ? Math.max(...own.map((r) => r.visual)) : null,
      technicalFailures: own.filter((r) => !r.technicalPass).length,
      productionMinutesMean: mean(own.map((r) => r.productionMinutes).filter(Number.isFinite)),
      productionMinutesTotal: own.some((r) => Number.isFinite(r.productionMinutes))
        ? round2(own.reduce((a, r) => a + (r.productionMinutes ?? 0), 0))
        : null,
      engines: [...new Set(own.flatMap((r) => r.engines))].sort(),
    };
  });

  const failureClusters = clusterFailures(records);

  const expectedOutputs = CASES.length * SEEDS.length * CONFIGS.length;
  const complete = records.length === expectedOutputs && incomplete.length === 0;

  let previous = null;
  if (args.prev) {
    if (!fs.existsSync(args.prev)) throw new Error(`previous report not found: ${args.prev}`);
    previous = readJson(args.prev);
  }
  const previousSurpass = previous?.summary?.surpassThisRound === true && previous?.complete === true;
  const surpassStreak = (summary.surpassThisRound ? 1 : 0) + (summary.surpassThisRound && previousSurpass ? 1 : 0);
  const surpassAchieved = complete && summary.surpassThisRound && previousSurpass;

  return {
    round: args.round,
    generatedAt: null, // deliberately null: a timestamp would make reports non-reproducible
    blindDir: path.relative(process.cwd(), path.resolve(args.blind)),
    salt: mapping.salt ?? '',
    complete,
    expectedOutputs,
    scoredOutputs: records.length,
    incomplete,
    summary,
    perConfig,
    failureClusters,
    records,
    previousRound: args.prev ? {file: args.prev, round: previous?.round ?? null, surpassThisRound: previousSurpass} : null,
    // A parity claim from a partial round is not a claim. Keep the raw
    // computation in summary.parity, but only this flag may be quoted.
    parityClaimable: complete && summary.parity,
    surpass: {
      thisRound: summary.surpassThisRound,
      previousRound: previousSurpass,
      consecutiveRounds: surpassStreak,
      required: SURPASS_CONSECUTIVE_ROUNDS,
      achieved: surpassAchieved,
    },
  };
};

const toMarkdown = (report) => {
  const s = report.summary;
  const lines = [];
  const push = (...items) => lines.push(...items);

  push(`# A/B Benchmark Report — ${report.round}`, '');
  push(`- Round complete: **${report.complete ? 'yes' : 'NO'}** (${report.scoredOutputs}/${report.expectedOutputs} scored outputs)`);
  push(`- Blind set: \`${report.blindDir}\`${report.salt ? ` (salt \`${report.salt}\`)` : ''}`);
  push(`- Parity (visual-first-c vs auto-motion): **${report.complete ? (s.parity ? 'REACHED' : 'not reached') : `NOT VALID — round incomplete (raw computation: ${s.parity ? 'reached' : 'not reached'})`}**`);
  push(`- Surpass: **${report.surpass.achieved ? 'ACHIEVED' : 'not achieved'}** (${report.surpass.consecutiveRounds}/${report.surpass.required} consecutive qualifying rounds)`);
  push('');
  if (!report.complete) {
    push('> Incomplete round. Parity and surpass claims from a partial round are not valid —', '> finish the missing outputs and re-score before quoting any number below.', '');
  }

  push('## Round result', '');
  push('| metric | value |', '|---|---|');
  push(`| categories won / tied / lost (C vs auto-motion) | ${s.wins} / ${s.ties} / ${s.losses} |`);
  push(`| visual-first-c visual mean | ${fmt(s.cVisualMean)} |`);
  push(`| auto-motion visual mean | ${fmt(s.autoVisualMean)} |`);
  push(`| legacy-current visual mean | ${fmt(s.legacyVisualMean)} |`);
  push(`| blank-context visual mean | ${fmt(s.blankVisualMean)} |`);
  push(`| visual mean delta (C − auto) | ${fmt(s.visualMeanDelta)} |`);
  push(`| technical failures (visual-first-c) | ${s.technicalFailures}${s.technicalFailureCategories.length ? ` (${s.technicalFailureCategories.join(', ')})` : ''} |`);
  push(`| parity condition (win+tie ≥ ${s.thresholds.parityMinCategories} and all technical gates pass) | ${s.parity ? 'met' : 'not met'} |`);
  push(`| surpass condition this round (wins ≥ ${s.thresholds.surpassMinWins}, delta > ${s.thresholds.surpassMeanLead}, all gates pass) | ${s.surpassThisRound ? 'met' : 'not met'} |`);
  push('');

  push('## Per category (seeds averaged)', '');
  push('| category | C | auto-motion | diff | result | legacy | blank | C minutes | auto minutes | technical |', '|---|---:|---:|---:|---|---:|---:|---:|---:|---|');
  for (const c of s.categories) {
    push(`| ${c.category} | ${fmt(c.cScore)} | ${fmt(c.autoScore)} | ${c.diff > 0 ? '+' : ''}${c.diff} | ${c.result} | ${fmt(c.legacyScore)} | ${fmt(c.blankScore)} | ${fmt(c.cMinutes)} | ${fmt(c.autoMinutes)} | ${c.technicalPass ? 'pass' : `FAIL${c.technicalFailures.length ? `: ${c.technicalFailures.join('; ')}` : ''}`} |`);
  }
  push('');

  push('## Every output (all cases, both seeds, all four configs)', '');
  push('| case | seed | blind label | config | visual | technical | minutes | engines | failure tags |', '|---|---|---|---|---:|---|---:|---|---|');
  const order = (r) => `${r.caseId}|${r.seed}|${r.config}`;
  for (const r of [...report.records].sort((a, b) => (order(a) < order(b) ? -1 : 1))) {
    push(`| ${r.caseId} | ${r.seed} | ${r.label} | ${r.config} | ${fmt(r.visual)} | ${r.technicalPass ? 'pass' : 'FAIL'} | ${fmt(r.productionMinutes)} | ${r.engines.join(', ') || '—'} | ${r.failureTags.join(', ') || '—'} |`);
  }
  push('');

  push('## Per config', '');
  push('| config | outputs | visual mean | min | max | technical failures | mean minutes | total minutes | engines |', '|---|---:|---:|---:|---:|---:|---:|---:|---|');
  for (const c of report.perConfig) {
    push(`| ${c.config} | ${c.outputs} | ${fmt(c.visualMean)} | ${fmt(c.visualMin)} | ${fmt(c.visualMax)} | ${c.technicalFailures} | ${fmt(c.productionMinutesMean)} | ${fmt(c.productionMinutesTotal)} | ${c.engines.join(', ') || '—'} |`);
  }
  push('');

  push('## Failure clusters', '');
  if (report.failureClusters.length === 0) {
    push('No failure tags recorded.', '');
  } else {
    push('| tag | count | configs | cases |', '|---|---:|---|---|');
    for (const f of report.failureClusters) {
      push(`| ${f.tag} | ${f.count} | ${f.configs.join(', ')} | ${f.cases.join(', ')} |`);
    }
    push('', 'Next round: fix **one** subsystem — pick the top cluster, change that subsystem only,', 're-run the affected cases, then re-run all six categories to confirm no regression.', '');
  }

  if (report.incomplete.length > 0) {
    push('## Missing or unscored', '');
    for (const item of report.incomplete) push(`- ${item}`);
    push('');
  }

  push('## Formulas', '');
  push(`- Win: visual score difference ≥ ${s.thresholds.winMargin}. Tie: absolute difference ≤ ${s.thresholds.tieMargin}. Otherwise a loss.`);
  push(`- Parity: visual-first-c wins or ties ≥ ${s.thresholds.parityMinCategories} of ${s.categoryCount} categories **and** every technical gate passes.`);
  push(`- Surpass: wins ≥ ${s.thresholds.surpassMinWins} categories **and** visual mean lead > ${s.thresholds.surpassMeanLead} **and** all technical gates pass, for ${s.thresholds.surpassConsecutiveRounds} consecutive complete rounds.`);
  push('');
  return `${lines.join('\n')}\n`;
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  for (const required of ['round', 'blind', 'out-md', 'out-json']) {
    if (!args[required]) {
      console.error(`missing --${required}\n${usage}`);
      process.exit(2);
    }
  }

  const collected = collect(args);
  const report = buildReport(args, collected);

  for (const target of [args['out-md'], args['out-json']]) {
    fs.mkdirSync(path.dirname(path.resolve(target)), {recursive: true});
  }
  fs.writeFileSync(path.resolve(args['out-md']), toMarkdown(report));
  fs.writeFileSync(path.resolve(args['out-json']), `${JSON.stringify(report, null, 2)}\n`);

  const s = report.summary;
  console.log(`round ${report.round}: ${report.scoredOutputs}/${report.expectedOutputs} outputs scored`);
  console.log(`win/tie/loss ${s.wins}/${s.ties}/${s.losses}  C ${s.cVisualMean} vs auto-motion ${s.autoVisualMean} (delta ${s.visualMeanDelta})`);
  console.log(`technical failures: ${s.technicalFailures}  parity: ${report.complete ? s.parity : 'not valid (round incomplete)'}  surpass: ${report.surpass.achieved} (${report.surpass.consecutiveRounds}/${report.surpass.required} rounds)`);
  console.log(`wrote ${args['out-md']} and ${args['out-json']}`);
  if (!report.complete) {
    console.error('round INCOMPLETE — the numbers above are not a valid parity/surpass claim');
    process.exit(1);
  }
};

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
