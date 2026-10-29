#!/usr/bin/env node
// tools/preset-preview.mjs —— preset 镜的「真实文案预览」+ 批次接触印张 + 确认闸门
//
// 为什么存在:verified preset 的版式/时序/动效在 verify 那次已经被看过了,每次使用真正
// 会变的只有**这次的文案和素材**。所以确认点从"三张 Styleframe 选方向"降为"一张带真实
// 文案的预览过目"——而且整批只过目一次。
//
// 用法:
//   node tools/preset-preview.mjs <project-dir> [--time 0.4] [--scale 0.4]
//                                 [--tile-width 260] [--jobs 2] [--shots shot-001,shot-003]
//     渲每个 preset 镜(含并列候选)在 0.4 时刻的一帧 → 拼成 preview/contact-sheet.png
//     + contact-sheet.md(编号↔镜号↔真实文案)+ preview-manifest.json(status: pending)
//   node tools/preset-preview.mjs <project-dir> --confirm "<用户原话/结论>"
//     用户过目之后盖章(status: confirmed)。**只有盖过章才允许渲完整视频**:
//     `node tools/render-queue.mjs <queue> --require-confirmed <project>/preview/preview-manifest.json`
//   node tools/preset-preview.mjs <project-dir> --check-confirmed
//     只查状态,没盖章 exit 1。
//
// 重渲预览(改了文案)会把 status 打回 pending —— 用户看过的不是这一版了。
//
// 退出码: 0 = 成功; 1 = 有镜渲失败 / 未确认; 2 = 参数或合同问题

import {mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join, resolve, dirname, isAbsolute} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {readVisualContract} from './lib/visual-contract.mjs';
import {loadPreset} from './lib/preset.mjs';
import {buildContactSheet} from './lib/contact-sheet.mjs';
import {runQueue} from './render-queue.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 预览帧位置:时长的 0.4 处。为什么不是首帧——入场动画还没落位,首帧看不出成品长相 */
export const previewFrame = (durationSeconds, fps, time = 0.4) => {
  const total = Math.max(1, Math.round(durationSeconds * fps));
  return Math.min(total - 1, Math.max(0, Math.round(time * durationSeconds * fps)));
};

const parseArgs = (argv) => {
  const opts = {time: 0.4, scale: 0.4, tileWidth: 260, jobs: 2, shots: null, confirm: null, checkOnly: false};
  let projectDir = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`${arg} 缺少取值`);
      return argv[i];
    };
    if (arg === '--time') opts.time = Number(next());
    else if (arg === '--scale') opts.scale = Number(next());
    else if (arg === '--tile-width') opts.tileWidth = Number(next());
    else if (arg === '--jobs') opts.jobs = Number(next());
    else if (arg === '--shots') opts.shots = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--confirm') opts.confirm = next();
    else if (arg === '--check-confirmed') opts.checkOnly = true;
    else if (arg.startsWith('--')) throw new Error(`未知参数 ${arg}`);
    else if (projectDir === null) projectDir = arg;
    else throw new Error(`多余参数 ${arg}`);
  }
  if (!projectDir) throw new Error('用法: node tools/preset-preview.mjs <project-dir> [--time 0.4] [--scale 0.4] [--confirm "…"]');
  if (!(opts.time > 0 && opts.time < 1)) throw new Error('--time 必须在 0 和 1 之间(帧位置 = 时长 × time)');
  if (!(opts.scale > 0 && opts.scale <= 1)) throw new Error('--scale 必须在 (0, 1]');
  return {projectDir, opts};
};

const manifestPathFor = (projectDir) => join(projectDir, 'preview', 'preview-manifest.json');

const readManifest = async (projectDir) => {
  const path = manifestPathFor(projectDir);
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new Error(`读不到预览清单 ${path} —— 先跑 node tools/preset-preview.mjs ${projectDir}`);
  }
};

const abs = (projectDir, p) => (isAbsolute(p) ? p : resolve(projectDir, p));

const sha256File = async (path) => createHash('sha256').update(await readFile(path)).digest('hex');

const slotLines = (props) => {
  const lines = [];
  for (const [key, value] of Object.entries(props.slots ?? {})) {
    lines.push(`  - \`${key}\`:${String(value).replace(/\n/g, ' ⏎ ')}`);
  }
  for (const [key, value] of Object.entries(props.variant ?? {})) {
    lines.push(`  - 档位 \`${key}\`:${JSON.stringify(value)}`);
  }
  return lines;
};

export const buildJobs = async (projectDir, contract, opts) => {
  const jobs = [];
  const fps = contract.canvas.fps;
  for (const shot of contract.shots) {
    if (!shot.preset) continue;
    if (opts.shots && !opts.shots.includes(shot.id)) continue;
    const candidates = [
      {kind: 'selected', id: shot.preset.id, version: shot.preset.version, props: join(projectDir, 'shots', shot.id, 'props.json')},
      ...(shot.presetAlternatives ?? []).map((alt) => ({
        kind: 'alternative',
        id: alt.id,
        version: alt.version,
        props: join(projectDir, 'shots', shot.id, `alt-${alt.id}.props.json`),
      })),
    ];
    for (const candidate of candidates) {
      if (!existsSync(candidate.props)) {
        throw new Error(
          `${shot.id} 缺 ${candidate.props} —— 先跑 node tools/expand-presets.mjs ${projectDir}(槽位校验也在那一步)`,
        );
      }
      const props = JSON.parse(await readFile(candidate.props, 'utf8'));
      const def = await loadPreset(ROOT, candidate.id);
      if (props.presetId !== candidate.id || props.presetVersion !== candidate.version ||
          def.version !== candidate.version || props.compositionId !== def.compositionId) {
        throw new Error(`${shot.id}: preset identity mismatch; rerun expand-presets for the selected preset`);
      }
      const durationSeconds = props.durationSeconds ?? shot.durationSeconds;
      const suffix = candidate.kind === 'alternative' ? `-alt-${candidate.id}` : '';
      jobs.push({
        shot: shot.id,
        kind: candidate.kind,
        preset: candidate.id,
        version: candidate.version,
        presetStatus: def.status,
        compositionId: props.compositionId,
        durationSeconds,
        frame: previewFrame(durationSeconds, fps, opts.time),
        propsPath: candidate.props,
        routePath: join(projectDir, 'shots', shot.id, 'route.json'),
        signalsPath: join(projectDir, 'shots', shot.id, 'signals.json'),
        still: join(projectDir, 'preview', 'stills', `${shot.id}${suffix}.png`),
        slots: props.slots ?? {},
        variant: props.variant ?? {},
      });
    }
  }
  return jobs;
};

const renderStills = async (projectDir, jobs, opts) => {
  const buildDir = join(projectDir, 'build');
  if (!existsSync(buildDir)) {
    throw new Error(`缺少 ${buildDir} —— 整批共用一个模板克隆:cp -Rc templates/remotion-base ${buildDir}`);
  }
  await mkdir(join(projectDir, 'preview', 'stills'), {recursive: true});
  const items = jobs.map((job) => ({
    id: `${job.shot}${job.kind === 'alternative' ? `-alt-${job.preset}` : ''}`,
    cwd: buildDir,
    command: [
      'npx', 'remotion', 'still', job.compositionId,
      `--props=${job.propsPath}`,
      `--frame=${job.frame}`,
      `--scale=${opts.scale}`,
      job.still,
    ],
    expectedOutput: job.still,
  }));
  // 复用正式渲染队列的执行器:并发上限、日志收敛、"产物存在且非空才算过"的判定全都一致
  const logDir = join(projectDir, 'preview', 'logs');
  await mkdir(logDir, {recursive: true});
  const results = await runQueue(items, Math.min(2, Math.max(1, opts.jobs)), logDir);
  return results;
};

const writeSheetDoc = async (projectDir, manifest, sheet) => {
  const lines = [
    '# Preset 预览接触印张(一次确认,批内全部镜头)',
    '',
    `> 图:${sheet.out}`,
    `> 时刻:各镜时长的 ${manifest.time} 处 · 渲染缩放 ${manifest.scale} · 版面 ${sheet.columns}×${sheet.rows}`,
    '> 图上左上角的白底数字 = 下表的编号。要改哪一格就报编号,例如「3 的第二行改成…」「5 选 6 号那版」。',
    '',
    '| 编号 | 镜号 | preset | 时长 | 状态 |',
    '|---:|---|---|---:|---|',
    ...manifest.tiles.map((t) =>
      `| ${t.tag} | ${t.shot} | ${t.preset}@v${t.version}${t.kind === 'alternative' ? ' · 并列候选' : ''} | ${t.durationSeconds}s | ${t.presetStatus} |`,
    ),
    '',
    '## 真实文案(逐格核对错别字、数字、断行)',
    '',
    ...manifest.tiles.flatMap((t) => [
      `- **${t.tag}** ${t.shot} · ${t.preset}@v${t.version}${t.kind === 'alternative' ? '(并列候选,与同镜另一格二选一)' : ''}`,
      ...slotLines({slots: t.slots, variant: t.variant}),
    ]),
    '',
    '## 确认之后',
    '',
    '```bash',
    `node tools/preset-preview.mjs ${projectDir} --confirm "<用户原话>"`,
    `node tools/render-queue.mjs ${join(projectDir, 'render-queue.json')} --concurrency 2 \\`,
    `  --require-confirmed ${manifestPathFor(projectDir)}`,
    '```',
    '',
  ];
  const path = join(projectDir, 'preview', 'contact-sheet.md');
  await writeFile(path, `${lines.join('\n')}\n`);
  return path;
};

const main = async () => {
  const {projectDir, opts} = parseArgs(process.argv.slice(2));

  if (opts.checkOnly) {
    const manifest = await readManifest(projectDir);
    if (manifest.status !== 'confirmed') {
      console.error(`[preset-preview] 未确认(status: ${manifest.status})—— 用户过目前不许渲完整视频`);
      return 1;
    }
    console.log(`[preset-preview] confirmed at ${manifest.confirmedAt}:${manifest.decision}`);
    return 0;
  }

  if (opts.confirm !== null) {
    const manifest = await readManifest(projectDir);
    if (manifest.decision && manifest.status === 'confirmed') {
      console.log(`[preset-preview] 覆盖上一次确认(${manifest.confirmedAt})`);
    }
    manifest.status = 'confirmed';
    manifest.confirmedAt = new Date().toISOString();
    manifest.decision = opts.confirm;
    await writeFile(manifestPathFor(projectDir), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`[preset-preview] 已确认 ${manifest.tiles.length} 格 → ${manifestPathFor(projectDir)}`);
    return 0;
  }

  const contract = await readVisualContract(join(projectDir, 'visual-contract.json'));
  const jobs = await buildJobs(projectDir, contract, opts);
  if (jobs.length === 0) {
    console.log('[preset-preview] 合同里没有 preset 镜,无预览可渲(全是 custom 镜 → 走三张 Styleframe 流程)');
    return 0;
  }

  const draft = jobs.filter((j) => j.presetStatus !== 'verified');
  for (const job of draft) {
    console.error(`[preset-preview] 注意 ${job.shot}:preset ${job.preset} 是 ${job.presetStatus},不走快车道自查降档,按 custom 镜全量门禁执行`);
  }

  const results = await renderStills(projectDir, jobs, opts);
  const failed = results.filter((r) => r.status === 'failed');
  if (failed.length > 0) {
    console.error(`[preset-preview] ${failed.length}/${results.length} 帧没渲出来,先修再拼印张`);
    return 1;
  }

  const renderById = new Map(results.map((result) => [result.id, result]));
  const tiles = await Promise.all(jobs.map(async (job, i) => {
    const renderId = `${job.shot}${job.kind === 'alternative' ? `-alt-${job.preset}` : ''}`;
    const render = renderById.get(renderId);
    return {
      tag: i + 1,
      ...job,
      scale: opts.scale,
      propsSha256: await sha256File(job.propsPath),
      routeSha256: job.kind === 'selected' ? await sha256File(job.routePath) : null,
      signalsSha256: job.kind === 'selected' ? await sha256File(job.signalsPath) : null,
      stillSha256: await sha256File(job.still),
      render,
    };
  }));
  const sheet = buildContactSheet(
    tiles.map((t) => ({png: t.still, tag: t.tag})),
    {out: join(projectDir, 'preview', 'contact-sheet.png'), tileWidth: opts.tileWidth},
  );

  const manifest = {
    version: 2,
    project: contract.project,
    generatedAt: new Date().toISOString(),
    time: opts.time,
    scale: opts.scale,
    sheet: sheet.out,
    status: 'pending',
    confirmedAt: null,
    decision: null,
    tiles: tiles.map((t) => ({
      tag: t.tag,
      shot: t.shot,
      kind: t.kind,
      preset: t.preset,
      version: t.version,
      presetStatus: t.presetStatus,
      compositionId: t.compositionId,
      durationSeconds: t.durationSeconds,
      frame: t.frame,
      props: t.propsPath,
      route: t.kind === 'selected' ? t.routePath : null,
      signals: t.kind === 'selected' ? t.signalsPath : null,
      still: t.still,
      scale: t.scale,
      propsSha256: t.propsSha256,
      routeSha256: t.routeSha256,
      signalsSha256: t.signalsSha256,
      stillSha256: t.stillSha256,
      render: t.render
        ? {
            status: t.render.status,
            exitCode: t.render.exitCode,
            cwd: t.render.cwd,
            command: t.render.command,
            expectedOutput: t.render.expectedOutput,
            outputBytes: t.render.outputBytes,
            durationMs: t.render.durationMs,
          }
        : null,
      slots: t.slots,
      variant: t.variant,
    })),
  };
  await writeFile(manifestPathFor(projectDir), `${JSON.stringify(manifest, null, 2)}\n`);
  const doc = await writeSheetDoc(projectDir, manifest, sheet);
  await rm(join(projectDir, 'preview', 'logs'), {recursive: true, force: true});

  console.log(`[preset-preview] ${tiles.length} 格 → ${sheet.out}`);
  console.log(`[preset-preview] 对照表 → ${doc}`);
  for (const t of tiles) {
    console.log(`  ${t.tag}. ${t.shot} · ${t.preset}@v${t.version}${t.kind === 'alternative' ? '(并列候选)' : ''} · frame ${t.frame}/${Math.round(t.durationSeconds * contract.canvas.fps)}`);
  }
  console.log('[preset-preview] status: pending —— 贴给用户看过、拿到一次确认之前不许渲完整视频');
  return 0;
};

// pathToFileURL,不是 `file://${argv[1]}` —— 项目路径里带空格时后者拼不对
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`[preset-preview] ${error.message}`);
    process.exitCode = 2;
  }
}
