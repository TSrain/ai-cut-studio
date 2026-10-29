#!/usr/bin/env node
// tools/build-hyperframes-gallery.mjs
//
// 用途:把 `hyperframes add` 装进 templates/hyperframes-base 的 registry 条目
// 全部摆上一条时间线,生成两个可渲染的样品册:
//
//   registry-gallery.html   —— 每个 block(以及带自己 composition-id+timeline 的
//                              "伪 block" 组件,如 morph-text)占一段互不重叠的
//                              时间,通过 data-composition-src 挂载。
//   component-gallery.html  —— 纯片段型 component(只有 HTML/CSS/JS,没有自己的
//                              composition-id)按 Registry 的说明合并进一个宿主:
//                              HTML 进各自的 panel,CSS 进宿主 <style>,JS 进宿主
//                              <script>,再由宿主时间线驱动它们的 timeline 调用。
//
// 用法:
//   node tools/build-hyperframes-gallery.mjs
//
// 踩过的坑,别再踩:
//   1. `hyperframes check` / `snapshot` 只认 <项目目录>/index.html,不接受
//      --composition(那是 render 专属)。所以本脚本额外生成两个"检查用外壳
//      目录" gallery-registry/ 与 gallery-component/:里面的 index.html 是
//      gallery 的副本,compositions / assets / models 是指回上层的**硬链接**
//      (软链接不行,见 buildHarness 的注释)。不这么做就只能改 index.html,
//      而 index.html 是已验收的模板,不许动。
//   5. 有些 block 的脚本在被当作 sub-composition 挂载时会抛
//      "TypeError: Illegal invocation",整块脚本不执行、canvas 停在初始帧。
//      这类块只有当自己就是 index.html(即 gallery-solo/<id>/)时才活,
//      留在组合 gallery 里只会让 `check` 报 runtime error 并 exit 1。
//      它们登记在 REGISTRY_GALLERY_EXCLUDE(每条附实测理由),
//      **只从组合 gallery 里排除,solo 宿主照建照抓图**。
//   2. 宿主 CSS 一律 sRGB hex。oklch() 会让 check 的 WCAG 对比度审计静默跳过
//      并照样打印 "Check passed"(实测:同一文件 sRGB 版 40 项、oklch 版 0 项)。
//   3. 字体只引 assets/fonts/ 里的本地文件,不引 CDN。
//   4. 有几个 registry block 内部 composition-id 都叫 "main"(cinematic-zoom /
//      domain-warp-dissolve 等)。运行时靠 __hf<n> 后缀去重,
//      但宿主这边必须原样写 "main" —— 宿主的 data-composition-id 是查 timeline
//      的键,改名就挂不上(sub-compositions.md Pitfall 2)。
import {readFile, writeFile, mkdir, readdir, rm, copyFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = path.join(REPO, 'templates/hyperframes-base');
const BLOCKS_DIR = path.join(BASE, 'compositions');
const COMPONENTS_DIR = path.join(BLOCKS_DIR, 'components');

const STAGE_W = 1920;
const STAGE_H = 1080;

/* ------------------------------------------------------------------ *
 * 组合 gallery 排除清单
 * ------------------------------------------------------------------ *
 * 键 = compositions/<键>.html 的文件名;值 = 为什么它不能和别的块共存。
 * 这里只影响 registry-gallery.html(组合宿主),**不影响 gallery-solo/**:
 * 被排除的条目照样各自建一个单块宿主并在那里抓缩略图。
 *
 * 加新条目到这份清单前,先确认它是"证明会让整册 check exit 1",不是"这一帧不好看"——
 * 后者应该调 SOLO_UNDERLAY 的 snapAt,而不是从组合 gallery 里删。
 * 判据只有一条:**把它挂回去,`npx hyperframes check gallery-registry` 从 passed 变 failed**。
 * 反例(别凭家族猜):liquid-glass-widgets / vfx-shatter / vfx-text-cursor 也是 html-in-canvas 块,
 * 一度按"同族必炸"被排除,实测挂回去 check 照样 passed —— 它们只贡献 contrast **warning**,
 * 不是 error,所以留在册里。
 */
const REGISTRY_GALLERY_EXCLUDE = {
  'cinematic-zoom':
    '实测:通过 data-composition-src 挂载时内联脚本死于 TypeError: Illegal invocation,' +
    '__timelines["main"] 从不注册,WebGL 画布停在第 0 帧;同一文件当 index.html 独立跑正常。',
  'domain-warp-dissolve':
    '实测:同 cinematic-zoom —— 挂载即 Illegal invocation、时间线不注册、shader 画布不绘制;' +
    '独立运行正常,缩略图取自 gallery-solo/domain-warp-dissolve。',
  'vfx-liquid-background':
    '实测:唯一一个在组合宿主里仍抛 page_error "Illegal invocation" 的块(solo 宿主里同样抛,' +
    '但 solo 里只污染它自己那一份检查)。留在组合 gallery 里会让整册 check 永远 exit 1。',
  'vfx-iphone-device':
    '实测:组合 gallery 的全部 23 个 layout content_overlap 错误都落在它的时间段(101.5–116.5s)。' +
    '它是 html-in-canvas 块 —— 手机屏/笔记本屏的 HTML 源面板叠在一起当纹理采样,' +
    '屏幕上永远不会同时出现,但 layout 审计只看 DOM 盒子,判成"两块文字重叠"。' +
    'solo 宿主里它自己就有 67 个 layout + 75 个 motion 错误,属于块自带,不是本宿主造成的。',
  'vfx-portal':
    '实测:挂进组合 gallery 后新增 20 个 layout content_overlap(t=101.7–111.3s)+ 4 个 contrast 错误。' +
    '它把亮色页面和暗色页面两份 HTML 源面板叠在同一位置当纹理,屏幕上由传送门遮罩二选一,' +
    'layout 审计看不到遮罩,判成"每一行文字都和自己重叠"。',
  flowchart:
    '实测:收尾的 #fade-overlay 盖住全部节点文字,layout 审计报 11 个 text_occluded + 1 个 contrast 1:1。' +
    '那是这个块自己的淡出设计(该时刻本来就该看不见字),但审计不区分"被设计成看不见"和"被压住看不见"。',
  'flowchart-vertical':
    '同 flowchart(同一个块的竖版孪生,同样带收尾 #fade-overlay)。' +
    '它在某些采样时刻侥幸没被抽到,但采样点会随时间线总长漂移 —— 留着就是随机 exit 1,所以一并移出。',
  'morph-text':
    '实测:content_overlap #morph-a inside #morph-b。这个块的 gooey 变形**就是**靠两段文字同位叠放 + SVG 阈值滤镜实现的,' +
    '重叠是效果本身而不是缺陷;layout 审计只看两个文字盒子相交。',
};

/* ------------------------------------------------------------------ *
 * solo 宿主的底图与抓帧时刻
 * ------------------------------------------------------------------ *
 * 有两个 block 是**叠加层**(闪白 / 给定格画面加装饰),自身不产生画面主体。
 * 不垫底图就只能渲出"全白"或"装饰件围着一块空底板",按判定标准算空白 → 不合格。
 * 这不是块坏了,是审计装置少给了它们一张底下的画面。
 *
 * backdrop 走**构建期内联 data URI**(读的是 remotion-base 里已存在的确定性占位图),
 * 不往 templates/hyperframes-base/assets/ 里加文件 —— 那个目录是已验收模板的一部分。
 *
 * snapAt 必须显式给:这两块的动作发生在自己时间线的特定瞬间,
 * 机械取"中点"会落在动作之外(editorial-flash 的闪白 hit = duration*0.58,4s 块的中点 2.0s 什么都没有)。
 */
const BACKDROP_SRC = path.join(REPO, 'templates/remotion-base/public/catalog/photo-01.svg');

const SOLO_UNDERLAY = {
  'editorial-flash-overlay': {
    snapAt: 2.46,
    why:
      '闪白 hit = duration*0.58 = 2.32s,wash 在 hit+0.04 起用 0.18s 退场。' +
      '2.46s 取的是"白已经退掉一半、core 光斑与 sweep 斜光带还在"的那一帧 —— ' +
      '再早只有一片白(看不出叠在什么上),再晚效果已经没了。',
  },
  'freeze-frame-dressing': {
    snapAt: 2.0,
    why:
      'hit = duration*0.24 = 0.96s,纸面 0.64 不透明度从 1.0s 持续到 exit=3.7s,' +
      '两条胶带分别在 1.26s / 1.38s 落位。2.0s 是纸 + 两条胶带全部到位、闪白已退的稳定段。',
  },
};

/* ------------------------------------------------------------------ *
 * 共享外壳:本地字体 + sRGB 色板(与 index.html 的令牌保持一致)
 * ------------------------------------------------------------------ */
const SHELL_CSS = `
      @font-face {
        font-family: "Smiley Sans";
        src: url("assets/fonts/SmileySans-Oblique.ttf") format("truetype");
        font-weight: 400;
        font-display: block;
      }
      @font-face {
        font-family: "Archivo";
        src: url("assets/fonts/Archivo-VF.ttf") format("truetype");
        font-weight: 100 900;
        font-display: block;
      }
      @font-face {
        font-family: "Noto Sans SC";
        src: url("assets/fonts/NotoSansSC-VF.ttf") format("truetype");
        font-weight: 100 900;
        font-display: block;
      }
      @font-face {
        font-family: "JetBrains Mono";
        src: url("assets/fonts/JetBrainsMono-VF.ttf") format("truetype");
        font-weight: 100 800;
        font-display: block;
      }
      /* sRGB only — 见文件头第 2 条 */
      :root {
        --ink-0: #040b17;
        --ink-1: #0c1929;
        --paper-0: #f2f5fb;
        --accent: #ffaa2e;
      }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body {
        width: ${STAGE_W}px;
        height: ${STAGE_H}px;
        overflow: hidden;
        background: #040b17;
      }
      #stage {
        position: relative;
        width: ${STAGE_W}px;
        height: ${STAGE_H}px;
        background: #040b17;
        overflow: hidden;
      }
      .hf-label {
        position: absolute;
        left: 32px;
        bottom: 28px;
        z-index: 9000;
        padding: 12px 22px;
        background: #040b17;
        border-left: 6px solid #ffaa2e;
        color: #f2f5fb;
        font-family: "JetBrains Mono", monospace;
        font-weight: 600;
        font-size: 30px;
        letter-spacing: 0.02em;
        line-height: 1.2;
        white-space: nowrap;
      }
      .hf-label b { color: #ffaa2e; font-weight: 700; }
`;

function shell({title, compositionId, duration, body, extraCss = '', scripts = ''}) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${STAGE_W}, height=${STAGE_H}" />
    <title>${title}</title>
    <!-- 本地 GSAP,不走 CDN:渲染期网络请求 = 不确定性 -->
    <script src="assets/vendor/gsap.min.js"></script>
    <style>${SHELL_CSS}${extraCss}
    </style>
  </head>
  <body>
    <div
      id="stage"
      data-composition-id="${compositionId}"
      data-root="true"
      data-start="0"
      data-duration="${duration}"
      data-width="${STAGE_W}"
      data-height="${STAGE_H}"
    >
${body}
    </div>
${scripts}
  </body>
</html>
`;
}

/* ------------------------------------------------------------------ *
 * 解析已安装文件
 * ------------------------------------------------------------------ */
function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
}

/** 找到文件里第一个带 data-composition-id 的元素开标签 */
function rootTag(html) {
  const m = html.match(/<(?:div|section|main)[^>]*data-composition-id="[^"]+"[^>]*>/);
  return m ? m[0] : null;
}

async function readMountable(file) {
  const html = await readFile(file, 'utf8');
  const tag = rootTag(html);
  if (!tag) return null;
  const id = attr(tag, 'data-composition-id');
  const width = Number(attr(tag, 'data-width') ?? STAGE_W);
  const height = Number(attr(tag, 'data-height') ?? STAGE_H);
  const duration = Number(attr(tag, 'data-duration') ?? 5);
  if (!id || !Number.isFinite(duration) || duration <= 0) return null;
  return {id, width, height, duration};
}

/* ------------------------------------------------------------------ *
 * Gallery 1 —— blocks
 * ------------------------------------------------------------------ */
function slotStyle(width, height) {
  // 把任意尺寸的 block 等比塞进 1920×1080 舞台,居中。
  const scale = Math.min(STAGE_W / width, STAGE_H / height);
  const left = Math.round((STAGE_W - width) / 2);
  const top = Math.round((STAGE_H - height) / 2);
  const t = scale === 1 ? '' : ` transform: scale(${scale.toFixed(4)}); transform-origin: 50% 50%;`;
  return `position: absolute; left: ${left}px; top: ${top}px; width: ${width}px; height: ${height}px; overflow: hidden;${t}`;
}

async function buildBlockGallery() {
  const files = (await readdir(BLOCKS_DIR)).filter((f) => f.endsWith('.html')).sort();
  const extras = [];
  // 片段目录里可能混着"其实是完整 block"的条目(morph-text 就是),它们有自己的
  // composition-id 和 __timelines 注册,只能当 sub-composition 挂,不能当片段粘。
  for (const entry of await readdir(COMPONENTS_DIR, {withFileTypes: true})) {
    const file = entry.isDirectory()
      ? path.join(COMPONENTS_DIR, entry.name, `${entry.name}.html`)
      : path.join(COMPONENTS_DIR, entry.name);
    if (!file.endsWith('.html') || !existsSync(file)) continue;
    const html = await readFile(file, 'utf8');
    if (rootTag(html) && html.includes('__timelines')) extras.push(file);
  }

  const items = [];
  const excluded = [];
  let cursor = 0;
  for (const file of [...files.map((f) => path.join(BLOCKS_DIR, f)), ...extras]) {
    const meta = await readMountable(file);
    if (!meta) {
      console.warn(`  ! 跳过(没有 composition 根节点): ${path.relative(BASE, file)}`);
      continue;
    }
    const name = path.basename(file, '.html');
    const src = path.relative(BASE, file).split(path.sep).join('/');
    const base = {
      name,
      src,
      compositionId: meta.id,
      width: meta.width,
      height: meta.height,
      duration: meta.duration,
    };
    if (REGISTRY_GALLERY_EXCLUDE[name]) {
      excluded.push({...base, reason: REGISTRY_GALLERY_EXCLUDE[name]});
      console.warn(`  - 排除出组合 gallery(仍建 solo): ${name}`);
      continue;
    }
    items.push({
      ...base,
      start: Number(cursor.toFixed(3)),
      midpoint: Number((cursor + meta.duration / 2).toFixed(3)),
    });
    cursor += meta.duration;
  }

  const total = Number(cursor.toFixed(3));
  const body = items
    .map(
      (item) => `      <!-- ${item.name} -->
      <div
        class="clip"
        data-composition-id="${item.compositionId}"
        data-composition-src="${item.src}"
        data-start="${item.start}"
        data-duration="${item.duration}"
        data-track-index="1"
        data-width="${item.width}"
        data-height="${item.height}"
        style="${slotStyle(item.width, item.height)}"
      ></div>
      <div
        class="clip hf-label"
        data-start="${item.start}"
        data-duration="${item.duration}"
        data-track-index="2"
      ><b>${item.name}</b> · ${item.width}×${item.height} · ${item.duration}s</div>`,
    )
    .join('\n');

  const scripts = `    <script>
      // 宿主自己没有内容动画:sub-composition 的时间线由运行时独立 seek,
      // 宿主只需要声明一条覆盖全长的 paused 时间线(sub-compositions.md)。
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({paused: true});
      tl.set(document.getElementById("stage"), {}, ${total});
      window.__timelines["registry-gallery"] = tl;
    </script>`;

  const html = shell({
    title: 'HyperFrames Registry Gallery — blocks',
    compositionId: 'registry-gallery',
    duration: total,
    body,
    scripts,
  });
  await writeFile(path.join(BASE, 'registry-gallery.html'), html, 'utf8');
  return {items, excluded, total};
}

/* ------------------------------------------------------------------ *
 * Gallery 2 —— 片段型 component
 * ------------------------------------------------------------------ *
 * 每个片段一个 6 秒的 panel。panel 里的"被作用对象"是本脚本写的样品内容
 * (卡片网格 / 大字 / 色块),因为片段本身不自带主体 —— 没有主体就只能看见
 * 一张空图,那正是判定标准里的"空白"。
 */
const PANEL = 6;

/** 每个片段的样品:主体 HTML + 宿主时间线里的调用。t 是 panel 起点(秒)。 */
const COMPONENT_SPECS = {
  'grain-overlay': {
    subject: `
        <div class="demo-fill demo-warm"></div>
        <div class="demo-title">GRAIN</div>`,
    timeline: () => '',
  },
  vignette: {
    // 标题必须放在**画面正中**:vignette 的暗角就是压在四角的,
    // 放左上角会被 rgba(0,0,0,0.85) 盖住 —— check 的 text_occluded 会直接判 error(实测)。
    subject: `
        <div class="demo-fill demo-bright"></div>
        <div class="demo-center"><span class="demo-title demo-dark">VIGNETTE</span></div>`,
    timeline: (t) =>
      `      tl.fromTo("#hf-vignette", {"--vignette-color": "rgba(0,0,0,0)"}, {"--vignette-color": "rgba(0,0,0,0.85)", duration: 2, ease: "power2.out"}, ${t});`,
  },
  'grid-pixelate-wipe': {
    subject: `
        <div class="demo-fill demo-cool"></div>
        <div class="demo-title">PIXELATE WIPE</div>`,
    timeline: (t) =>
      `      tl.fromTo("#grid-pixelate-overlay .grid-cell", {scale: 0}, {scale: 1, duration: 2.4, stagger: {amount: 2.2, from: "edges"}, ease: "power2.inOut"}, ${t + 0.6});`,
  },
  'shimmer-sweep': {
    subject: `
        <div class="demo-fill demo-ink"></div>
        <div class="demo-center"><span class="demo-title shimmer-sweep-target">SHIMMER</span></div>`,
    timeline: (t) =>
      `      tl.fromTo(".shimmer-sweep-target", {"--shimmer-pos": "-20%"}, {"--shimmer-pos": "120%", duration: 4, ease: "none"}, ${t + 0.5});`,
  },
  'parallax-zoom': {
    subject: `
        <div class="demo-fill demo-ink"></div>
        <div class="demo-center">
          <div class="parallax-zoom-grid demo-grid">
${cards('pz', 'parallax-zoom-card')}
          </div>
        </div>`,
    timeline: (t) =>
      `      tl.fromTo(".parallax-zoom-grid", {"--pz-progress": 0}, {"--pz-progress": 1, duration: 4, ease: "power2.inOut"}, ${t + 1});`,
  },
  'parallax-unzoom': {
    subject: `
        <div class="demo-fill demo-ink"></div>
        <div class="demo-center">
          <div class="parallax-unzoom-grid demo-grid">
${cards('pu', 'parallax-unzoom-card')}
          </div>
        </div>`,
    timeline: (t) =>
      `      tl.fromTo(".parallax-unzoom-grid", {"--pu-progress": 0}, {"--pu-progress": 1, duration: 4, ease: "power2.inOut"}, ${t + 1});`,
  },
  // motion-blur 已从目录移除:它的拖影来自**相邻帧位置差**,单点 seek 天然产生不了
  // 任何模糊,违反"任意一帧必须能独立算出来"。不是渲染装置的问题,不要再加回来。
  'texture-mask-text': {
    subject: `
        <div class="demo-fill demo-warm"></div>
        <div class="demo-center">
          <div class="demo-title hf-texture-text hf-texture-concrete-034">TEXTURE</div>
        </div>`,
    timeline: () => '',
  },
};

function cards(prefix, className) {
  const out = [];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const focus = row === 1 && col === 1 ? ` data-${prefix}-focus="true"` : '';
      out.push(
        `            <div class="${className} demo-card" data-${prefix}-row="${row}" data-${prefix}-col="${col}"${focus}>${row * 3 + col + 1}</div>`,
      );
    }
  }
  return out.join('\n');
}

const DEMO_CSS = `
      .demo-panel { position: absolute; inset: 0; overflow: hidden; }
      .demo-fill { position: absolute; inset: 0; }
      .demo-warm { background: linear-gradient(135deg, #ffaa2e 0%, #c46d00 55%, #40260a 100%); }
      .demo-cool { background: linear-gradient(135deg, #2f6fb8 0%, #123055 60%, #040b17 100%); }
      .demo-bright { background: linear-gradient(135deg, #f2f5fb 0%, #c3cbd6 100%); }
      .demo-ink { background: linear-gradient(135deg, #1c2c41 0%, #040b17 100%); }
      .demo-center {
        position: absolute; inset: 0;
        display: flex; align-items: center; justify-content: center;
        /* 必须高于 vignette 片段的 z-index:90(它整块铺满 panel)。
           不抬层的话 check 的 layout 审计判 text_occluded = error,即使 vignette
           中心其实是透明的 —— 审计只比较元素盒子与层级,不采像素。 */
        z-index: 95;
      }
      .demo-title {
        position: absolute; left: 96px; top: 96px;
        font-family: "Archivo", "Noto Sans SC", sans-serif;
        font-weight: 800; font-size: 132px; letter-spacing: -0.02em;
        color: #f2f5fb;
      }
      .demo-title.demo-dark { color: #040b17; }
      .demo-center .demo-title { position: static; }
      .demo-grid {
        display: grid; grid-template-columns: repeat(3, 300px);
        grid-template-rows: repeat(3, 200px); gap: 28px;
      }
      .demo-card {
        display: flex; align-items: center; justify-content: center;
        background: #f2f5fb; color: #040b17; border: 8px solid #ffaa2e;
        border-radius: 18px;
        font-family: "Archivo", sans-serif; font-weight: 800; font-size: 84px;
      }
      #mb-box {
        position: absolute; left: 810px; top: 440px;
        width: 300px; height: 200px; border-radius: 24px;
        background: #ffaa2e;
      }
`;

/** 从片段文件里拆出 markup / style / script 三部分(Registry 的合并说明) */
function splitSnippet(html) {
  const styles = [];
  const scripts = [];
  let rest = html;
  rest = rest.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_, css) => {
    styles.push(css);
    return '';
  });
  rest = rest.replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, (_, js) => {
    scripts.push(js);
    return '';
  });
  rest = rest.replace(/<!--[\s\S]*?-->/g, '');
  return {markup: rest.trim(), styles, scripts};
}

async function buildComponentGallery() {
  const names = Object.keys(COMPONENT_SPECS);
  const panels = [];
  const styles = [];
  const scripts = [];
  const timelineCalls = [];
  const postCalls = [];
  const items = [];

  let cursor = 0;
  for (const name of names) {
    const file = existsSync(path.join(COMPONENTS_DIR, `${name}.html`))
      ? path.join(COMPONENTS_DIR, `${name}.html`)
      : path.join(COMPONENTS_DIR, name, `${name}.html`);
    if (!existsSync(file)) {
      console.warn(`  ! 片段缺失,跳过: ${name}`);
      continue;
    }
    const spec = COMPONENT_SPECS[name];
    const {markup, styles: css, scripts: js} = splitSnippet(await readFile(file, 'utf8'));
    styles.push(`/* ===== ${name} ===== */\n${css.join('\n')}`);
    for (const chunk of js) scripts.push(`/* ===== ${name} ===== */\n${chunk}`);

    const start = Number(cursor.toFixed(3));
    panels.push(`      <!-- ${name} -->
      <div
        class="clip demo-panel"
        data-start="${start}"
        data-duration="${PANEL}"
        data-track-index="1"
      >${spec.subject}
${markup
  .split('\n')
  .map((line) => (line.trim() ? `        ${line.trim()}` : ''))
  .filter(Boolean)
  .join('\n')}
      </div>
      <div
        class="clip hf-label"
        data-start="${start}"
        data-duration="${PANEL}"
        data-track-index="2"
      ><b>${name}</b> · component snippet</div>`);

    const call = spec.timeline(start);
    if (call) timelineCalls.push(call);
    if (spec.post) postCalls.push(spec.post);

    items.push({
      name,
      src: 'component-gallery.html',
      compositionId: 'component-gallery',
      width: STAGE_W,
      height: STAGE_H,
      start,
      duration: PANEL,
      midpoint: Number((start + PANEL / 2).toFixed(3)),
    });
    cursor += PANEL;
  }

  const total = Number(cursor.toFixed(3));
  const scriptBlock = `    <script>
${scripts.join('\n')}
    </script>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({paused: true});
${timelineCalls.join('\n')}
      // 把时间线补到 data-duration,否则 seek 到末尾时回调收不到(见 motion-blur 注释)
      tl.set(document.getElementById("stage"), {}, ${total});
${postCalls.join('\n')}
      window.__timelines["component-gallery"] = tl;
    </script>`;

  const html = shell({
    title: 'HyperFrames Registry Gallery — components',
    compositionId: 'component-gallery',
    duration: total,
    body: panels.join('\n'),
    extraCss: `${DEMO_CSS}\n${styles.join('\n')}`,
    scripts: scriptBlock,
  });
  await writeFile(path.join(BASE, 'component-gallery.html'), html, 'utf8');
  return {items, total};
}

/* ------------------------------------------------------------------ *
 * 检查用外壳目录(见文件头第 1 条)
 * ------------------------------------------------------------------ */
async function buildHarness(dirName, galleryFile) {
  const dir = path.join(BASE, dirName);
  await rm(dir, {recursive: true, force: true});
  await mkdir(dir, {recursive: true});
  await copyFile(path.join(BASE, galleryFile), path.join(dir, 'index.html'));
  await copyFile(path.join(BASE, 'hyperframes.json'), path.join(dir, 'hyperframes.json'));
  // 用硬链接而不是软链接:`hyperframes` 的打包器读软链接目录里的
  // sub-composition 会当成空文件("Skipping sub-composition: the file is empty"),
  // 20 个 block 会被一声不吭地全部丢掉,渲出来是一张纯黑图。硬链接没有这个问题,
  // 也不会把 26MB 素材复制两份。
  for (const link of ['compositions', 'assets', 'models']) {
    const src = path.join(BASE, link);
    if (!existsSync(src)) continue;
    try {
      execFileSync('cp', ['-al', src, path.join(dir, link)]);
    } catch {
      execFileSync('cp', ['-R', src, path.join(dir, link)]);
    }
  }
}

/* ------------------------------------------------------------------ *
 * 单条目外壳(solo harness)
 * ------------------------------------------------------------------ *
 * 为什么需要它:好几个 registry block(whip-pan / light-leak / cinematic-zoom /
 * domain-warp-dissolve / freeze-frame-dressing / editorial-flash-overlay)在脚本
 * 执行的那一刻,用 getBoundingClientRect() 把自己的 DOM 场景"拍"进 canvas 当纹理。
 * 在拼接式 gallery 里,这些 block 挂载时 data-start 还没到、clip 是隐藏的,所有
 * rect 都是 0×0,于是纹理只剩背景色 —— 渲出来是一张纯色图。把它单独放在 t=0
 * 的宿主里就正常。这不是 block 坏了,是"挂载即隐藏"与"挂载时截图"冲突。
 */
async function buildSoloHarness(item, backdropUri) {
  const dir = path.join(BASE, 'gallery-solo', item.name);
  await rm(dir, {recursive: true, force: true});
  await mkdir(dir, {recursive: true});

  // 叠加层专用底图:track-index 0,全程铺满,盖住宿主的深底。
  // 用 background-image + data URI(见 SOLO_UNDERLAY 注释:不往 assets/ 加文件)。
  const underlay = SOLO_UNDERLAY[item.name]
    ? `      <div
        class="clip hf-underlay"
        data-start="0"
        data-duration="${item.duration}"
        data-track-index="0"
        style="position: absolute; inset: 0; background-image: url('${backdropUri}'); background-size: cover; background-position: 50% 42%;"
      ></div>
`
    : '';

  const html = shell({
    title: `HyperFrames Registry — ${item.name}`,
    compositionId: 'solo-gallery',
    duration: item.duration,
    body: `${underlay}      <div
        class="clip"
        data-composition-id="${item.compositionId}"
        data-composition-src="${item.src}"
        data-start="0"
        data-duration="${item.duration}"
        data-track-index="1"
        data-width="${item.width}"
        data-height="${item.height}"
        style="${slotStyle(item.width, item.height)}"
      ></div>
      <div
        class="clip hf-label"
        data-start="0"
        data-duration="${item.duration}"
        data-track-index="2"
      ><b>${item.name}</b> · ${item.width}×${item.height} · ${item.duration}s</div>`,
    scripts: `    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({paused: true});
      tl.set(document.getElementById("stage"), {}, ${item.duration});
      window.__timelines["solo-gallery"] = tl;
    </script>`,
  });
  await writeFile(path.join(dir, 'index.html'), html, 'utf8');
  await copyFile(path.join(BASE, 'hyperframes.json'), path.join(dir, 'hyperframes.json'));
  for (const link of ['compositions', 'assets', 'models']) {
    const src = path.join(BASE, link);
    if (!existsSync(src)) continue;
    try {
      execFileSync('cp', ['-al', src, path.join(dir, link)]);
    } catch {
      execFileSync('cp', ['-R', src, path.join(dir, link)]);
    }
  }
}

/* ------------------------------------------------------------------ */
async function main() {
  console.log('building registry-gallery.html …');
  const blocks = await buildBlockGallery();
  console.log(`  ${blocks.items.length} mounts, ${blocks.total}s`);

  console.log('building component-gallery.html …');
  const components = await buildComponentGallery();
  console.log(`  ${components.items.length} panels, ${components.total}s`);

  await buildHarness('gallery-registry', 'registry-gallery.html');
  await buildHarness('gallery-component', 'component-gallery.html');

  const backdropUri = `data:image/svg+xml;base64,${(await readFile(BACKDROP_SRC)).toString('base64')}`;
  const soloItems = [...blocks.items, ...blocks.excluded];
  await rm(path.join(BASE, 'gallery-solo'), {recursive: true, force: true});
  for (const item of soloItems) await buildSoloHarness(item, backdropUri);
  console.log(`  ${soloItems.length} solo harnesses under gallery-solo/`);

  const timing = {
    registry: {file: 'registry-gallery.html', harness: 'gallery-registry', ...blocks},
    component: {file: 'component-gallery.html', harness: 'gallery-component', ...components},
    solo: {
      dir: 'gallery-solo',
      items: soloItems.map((item) => {
        const under = SOLO_UNDERLAY[item.name];
        return {
          name: item.name,
          duration: item.duration,
          // 默认取中点;叠加层按 SOLO_UNDERLAY.snapAt 显式指定(理由见 why)
          snapAt: under ? under.snapAt : Number((item.duration / 2).toFixed(3)),
          underlay: Boolean(under),
          ...(under ? {snapReason: under.why} : {}),
          ...(item.reason ? {excludedFromRegistryGallery: item.reason} : {}),
        };
      }),
    },
  };
  await writeFile(
    path.join(BASE, 'gallery-timing.json'),
    `${JSON.stringify(timing, null, 2)}\n`,
    'utf8',
  );

  console.log('\nmidpoints (registry):');
  console.log(`  --at ${blocks.items.map((i) => i.midpoint).join(',')}`);
  console.log('midpoints (component):');
  console.log(`  --at ${components.items.map((i) => i.midpoint).join(',')}`);
}

main().catch((error) => {
  console.error(`FAIL build gallery: ${error.message}`);
  process.exit(1);
});
