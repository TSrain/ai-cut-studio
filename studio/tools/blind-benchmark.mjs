#!/usr/bin/env node
// tools/blind-benchmark.mjs
//
// Stage one full benchmark round for blind review.
//
// Reads the four configs' outputs for every case x seed, relabels them A/B/C/D
// with a deterministic per-case/per-seed mapping, and writes them into a review
// directory that contains no trace of which config produced what. The mapping is
// written to a dot-prefixed file so it does not show up in a plain `ls` or in a
// Finder window while scoring.
//
// Determinism: labels come from blindOrder(seedString) only. There is no
// Math.random() in this file. Re-running the command reproduces the identical
// review directory, so a score sheet can always be re-deblinded later.
//
// Expected input layout (48 files for a full round):
//   <runs>/<config>/<seed>/<case-id>.mp4
// e.g. benchmarks/runs/round-01/visual-first-c/seed-01/01-brand-launch.mp4
// An optional sidecar <case-id>.json next to each video carries production
// minutes, engine routes and technical-gate results; it is copied through under
// the blind label so summarize-benchmark can read it without deblinding first.
//
// Output layout:
//   <out>/<case-id>/<seed>/A.mp4 B.mp4 C.mp4 D.mp4   (+ A.json ... if present)
//   <out>/review/<case-id>--<seed>.json              (empty score sheet)
//   <out>/.mapping.json                              (hidden; do not open while scoring)
//
// Usage:
//   node tools/blind-benchmark.mjs --round round-01 \
//     --runs benchmarks/runs/round-01 \
//     --out  benchmarks/runs/round-01/blind \
//     [--mode copy|symlink] [--salt <string>] [--ext mp4] [--force]

import fs from 'node:fs';
import path from 'node:path';
import {CASES, CONFIGS, SEEDS, blindOrder} from './lib/benchmark.mjs';

const parseArgs = (argv) => {
  const args = {mode: 'copy', ext: 'mp4', salt: '', force: false};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2);
    if (key === 'force') {
      args.force = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`--${key} needs a value`);
    args[key] = value;
    i += 1;
  }
  return args;
};

const usage = `usage: node tools/blind-benchmark.mjs --round <id> --runs <dir> --out <dir> [--mode copy|symlink] [--salt <string>] [--ext mp4] [--force]`;

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  for (const required of ['round', 'runs', 'out']) {
    if (!args[required]) {
      console.error(`missing --${required}\n${usage}`);
      process.exit(2);
    }
  }
  if (!['copy', 'symlink'].includes(args.mode)) {
    console.error(`--mode must be copy or symlink\n${usage}`);
    process.exit(2);
  }

  const runsDir = path.resolve(args.runs);
  const outDir = path.resolve(args.out);

  if (fs.existsSync(outDir) && !args.force) {
    const existing = fs.readdirSync(outDir);
    if (existing.length > 0) {
      console.error(`refusing to write into non-empty ${outDir} without --force`);
      console.error('a half-overwritten blind directory silently mixes two rounds of files.');
      process.exit(2);
    }
  }

  const mapping = {
    round: args.round,
    salt: args.salt,
    configs: CONFIGS,
    seeds: SEEDS,
    generatedFrom: path.relative(process.cwd(), runsDir),
    cases: {},
  };

  const missing = [];
  let staged = 0;

  for (const testCase of CASES) {
    mapping.cases[testCase.id] = {};
    for (const seed of SEEDS) {
      const seedString = [args.round, testCase.id, seed, args.salt].filter(Boolean).join('|');
      const labels = blindOrder(CONFIGS, seedString);
      mapping.cases[testCase.id][seed] = {seedString, labels};

      const destDir = path.join(outDir, testCase.id, seed);
      fs.mkdirSync(destDir, {recursive: true});

      for (const [label, config] of Object.entries(labels)) {
        const source = path.join(runsDir, config, seed, `${testCase.id}.${args.ext}`);
        const dest = path.join(destDir, `${label}.${args.ext}`);
        if (!fs.existsSync(source)) {
          missing.push(path.relative(process.cwd(), source));
          continue;
        }
        fs.rmSync(dest, {force: true});
        if (args.mode === 'symlink') fs.symlinkSync(path.resolve(source), dest);
        else fs.copyFileSync(source, dest);
        staged += 1;

        const sidecar = path.join(runsDir, config, seed, `${testCase.id}.json`);
        if (fs.existsSync(sidecar)) {
          fs.copyFileSync(sidecar, path.join(destDir, `${label}.json`));
        }
      }

      const sheetDir = path.join(outDir, 'review');
      fs.mkdirSync(sheetDir, {recursive: true});
      const sheetPath = path.join(sheetDir, `${testCase.id}--${seed}.json`);
      if (!fs.existsSync(sheetPath)) {
        const sheet = {
          case: testCase.id,
          category: testCase.category,
          seed,
          canvas: testCase.canvas,
          durationSeconds: testCase.durationSeconds,
          note: 'Score every label. Do not skip a label because it looks weak — omitted rows are cherry-picking.',
          scores: Object.fromEntries(Object.keys(labels).map((label) => ([label, {
            visual: null,
            dimensions: {
              composition: null, typography: null, density: null,
              motion: null, material: null, clarity: null, continuity: null,
            },
            technicalPass: null,
            productionMinutes: null,
            engines: [],
            failureTags: [],
            notes: '',
          }]))),
        };
        fs.writeFileSync(sheetPath, `${JSON.stringify(sheet, null, 2)}\n`);
      }
    }
  }

  const mappingPath = path.join(outDir, '.mapping.json');
  fs.writeFileSync(mappingPath, `${JSON.stringify(mapping, null, 2)}\n`);
  fs.writeFileSync(
    path.join(outDir, 'READ-ME-BEFORE-SCORING.txt'),
    [
      `Blind review set for ${args.round}.`,
      '',
      'Each folder holds four videos named A/B/C/D for one case and one seed.',
      'The A/B/C/D order is different in every folder, so a label carries no',
      'information across folders. Score all four every time.',
      '',
      'The source mapping lives in the hidden file .mapping.json. Opening it',
      'before scoring destroys the round — there is no way to un-see it and the',
      'entire round would have to be re-produced, not just re-scored.',
      '',
      'Fill in review/<case>--<seed>.json, then run:',
      `  node tools/summarize-benchmark.mjs --round ${args.round} --blind <this dir> --out-md benchmarks/reports/${args.round}.md --out-json benchmarks/reports/${args.round}.json`,
      '',
    ].join('\n'),
  );

  const expected = CASES.length * SEEDS.length * CONFIGS.length;
  console.log(`round:   ${args.round}`);
  console.log(`mode:    ${args.mode}`);
  console.log(`staged:  ${staged}/${expected} outputs into ${path.relative(process.cwd(), outDir)}`);
  console.log(`mapping: ${path.relative(process.cwd(), mappingPath)} (hidden — do not open while scoring)`);
  if (missing.length > 0) {
    console.error(`\nmissing ${missing.length} output(s):`);
    for (const item of missing) console.error(`  ${item}`);
    console.error('\nA round is only complete at 6 cases x 2 seeds x 4 configs = 48 outputs.');
    console.error('Reporting a partial round as a result is cherry-picking; produce the missing outputs first.');
    process.exit(1);
  }
};

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
