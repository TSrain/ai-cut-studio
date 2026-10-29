import test from 'node:test';
import assert from 'node:assert/strict';
import {validateVisualContract, validatePresetArtifacts} from '../lib/visual-contract.mjs';
import {mkdtemp, mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';

const valid = {
  version: 1,
  project: 'contract-smoke',
  mode: 'visual-first',
  canvas: {width: 1080, height: 1920, fps: 30, durationSeconds: 8},
  density: {target: 8, occupancyMin: 0.6, occupancyMax: 0.85, layerCount: 3},
  focus: {primary: 'hero title', secondary: ['product frame']},
  palette: {
    mode: 'dark',
    dominant: '#15181f',
    support: ['#273044'],
    accent: ['#63f3c6'],
    surfaces: ['#1c2230', '#252e40'],
  },
  typography: {kit: 'impact', displayRole: 'display', bodyRole: 'body', dataRole: 'data'},
  material: ['glass', 'grain'],
  background: ['grid', 'ambient-glow'],
  motion: {character: 'decisive', springAccents: 2, ambientMotion: true},
  transition: {language: 'shared-axis'},
  assets: {
    allowBrandLogos: true,
    allowScreenshots: true,
    allowUnknownNetworkImages: true,
    cacheSelectedLocally: true,
  },
  facts: {mode: 'illustrative'},
  shots: [{
    id: 'shot-001',
    durationSeconds: 8,
    engine: 'hybrid',
    objective: 'Reveal product automation',
    startAnchor: 'accent line enters from lower-left',
    endAnchor: 'product frame holds at center',
  }],
};

test('accepts a complete visual-first contract', () => {
  assert.deepEqual(validateVisualContract(valid), {ok: true, errors: []});
});

test('rejects implicit typography and missing continuity anchors', () => {
  const broken = structuredClone(valid);
  delete broken.typography.kit;
  delete broken.shots[0].endAnchor;
  const result = validateVisualContract(broken);
  assert.equal(result.ok, false);
  assert(result.errors.includes('typography.kit is required'));
  assert(result.errors.includes('shots[0].endAnchor is required'));
});

test('rejects odd canvas dimensions and unsupported engines', () => {
  const broken = structuredClone(valid);
  broken.canvas.width = 1079;
  broken.shots[0].engine = 'css';
  const result = validateVisualContract(broken);
  assert(result.errors.includes('canvas.width and canvas.height must be even integers'));
  assert(result.errors.includes('shots[0].engine must be remotion, hyperframes, or hybrid'));
});

test('limits secondary focus anchors to two', () => {
  const broken = structuredClone(valid);
  broken.focus.secondary = ['a', 'b', 'c'];
  const result = validateVisualContract(broken);
  assert(result.errors.includes('focus.secondary must contain at most 2 items'));
});

// ── preset 匹配记录(B-roll 门:--require-preset-matching)────────────────────

const brollShot = {
  id: 'shot-001',
  durationSeconds: 3,
  engine: 'remotion',
  objective: 'preset expanded',
  startAnchor: 'a',
  endAnchor: 'b',
  presetCandidates: ['recede', 'key-concept'],
  selectedPreset: 'recede',
  matchReason: '整屏一句话退让,槽位正好只要 line + hero',
  preset: {id: 'recede', version: 2},
  presetProps: {durationSeconds: 3, slots: {line: '知识是最慢的生产资料'}},
};

const broll = (shot) => {
  const contract = structuredClone(valid);
  contract.shots = [shot];
  return contract;
};

test('preset matching record is optional by default and enforced for b-roll', () => {
  const legacy = broll({
    id: 'shot-001', durationSeconds: 3, engine: 'remotion',
    objective: 'o', startAnchor: 'a', endAnchor: 'b',
  });
  assert.equal(validateVisualContract(legacy).ok, true);

  const strict = validateVisualContract(legacy, {requirePresetMatching: true});
  assert.equal(strict.ok, false);
  assert(strict.errors.some((e) => e.includes('shots[0].presetCandidates is required')));
  assert(strict.errors.some((e) => e.includes('shots[0].selectedPreset is required')));
});

test('accepts a matched preset shot under the b-roll gate', () => {
  const result = validateVisualContract(broll(structuredClone(brollShot)), {requirePresetMatching: true});
  assert.deepEqual(result, {ok: true, errors: []});
});

test('unmatched shots must say what did not fit, and must not carry a preset', () => {
  const unmatched = structuredClone(brollShot);
  unmatched.selectedPreset = null;
  delete unmatched.matchReason;
  unmatched.unmatchedReason = '需要一张真实录屏 + 三处圈注,没有 preset 有这个槽';
  assert.equal(validateVisualContract(broll(structuredClone(unmatched)), {requirePresetMatching: true}).ok, false);

  delete unmatched.preset;
  delete unmatched.presetProps;
  assert.equal(validateVisualContract(broll(unmatched), {requirePresetMatching: true}).ok, true);

  const silent = structuredClone(unmatched);
  delete silent.unmatchedReason;
  const result = validateVisualContract(broll(silent), {requirePresetMatching: true});
  assert(result.errors.some((e) => e.includes('shots[0].unmatchedReason is required')));
});

test('selectedPreset must be one of the candidates and must match the mounted preset', () => {
  const drifted = structuredClone(brollShot);
  drifted.selectedPreset = 'quote-card';
  const result = validateVisualContract(broll(drifted), {requirePresetMatching: true});
  assert(result.errors.some((e) => e.includes('must appear in presetCandidates')));
  assert(result.errors.some((e) => e.includes('must match shots[0].preset.id')));
});

test('tie candidates need real props and must be resolved before rendering', () => {
  const tie = structuredClone(brollShot);
  tie.presetAlternatives = [{id: 'key-concept', version: 1, presetProps: {slots: {term: '退让'}}}];
  assert.equal(validateVisualContract(broll(structuredClone(tie)), {requirePresetMatching: true}).ok, true);

  const resolved = validateVisualContract(broll(structuredClone(tie)), {
    requirePresetMatching: true,
    requirePresetResolved: true,
  });
  assert.equal(resolved.ok, false);
  assert(resolved.errors.some((e) => e.includes('presetAlternatives must be empty after the confirmation gate')));

  const hollow = structuredClone(tie);
  delete hollow.presetAlternatives[0].presetProps;
  const result = validateVisualContract(broll(hollow), {requirePresetMatching: true});
  assert(result.errors.some((e) => e.includes('presetAlternatives[0].presetProps must be an object')));
});

test('leaving remotion requires a written reason under the b-roll gate', () => {
  const shot = structuredClone(brollShot);
  shot.engine = 'hyperframes';
  const result = validateVisualContract(broll(structuredClone(shot)), {requirePresetMatching: true});
  assert(result.errors.some((e) => e.includes('shots[0].engineReason is required for engine「hyperframes」')));

  shot.engineReason = '整镜是 shader 液态玻璃,换 Remotion 等于换个镜头';
  assert.equal(validateVisualContract(broll(shot), {requirePresetMatching: true}).ok, true);
});


test('preset artifact gate requires expand-presets outputs for selected preset shots', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'preset-artifacts-'));
  const contract = broll(structuredClone(brollShot));
  let result = await validatePresetArtifacts(contract, dir);
  assert.equal(result.ok, false);
  assert(result.errors.some((e) => e.includes('shots/shot-001/props.json')));

  const shotDir = join(dir, 'shots', 'shot-001');
  await mkdir(shotDir, {recursive: true});
  await writeFile(join(shotDir, 'props.json'), '{}');
  await writeFile(join(shotDir, 'route.json'), '{}');
  await writeFile(join(shotDir, 'signals.json'), '{}');
  result = await validatePresetArtifacts(contract, dir);
  assert.deepEqual(result, {ok: true, errors: []});
});

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('preset artifact gate rejects hand-drawn keyframe without a preview execution receipt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'preset-artifacts-forged-'));
  const contract = broll(structuredClone(brollShot));
  const shotDir = join(dir, 'shots', 'shot-001');
  const previewDir = join(dir, 'preview', 'stills');
  await mkdir(shotDir, {recursive: true});
  await mkdir(previewDir, {recursive: true});
  await writeFile(join(shotDir, 'props.json'), '{"presetId":"recede","presetVersion":2,"compositionId":"PresetRecede"}\n');
  await writeFile(join(shotDir, 'route.json'), '{"engine":"remotion"}\n');
  await writeFile(join(shotDir, 'signals.json'), '{"framePrecision":2}\n');
  await writeFile(join(previewDir, 'shot-001.png'), 'hand drawn png');

  const result = await validatePresetArtifacts(contract, dir, {requirePreviewReceipt: true});

  assert.equal(result.ok, false);
  assert(result.errors.some((e) => e.includes('preview/preview-manifest.json')));
});

test('preset artifact gate verifies preview still binding to props route signals and render command', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'preset-artifacts-bound-'));
  const contract = broll(structuredClone(brollShot));
  const shotDir = join(dir, 'shots', 'shot-001');
  const previewDir = join(dir, 'preview', 'stills');
  await mkdir(shotDir, {recursive: true});
  await mkdir(previewDir, {recursive: true});

  const propsPath = join(shotDir, 'props.json');
  const routePath = join(shotDir, 'route.json');
  const signalsPath = join(shotDir, 'signals.json');
  const stillPath = join(previewDir, 'shot-001.png');
  const props = '{"presetId":"recede","presetVersion":2,"compositionId":"PresetRecede","slots":{"line":"知识是最慢的生产资料"}}\n';
  const route = '{"engine":"remotion"}\n';
  const signals = '{"framePrecision":2}\n';
  const still = 'real remotion still bytes';
  await writeFile(propsPath, props);
  await writeFile(routePath, route);
  await writeFile(signalsPath, signals);
  await writeFile(stillPath, still);
  await mkdir(join(dir, 'preview'), {recursive: true});
  await writeFile(join(dir, 'preview', 'preview-manifest.json'), JSON.stringify({
    version: 2,
    project: contract.project,
    generatedAt: '2026-09-10T00:00:00.000Z',
    time: 0.4,
    scale: 0.4,
    sheet: join(dir, 'preview', 'contact-sheet.png'),
    status: 'pending',
    tiles: [{
      tag: 1,
      shot: 'shot-001',
      kind: 'selected',
      preset: 'recede',
      version: 2,
      compositionId: 'PresetRecede',
      frame: 36,
      props: propsPath,
      route: routePath,
      signals: signalsPath,
      still: stillPath,
      propsSha256: sha256(props),
      routeSha256: sha256(route),
      signalsSha256: sha256(signals),
      stillSha256: sha256(still),
      render: {
        status: 'passed',
        exitCode: 0,
        cwd: join(dir, 'build'),
        command: ['npx', 'remotion', 'still', 'PresetRecede', `--props=${propsPath}`, '--frame=36', '--scale=0.4', stillPath],
        expectedOutput: stillPath,
        outputBytes: still.length,
      },
    }],
  }, null, 2));

  let result = await validatePresetArtifacts(contract, dir, {requirePreviewReceipt: true});
  assert.deepEqual(result, {ok: true, errors: []});

  await writeFile(stillPath, 'replacement hand drawn bytes');
  result = await validatePresetArtifacts(contract, dir, {requirePreviewReceipt: true});
  assert.equal(result.ok, false);
  assert(result.errors.some((e) => e.includes('still sha256 mismatch')));
});


test('custom-only contracts do not require a preset preview receipt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'custom-no-preview-'));
  const result = await validatePresetArtifacts({shots: [{id: 'shot-001', selectedPreset: null}]}, dir, {requirePreviewReceipt: true});
  assert.deepEqual(result, {ok: true, errors: []});
});

// designIntent v1 carries authored semantics; real timing is separate.
const designed = () => {
  const value = structuredClone(valid);
  value.designIntentVersion = 1;
  Object.assign(value.shots[0], {
    presetCandidates: ['pill-stack'], selectedPreset: null, unmatchedReason: 'feedback loop',
    designIntent: {
      goal: 'Explain revision', concept: 'One persistent card',
      states: {start: 'Card enters', change: 'Feedback returns', end: 'Card exits'},
      beats: [{id: 'trial', anchor: '先试跑', action: 'Card moves'}],
      focus: 'Card', presenterRelation: 'Presenter stays visible',
      templateOptions: [{presetId: 'pill-stack', fit: 'Labels', gaps: ['No loop']}],
      customOption: {approach: 'Animate loop', benefit: 'Shows revision', cost: 'More choreography'},
      recommendation: {route: 'component-custom', reason: 'Needs feedback'},
      acceptance: ['Keep identity'], risks: [],
    },
  });
  return value;
};
test('accepts v1 design without inventing downstream speech or timing fields', () => {
  const value = designed();
  const before = structuredClone(value);
  assert.equal(validateVisualContract(value).ok, true);
  assert.deepEqual(value, before);
});
test('rejects malformed declared designIntent v1', () => {
  const mutations = [
    v => { v.designIntentVersion = '1'; },
    v => { delete v.shots[0].designIntent; },
    v => { delete v.shots[0].designIntent.states.change; },
    v => { v.shots[0].designIntent.beats[0].anchor = ''; },
    v => { v.shots[0].designIntent.beats.push({...v.shots[0].designIntent.beats[0]}); },
    v => { v.shots[0].presetCandidates = []; },
    v => { v.shots[0].selectedPreset = 'pill-stack'; },
    v => { v.shots[0].designIntent.recommendation.route = 'preset'; },
    v => { v.shots[0].designIntent.acceptance = []; },
    v => { delete v.designIntentVersion; },
  ];
  for (const mutate of mutations) {
    const value = designed(); mutate(value);
    assert.equal(validateVisualContract(value).ok, false, JSON.stringify(value.shots[0].designIntent));
  }
});

// Route consistency is enforced by the default API, without the B-roll flag.
for (const route of ['custom', 'component-custom']) {
  test(`default design validation rejects an actual preset mounted on ${route}`, () => {
    const value = designed();
    value.shots[0].designIntent.recommendation.route = route;
    value.shots[0].preset = {id: 'pill-stack', version: 1};
    const result = validateVisualContract(value);
    assert.equal(result.ok, false);
    assert(result.errors.some(error => error.includes('selectedPreset is null but shots[0].preset is set')));
  });
}

const presetDesigned = () => {
  const value = designed();
  const shot = value.shots[0];
  shot.engine = 'remotion';
  shot.designIntent.recommendation = {route: 'preset', reason: 'Native motion achieves the designed result'};
  shot.designIntent.templateOptions[0].gaps = [];
  shot.selectedPreset = 'pill-stack';
  shot.preset = {id: 'pill-stack', version: 1};
  shot.presetProps = {durationSeconds: 8, slots: {}};
  shot.matchReason = 'Native object structure and movement match the design';
  delete shot.unmatchedReason;
  return value;
};

for (const actualPreset of [undefined, {id: 'recede', version: 2}]) {
  test(`default design validation rejects preset route with ${actualPreset ? 'a different' : 'no'} mounted preset`, () => {
    const value = presetDesigned();
    if (actualPreset) value.shots[0].preset = actualPreset;
    else delete value.shots[0].preset;
    const result = validateVisualContract(value);
    assert.equal(result.ok, false);
    assert(result.errors.some(error => error.includes('must match shots[0].preset.id')));
  });
}

test('a gap-free template candidate does not override the selected custom route', () => {
  const value = designed();
  value.shots[0].designIntent.templateOptions[0].gaps = [];
  value.shots[0].designIntent.recommendation = {route: 'custom', reason: 'User selected this visual direction'};
  value.shots[0].unmatchedReason = 'User selected the custom direction after comparing both options';
  const before = structuredClone(value);
  assert.deepEqual(validateVisualContract(value), {ok: true, errors: []});
  assert.deepEqual(value, before);
});

test('default design validation accepts the correctly mounted selected preset', () => {
  assert.deepEqual(validateVisualContract(presetDesigned()), {ok: true, errors: []});
});

test('legacy contracts do not acquire a new design-route requirement', () => {
  const value = structuredClone(valid);
  assert.deepEqual(validateVisualContract(value), {ok: true, errors: []});
  assert.equal(value.designIntentVersion, undefined);
  assert.equal(value.shots[0].selectedPreset, undefined);
});

test('an unselected template requires an effect or selection reason, not an invented slot failure', () => {
  const value = designed();
  value.shots[0].designIntent.templateOptions[0].gaps = [];
  delete value.shots[0].unmatchedReason;
  const result = validateVisualContract(value);
  assert.equal(result.ok, false);
  const error = result.errors.find(item => item.includes('unmatchedReason is required'));
  assert.match(error, /未选择.*效果理由/);
  assert.doesNotMatch(error, /装不下槽位|未命中/);
});

// Source geometry belongs to the source asset, not the output canvas.
test('JSON schema accepts optional source metadata and still rejects unknown root fields', async () => {
  const {createRequire} = await import('node:module');
  const {readFile} = await import('node:fs/promises');
  const require = createRequire(new URL('../../templates/remotion-base/package.json', import.meta.url));
  const Ajv = require('ajv/dist/2020').default;
  const schema = JSON.parse(await readFile(new URL('../../docs/visual-contract.schema.json', import.meta.url), 'utf8'));
  const check = new Ajv({strict: false, allErrors: true}).compile(schema);
  const contract = structuredClone(valid);
  assert.equal(check(contract), true, JSON.stringify(check.errors));
  contract.sourceVideo = '/media/talking-head.mov';
  contract.sourceCanvas = {width: 3840, height: 2160, displayWidth: 3840, displayHeight: 2160, sampleAspectRatio: '1:1', rotation: 0};
  assert.equal(check(contract), true, JSON.stringify(check.errors));
  contract.unrecognizedRootField = true;
  assert.equal(check(contract), false);
  assert(check.errors.some((e) => e.keyword === 'additionalProperties'));
});
