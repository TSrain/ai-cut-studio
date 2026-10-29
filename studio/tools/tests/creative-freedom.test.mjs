import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {productionGate, GATE_ACTIONS} from '../lib/production-clock.mjs';

const run = (command, args) => spawnSync(command, args, {encoding: 'utf8'});
test('production time is advisory even beyond sixty minutes', () => {
  assert.equal(productionGate(60 * 60_000), 'budget-advisory');
  assert.equal(productionGate(180 * 60_000), 'budget-advisory');
  assert.equal(productionGate(45 * 60_000), 'progress-advisory');
  assert.doesNotMatch(Object.values(GATE_ACTIONS).join(' '), /采用最高匹配|冻结功能|禁止新增|不再改|生产失败|降级/);
});

test('sparse and empty entry/exit frames do not fail ink gates; invalid media still fails', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creative-density-'));
  try {
    const video = join(dir, 'fade.mp4');
    const frame = join(dir, 'end.png');
    for (const [output, args] of [[video, ['-t', '0.5', '-c:v', 'libx264']], [frame, ['-frames:v', '1']]]) {
      const made = run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=270x480:r=30', ...args, output]);
      assert.equal(made.status, 0, made.stderr);
    }
    const density = run('bash', ['tools/check-density.sh', video]);
    assert.equal(density.status, 0, density.stdout + density.stderr);
    assert.doesNotMatch(density.stdout, /下限|硬切在场/);
    const audit = run('node', ['tools/frame-audit.mjs', frame, '--strict']);
    assert.equal(audit.status, 0, audit.stdout + audit.stderr);
    const outputArgs = ['tools/validate-output.sh', video, '--size', '270x480', '--fps', '30', '--duration', '0.5', '--dur-tol', '0.1', '--codec', 'h264', '--pix-fmt', 'yuv420p'];
    assert.equal(run('bash', outputArgs).status, 0);
    assert.equal(run('bash', [...outputArgs, '--size', '480x270']).status, 1);
    assert.equal(run('bash', [...outputArgs, '--duration', '2']).status, 1);
    const invalid = join(dir, 'invalid.mp4');
    await writeFile(invalid, 'not media');
    assert.notEqual(run('bash', ['tools/check-density.sh', invalid]).status, 0);
    assert.notEqual(run('node', ['tools/frame-audit.mjs', invalid]).status, 0);
  } finally { await rm(dir, {recursive: true, force: true}); }
});

test('flat vector source needs no materials or springs; typography and determinism remain gated', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creative-lint-'));
  try {
    const source = join(dir, 'shot.tsx');
    const base = "const t = createTypography('impact'); const c = scenePalette(); const style = textStyle(t, 'body');";
    await writeFile(source, base);
    const clean = run('node', ['tools/lint-shot.mjs', source]);
    assert.equal(clean.status, 0, clean.stdout + clean.stderr);
    assert.doesNotMatch(clean.stdout, /名额没用掉|未使用.*材质|全片零弹簧/);
    const contract = join(dir, 'contract.json');
    await writeFile(contract, JSON.stringify({
      version: 1, project: 'flat-vector', mode: 'visual-first',
      canvas: {width: 1080, height: 1920, fps: 30, durationSeconds: 8},
      density: {target: 8, occupancyMin: 0.6, occupancyMax: 0.85, layerCount: 6},
      focus: {primary: 'title', secondary: []},
      palette: {mode: 'dark', dominant: '#15181f', support: [], accent: [], surfaces: []},
      typography: {kit: 'impact', displayRole: 'display', bodyRole: 'body', dataRole: 'data'},
      material: [], background: [], motion: {character: 'decisive', springAccents: 3},
      transition: {language: 'shared-axis'}, assets: {cacheSelectedLocally: true, allowBrandLogos: true, allowScreenshots: true, allowUnknownNetworkImages: true}, facts: {mode: 'illustrative'},
      shots: [{id: 'flat', durationSeconds: 8, engine: 'remotion', objective: 'title', startAnchor: 'empty', endAnchor: 'title'}],
    }));
    const withContract = run('node', ['tools/lint-shot.mjs', source, '--contract', contract]);
    assert.equal(withContract.status, 0, withContract.stdout + withContract.stderr);

    await writeFile(source, base + '\nconst random = Math.random();');
    assert.equal(run('node', ['tools/lint-shot.mjs', source]).status, 1);
    await writeFile(source, "const c = scenePalette(); const style = {fontFamily: 'system-ui'};");
    assert.equal(run('node', ['tools/lint-shot.mjs', source]).status, 1);
  } finally { await rm(dir, {recursive: true, force: true}); }
});
