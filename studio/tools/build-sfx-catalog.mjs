#!/usr/bin/env node
// 生成 assets/library/sfx/CATALOG.json —— 音效库的中文索引。
//
// 为什么要生成而不是手写:149 个文件手写说明必然写成半吊子,而**只有文件名的素材等于没入库**
// (和 HDRI 那条同一个规矩)——用户在控制台里看不懂,也就选不动。
//
// 三个字段各有各的来源,都不是编的:
//   · 时长  —— ffprobe 现场实测(文件就在本地,没必要抄上游的表)
//   · 峰值 / 英文原名 —— 解析上游的 AUDITION.md(ffmpeg volumedetect 实测值)
//   · 中文名 —— 英文原名/文件名走词表映射;词表在下面,不认识的词原样保留
//
// 类别描述与 ui/ 的逐条质感判定来自上游 sound-design.md 3.0 / 3.3,是**听过之后的结论**,照搬。
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync, readdirSync, existsSync, statSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SFX = join(ROOT, 'assets/library/sfx');
const CINE = join(SFX, 'cinematic');

// 16 类。「什么时候进这个目录」是找音的入口:**先定类别,再挑音色**。
const CATS = {
  transition: ['转场 / 呼啸', 'whoosh / sweep / swoosh / 风。运镜、场景切换、元素飞入飞走。不知道配什么先来这里'],
  impact: ['落地 / 重拍', 'impact / thud / stomp / bass hit。落地钉点、重拍、slam 文字'],
  riser: ['上升铺垫', '进 finale 或大镜头前的能量铺垫。库里只有 1 个,用完记得换素材别复读'],
  camera: ['相机 / 快门', '快门、镜头、变焦。拍照感、crash zoom、对焦'],
  ui: ['界面反馈', '点击、开关、通知、pop。**必须逐个试听**——这一类内部质感分裂,一半是合成音(见 verdict 字段)'],
  text: ['打字 / 书写', '打字机、键盘、书写。打字揭示、描线、下划线'],
  paper: ['纸张', '纸、翻页、印刷。翻页转场、撕裂、纸艺'],
  film: ['胶片 / 放映', '放映机、胶片、磁带、黑胶。预告片语法、回带变速'],
  light: ['光效 / sparkle', '扫光、点亮、余韵闪光。**词汇表里的 sparkle 就在这个目录**,库里没有 sparkle/'],
  data: ['数据 / 故障', 'glitch、电流、数据。HUD、流式输出、骨架屏、故障。合成音多,同样要逐个试听'],
  scifi: ['科技底噪', '太空、系统底噪。长样本铺底用,同样要逐个试听'],
  mech: ['机械', '机械、工业、锁。部件组装、锁定、形变'],
  glass: ['玻璃', '玻璃、碎裂。碎裂转场、硬切冲击'],
  fluid: ['流体', '墨水、水、流体、颗粒。墨开场、颗粒填充、气泡'],
  crowd: ['人群 / 生理', '人群、掌声、呼吸、心跳。合影收尾、发布会感、张力'],
  counter: ['计数 / 仪表', '计数器、仪表、钟、倒计时。数字滚动、读数、时间轴'],
};

// ui/ 的逐条质感判定(上游 sound-design.md 3.3,听过之后的结论)。
// ✅ 可直接当交互拟音 / ⚠️ 必须在成片语境里试听再定 / ❌ 合成音,默认不用于产品片
const UI_VERDICT = {
  'switch-light': 'ok', 'switch-tap': 'ok', 'switch-click-quick': 'ok', pop: 'ok',
  'hitech-touch-magnet': 'maybe', 'chime-crystal': 'maybe', 'pop-electric': 'maybe', 'ui-select-click': 'maybe',
  'ui-click-tone': 'no', 'ui-confirm-bleep': 'no', 'ui-confirm-tone': 'no', 'ui-tone-quick': 'no',
  'ui-success-soft': 'no', 'ui-notify-tech': 'no', 'ui-message-pop': 'no', 'ui-popup-dry': 'no',
  'ui-option-select': 'no', 'ui-select-modern': 'no',
};

// 词表:文件名 token → 中文。不认识的 token 原样保留,不硬猜。
const WORDS = {
  air: '气流', whoosh: '呼啸', woosh: '呼啸', swoosh: '掠过', sweep: '扫过', swipe: '划过',
  powerful: '强', deep: '低沉', quick: '快', fast: '快', slow: '慢', short: '短', long: '长',
  soft: '轻', hard: '硬', big: '大', small: '小', light: '轻', heavy: '重', dry: '干',
  zoom: '变焦', vacuum: '抽吸', wind: '风', swirl: '旋', tech: '科技', slide: '滑',
  impact: '撞击', thud: '闷响', stomp: '跺地', bass: '低频', hit: '击', boom: '轰',
  cine: '电影感', cinematic: '电影感', trailer: '预告片', epic: '史诗',
  riser: '上升铺垫', rise: '上升', drone: '底噪',
  camera: '相机', shutter: '快门', click: '咔哒', lens: '镜头', focus: '对焦', iris: '光圈',
  switch: '开关', tap: '轻点', toggle: '切换', pop: '弹出', bubble: '气泡',
  ui: '界面', select: '选择', confirm: '确认', tone: '合成音', bleep: '电子提示',
  notify: '通知', notification: '通知', message: '消息', alert: '警示', success: '成功',
  popup: '弹窗', option: '选项', modern: '现代', magnet: '磁吸', chime: '风铃', crystal: '水晶',
  hitech: '高科技', electric: '电子', touch: '触碰',
  type: '打字', typewriter: '打字机', typing: '打字', keyboard: '键盘', key: '按键',
  write: '书写', pencil: '铅笔', pen: '钢笔', marker: '记号笔', draw: '描画',
  paper: '纸', page: '翻页', turn: '翻', tear: '撕', rip: '撕裂', print: '印刷',
  crumple: '揉纸', flip: '翻动', sheet: '纸张', book: '书',
  film: '胶片', projector: '放映机', reel: '片盘', tape: '磁带', vinyl: '黑胶', rewind: '回带',
  sparkle: '闪光', shimmer: '微光', glow: '辉光', magic: '魔法', twinkle: '闪烁', flash: '闪',
  glitch: '故障', data: '数据', digital: '数字', static: '静电', noise: '噪声', signal: '信号',
  scan: '扫描', load: '加载', os: '系统', computer: '电脑', hud: 'HUD', interface: '界面',
  space: '太空', scifi: '科幻', sci: '科幻', ambient: '氛围', atmosphere: '氛围',
  mech: '机械', mechanical: '机械', metal: '金属', gear: '齿轮', lock: '锁定', unlock: '解锁',
  robot: '机器人', servo: '舵机', industrial: '工业', machine: '机器',
  glass: '玻璃', shatter: '碎裂', break: '破碎', crack: '裂',
  ink: '墨水', water: '水', liquid: '液体', splash: '溅', drop: '滴', flow: '流动',
  particle: '颗粒', granular: '颗粒',
  crowd: '人群', applause: '掌声', clap: '鼓掌', cheer: '欢呼', breath: '呼吸', heartbeat: '心跳',
  heart: '心跳', gasp: '倒吸气',
  counter: '计数器', clock: '钟', tick: '滴答', countdown: '倒计时', timer: '计时器',
  knob: '旋钮', spin: '旋转', dial: '刻度盘', meter: '仪表', single: '单次',
  wing: '振翅', flutter: '扑动', transition: '转场', in: '进', out: '出',
};

const zhName = (base) =>
  base
    .replace(/\.mp3$/, '')
    .split('-')
    .map((w) => WORDS[w] ?? w)
    .join('·');

// —— 解析上游试听表:峰值与 Mixkit 原名(实测值,别自己编)——
const meta = new Map();
const auditionPath = join(CINE, 'AUDITION.md');
if (existsSync(auditionPath)) {
  for (const line of readFileSync(auditionPath, 'utf8').split('\n')) {
    const m = line.match(/^\|\s*`([a-z0-9-]+)\/([a-z0-9-]+\.mp3)`\s*\|\s*([\d.]+)s\s*\|\s*(-?[\d.]+dB)\s*\|\s*([^|]*)\|\s*([^|]*)\|/);
    if (m) meta.set(m[2], {peak: m[4].trim(), origin: m[6].trim()});
  }
}

const probeDur = (file) => {
  try {
    const out = execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
      {encoding: 'utf8'},
    );
    return Math.round(Number(out.trim()) * 100) / 100;
  } catch {
    return null;
  }
};

const items = [];
for (const cat of Object.keys(CATS)) {
  const dir = join(CINE, cat);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.mp3')).sort()) {
    const base = f.replace(/\.mp3$/, '');
    const m = meta.get(f) ?? {};
    items.push({
      file: `cinematic/${cat}/${f}`,
      name: zhName(f),
      cat,
      dur: probeDur(join(dir, f)),
      peak: m.peak ?? null,
      origin: m.origin || null,
      // ui/ 的三档判定;其余类别不标(不是"没判定",是这一类不存在这个分裂)
      verdict: cat === 'ui' ? UI_VERDICT[base] ?? 'maybe' : null,
      // 轻音名单:volume 是乘法系数不是目标音量,给到 1.0 也会被 BGM 盖住
      quiet: m.peak ? Number(String(m.peak).replace('dB', '')) < -12 : false,
    });
  }
}

const existing = JSON.parse(readFileSync(join(SFX, 'CATALOG.json'), 'utf8'));
// 原有的 remotion.media 梗音效条目原样保留 —— 它们是另一套调性,不是被替换掉
const memeItems = (existing.items ?? []).filter((it) => !String(it.file).startsWith('cinematic/'));

const out = {
  note:
    '两套音效并存,调性完全不同,别混用:根目录是 remotion.media 的干活音 + 梗音效(整活口播用);' +
    'cinematic/ 是 149 个电影系音效分 16 类(成片 / showcase 用)。' +
    '渲染时必须引本地文件(拷进 build/public/sfx/ 再 staticFile),不许直接引 URL——渲染期网络请求违反确定性条款。' +
    '找音先定类别再挑音色。方法论见 docs/sound-design.md。本文件由 tools/build-sfx-catalog.mjs 生成,不要手改。',
  sources: [
    {set: 'root', source: existing.source, license: existing.license},
    {
      set: 'cinematic',
      source: 'Mixkit(经 video-shotcraft 筛选,Apache-2.0 仓库)',
      license: 'Mixkit Sound Effects Free License:免费商用、免署名',
      redistribution:
        '⚠️ 分发红线:Mixkit 授权**不允许把素材作为独立文件再分发**。放在本机私有项目里用没问题;' +
        '本项目若将来公开或作为 skill 分发,必须把 cinematic/ 排除出去,退化成"给下载清单 + 脚本自动拉取"。',
      attribution: 'assets/library/sfx/cinematic/ATTRIBUTION.md(逐条 URL)',
      audition: 'assets/library/sfx/cinematic/AUDITION.md(逐条时长/峰值/原名)',
    },
  ],
  categories: {...(existing.categories ?? {}), ...Object.fromEntries(Object.entries(CATS).map(([k, v]) => [k, `${v[0]} —— ${v[1]}`]))},
  verdictLegend: {
    ok: '真实物件拟音,可直接当交互拟音用',
    maybe: '偏合成但有物理感——**必须在成片语境里试听**再决定,别单听',
    no: '合成 tone / bleep / 通知音,默认不用于产品片;只有片子刻意要"系统在说话"时才用,并写进项目说明',
  },
  items: [...memeItems, ...items],
};
writeFileSync(join(SFX, 'CATALOG.json'), `${JSON.stringify(out, null, 2)}\n`, 'utf8');

const byCat = items.reduce((a, it) => ({...a, [it.cat]: (a[it.cat] ?? 0) + 1}), {});
console.log(
  `PASS sfx catalog: ${items.length} 个电影系音效 / ${Object.keys(CATS).length} 类 + ${memeItems.length} 个原有条目` +
    `(有原名 ${items.filter((i) => i.origin).length} 个,轻音 ${items.filter((i) => i.quiet).length} 个,ui 需试听 ${items.filter((i) => i.verdict && i.verdict !== 'ok').length} 个)`,
);
console.log(Object.entries(byCat).map(([k, v]) => `${k}:${v}`).join(' · '));
