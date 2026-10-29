#!/usr/bin/env node
// lint-shot.mjs — 镜头源码技术与可读性 lint
//
// 不以材质种类或弹簧次数评判表达质量；画面层级与运动交由真实渲染评审。
//
// 用法:
//   node tools/lint-shot.mjs <目录或文件...>
//   node tools/lint-shot.mjs projects/x/build/src/shots
//   node tools/lint-shot.mjs <目录> --contract <visual-contract.json>
//
// 退出码: 0 = 无 error; 1 = 有 error(或合同不合法); 2 = 参数错
//
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, extname} from 'node:path';
import {readVisualContract} from './lib/visual-contract.mjs';
import {DENSITY_PROFILES} from './lib/review.mjs';

const argv = process.argv.slice(2);
const args = [];
let contractPath = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--contract') {
    contractPath = argv[++i];
    if (!contractPath) {
      console.error('--contract 需要一个文件路径');
      process.exit(2);
    }
  } else if (argv[i].startsWith('--contract=')) {
    contractPath = argv[i].slice('--contract='.length);
  } else {
    args.push(argv[i]);
  }
}

if (args.length === 0) {
  console.error('用法: node tools/lint-shot.mjs <目录或文件...> [--contract <path>]');
  process.exit(2);
}

// —— 合同先行:合同不合法就没必要看源码了(镜头 id / 时长 / kit 都从它来)——
//
// 给了合同之后,下面的下限**按合同的 profile / density / motion / typography / palette 取值**,
// 不再套用一组全局常量。理由:四份 profile 的密度、弹簧名额、强调面积本来就不同,
// 拿 visual-max 的数字去审 editorial-luxe 是用一份风格卡审判另一份。
let contract = null;
let profileName = null;
let profile = null;
if (contractPath) {
  try {
    contract = await readVisualContract(contractPath);
  } catch (err) {
    console.error(`视觉合同 ✗ ${contractPath}`);
    console.error(String(err.message ?? err));
    process.exit(1);
  }
  profileName = contract.profile ?? contract.style ?? contract.styleProfile ?? null;
  if (profileName && !DENSITY_PROFILES[profileName]) {
    console.error(`视觉合同 ✗ 未知 profile「${profileName}」,可选:${Object.keys(DENSITY_PROFILES).join(', ')}`);
    process.exit(1);
  }
  profile = DENSITY_PROFILES[profileName ?? 'visual-max'];
  console.log(`视觉合同 ✓ ${contractPath}(kit=${contract.typography.kit},${contract.shots.length} 镜)`);
  console.log(
    `  profile=${profileName ?? 'visual-max(默认)'}  占屏 ${(profile.occupancyMin * 100).toFixed(0)}–${(profile.occupancyMax * 100).toFixed(0)}%` +
      `  density.target=${contract.density.target}  layerCount=${contract.density.layerCount}` +
      `  springAccents=${contract.motion?.springAccents ?? '未声明'}`,
  );
}

const files = [];
const walk = (p) => {
  const st = statSync(p);
  if (st.isDirectory()) {
    for (const e of readdirSync(p)) walk(join(p, e));
  } else if (['.tsx', '.ts'].includes(extname(p))) {
    files.push(p);
  }
};
for (const a of args) walk(a);

if (files.length === 0) {
  console.error('没找到 .tsx/.ts 文件');
  process.exit(2);
}

// —— 只看代码,不看注释 ——
//
// 这是 system-ui 那条已经踩过一次的坑的通用版:组件里那段「禁止在渲染路径里用 Math.random()」
// 的**设计说明**,会被朴素计数当成违规本身,于是模板自己过不了自己的 lint。
// 手写一个小扫描器而不是正则:必须区分字符串里的 `//`(如 https:// )和真正的行注释,
// 否则「远程资源引用」那条规则会被自己截断掉。
const stripComments = (source) => {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += next ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
    } else if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      i++;
    } else if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      out += ' ';
    } else {
      out += c;
      i++;
    }
  }
  return out;
};

const src = files.map((f) => stripComments(readFileSync(f, 'utf8'))).join('\n');
const count = (re) => (src.match(re) ?? []).length;

const kit = contract?.typography?.kit ?? null;
const kitReferenced = kit ? new RegExp(`['"\`]${kit}['"\`]`).test(src) : false;

const MISSING = [
  {
    name: kit ? `字体令牌(合同 kit=${kit})` : '字体令牌',
    // 有合同时要求代码真的引到合同那个 kit;没有合同时维持老的「用了显式排版 API 即可」。
    ok: count(/createTypography|typography\.families|textStyle\s*\(/g) > 0 && (!kit || kitReferenced),
    level: 'error',
    why:
      '没用显式排版 kit。字体是画面性格的第一来源,交给 system-ui = 主动放弃性格。\n' +
      (kit
        ? `      合同写死了 typography.kit=${kit},源码里必须出现 createTypography('${kit}')。\n` +
          '      拿了别的 kit = 成片的中文字形和选中的 Styleframe 不是同一套。\n'
        : '      从合同的 typography.kit 取 createTypography(kit),再 textStyle(typography, name)。\n') +
      '      字号也别只取数字——textStyle() 带着配套的字重/字距/行高,\n' +
      '      三者不配套就是「字号对了但还是很土」。',
  },
  {
    name: '配色令牌',
    ok: count(/scenePalette|seriesDark|seriesLight|\bink\.|\bpalette\./g) > 0,
    level: 'error',
    why: '没从令牌取色。新项目应该 scenePalette(hue, mode) 自己调一次,色相来自题材。',
  },
];

// —— 隐式字体 API(必须显式排版 kit)——
//
// 注意这四条都**只匹配代码上下文**,不做整串朴素计数:
// fonts.ts 顶上那段「为什么不用 system-ui」的注释是合法的设计说明,
// 早先 /system-ui/g 的写法会把它连同文档性文字一起误报,导致模板自己过不了自己的 lint。
// 判定 system font 只看 `fontFamily: '...system-ui...'` 这种真正的字体声明。
const explicitTypographyViolations = [
  {re: /\b(?:theme\.)?font\.family\b/g, message: 'use an explicit typography kit; font.family is forbidden'},
  {re: /\bFONT\.text\b/g, message: 'use an explicit typography kit; FONT.text is forbidden in new shots'},
  {re: /fontFamily\s*:\s*['"`][^'"`]*(?:system-ui|-apple-system)/g, message: 'system font fallback is forbidden'},
  // 字符类必须含数字:SIZE 的六个样式名是 hero/h1/h2/body/label/caption,
  // 计划原文写的 [a-zA-Z]+ 会放过 textStyle('h1') 和 textStyle('h2')——
  // 偏偏这两个是最常被手写的标题级字号,等于这条规则对半失效。
  {re: /textStyle\(\s*['"`][a-zA-Z0-9]+['"`]\s*\)/g, message: 'textStyle requires TypographyContext as its first argument'},
];

// —— 不该用而用了 ——
//
// hex 规则也吃合同:合同 palette 里声明过的颜色不算「手写 hex」——
// 它就是这次的色板令牌,写在代码里和写在合同里是同一个决定。
// 没在合同里的 hex 才是现场发挥的那种。
const declaredHex = new Set(
  [
    contract?.palette?.dominant,
    ...(contract?.palette?.support ?? []),
    ...(contract?.palette?.accent ?? []),
    ...(contract?.palette?.surfaces ?? []),
  ]
    .filter((v) => typeof v === 'string')
    .map((v) => v.toLowerCase()),
);
const hexLiterals = src.match(/['"`]#[0-9a-fA-F]{6}\b/g) ?? [];
const undeclaredHex = hexLiterals.filter((h) => !declaredHex.has(h.slice(1).toLowerCase()));

// —— 最低有效字高(判例 T1)——
//
// 项目自己的口号是「缩到 320px 宽仍可读」,但在 2026-08-20 之前**没有任何脚本在执行它**:
// check-density 查墨量、frame-audit 查层数与偏压、lint-shot 查令牌,
// 三条门禁没有一条能发现「字太小」——而这是竖屏 + 手机观看下最致命、
// 也最容易在缩略图里被忽略的问题。
//
// 阈值按**短边**算,不按帧高算。竖版 1080×1920 的短边是宽 1080:
// 文字行是横向排的,读起来的相对大小跟着宽度走,拿 1920 当分母会把门槛抬到 57px,
// 连 body(44)都过不了 —— 那不是严格,那是标错了尺子。
//
// 这一层是**静态检查**:只看源码里手写的 fontSize 数字。
// 真正的"最终像素量"要连 transform scale 一起算,那属于像素层(frame-audit),
// 中文笔画密度的阈值标定没做完之前不上门禁。静态层的价值在于它零误报:
// 手写 fontSize: 20 绕过 textStyle(),无论怎么缩放都是可疑的。
const shortSide = contract ? Math.min(contract.canvas.width, contract.canvas.height) : 1080;
const READABLE_FLOOR = Math.round(shortSide * 0.03); // 辅助文字下限 3%
const CAPTION_FLOOR = Math.round(shortSide * 0.05); // 字幕下限 5%

// 肌理文字要豁免,否则这条规则会骂判例 Q5 自己认可的手法。
// 「卡片标题降到 20px、ink.muted、opacity 0.7 只当重复肌理读」——那种字**故意不让人读**,
// 一旦可读观众就会去读,焦点反而散了。签名很稳定:小字号 + 弱墨色 + 降透明度同时出现。
// 判据取 fontSize 前后各 240 字符的窗口(一个 style 对象的量级),
// 命中弱墨令牌或 <0.9 的 opacity 就认定是肌理,不计入告警但单独报数——
// **报数是为了防止这个豁免变成后门**:哪天肌理文字有十几处,那本身就是个信号。
const WEAK_INK =
  /ink\.(?:muted|secondary|faint)|opacity\s*:\s*(?:0?\.[0-8]\d*|[a-zA-Z_$][\w$]*\s*\*)|alpha\([^)]*,\s*0?\.[0-8]\d*\s*\)/;
const smallHits = [...src.matchAll(/fontSize\s*:\s*(\d+(?:\.\d+)?)/g)]
  .map((m) => ({size: Number(m[1]), index: m.index ?? 0}))
  .filter((hit) => hit.size < READABLE_FLOOR)
  .map((hit) => ({
    ...hit,
    texture: WEAK_INK.test(src.slice(Math.max(0, hit.index - 240), hit.index + 240)),
  }));
const tooSmall = smallHits.filter((hit) => !hit.texture);
const textureExempt = smallHits.filter((hit) => hit.texture);
const sizeList = (list) => [...new Set(list.map((hit) => hit.size))].sort((a, b) => a - b).join(' / ');

const FORBIDDEN = [
  {
    name:
      `低于最低有效字高的手写字号(短边 ${shortSide},下限 ${READABLE_FLOOR}px = 3%` +
      (textureExempt.length ? `;另有 ${textureExempt.length} 处判定为肌理文字已豁免:${sizeList(textureExempt)}px` : '') +
      ')',
    hits: tooSmall.length,
    level: 'warn',
    why:
      `判例 T1:要被读的文字有最低有效字高——字幕 ≥5%(${CAPTION_FLOOR}px)、辅助文字 ≥3%(${READABLE_FLOOR}px)。\n` +
      `      实到:${sizeList(tooSmall)}px。\n` +
      '      本项目自己的口径是「缩到 320px 宽仍可读」,低于下限的字缩完只剩几个像素。\n' +
      '      正解是从 textStyle(typography, role) 取字号(它带着配套字重/字距/行高),不是手写数字。\n' +
      '      **故意压小的肌理文字不在此列**(判例 Q5:弱墨色 + 低透明度),那种已自动豁免;\n' +
      '      这里报的是全墨全不透明的小字——那是真要人读却读不清的。',
  },
  {
    name: contract
      ? `合同外的硬编码 hex 颜色(合同声明了 ${declaredHex.size} 个,已豁免 ${hexLiterals.length - undeclaredHex.length} 处)`
      : '硬编码 hex 颜色',
    hits: undeclaredHex.length,
    level: 'warn',
    why:
      '手写 hex 的感知明度不可控,拼一起就是说不出哪儿不对的廉价感。\n' +
      '      用 scenePalette() / oklch() / theme 令牌,或把颜色写进合同 palette 再从合同消费。\n' +
      '      确有理由(如品牌色)就在注释里写明。',
  },
  {
    name: '渲染期不确定性',
    hits: count(/Date\.now\(|Math\.random\(/g),
    level: 'error',
    why: 'design-principles §9:任意一帧必须能独立算出来。用固定种子的伪随机。',
  },
  {
    name: '远程资源引用',
    hits: count(/(src|href|url)\s*[=(:]\s*['"`]https?:\/\//g),
    level: 'error',
    why:
      '渲染期网络请求。断网渲不出来、远端变了重渲结果就变,抽帧自查失去意义。\n' +
      '      素材先下载进项目 assets/ 再引本地文件,并登记 assets.md 版权。',
  },
];

let errors = 0;
let warns = 0;
console.log(`镜头源码技术检查  (${files.length} 个文件)`);

for (const r of MISSING) {
  if (r.ok) {
    console.log(`  ✓ ${r.name}`);
  } else {
    const tag = r.level === 'error' ? '✗' : '!';
    console.log(`  ${tag} ${r.name}:未使用`);
    console.log(`      ${r.why}`);
    r.level === 'error' ? errors++ : warns++;
  }
}
let typographyClean = true;
for (const r of explicitTypographyViolations) {
  const hits = count(r.re);
  if (hits === 0) continue;
  typographyClean = false;
  console.log(`  ✗ ${r.message}:${hits} 处`);
  errors++;
}
if (typographyClean) console.log('  ✓ 显式排版 kit(no implicit font APIs)');

for (const r of FORBIDDEN) {
  if (r.hits === 0) {
    console.log(`  ✓ 无${r.name}`);
  } else {
    const tag = r.level === 'error' ? '✗' : '!';
    console.log(`  ${tag} ${r.name}:${r.hits} 处`);
    console.log(`      ${r.why}`);
    r.level === 'error' ? errors++ : warns++;
  }
}

console.log(errors === 0 ? (warns === 0 ? 'PASS' : `PASS(${warns} 项告警)`) : `FAIL(${errors} 项)`);
process.exit(errors === 0 ? 0 : 1);
