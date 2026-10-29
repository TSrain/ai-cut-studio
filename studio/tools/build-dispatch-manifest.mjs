#!/usr/bin/env node
// tools/build-dispatch-manifest.mjs
// 用法: node tools/build-dispatch-manifest.mjs <project-dir>
// 校验 visual-contract.json,然后为每个镜头建 shots/<id>/{source,keyframes}
// 并写 dispatch.md + context-pack.json。每份 dispatch 只声明自己那一个可写目录,
// 不出现任何别的镜头 —— 隔离是并行 worker 不互相踩踏的唯一保证。
import {mkdir, writeFile, readFile} from 'node:fs/promises';
import {resolve, join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readVisualContract} from './lib/visual-contract.mjs';
import {routeKnowledgeForEngine} from './lib/knowledge-router.mjs';
import {shortlistComponents} from './lib/component-catalog.mjs';

const toolRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rawDir = process.argv[2];

if (!rawDir) {
  console.error('Usage: node tools/build-dispatch-manifest.mjs <project-dir>');
  process.exit(2);
}

const projectDir = resolve(rawDir);
const contractPath = join(projectDir, 'visual-contract.json');

// 镜头没写 tags 时的兜底:任何镜头都要排版/构图基线知识。
const FALLBACK_TAGS = ['core', 'layout', 'type'];

// 组件候选清单的条数上限。46 条全表约 6600 tokens,一镜真正用得上的通常不到 10 条,
// 所以 dispatch 里只放重合度最高的这些;不够用时 worker 再去读全表。
const MAX_COMPONENTS = 10;
// 配方比组件粗一档、单条更贵(带完整参数表),所以取 3 条不取 10 条。
// 一镜真正用得上的手法通常就一两个;给多了 worker 会挑花眼,也把 dispatch 撑回全表量级。
const MAX_RECIPES = 3;

const shotTags = (shot) =>
  Array.isArray(shot.tags) && shot.tags.length > 0
    ? [...new Set([...shot.tags, 'core'])]
    : FALLBACK_TAGS;

const roleContracts = (engine) =>
  engine === 'hybrid'
    ? ['docs/subagents/shot-worker-remotion.md', 'docs/subagents/shot-worker-hyperframes.md']
    : [`docs/subagents/shot-worker-${engine}.md`];

const componentLine = (entry) =>
  `- ${entry.id} · ${entry.title} · ${entry.engine} · ${entry.tags.join(',')} · cost:${entry.cost}` +
  ` · ${entry.install ? `install: ${entry.install}` : entry.source}`;

// shortlist 只给 id 和 tags 时,worker 知道"有这个组件"但不知道"怎么调",于是照旧手搓。
// params(参数 / 典型值 / 调节手感)与 pitfalls 补上这一层。
//
// 但不能十条都展开——那是 ~1500 tokens,又把 dispatch 撑回全表的量级。
// 折中:**重合度最高的前三条**给完整参数表(那三条本来就是这镜最可能用的),
// 其余只补一条最要命的坑。不够用时 worker 再去读 docs/catalog/components.json 的该条。
const DETAIL_TOP_N = 3;

const componentDetail = (entry, index) => {
  const lines = [componentLine(entry)];
  if (index < DETAIL_TOP_N && entry.params?.length) {
    lines.push(...entry.params.map((param) => `    · ${param.name} = ${param.typical} —— ${param.feel}`));
  }
  const pitfalls = index < DETAIL_TOP_N ? entry.pitfalls ?? [] : (entry.pitfalls ?? []).slice(0, 1);
  lines.push(...pitfalls.map((item) => `    ⚠ ${item}`));
  return lines.join('\n');
};

// context-pack.json:合同设计 token + 本镜参数的脚本生成快照,worker 的默认合同视图。
// 完整合同对 worker 是只读全量输入,但一镜真正消费的只有设计 token 和自己那一条 shot——
// 其余 N-1 条 shot 的描述每镜重复读一遍,批次越大浪费越大。快照由脚本从冻结合同投影,
// 不存在漂移;缺字段才回读完整合同。
const buildContextPack = ({contract, shot, resources, components}) => ({
  generatedBy: 'tools/build-dispatch-manifest.mjs',
  note: '从冻结 visual-contract.json 生成的只读快照;缺字段才回读完整合同,不许改这份文件。',
  project: contract.project,
  profile: contract.profile ?? contract.style ?? null,
  canvas: contract.canvas,
  density: contract.density,
  palette: contract.palette ?? null,
  typography: contract.typography,
  motion: contract.motion ?? null,
  focus: contract.focus ?? null,
  facts: contract.facts ?? null,
  shot,
  routedKnowledge: resources,
  componentShortlist: components,
});

// preset 快车道 dispatch:不派 worker、不路由知识、不列组件清单——设计已由 preset 冻结,
// 唯一输入是 props.json。主 agent 直接把渲染命令排进 render-queue。
const renderPresetDispatch = ({shot, shotDir}) =>
  [
    `# Shot Dispatch: ${shot.id}`,
    '',
    'Mode: preset-fastlane(不派 worker、不写新 TSX;设计已由 preset 冻结,唯一变量是本次文案与素材)',
    `Preset: ${shot.preset.id}@v${shot.preset.version}(定义 docs/presets/${shot.preset.id}/preset.json)`,
    `Match: selected=${shot.selectedPreset ?? '(未记录)'} · candidates=${(shot.presetCandidates ?? []).join('/') || '(未记录)'}`,
    `Match reason: ${shot.matchReason ?? '(未记录——合同该字段必填,回去补)'}`,
    `Engine: ${shot.engine}`,
    `Objective: ${shot.objective}`,
    `Duration: ${shot.durationSeconds}s`,
    `Props: ${join(shotDir, 'props.json')}(由 tools/expand-presets.mjs 生成)`,
    '',
    '## 顺序:预览在前,视频在后',
    '1. `node tools/preset-preview.mjs <project>` —— 本镜 0.4 时刻一帧,真实文案,进批次接触印张',
    '2. 印张贴给用户,**整批只此一次确认**;`--confirm "<用户原话>"` 盖章',
    '3. 盖章后才渲视频:`node tools/render-queue.mjs <queue> --concurrency 2 --require-confirmed <project>/preview/preview-manifest.json`',
    '',
    '## 渲染(主 agent 直接排进 render-queue,--color-space=bt709 出限范围 yuv420p,normalize 走免转码)',
    '```json',
    JSON.stringify(
      {
        id: shot.id,
        cwd: '<project>/build',
        command: [
          'npx', 'remotion', 'render', '<compositionId 见 props.json>',
          `--props=${join(shotDir, 'props.json')}`, '--color-space=bt709',
          join(shotDir, 'raw.mp4'),
        ],
        expectedOutput: join(shotDir, 'raw.mp4'),
      },
      null,
      2,
    ),
    '```',
    '',
    '## 自查:verified preset 每次使用只做这四项(draft preset 按 custom 镜全量门禁)',
    '1. 槽位校验 —— `node tools/expand-presets.mjs <project>`(估宽/必填/enum/版本;exit 0 才算过)',
    '2. Preset Preview —— 真实文案那一帧渲出来并进印张(见上)',
    '3. 输出成功检查 —— render-queue 该项 exit 0 且 raw.mp4 存在非空',
    '4. 分辨率/时长/编码/音轨 —— `tools/validate-output.sh <out.mp4> --size WxH --fps N --duration S --codec h264 --pix-fmt yuv420p --audio none`',
    '不再跑 frame-audit / lint-shot / check-density / 逐镜 visual-reviewer:',
    'verified 那一次已经逐帧看过版式与墨量,本次唯一的变量是文案,而文案由印张确认。',
    'review.json 的 technical 五项照填,取值必须来自上面四条命令的真实 exit code。',
    '',
  ].join('\n');

const renderDispatch = ({shot, shotDir, resources, recipes, components, tags, catalogSize}) =>
  [
    `# Shot Dispatch: ${shot.id}`,
    '',
    `Engine: ${shot.engine}`,
    `Objective: ${shot.objective}`,
    `Duration: ${shot.durationSeconds}s`,
    `Start anchor: ${shot.startAnchor}`,
    `End anchor: ${shot.endAnchor}`,
    `Context pack: ${join(shotDir, 'context-pack.json')}(设计 token + 本镜参数的合同快照,**先读它**)`,
    `Contract: ${contractPath} (read-only; 只在 context-pack 缺字段时回读)`,
    `Writable scope: ${shotDir}`,
    '',
    '## Required outputs',
    '- source implementation under `source/`',
    '- `keyframes/start.png`',
    '- `keyframes/mid.png`',
    '- `keyframes/end.png`',
    '- `draft.mp4`',
    '- `review.json`',
    '',
    '## Role contract',
    ...roleContracts(shot.engine).map((path) => `- ${path}`),
    '',
    '## Routed knowledge (open at the path; bodies are not copied here)',
    ...resources.map((resource) => `- ${resource}`),
    '',
    `## Recipe shortlist (tags: ${tags.join(',')})`,
    '配方 = 几个组件按什么时序凑成一个**具名手法**。命中就照卡做,不要重新发明一遍时序。',
    ...(recipes.length > 0
      ? recipes.map(componentDetail)
      : ['- (本镜标签没匹配到配方;`docs/recipes/` 只有本地层,外部 152 张卡在控制台「镜头配方」区挑)']),
    '',
    `## Component shortlist (tags: ${tags.join(',')})`,
    '默认动作是从这里挑一个复用+调参,不是手搓等价物。',
    ...(components.length > 0
      ? components.map(componentDetail)
      : ['- (本镜标签在目录里没有匹配项,去读全表)']),
    `完整目录 docs/catalog/components.json 共 ${catalogSize} 条 —— **只有这份清单不够用时才去读全表**;`,
    'HyperFrames 侧另跑 `hyperframes catalog`。',
    '',
    '## Guardrails',
    '- Write only inside the writable scope above.',
    '- `visual-contract.json`, shared templates, `AGENTS.md` and every other shot directory are read-only.',
    '',
  ].join('\n');

let contract;
try {
  contract = await readVisualContract(contractPath);
} catch (error) {
  console.error(`FAIL visual contract: ${contractPath}\n${error.message}`);
  process.exit(1);
}

try {
  const manifest = JSON.parse(await readFile(join(toolRoot, 'docs/knowledge-manifest.json'), 'utf8'));
  const maxDynamic = Number(manifest.maxDynamic ?? 4);
  const maxContextTokens = Number(manifest.maxContextTokens ?? Infinity);
  const exclusiveKinds = manifest.exclusiveKinds ?? [];
  const catalog = JSON.parse(await readFile(join(toolRoot, 'docs/catalog/components.json'), 'utf8'));

  for (const shot of contract.shots) {
    const shotDir = join(projectDir, 'shots', shot.id);
    await mkdir(join(shotDir, 'source'), {recursive: true});
    await mkdir(join(shotDir, 'keyframes'), {recursive: true});

    // preset 镜走快车道:零知识路由、零组件清单、零 worker(省掉整段 dispatch token)
    if (shot.preset) {
      await writeFile(join(shotDir, 'dispatch.md'), renderPresetDispatch({shot, shotDir}), 'utf8');
      console.log(`dispatch: ${join(shotDir, 'dispatch.md')} (preset-fastlane: ${shot.preset.id}@v${shot.preset.version})`);
      continue;
    }

    const tags = shotTags(shot);
    const resources = routeKnowledgeForEngine(manifest.entries, {
      engine: shot.engine,
      tags,
      maxDynamic,
      maxContextTokens,
      exclusiveKinds,
    }).map((entry) => entry.resource);
    // 配方和组件分开排、分开取上限:两者混在一条清单里会互相挤掉。
    // 配方给的是"这个手法整套怎么做",组件给的是"这个零件怎么调",worker 两样都要。
    const recipes = shortlistComponents(
      catalog.filter((entry) => entry.kind === 'recipe'),
      {engine: shot.engine, tags, max: MAX_RECIPES},
    );
    const components = shortlistComponents(
      catalog.filter((entry) => entry.kind !== 'recipe'),
      {engine: shot.engine, tags, max: MAX_COMPONENTS},
    );

    await writeFile(
      join(shotDir, 'context-pack.json'),
      `${JSON.stringify(buildContextPack({contract, shot, resources, components}), null, 2)}\n`,
      'utf8',
    );
    await writeFile(
      join(shotDir, 'dispatch.md'),
      renderDispatch({shot, shotDir, resources, recipes, components, tags, catalogSize: catalog.length}),
      'utf8',
    );
    console.log(
      `dispatch: ${join(shotDir, 'dispatch.md')} (${shot.engine}, ${resources.length} resources, ${recipes.length} recipes + ${components.length} components, context-pack.json)`,
    );
  }

  console.log(`PASS dispatch manifest: ${contract.project} (${contract.shots.length} shots)`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
