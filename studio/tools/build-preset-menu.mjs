#!/usr/bin/env node
// tools/build-preset-menu.mjs —— 从 docs/presets/*/preset.json 自动生成 docs/presets/MENU.md
//
// MENU.md 是给上游(自媒体工作流 /package)现读的能力菜单:理想表达设计后比较模板能力,
// 按批准路线制作，已选原生 verified preset 才走技术快车道。**菜单住在本项目、脚本生成、不手维护、
// 不许被复制到别的项目**——上游只保留一行指针(单一事实源,防双源漂移)。
//
// 什么时候跑:任何 preset.json 变动之后(新增/升版/翻 verified)。幂等。
import {readFile, writeFile, readdir} from 'node:fs/promises';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateMenuDefinition} from './lib/preset-menu-definition.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PRESETS_DIR = join(ROOT, 'docs', 'presets');

const dirs = (await readdir(PRESETS_DIR, {withFileTypes: true}))
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const defs = [];
for (const dir of dirs) {
  let raw;
  try {
    raw = await readFile(join(PRESETS_DIR, dir, 'preset.json'), 'utf8');
  } catch {
    continue; // 没有 preset.json 的目录不是 preset
  }
  const def = JSON.parse(raw);
  const result = validateMenuDefinition(def);
  if (!result.ok) {
    console.error(`跳过 ${dir}:定义不合法\n  ${result.errors.join('\n  ')}`);
    process.exitCode = 1;
    continue;
  }
  defs.push(def);
}

const slotLine = (name, slot) => {
  const req = slot.required === false ? '可选' : '必填';
  const kind = {text: '文字', number: '数字', image: '图片', enum: '枚举', list: '列表'}[slot.type] ?? slot.type;
  return `  - \`${name}\`(${kind},${req})${slot.description ? ` — ${slot.description}` : ''}`;
};

const section = (def) => {
  const variantLines = Object.entries(def.variants ?? {}).map(
    ([k, v]) => `  - \`${k}\`:${v.values.map((x) => JSON.stringify(x)).join(' / ')}(默认 ${JSON.stringify(v.default)})${v.description ? ` — ${v.description}` : ''}`,
  );
  return [
    `## ${def.id} · ${def.name} · v${def.version}${def.status === 'verified' ? '' : ' · ⚠️ draft(不走快车道)'}`,
    '',
    `![${def.id}](../catalog/thumbnails/remotion/preset-${def.id}.png)`,
    '',
    `- 时长:${def.duration.min}–${def.duration.max}s(默认 ${def.duration.default}s)· 画布 ${def.canvas.join('/')}`,
    ...(def.motion ? [`- 动效性格:${def.motion.character},弹簧名额 ${def.motion.springAccents}`] : [`- 原生动作:${def.anchors?.start ?? def.description ?? '见PRESET.md'} → ${def.anchors?.end ?? '见PRESET.md'}`]),
    ...(def.description ? [`- 表达能力:${def.description}`] : []),
    ...(def.componentSource ? [`- 原生组件:\`${def.componentSource}\`；准备条件和实际动作读同目录 PRESET.md。`] : []),
    '- 槽位:',
    ...Object.entries(def.slots).map(([k, v]) => slotLine(k, v)),
    ...(variantLines.length > 0 ? ['- 档位:', ...variantLines] : []),
    '- 合同写法:',
    '```json',
    JSON.stringify(
      {id: 'shot-NNN', preset: {id: def.id, version: def.version}, presetProps: {durationSeconds: def.duration.default, slots: {'…': '…'}}},
      null,
      2,
    ),
    '```',
    '',
  ];
};

const lines = [
  '# 口播 Preset 能力菜单(脚本生成,不手改)',
  '',
  '> semantic-template-v1：先全文语义，再全文模板表现力复审，覆盖概念/强调/结论/转折/并列等机会；本分支无模板审批。PRESET.md与组件是实际能力依据，不能只按复杂机制判断；下文旧审批措辞只适用legacy合同。',
  '',
  `> 生成器:\`node tools/build-preset-menu.mjs\` · 来源:docs/presets/*/preset.json · 共 ${defs.length} 个`,
  '> 用法(上游 /package、motion-broll):**先设计对象、起始→变化→结束与口播锚点，再现读本文件**(不缓存不摘抄),逐镜比较语义关系、对象结构、构图、运动、节奏与风格;',
  '> 先以最佳效果推荐路线；模板能满足时同步给方案。已选原生模板才写 `preset: {id, version}` + 真实文案槽，不以候选存在自动切换路线。',
  '> 模板/定制比较写可保留表达、缺失动作、定制收益与负担、推荐及风险，合并原审批；用户无需提供参考片，agent 按需研究。',
  '> 槽位适配仅是技术条件；模板同等最好可推荐复用，定制有效果收益则说明收益。已批准 custom 保持原路线，不因重匹配覆盖；不强制定制，也不冒充 verified。',
  '>',
  '> 每镜的匹配结论必须落进合同(四个字段,`validate-contract.mjs --require-preset-matching` 会拦):',
  '> `presetCandidates`(比较过谁)/ `selectedPreset`(实际选了谁,custom/未选定写 null)/ `matchReason`(六项表达为何完整匹配)/',
  '> `unmatchedReason`(本次未选原生模板的原因,可有合适候选)。`presetCandidates` 只表示比较，不代表选择；模板对照预览的 `presetAlternatives` 仅写独立候选合同,',
  '> 各带真实文案渲预览，可与定制候选同步展示；正式合同按用户所选路线冻结，存在候选不免除定制设计。',
  '>',
  '> 已选原生 verified preset 复用技术快车道:槽位校验 → Preset Preview(0.4 时刻真实文案帧,整批拼一张接触印张)',
  '> → 输出成功 → 分辨率/时长/编码/音轨。**用户确认印张之前不渲完整视频。**',
  '> 全部交付镜仍须本次连续播放、内容/节奏/可读性/衔接检查，overlay 查看真实口播合成；verified 和评分不代替观看。',
  '> keyframes-only 不渲 MP4，明确动态未验收；时限/修复轮数不授权自动降质，未达标交草稿与缺口。',
  '',
  ...defs.flatMap(section),
];

await writeFile(join(PRESETS_DIR, 'MENU.md'), `${lines.join('\n')}\n`);
console.log(`[build-preset-menu] ${defs.length} 个 preset → docs/presets/MENU.md`);
