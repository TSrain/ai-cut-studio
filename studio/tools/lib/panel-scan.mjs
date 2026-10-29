// 资产面板的**采集层**:把仓库扫成一个 JSON,页面只负责画。
//
// 拆出来单独一个文件是因为它有两个消费者:生成静态页时跑一次,
// 面板里点「刷新」时服务端再跑一次(上传/删除之后必须重扫,否则页面显示的是旧世界)。
//
// 扫描分两档,**别把它们混在一起**:
// - 轻扫(scanAll):只读目录名和 json,毫秒级,页面加载就要
// - 重扫(scanStorage / scanProjects):要 du 整个 13G 的 projects/,几秒到几十秒,
//   所以走独立 API 端点、按需触发、结果缓存

import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const TPL = join(ROOT, 'templates/remotion-base');
const NM = join(TPL, 'node_modules');

export const readJSON = (p, fallback = null) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
};
export const lsSafe = (p, filter = () => true) => {
  try {
    return readdirSync(p).filter(filter).sort();
  } catch {
    return [];
  }
};
/** 页面住在 assets/ 下,所有资源引用都相对它 */
export const rel = (abs) => relative(join(ROOT, 'assets'), abs).split('\\').join('/');

/**
 * 把磁盘上的文件名和手写的中文说明 + 渲好的缩略图对起来。
 *
 * **以磁盘为准,不以 JSON 为准**:JSON 里写了但文件被删了,不显示;
 * 文件在但没写说明,照样显示(只是没有中文一句话)——否则删一个文件就得同步改两处,
 * 迟早对不上。缩略图缺了也不报错,退化成纯文件名,和改动前一样。
 */
const withMeta = (files, items, key, previewId) =>
  files.map((f) => {
    const m = (items || []).find((i) => i[key] === f) || {};
    const shot = join(ROOT, 'assets/previews/library', `${previewId(f)}.jpg`);
    const pano = join(ROOT, 'assets/previews/library', `${previewId(f)}-pano.jpg`);
    return {
      file: f,
      cn: m.cn || '',
      use: m.use || '',
      character: m.character || '',
      source: m.source || '',
      license: m.license || '',
      link: m.link || '',
      shot: existsSync(shot) ? rel(shot) : null,
      pano: existsSync(pano) ? rel(pano) : null,
    };
  });

/** du -sk 的字节数。目录不存在返回 0(不抛,扫描不能因为一个缺目录就整个失败) */
export const duBytes = (p) => {
  if (!existsSync(p)) return 0;
  try {
    return Number(execFileSync('du', ['-sk', p], {encoding: 'utf8'}).split('\t')[0]) * 1024;
  } catch {
    return 0;
  }
};

export const fmtBytes = (n) => {
  if (n >= 1 << 30) return (n / (1 << 30)).toFixed(1) + ' GB';
  if (n >= 1 << 20) return (n / (1 << 20)).toFixed(0) + ' MB';
  if (n >= 1 << 10) return (n / (1 << 10)).toFixed(0) + ' KB';
  return n + ' B';
};


/**
 * 缩略图取小图。
 *
 * 原图是 1080×1920 的 PNG,一张 1MB —— 那是给"验收样张"用的分辨率,
 * 塞进面板里 96px 宽的卡片纯属浪费:七张模板图就是 7MB 首屏流量。
 * `docs/catalog/thumbnails/sm/` 是 320px 宽的 JPEG 副本(一张 ~7KB),
 * 面板一律用它;找不到才回退原图(比如刚渲出来还没生成小图)。
 * 重新生成:tools/build-thumb-smalls.sh
 */
const SM = join(ROOT, 'docs/catalog/thumbnails/sm');
const smallThumb = (absPng) => {
  const b = absPng.split('/').pop().replace(/\.png$/, '.jpg');
  const s = join(SM, b);
  return existsSync(s) ? rel(s) : rel(absPng);
};


/**
 * 控制台自己的主题令牌 —— **从当前皮肤派生,不是另挑一套**。
 *
 * 这是个排版驱动的动画系统,库里躺着 13 款正版字体和一套 OKLCH 皮肤系统,
 * 而它的控制台之前用 `-apple-system` + 一个通用蓝(#5b8cff)——长得像任何一个后台管理系统。
 *
 * 现在中性色用**和成片画面同一条明度阶梯**(见 src/lib/color.ts 的 scenePalette),
 * 色相跟着皮肤的 neutralHue 走。也就是说这里的"灰"不是通用灰,是带色相染过的灰,
 * 正是这个项目对自己画面立的规矩("底不做纯黑,要有色相")。
 * 换皮肤 → 控制台跟着变色。它是这套系统的控制台,不是一个通用后台。
 */
export function panelTheme() {
  const baseline = readJSON(join(ROOT, 'docs/presets/baseline.json'), {});
  const src = readFileSync(join(TPL, 'src/style/baseline.tsx'), 'utf8');
  const pick = (key, def) => {
    const m = new RegExp(`id: '${baseline.skin}'[\\s\\S]*?${key}: ([\\d.]+)`).exec(src);
    return m ? Number(m[1]) : def;
  };
  const accentHue = pick('accentHue', 252);
  return {
    skin: baseline.skin ?? 'abyss',
    accentHue,
    neutralHue: pick('neutralHue', accentHue),
    neutralChroma: pick('neutralChroma', 0.008),
    accentChroma: pick('accentChroma', 0.16),
  };
}

// ─────────────────────────── 轻扫:页面加载就要的东西 ───────────────────────────

const scanPresets = () =>
  lsSafe(join(ROOT, 'docs/presets'), (f) => existsSync(join(ROOT, 'docs/presets', f, 'preset.json'))).map((id) => {
    const p = readJSON(join(ROOT, 'docs/presets', id, 'preset.json'), {});
    const thumb = join(ROOT, `docs/catalog/thumbnails/remotion/preset-${id}.png`);
    // 一句话说明取 PRESET.md 的 `role:` —— 那行本来就是写给人看的"这镜干什么用"
    const md = join(ROOT, 'docs/presets', id, 'PRESET.md');
    let blurb = '';
    if (existsSync(md)) {
      const lines = readFileSync(md, 'utf8').split('\n');
      const i = lines.findIndex((l) => /^role:/.test(l));
      if (i >= 0) {
        blurb = lines[i].replace(/^role:\s*>?\s*/, '').trim();
        for (let j = i + 1; !blurb && j < lines.length && /^\s+\S/.test(lines[j]); j++) blurb += lines[j].trim() + ' ';
      }
    }
    return {
      id,
      name: p.name || id,
      version: p.version ?? '?',
      status: p.status || '?',
      duration: p.duration,
      compositionId: p.compositionId,
      tags: p.tags || [],
      blurb: blurb.slice(0, 170),
      slots: p.slots ? Object.keys(p.slots) : [],
      thumb: existsSync(thumb) ? smallThumb(thumb) : null,
    };
  });

const scanComponents = () => {
  // 18 个 Remotion 原生组件的缩略图是**它所在的样品册那一页**(一页摆 2–4 个),
  // 于是几个组件共用同一张图,看上去像 bug。按内容哈希认出同页伙伴,在卡片上写清楚。
  const hash = (p) => createHash('md5').update(readFileSync(p)).digest('hex');
  const raw = readJSON(join(ROOT, 'docs/catalog/components.json'), []) || [];

  // 「谁在用这个组件」——从 preset 源码的 import 里现算,不靠人工登记(登记的迟早会漂)。
  // 这一栏存在的理由不是好看:目录里躺着 50 个组件,而 10 个模板里只有 2 个真的 import 了组件,
  // 其余全是手搓的。这件事光看目录看不出来,标出来才治得了。
  const presetSrc = [];
  for (const id of lsSafe(join(ROOT, 'docs/presets'), (f) => existsSync(join(ROOT, 'docs/presets', f, 'preset.json')))) {
    const def = readJSON(join(ROOT, 'docs/presets', id, 'preset.json'), {});
    const src = def.componentSource && join(ROOT, def.componentSource);
    if (src && existsSync(src)) presetSrc.push({id, text: readFileSync(src, 'utf8')});
  }
  const usedByOf = (source) => {
    // src/components/visual/ChartStage.tsx → 认 import 里的 'components/visual/ChartStage'
    const m = String(source || '').match(/src\/components\/(.+)\.tsx$/);
    if (!m) return [];
    return presetSrc.filter((p) => p.text.includes(`components/${m[1]}'`)).map((p) => p.id);
  };
  const shared = new Map();
  for (const c of raw) {
    if (!c.thumbnail || !existsSync(join(ROOT, c.thumbnail))) continue;
    const h = hash(join(ROOT, c.thumbnail));
    if (!shared.has(h)) shared.set(h, []);
    shared.get(h).push(c.id);
  }
  return (
    raw
      // 5 个 preset 也登记在组件目录里(展开器要读),但它们是整镜成品不是零件,
      // 面板上有专门的「镜头模板」区,混在一起只会让人以为组件和模板是一回事
      .filter((c) => !/^Preset/.test(c.title))
      // 配方(kind:"recipe")是"几个组件按什么时序凑成一个手法",不是零件,
      // 有自己的「镜头配方」区。混进组件墙 = 同一堵墙出现两种粒度的东西。
      .filter((c) => c.kind !== 'recipe')
      .map((c) => {
        const ok = c.thumbnail && existsSync(join(ROOT, c.thumbnail));
        return {
          id: c.id,
          title: c.title,
          engine: c.engine,
          tags: c.tags || [],
          verified: !!c.verified,
          cost: c.cost,
          thumb: ok ? smallThumb(join(ROOT, c.thumbnail)) : null,
          // 卡片用 320px 小图,点开看大图要原图(1080×1920,约 1MB)—— 只在点开那一刻才加载
          full: ok ? rel(join(ROOT, c.thumbnail)) : null,
          source: c.source,
          usedBy: usedByOf(c.source),
          // 同页伙伴用**内容哈希**认(文件名各不相同但图是同一张),面板据此把同页的几个组件并成一张卡
          page: ok ? hash(join(ROOT, c.thumbnail)).slice(0, 8) : null,
          mates: ok ? shared.get(hash(join(ROOT, c.thumbnail))).filter((x) => x !== c.id) : [],
        };
      })
  );
};

// 镜头配方两层:本地层(有实现、有图、可直接用)+ 索引层(152 张外部卡,只能挑)。
// 面板把两层摆在同一区但分开两堵墙 —— 用户挑的时候需要看见"有哪些现成的"和
// "还能从哪儿挑",但必须一眼分清哪些能直接用。
const scanRecipes = () => {
  const cat = readJSON(join(ROOT, 'docs/catalog/components.json'), []) || [];
  const local = cat
    .filter((c) => c.kind === 'recipe')
    .map((c) => {
      const ok = c.thumbnail && existsSync(join(ROOT, c.thumbnail));
      return {
        id: c.id,
        title: c.title,
        tags: c.tags || [],
        thumb: ok ? smallThumb(join(ROOT, c.thumbnail)) : null,
        full: ok ? rel(join(ROOT, c.thumbnail)) : null,
        card: c.source,
        uses: c.usesComponents || [],
        camera: c.camera || 'none',
        sfx: c.usesSfx || [],
        externalRef: c.externalRef || null,
        // 参数表的第一条当"手感摘要"贴在卡上:这一栏才是配方比组件多出来的东西
        firstParam: c.params?.[0] ? `${c.params[0].name} = ${c.params[0].typical}` : null,
        pitfallCount: (c.pitfalls || []).length,
      };
    });

  const idx = readJSON(join(ROOT, 'docs/catalog/recipes-external.json'), null);
  const external = idx
    ? idx.recipes.map((r) => ({
        key: r.key,
        title: r.title,
        category: r.category,
        // 摘要在卡片上只露一行,全文在卡里 —— 面板是入口不是画册
        summary: (r.summary || '').slice(0, 64),
        fit: r.fit,
        fitNote: r.fitNote,
        poster: r.poster,
        gallery: r.gallery,
        cardPath: r.cardPath,
        localizedAs: r.localizedAs,
      }))
    : [];
  return {local, external, stats: idx?.stats ?? null, upstream: idx?.upstream ?? null};
};

const ICON_PACKS = [
  {id: 'lucide', name: 'Lucide', desc: '通用线条图标。搜索、数据库、箭头、警告……讲抽象概念时的默认来源', dir: join(NM, 'lucide-static/icons'), tone: 'stroke'},
  {id: 'simple', name: 'Simple Icons', desc: '品牌 logo 单色版。3000+ 家公司/产品,提到具体公司时用', dir: join(NM, 'simple-icons/icons'), tone: 'solid'},
  {id: 'lobehub', name: 'Lobe Icons', desc: 'AI 产品专用图标,带彩色版(-color 后缀)。OpenAI / Claude / Gemini / 通义…全都有', dir: join(NM, '@lobehub/icons-static-svg/icons'), tone: 'mixed'},
];

/**
 * 你的偏好与规矩。
 *
 * 唯一数据源是仓库里的 `memory/taste.md`。面板只展示其中明确标为“原话”的用户反馈，
 * 以及批次和章节统计；技法流水全文仍留在文件里，不倒进面板。
 */
const scanPreferences = () => {
  // taste.md 只取统计与用户原话,不倒正文
  const taste = join(ROOT, 'memory/taste.md');
  const t = existsSync(taste) ? readFileSync(taste, 'utf8') : '';
  const heads = [...t.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1]);
  const quotes = [...t.matchAll(/原话[:：]\s*[「"](.+?)[」"]/g)].map((m) => m[1]);
  const voice = quotes.map((text, index) => ({
    id: `taste-quote-${String(index + 1).padStart(3, '0')}`,
    type: 'feedback',
    text,
    why: '来自 memory/taste.md 的用户原话',
  }));
  const craft = {
    batches: heads.filter((h) => /^\d{4}-\d{2}-\d{2}/.test(h)).length,
    lines: t ? t.split('\n').length : 0,
    quotes,
    // 只列小节标题,不列条目正文 —— 想看细节去开文件
    sections: heads.filter((h) => !h.startsWith('<')),
  };

  const baseline = readJSON(join(ROOT, 'docs/presets/baseline.json'), {});
  const skinSrc = readFileSync(join(TPL, 'src/style/baseline.tsx'), 'utf8');
  const kit = new RegExp(`id: '${baseline.skin}'[\\s\\S]*?kit: '([a-z-]+)'`).exec(skinSrc)?.[1] ?? '?';
  const hue = new RegExp(`id: '${baseline.skin}'[\\s\\S]*?accentHue: (\\d+)`).exec(skinSrc)?.[1] ?? '?';

  // 「现在生效的是什么」—— 一行能答完的事实,放最上面
  const profile = [
    {k: '风格皮肤', v: `${baseline.skin ?? '?'} v${baseline.baselineVersion ?? '?'}`},
    {k: '字体套装', v: kit},
    {k: '强调色相', v: hue},
    {k: '默认画布', v: '1080×1920 · 30fps'},
    {k: '模板 / 组件', v: `${lsSafe(join(ROOT, 'docs/presets'), (f) => existsSync(join(ROOT, 'docs/presets', f, 'preset.json'))).length} 个模板 · ${(readJSON(join(ROOT, 'docs/catalog/components.json'), []) || []).length} 个组件`},
  ];

  // 硬门槛不是"偏好",是不可协商的下限——分开显示,否则你会以为它们也能改
  const gates = [
    {k: '交付评分', v: '总分 ≥80 · 任一维度 ≥6 · 英雄帧 ≥8', why: '不到线不许交付'},
    {k: '活跃时长', v: '60分钟参考预算', why: '只提示成本变化，不自动判质量失败'},
    {k: '字体', v: '禁 system-ui,禁中文静默回退', why: '默认字体自带"没做选择"的气味'},
    {k: '确定性', v: '禁 Date.now / 未播种 random / 渲染期联网', why: '否则两次渲染结果不一致,抽帧自查失效'},
    {k: '决策点', v: '全程只有一个:选 Styleframe', why: '选完自动跑完,中间不打断你'},
    {k: '付费生成', v: '万相 0.2 元/张,生成前必确认', why: 'codex 走会员不额外花钱,免确认'},
  ];

  return {profile, gates, voice, craft};
};

export function scanAll() {
  const fontsMeta = readJSON(join(ROOT, 'assets/library/fonts/FONTS.json'), {items: []});
  const FONT_DIR = join(ROOT, 'assets/library/fonts');
  const sfxMeta = readJSON(join(ROOT, 'assets/library/sfx/CATALOG.json'), {items: []});

  const refDirs = lsSafe(join(ROOT, 'docs/reference'), (f) => statSync(join(ROOT, 'docs/reference', f)).isDirectory());

  return {
    presets: scanPresets(),
    components: scanComponents(),
    recipes: scanRecipes(),
    // 字体真身在 assets/library/fonts/(全量);public/fonts/ 只放已接入 FACES 的 8 款,
    // 因为 public/ 会被整个打进每次渲染的 bundle
    fonts: fontsMeta.items
      .filter((f) => existsSync(join(FONT_DIR, f.file)))
      .map((f) => ({...f, url: rel(join(FONT_DIR, f.file)), sizeMB: +(statSync(join(FONT_DIR, f.file)).size / 1048576).toFixed(1)})),
    fontsNote: fontsMeta.wiringNote || '',
    sfx: sfxMeta.items
      .filter((s) => existsSync(join(ROOT, 'assets/library/sfx', s.file)))
      .map((s) => ({...s, url: rel(join(ROOT, 'assets/library/sfx', s.file))})),
    sfxNote: sfxMeta.note || '',
    // BGM 是 2026-08-20 新增的品类(此前本项目完全没有配乐能力)。
    // 每首旁边挂 beat-grid 算出的 BPM —— 没有 BPM 的 BGM 等于不能卡点,
    // 而"能不能卡点"正是选这首歌时唯一需要当场判断的事。
    bgm: lsSafe(join(ROOT, 'assets/library/bgm'), (f) => f.endsWith('.mp3')).map((f) => {
      const beats = readJSON(join(ROOT, 'assets/library/bgm', f.replace(/\.mp3$/, '.beats.json')), null);
      const abs = join(ROOT, 'assets/library/bgm', f);
      return {
        file: f,
        name: f.replace(/\.mp3$/, ''),
        url: rel(abs),
        sizeMB: +(statSync(abs).size / 1048576).toFixed(1),
        bpm: beats?.bpm ?? null,
        framesPerBeat: beats?.framesPerBeat ?? null,
        durationSeconds: beats?.durationSeconds ?? null,
        beatOk: beats ? beats.accepted : null,
        phaseError: beats?.meanPhaseError ?? null,
      };
    }),
    sfxSources: sfxMeta.moreFreeSources || [],
    icons: ICON_PACKS.map((p) => {
      const files = lsSafe(p.dir, (f) => f.endsWith('.svg'));
      return {id: p.id, name: p.name, desc: p.desc, tone: p.tone, base: files.length ? rel(p.dir) : null, names: files.map((f) => f.replace(/\.svg$/, ''))};
    }),
    lotties: lsSafe(join(TPL, 'public/lottie'), (f) => f.endsWith('.json')).map((f) => ({id: f.replace(/\.json$/, ''), url: rel(join(TPL, 'public/lottie', f))})),
    references: refDirs.flatMap((d) =>
      lsSafe(join(ROOT, 'docs/reference', d), (f) => /\.(png|jpg|jpeg|webp)$/i.test(f)).map((f) => ({
        group: d,
        name: f.replace(/\.[^.]+$/, ''),
        url: rel(join(ROOT, 'docs/reference', d, f)),
      })),
    ),
    library: {
      // HDRI 和材质带缩略图:文件名(qwantani_dusk_2_2k.hdr)对人是零信息量,
      // 这两类必须看图才选得动。图由 tools/build-library-previews.mjs 渲,缺图就只显示文件名。
      hdriNote: readJSON(join(ROOT, 'assets/library/hdri/HDRI.json'), {}).note || '',
      materialsNote: readJSON(join(ROOT, 'assets/library/materials/MATERIALS.json'), {}).note || '',
      hdri: withMeta(
        lsSafe(join(ROOT, 'assets/library/hdri'), (f) => f.endsWith('.hdr')),
        readJSON(join(ROOT, 'assets/library/hdri/HDRI.json'), {items: []}).items,
        'file',
        (f) => `hdri-${f.replace(/\.hdr$/, '')}`,
      ),
      materials: withMeta(
        lsSafe(join(ROOT, 'assets/library/materials'), (f) => !f.startsWith('.') && !f.endsWith('.json')),
        readJSON(join(ROOT, 'assets/library/materials/MATERIALS.json'), {items: []}).items,
        'dir',
        (f) => `mat-${f}`,
      ),
      models: lsSafe(join(ROOT, 'assets/library/models'), (f) => !f.startsWith('.')),
      // 已经登记入库的(转过码、写过说明);还在收件箱里的走「上传」区显示,两者别混
      footage: lsSafe(join(ROOT, 'assets/library/footage'), (f) => !f.startsWith('.') && f !== 'inbox'),
    },
    baseline: readJSON(join(ROOT, 'docs/presets/baseline.json'), {}),
    skinSamples: lsSafe(join(TPL, 'review/skins'), (f) => f.endsWith('.png')).map((f) => ({name: f.replace(/\.png$/, ''), url: rel(join(TPL, 'review/skins', f))})),
    prefs: scanPreferences(),
    theme: panelTheme(),
    skins: ['abyss', 'ember', 'slate', 'paper'],
  };
}


/**
 * 「做片子」表单要的全部元数据。
 *
 * **表单是算出来的,不是手写的。** 槽位的中文说明、必填与否、能不能折行,
 * `docs/presets/<id>/preset.json` 里本来就写着(它是给上游 AI 读的能力描述)。
 * 从那儿生成表单意味着:以后加第六个模板,只要 preset.json 写对了,表单自动就有,
 * 不用回来改这个文件——手写表单才是"加一个模板改两处"的那种设计。
 */
/**
 * preset.json 的 description 是写给**上游 AI** 的能力描述,里面会出现 `\n`(转义符)、
 * 字段名、facts.mode 这类只有系统内部才懂的词。原样贴到表单下面,用户会以为
 * 自己得手打反斜杠 n。这里做一次面向人的改写:能改的改,改不动的截断。
 */
const humanHint = (d) =>
  String(d ?? '')
    .replace(/支持\s*\\n\s*(手动)?折行/g, '直接按回车折行')
    .replace(/,?\s*\\n\s*折行/g, ',按回车折行')
    .replace(/\\n/g, '回车')
    .replace(/;facts\.mode[^。;]*/g, '')
    .replace(/。?\s*facts\.mode[^。]*。?/g, '')
    .trim()
    .slice(0, 110);

export function makeMeta() {
  const presets = lsSafe(join(ROOT, 'docs/presets'), (f) => existsSync(join(ROOT, 'docs/presets', f, 'preset.json'))).map((id) => {
    const p = readJSON(join(ROOT, 'docs/presets', id, 'preset.json'), {});
    const md = join(ROOT, 'docs/presets', id, 'PRESET.md');
    let role = '';
    if (existsSync(md)) {
      const lines = readFileSync(md, 'utf8').split('\n');
      const i = lines.findIndex((l) => /^role:/.test(l));
      if (i >= 0) role = lines[i].replace(/^role:\s*>?\s*/, '').trim();
    }
    const thumb = join(ROOT, `docs/catalog/thumbnails/remotion/preset-${id}.png`);
    return {
      id,
      compositionId: p.compositionId,
      name: p.name || id,
      role: role.slice(0, 120),
      thumb: existsSync(thumb) ? smallThumb(thumb) : null,
      // 预渲好的样例动效循环片。缩略图只能证明版式,时序得看动的 ——
      // 有它面板就直接播,没有就退回静图(渲:node tools/build-asset-previews.mjs --only presets)
      loop: existsSync(join(ROOT, `assets/previews/presets/${id}.mp4`))
        ? rel(join(ROOT, `assets/previews/presets/${id}.mp4`))
        : null,
      duration: p.duration ?? {min: 2, max: 6, default: 3},
      // 多画幅 preset(canvas 数组 >1)在表单里出横竖切换;output.alphaWhen 命中当前
      // variant 时导出走双通道链(ProRes4444→HEVC alpha,产物 .mov)
      canvas: Array.isArray(p.canvas) && p.canvas.length ? p.canvas : ['1080x1920'],
      output: p.output ?? null,
      // 表单初值:让人点开模板就能先「看一眼」看到东西,再改成自己的内容。
      // 不是契约,漂了不影响生产(生产走合同)
      sample: p.sample ?? null,
      // 槽位按 preset.json 的声明顺序出,必填的天然在前(写 preset.json 时就是这么排的)
      slots: Object.entries(p.slots ?? {}).map(([key, v]) => ({
        key,
        label: v.label || key,
        // asset = 从 public/<assetDir>/ 里挑一个现成文件(表单渲下拉,不让人手打文件名)
        // list = 多行文本框,一行一条(表单里不做「加一行 / 删一行」的动态控件:
        // 一个纯文本框可以整段粘贴、可以直接调顺序,比一堆小输入框顺手)
        // 槽位类型的权威名字在 tools/lib/preset.mjs 的 SLOT_TYPES(image 不叫 asset ——
        // 叫错会被 validatePresetDef 判定义不合法、进而**从 MENU 里静默消失**,
        // screen-push 就这么丢过一次)。这里 'asset' 只是表单侧的控件名。
        type:
          v.type === 'number' ? 'number'
          : v.type === 'image' || v.type === 'asset' ? 'asset'
          : v.type === 'video' ? 'footage'
          : v.type === 'list' ? 'list'
          : 'text',
        listMax: v.maxItems ?? null,
        assetDir: v.assetDir ?? null,
        // derivedFrom 的槽位由选中的素材自动填(比如源图尺寸),表单里只读显示
        derivedFrom: v.derivedFrom ?? null,
        required: !!v.required,
        multiline: (v.maxLines ?? 1) > 1,
        // hint 是给人看的一句话(preset.json 里显式写的);没写才退到把 description 改写一遍
        hint: v.hint || humanHint(v.description),
      })),
      variants: Object.entries(p.variants ?? {}).map(([key, v]) => ({
        key,
        label: v.label || key,
        values: v.values ?? [],
        def: v.default,
        hint: v.hint || humanHint(v.description),
      })),
    };
  });

  const looksFile = readJSON(join(ROOT, 'docs/presets/looks.json'), {looks: []});
  // 每个观感对每个模板各有一张缩略图 —— 观感是"皮肤 × 版式"的乘积,
  // 只给一个版式的样子等于只说了一半,你选了卡片群却看到关键概念卡就是这么来的
  const looks = (looksFile.looks ?? []).map((l) => {
    const thumbs = {};
    for (const p of presets) {
      const t = join(ROOT, 'docs/catalog/thumbnails/looks', `${p.compositionId}--${l.id}.png`);
      if (existsSync(t)) thumbs[p.compositionId] = smallThumb(t);
    }
    return {...l, thumbs};
  });

  // 品牌标记与音效只认 public/ 下的文件 —— 渲染只能读 staticFile,
  // 放在别处的图和音效渲染进程根本看不见
  const brand = lsSafe(join(TPL, 'public/brand'), (f) => /\.(png|jpg|jpeg|webp|svg)$/i.test(f));
  // 截图类素材要连真实像素尺寸一起给前端 —— KenBurns 用它把归一化焦点映射成像素坐标,
  // 让用户手输宽高是最容易填错、且填错只在末帧才看出来的那种坑
  const screens = lsSafe(join(TPL, 'public/screens'), (f) => /\.(png|jpg|jpeg|webp)$/i.test(f)).map((f) => {
    let w = 0;
    let h = 0;
    try {
      const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', join(TPL, 'public/screens', f)], {encoding: 'utf8'});
      const [a, b] = out.trim().split(',').map(Number);
      w = a || 0;
      h = b || 0;
    } catch {
      /* 探不到就给 0,表单会提示手填 */
    }
    return {file: f, w, h};
  });
  // 嵌入素材(aspect-embed 的 video 槽)同理只认 public/footage/;
  // 尺寸+时长一起给——srcW/srcH/srcDur 由选中素材自动填,手输时长是必错的坑
  const footage = lsSafe(join(TPL, 'public/footage'), (f) => /\.(mp4|mov|m4v)$/i.test(f)).map((f) => {
    let w = 0;
    let h = 0;
    let dur = 0;
    try {
      const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height:format=duration', '-of', 'json', join(TPL, 'public/footage', f)], {encoding: 'utf8'});
      const info = JSON.parse(out);
      w = info.streams?.[0]?.width || 0;
      h = info.streams?.[0]?.height || 0;
      dur = Math.round((Number(info.format?.duration) || 0) * 100) / 100;
    } catch {
      /* 探不到就给 0,表单会提示手填 */
    }
    return {file: f, w, h, dur};
  });
  const sfx = lsSafe(join(TPL, 'public/sfx'), (f) => /\.(wav|mp3|m4a)$/i.test(f));
  const sfxMeta = readJSON(join(ROOT, 'assets/library/sfx/CATALOG.json'), {items: [], presetDefaults: {}});
  const sfxNames = Object.fromEntries((sfxMeta.items ?? []).map((i) => [i.file, i.name]));
  // 收件箱里等着被装成品牌标记的图
  const inboxImages = lsSafe(join(ROOT, 'assets/inbox/images'), (f) => /\.(png|jpg|jpeg|webp|svg)$/i.test(f));

  // 导出的成片落用户的 ~/Downloads(见 panel-api 的 EXPORT_DIR),不在仓库里,
  // 所以这里没有可扫的东西 —— 面板只记本次会话导出了什么,真正的清单是访达
  const exports = [];

  return {
    presets,
    looks,
    brand,
    screens,
    footage,
    inboxImages,
    sfx: sfx.map((f) => ({file: f, name: sfxNames[f] ?? f})),
    sfxDefaults: sfxMeta.presetDefaults ?? {},
    fonts: [
      {v: 'skin', label: '跟随皮肤'},
      {v: 'smiley', label: '得意黑（力量）'},
      {v: 'archivo', label: 'Archivo（硬朗）'},
      {v: 'serif', label: '衬线（编辑感）'},
      {v: 'wenkai', label: '霞鹜文楷（手写）'},
      {v: 'noto-serif', label: '思源宋体（正统）'},
    ],
    exports,
  };
}

// ─────────────────────────── 重扫:按需触发,要 du 整个仓库 ───────────────────────────

/**
 * 存储清理的候选清单。
 *
 * **最重要的一件事:把「删了真能省」和「删了白删」分开。**
 * 项目的 node_modules 是 `cp -Rc` 的 APFS 克隆,和模板共享磁盘块——
 * `du` 每个报 900MB,29 个报 12GB,但它们绝大部分是同一份数据,删掉回收的远没那么多。
 * 面板如果照着 du 的数字说"能省 12G",那是在骗人。所以每一类都带 `reclaim` 字段:
 * 'full' = 独占,删多少省多少;'shared' = 克隆共享,实际回收远小于显示值。
 */
/** projects/ 下只有目录才是项目;README.md 之类的文件不算 */
const listProjects = () =>
  lsSafe(join(ROOT, 'projects'), (f) => !f.startsWith('.') && statSync(join(ROOT, 'projects', f)).isDirectory());

export function scanStorage() {
  const groups = [];
  const add = (g) => {
    g.items = g.items.filter((i) => i.bytes > 0);
    g.bytes = g.items.reduce((a, i) => a + i.bytes, 0);
    if (g.items.length) groups.push(g);
  };
  const projects = listProjects();

  add({
    id: 'benchmarks',
    title: '历史评测产物',
    reclaim: 'full',
    note: '盲评跑出来的中间帧和视频。评测结论已经写进文档,这些原始产物留着只是占地方——这是最值得先删的一块。',
    items: lsSafe(join(ROOT, 'benchmarks/runs')).map((f) => ({
      path: `benchmarks/runs/${f}`,
      label: f,
      bytes: duBytes(join(ROOT, 'benchmarks/runs', f)),
    })),
  });

  add({
    id: 'review-frames',
    title: '渲帧自查的中间产物',
    reclaim: 'full',
    note: '每镜自查时渲的关键帧和临时视频。成片导出后就没用了,删掉不影响任何已交付的东西。',
    items: projects.flatMap((p) =>
      ['build/review', 'build/out', 'shots'].map((sub) => ({
        path: `projects/${p}/${sub}`,
        label: `${p} · ${sub.split('/').pop()}`,
        bytes: duBytes(join(ROOT, 'projects', p, sub)),
      })),
    ),
  });

  add({
    id: 'node_modules',
    title: '各项目的 node_modules',
    reclaim: 'shared',
    note: '⚠️ 这些是模板的 APFS 克隆,和模板共享磁盘块。下面显示的是名义大小,**实际回收远小于它**。删了以后那个项目要重渲得先 npm install。除非你确定不会再动某个老项目,否则别删。',
    items: projects.map((p) => ({
      path: `projects/${p}/build/node_modules`,
      label: p,
      bytes: duBytes(join(ROOT, 'projects', p, 'build/node_modules')),
    })),
  });

  add({
    id: 'project-assets',
    title: '各项目下载/生成的素材',
    reclaim: 'full',
    note: '搜来的图、AI 生成的图、下载的音效。已进成片的会另外入库到 assets/library/,这里删掉不影响库。',
    items: projects.flatMap((p) =>
      ['assets', 'build/public'].map((sub) => ({
        path: `projects/${p}/${sub}`,
        label: `${p} · ${sub.split('/').pop()}`,
        bytes: duBytes(join(ROOT, 'projects', p, sub)),
      })),
    ),
  });

  add({
    id: 'finals',
    title: '成片(交付物)',
    reclaim: 'full',
    danger: true,
    note: '🔴 这是你的交付成果。删之前先确认已经导出到别处或者上传过了。默认不勾选。',
    items: projects.map((p) => ({
      path: `projects/${p}/out`,
      label: p,
      bytes: duBytes(join(ROOT, 'projects', p, 'out')),
    })),
  });

  add({
    id: 'misc',
    title: '其他可重建的',
    reclaim: 'full',
    note: '面板预览片跑一条命令就能重建;workspace 是学习视频的下载缓存;.trash-stale 是清理出来的死文件。',
    items: [
      {path: 'assets/previews', label: '面板预览图与运动预览片(可重建)', bytes: duBytes(join(ROOT, 'assets/previews'))},
      {path: 'workspace/learn', label: 'learn-broll 下载缓存', bytes: duBytes(join(ROOT, 'workspace/learn'))},
      {path: '.trash-stale', label: '清理出的死文件', bytes: duBytes(join(ROOT, '.trash-stale'))},
    ],
  });

  return {groups, total: groups.reduce((a, g) => a + g.bytes, 0), scannedAt: new Date().toISOString()};
}

/** 项目总览:每个项目一张卡。封面帧优先用成片首帧的静态图,没有就退到 styleframe / 关键帧 */
export function scanProjects() {
  return listProjects()
    .map((id) => {
      const dir = join(ROOT, 'projects', id);
      const finals = lsSafe(join(dir, 'out'), (f) => /\.(mp4|mov|webm)$/i.test(f)).map((f) => ({
        name: f,
        url: rel(join(dir, 'out', f)),
        bytes: statSync(join(dir, 'out', f)).size,
      }));
      // 封面按"离交付最近"的顺序找:选中的 Styleframe → 任意 styleframe → 任意关键帧
      const sfDir = join(dir, 'styleframes');
      let cover = lsSafe(sfDir, (f) => f.endsWith('.png'))[0];
      cover = cover ? rel(join(sfDir, cover)) : null;
      if (!cover) {
        const shots = lsSafe(join(dir, 'shots'), (f) => f.startsWith('shot-'));
        for (const s of shots) {
          const k = lsSafe(join(dir, 'shots', s, 'keyframes'), (f) => f.endsWith('.png'))[0];
          if (k) {
            cover = rel(join(dir, 'shots', s, 'keyframes', k));
            break;
          }
        }
      }
      const shotCount = lsSafe(join(dir, 'shots'), (f) => f.startsWith('shot-')).length;
      const log = readJSON(join(dir, 'build-log.json'), null);
      let activeMin = null;
      if (log && Array.isArray(log.events)) {
        const ev = log.events;
        const fin = ev.find((e) => e.type === 'finish');
        if (fin && typeof fin.activeSeconds === 'number') activeMin = Math.round(fin.activeSeconds / 60);
      }
      return {
        id,
        cover,
        finals,
        shotCount,
        activeMin,
        delivered: existsSync(join(dir, 'DELIVERY.md')),
        hasBrief: existsSync(join(dir, 'brief.md')),
        mtime: statSync(dir).mtimeMs,
      };
    })
    .sort((a, b) => b.id.localeCompare(a.id));
}

/** 系统体检:一屏红绿灯。每条都是"跑一次命令 / 查一个文件"能确定的事实,不做主观判断 */
export function runHealth() {
  const checks = [];
  const push = (name, ok, detail, fix) => checks.push({name, ok, detail, fix});

  // 测试。**必须把文件一个个列出来**:`node --test tools/tests/` 传目录时会被当成一个
  // 待执行文件,结果永远是"0 过 1 挂",看着像全线崩了,其实一条都没跑。
  const testFiles = lsSafe(join(ROOT, 'tools/tests'), (f) => f.endsWith('.test.mjs')).map((f) => join('tools/tests', f));
  try {
    const out = execFileSync('node', ['--test', ...testFiles], {cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000});
    const pass = /ℹ pass (\d+)/.exec(out)?.[1] ?? '?';
    const fail = /ℹ fail (\d+)/.exec(out)?.[1] ?? '?';
    push('工具链测试', fail === '0', `${pass} 过 / ${fail} 挂`, fail === '0' ? null : '跑 node --test tools/tests/ 看哪条挂了');
  } catch (e) {
    const out = (e.stdout || '') + (e.stderr || '');
    const pass = /ℹ pass (\d+)/.exec(out)?.[1] ?? '?';
    const fail = /ℹ fail (\d+)/.exec(out)?.[1] ?? '?';
    push('工具链测试', false, `${pass} 过 / ${fail} 挂`, '跑 node --test tools/tests/ 看哪条挂了');
  }

  // Remotion 全家桶版本一致性。**查已安装的版本,不查 package.json 里的范围**——
  // 声明写 ^4.0.0 而实际装的是 4.0.490 是完全正常的,拿声明去比会天天报假警;
  // 真正会炸的是 @remotion/three 和 remotion 的**实装**版本对不上(LIBRARY.md 记过这个坑)。
  const pkg = readJSON(join(TPL, 'package.json'), {});
  const declared = Object.keys({...(pkg.dependencies || {}), ...(pkg.devDependencies || {})}).filter((k) => k === 'remotion' || k.startsWith('@remotion/'));
  const installed = Object.fromEntries(declared.map((k) => [k, readJSON(join(NM, k, 'package.json'), {}).version]).filter(([, v]) => v));
  const rv = installed.remotion;
  const bad = Object.entries(installed).filter(([, v]) => v !== rv);
  push(
    'Remotion 版本一致',
    bad.length === 0,
    rv ? (bad.length ? `${bad.map(([k, v]) => k + '@' + v).join(', ')} 对不上 remotion@${rv}` : `全家桶都在 ${rv}`) : '模板还没 npm install',
    bad.length ? '跑 npx remotion upgrade(会动模板和所有历史项目,先问用户)' : null,
  );

  // 皮肤版本
  const bl = readJSON(join(ROOT, 'docs/presets/baseline.json'), {});
  push('风格皮肤', !!bl.skin, `${bl.skin ?? '未定'} · v${bl.baselineVersion ?? '?'} · ${bl.confirmedAt ?? ''}`, null);

  // preset 与组件目录是否同步
  const presetIds = lsSafe(join(ROOT, 'docs/presets'), (f) => existsSync(join(ROOT, 'docs/presets', f, 'preset.json')));
  const cat = readJSON(join(ROOT, 'docs/catalog/components.json'), []) || [];
  const catPresetCount = cat.filter((c) => /^Preset/.test(c.title)).length;
  push('模板已登记进目录', catPresetCount === presetIds.length, `${presetIds.length} 个模板 / 目录里 ${catPresetCount} 条`, catPresetCount === presetIds.length ? null : '新模板漏登记了 docs/catalog/components.json');

  // 能力菜单是否比模板旧
  const menu = join(ROOT, 'docs/presets/MENU.md');
  const newestPreset = Math.max(0, ...presetIds.map((id) => statSync(join(ROOT, 'docs/presets', id, 'preset.json')).mtimeMs));
  const menuStale = existsSync(menu) && statSync(menu).mtimeMs < newestPreset;
  push('上游能力菜单', !menuStale, menuStale ? 'MENU.md 比模板旧了' : '与模板同步', menuStale ? '跑 node tools/build-preset-menu.mjs' : null);

  // 缩略图缺失
  const missing = cat.filter((c) => c.verified && c.thumbnail && !existsSync(join(ROOT, c.thumbnail)));
  push('组件缩略图完整', missing.length === 0, missing.length ? `${missing.length} 个 verified 组件缺图` : `${cat.length} 条全有图`, missing.length ? '重渲对应样品册' : null);

  // 面板预览片是否齐
  const pvCount = lsSafe(join(ROOT, 'assets/previews'), (f) => f.endsWith('.mp4')).length;
  push('面板运动预览片', pvCount >= 12, `${pvCount} / 12 段`, pvCount >= 12 ? null : '跑 node tools/build-asset-previews.mjs');

  // 素材库缩略图:HDRI/材质少一张图,那条素材在控制台里就只剩一个没人看得懂的文件名
  const libWant = [
    ...lsSafe(join(ROOT, 'assets/library/hdri'), (f) => f.endsWith('.hdr')).map((f) => `hdri-${f.replace(/\.hdr$/, '')}.jpg`),
    ...lsSafe(join(ROOT, 'assets/library/materials'), (f) => !f.startsWith('.') && !f.endsWith('.json')).map((d) => `mat-${d}.jpg`),
  ];
  const libMissing = libWant.filter((f) => !existsSync(join(ROOT, 'assets/previews/library', f)));
  push(
    '素材库样品球',
    libMissing.length === 0,
    libMissing.length ? `${libMissing.length} / ${libWant.length} 张缺图` : `${libWant.length} 条全有图`,
    libMissing.length ? '跑 node tools/build-library-previews.mjs' : null,
  );

  // 个人素材库供料情况(不是错误,是提醒)
  const pending = lsSafe(join(ROOT, 'assets/inbox/footage'), (f) => !f.startsWith('.')).length;
  const stocked = lsSafe(join(ROOT, 'assets/library/footage'), (f) => !f.startsWith('.') && f !== 'inbox').length;
  push('个人视频素材库', true, pending ? `收件箱里有 ${pending} 个待登记,已入库 ${stocked} 个` : stocked ? `已入库 ${stocked} 个` : '空 —— 想让 b-roll 出现真实画面,去「上传」区传几段', null);

  return {checks, ranAt: new Date().toISOString()};
}

/** 成片库:所有项目 out/ 下的视频,按项目分组 */
/**
 * 所有视频产物,带「成品 / 单次产物」判定。
 *
 * **判定按项目是否已交付(有 DELIVERY.md),不按文件名。**
 * 这个项目大部分交付物是 b-roll 批次 —— 一批十几支单镜插片整批交出去,
 * 它们就是成品。按文件名判(只认 final*.mp4)的话 48 支里只有 3 支算成品,
 * 会把你真正交出去的东西全归成"单次产物",那是拿工具的内部命名当业务事实。
 */
export function scanFinals() {
  // 「做片子」导出的成片不在这里 —— 它们直接落用户的 ~/Downloads,
  // 归用户管,不算这套系统的产物(所以也不该占「成片库」和「存储清理」的位置)
  const out = [];
  for (const p of listProjects()) {
    const delivered = existsSync(join(ROOT, 'projects', p, 'DELIVERY.md'));
    for (const f of lsSafe(join(ROOT, 'projects', p, 'out'), (x) => /\.(mp4|mov|webm)$/i.test(x))) {
      const abs = join(ROOT, 'projects', p, 'out', f);
      const st = statSync(abs);
      out.push({project: p, delivered, name: f, url: rel(abs), path: `projects/${p}/out/${f}`, bytes: st.size, mtime: st.mtimeMs});
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}
