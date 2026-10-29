#!/usr/bin/env node
// 「控制台」——这个项目的唯一操作入口。
//
// 它经历过三代:
//   v1 是一张 markdown 路标表(docs/ASSETS-MAP.md),只回答"东西在哪个文件夹";
//   v2 是一页只读画册,把字体渲成样句、运镜渲成动图、音效变成播放器;
//   v3(现在)是一个**能改磁盘的本地控制台**:上传、删除、起 Studio、调皮肤、体检。
//
// 为什么一定要有服务端:浏览器打开 file:// 时既加载不了字体(CORS)、也 fetch 不了 JSON,
// 更不可能写文件。所以 `--serve` 不是"顺便帮你打开",它是这个东西能工作的前提。
//
// 用法:
//   node tools/build-asset-browser.mjs           # 只生成静态页(资产变了想刷新缓存时用)
//   node tools/build-asset-browser.mjs --serve   # 生成 + 起服务 + 打开浏览器  ← 平时用这条
//
// 分层:
//   tools/lib/panel-scan.mjs  采集(扫仓库 → JSON)
//   tools/lib/panel-api.mjs   写入(上传/删除/Studio/皮肤预览,自带边界校验)
//   tools/lib/panel-page.html 页面本体(原始 HTML,不是模板字符串,改样式直接改它)

import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {allowLocalRequest} from './lib/local-request.mjs';
import {dirname, extname, join, relative} from 'node:path';
import {PREVIEWS} from './build-asset-previews.mjs';
import {ROOT, TPL, lsSafe, makeMeta, rel, scanAll, scanFinals, scanProjects, scanStorage, runHealth} from './lib/panel-scan.mjs';
import {
  cancelCaptionJob,
  captionJob,
  compareFrame,
  listCaptionProjects,
  loadCaption,
  restoreCaption,
  saveCaption,
  startCaptionRender,
  waveform,
} from './lib/caption-store.mjs';
import {reapOrphanChrome} from './lib/panel-api.mjs';
import {editorApi} from './lib/editor-api.mjs';
import {buildEditor} from './build-editor.mjs';
import {captureBuildInfo,createBuildStatus} from './lib/build-info.mjs';
import {resolvePanelStatic} from './lib/panel-static.mjs';
import {pipePanelFile} from './lib/panel-file-stream.mjs';
import {captionSpec, lintScript} from './lib/caption-spec.mjs';
import {
  UPLOAD_DIRS,
  cancelLane,
  deleteAsset,
  deleteReference,
  doDelete,
  handleUpload,
  inboxState,
  installBrand,
  installScreen,
  installFootage,
  installSfx,
  makeExport,
  revealExport,
  makePreview,
  makePreviewVideo,
  json,
  readBody,
  renderSkinPreview,
  saveSkinProposal,
  studioStart,
  studioStatus,
  studioStop,
  videoPoster,
} from './lib/panel-api.mjs';
import {ocrLocate, padBox, boxToMarkSlots} from './lib/ocr.mjs';

const OUT = join(ROOT, 'assets/BROWSER.html');
const NM = join(TPL, 'node_modules');
const PAGE = join(ROOT, 'tools/lib/panel-page.html');

// ─────────────────────────────── 生成页面 ───────────────────────────────

/**
 * 控制台的主题 CSS —— 用**和成片画面同一条 OKLCH 明度阶梯**生成(src/lib/color.ts 的 scenePalette)。
 * 直接输出 `oklch()` 而不是转成 hex:公式一模一样,浏览器自己算,以后改阶梯两边不会漂。
 */
function themeCss(t) {
  const nH = t.neutralHue;
  const aC = t.accentChroma;
  // **浅色模式要把中性彩度压下来。**
  // 皮肤的 neutralChroma(abyss 是 0.022)是为深色视频画面定的 —— 在 L=0.17 的底上
  // 它读作"带冷蓝的黑",正是想要的。但同样的彩度放到 L=0.98 的浅色 UI 上就变成一片淡蓝洗底,
  // 撞上项目自己 docs/color.md 那条警告:">0.02 会让灰读成有颜色"。
  // 所以浅色下按该文档的默认值 0.008 封顶,色相保留 —— 还是这个项目的色相,只是不再喧宾夺主。
  const nCLight = Math.min(t.neutralChroma, 0.008);
  const nC = t.neutralChroma;
  const ok = (l, c, h) => `oklch(${l} ${c.toFixed(4)} ${h})`;
  return `:root{
  --bg:${ok(0.985, nCLight * 0.7, nH)}; --panel:${ok(1.0, 0, nH)}; --panel2:${ok(0.955, nCLight, nH)}; --line:${ok(0.9, nCLight * 1.6, nH)};
  --ink:${ok(0.22, nCLight * 1.2, nH)}; --ink2:${ok(0.44, nCLight * 1.6, nH)}; --ink3:${ok(0.56, nCLight * 2, nH)};
  --accent:${ok(0.55, aC, t.accentHue)};
  --good:oklch(0.52 0.14 155); --warn:oklch(0.58 0.13 68); --bad:oklch(0.53 0.19 25);
  --r:12px;
}
@media (prefers-color-scheme: dark){
  :root{
    --bg:${ok(0.17, nC, nH)}; --panel:${ok(0.22, nC * 1.2, nH)}; --panel2:${ok(0.27, nC * 1.4, nH)}; --line:${ok(0.33, nC * 1.6, nH)};
    --ink:${ok(0.97, nC * 0.6, nH)}; --ink2:${ok(0.78, nC * 1.5, nH)}; --ink3:${ok(0.6, nC * 2, nH)};
    --accent:${ok(0.72, aC, t.accentHue)};
    --good:oklch(0.72 0.15 155); --warn:oklch(0.78 0.13 75); --bad:oklch(0.68 0.17 25);
  }
}`;
}



function buildPage() {
  const data = scanAll();

  data.previews = PREVIEWS.map((g) => ({
    ...g,
    items: g.items
      .map((it) => ({...it, url: rel(join(ROOT, 'assets/previews', `${g.group}-${it.variant}.mp4`))}))
      .filter((it) => existsSync(join(ROOT, 'assets', it.url))),
  }));
  data.uploadDirs = UPLOAD_DIRS;
  data.make = makeMeta();
  data.captionProjects = listCaptionProjects();

  // 总览那排统计卡的图标。**从本地 lucide 里现读并内联**,不引 CDN、不写 emoji:
  // 一排纯数字加中文标签,扫过去每张卡长得一样,得逐张读字才知道是哪一类;
  // 图标是这排卡唯一的形状差异,也是"一眼认出"的全部来源。
  // 内联 SVG 而不是 <img src>:8 个请求变 0 个,而且 stroke="currentColor" 能跟着皮肤换色。
  const LUCIDE = join(NM, 'lucide-static/icons');
  const STAT_ICONS = {
    make: 'clapperboard',      // 镜头模板 = 一整镜的成品
    'pv-move': 'orbit',        // 运动预览 = 运镜/出场/底纹这些"动"的东西
    fonts: 'type',
    sfx: 'audio-waveform',
    icons: 'shapes',
    lottie: 'sparkles',        // 会动的小矢量
    components: 'blocks',      // 搭画面的积木
    refs: 'images',
  };
  data.statIcons = {};
  for (const [id, name] of Object.entries(STAT_ICONS)) {
    const p = join(LUCIDE, `${name}.svg`);
    if (!existsSync(p)) continue;
    data.statIcons[id] = readFileSync(p, 'utf8')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\s+class="[^"]*"/, '')
      .replace(/width="24"/, 'width="18"')
      .replace(/height="24"/, 'height="18"')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // 侧边栏分两组:先「管理」后「资产」。这个顺序是有意的——
  // 这一版之后日常操作(传东西、清盘、体检)比查资产更高频,高频的放上面。
  // 导航按**使用频率**排,不按功能分类排。
  // 总览/做片子/项目是每次都会碰的;资产是查和改的地方;
  // 存储清理、体检、偏好、皮肤调参都是"定一次用很久"的例行事,压到最下面并做视觉弱化,
  // 免得它们和核心工作抢注意力(2026-08-15 用户提的:总览和资产最重要,其余可选非高频)。
  const NAV = [
    {id: 'overview', label: '总览'},
    {id: 'make', label: '做片子', n: data.make.presets.length},
    {id: 'editor', label: '时间轴编辑'},
    // 「改字幕」紧跟「做片子」:它和做片子一样是每天都会碰的动作,不是查资料。
    // 出完一支口播字幕之后,改错字/改断句/挪时间的次数远多于重新做一支。
    {id: 'captions', label: '改字幕', n: data.captionProjects.length},
    {id: 'projects', label: '项目与产物'},
    {grp: '资产'},
    ...data.previews.map((g) => ({id: `pv-${g.group}`, label: g.title, n: g.items.length})),
    {id: 'fonts', label: '字体', n: data.fonts.length},
    {id: 'sfx', label: '音效', n: data.sfx.length},
    {id: 'bgm', label: 'BGM 与卡点', n: data.bgm.length},
    {id: 'icons', label: '图标', n: data.icons.reduce((a, p) => a + p.names.length, 0)},
    {id: 'lottie', label: 'Lottie 动画', n: data.lotties.length},
    // 「镜头配方」排在组件之前:写新镜头的顺序就是先看有没有现成手法,再看有哪些零件。
    // 导航按使用频率排,而这两条的使用**顺序**恰好也是这个,不冲突。
    {id: 'recipes', label: '镜头配方', n: data.recipes.local.length},
    {id: 'components', label: '组件', n: data.components.length},
    {id: 'refs', label: '审美参考帧', n: data.references.length},
    {id: 'library', label: '素材库'},
    {grp: '设置与维护', minor: true},
    {id: 'skinlab', label: '风格皮肤', minor: true},
    {id: 'storage', label: '存储清理', minor: true},
    {id: 'health', label: '系统体检', minor: true},
    {id: 'prefs', label: '我的偏好', n: data.prefs.voice.length, minor: true},
  ];
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const navHtml = NAV.map((s) =>
    s.grp
      ? `<div class="grp${s.minor ? ' minor' : ''}">${esc(s.grp)}</div>`
      : `<a href="${s.id === 'editor' ? '/editor' : '#' + s.id}" ${s.id === 'editor' ? '' : 'data-s="' + s.id + '"'}${s.minor ? ' class="minor"' : ''}>${esc(s.label)}${s.n !== undefined ? `<b>${s.n}</b>` : ''}</a>`,
  ).join('\n  ');

  const previewSections = data.previews
    .map(
      (g) => `<section id="pv-${g.group}">
  <h2>${esc(g.title)}</h2>
  <p class="lead">${esc(g.intro)}</p>
  <div class="grid g3" id="pv-${g.group}-grid"></div>
</section>`,
    )
    .join('\n\n');

  const lottieJs = existsSync(join(NM, 'lottie-web/build/player/lottie.min.js')) ? rel(join(NM, 'lottie-web/build/player/lottie.min.js')) : '';

  const html = readFileSync(PAGE, 'utf8')
    .replace('__NAV__', navHtml)
    .replace('__PREVIEW_SECTIONS__', previewSections)
    .replace('__DATA__', JSON.stringify(data))
    .replace('__LOTTIE_JS__', lottieJs)
    .replace('__THEME_CSS__', themeCss(data.theme))
    .replace(/__FONT_ARCHIVO__/g, rel(join(ROOT, 'assets/library/fonts/Archivo-VF.ttf')))
    .replace(/__FONT_INTER__/g, rel(join(ROOT, 'assets/library/fonts/InterVariable.ttf')))
    .replace(/__FONT_MONO__/g, rel(join(ROOT, 'assets/library/fonts/JetBrainsMono-VF.ttf')))
    .replace('__BUILT__', new Date().toISOString().slice(0, 16).replace('T', ' '));

  mkdirSync(dirname(OUT), {recursive: true});
  writeFileSync(OUT, html);
  // 面板里写着的收件箱路径必须真的存在,否则你拖文件过去会一头雾水
  for (const spec of Object.values(UPLOAD_DIRS)) mkdirSync(join(ROOT, spec.dir), {recursive: true});
  return data;
}

/**
 * 缺哪个模板的循环片就当场补渲。
 *
 * **为什么放在这里而不是写进文档里提醒自己。**
 * 模板卡的自动播放依赖 `assets/previews/presets/<id>.mp4`。加了新模板不跑
 * `build-asset-previews.mjs`,卡片就静静地退化成一张静图——**不报错、不缺东西,
 * 只是那个模板"不会动了"**,而模板一半的价值就在时序。2026-08-16 用户发现了这件事:
 * 新做的流程推进和趋势图表在面板里不播。
 *
 * 靠"下次记得跑"是最弱的一层修法。控制台每次重建本来就要跑一遍,
 * 顺手把缺的补上,成本只在第一次(每支约 20–40 秒),之后全是跳过。
 * `--no-autoloop` 留给"我就想快点看一眼页面"的时候。
 */
function renderMissingLoops() {
  if (process.argv.includes('--no-autoloop')) return;
  const dir = join(ROOT, 'docs/presets');
  const missing = [];
  for (const id of readdirSync(dir).sort()) {
    const def = join(dir, id, 'preset.json');
    if (!existsSync(def)) continue;
    const out = join(ROOT, 'assets/previews/presets', `${id}.mp4`);
    if (!existsSync(out) || statSync(out).size === 0) missing.push(id);
  }
  if (missing.length === 0) return;
  console.log(`模板循环片缺 ${missing.length} 支(${missing.join(', ')}),现在补渲——每支约 20–40 秒…`);
  try {
    execFileSync('node', [join(ROOT, 'tools/build-asset-previews.mjs'), '--only', 'presets'], {
      cwd: ROOT,
      stdio: 'inherit',
    });
  } catch (e) {
    console.log(`  补渲失败(${e.message}),这些模板卡会退化成静图。手动重试:node tools/build-asset-previews.mjs --only presets`);
  }
}

/**
 * 素材库缩略图同理:新下载一个 HDRI / 材质却没渲样品球,卡片就只剩一个
 * `qwantani_dusk_2_2k.hdr` 这样的文件名——**对人零信息量,等于没入库**。
 * 同样不靠"下次记得跑",重建时缺谁补谁(每个约 15 秒),之后全是跳过。
 */
function renderMissingLibraryShots() {
  if (process.argv.includes('--no-autoloop')) return;
  const shots = join(ROOT, 'assets/previews/library');
  const want = [
    ...lsSafe(join(ROOT, 'assets/library/hdri'), (f) => f.endsWith('.hdr')).map(
      (f) => `hdri-${f.replace(/\.hdr$/, '')}.jpg`,
    ),
    ...lsSafe(join(ROOT, 'assets/library/materials'), (f) => !f.startsWith('.') && !f.endsWith('.json')).map(
      (d) => `mat-${d}.jpg`,
    ),
  ];
  const missing = want.filter((f) => !existsSync(join(shots, f)) || statSync(join(shots, f)).size === 0);
  if (missing.length === 0) return;
  console.log(`素材库缩略图缺 ${missing.length} 张,现在补渲——每张约 15 秒…`);
  try {
    execFileSync('node', [join(ROOT, 'tools/build-library-previews.mjs')], {cwd: ROOT, stdio: 'inherit'});
  } catch (e) {
    console.log(`  补渲失败(${e.message}),这些卡片只显示文件名。手动重试:node tools/build-library-previews.mjs`);
  }
}

renderMissingLoops();
renderMissingLibraryShots();
const data = buildPage();
console.log(
  `控制台已生成 → ${relative(ROOT, OUT)}\n` +
    `  模板 ${data.presets.length} · 组件 ${data.components.length} · 运动预览 ${data.previews.reduce((a, g) => a + g.items.length, 0)} · ` +
    `字体 ${data.fonts.length} · 音效 ${data.sfx.length} · 图标 ${data.icons.reduce((a, p) => a + p.names.length, 0)} · ` +
    `Lottie ${data.lotties.length} · 参考帧 ${data.references.length} · 偏好 ${data.prefs.voice.length} 条`,
);

// ─────────────────────────── 本地服务 ───────────────────────────

if (process.argv.includes('--serve')) {
  await buildEditor();
  const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.css': 'text/css',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.m4v': 'video/mp4',
    '.webm': 'video/webm',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
  };

  // 重扫很贵(要 du 整个 13G 的 projects/),缓存住;写操作之后主动作废
  let cache = {storage: null, projects: null, finals: null};
  const invalidate = () => (cache = {storage: null, projects: null, finals: null});

  // Recorded after the startup build so regenerated catalogs/bundle are part of the baseline.
  const buildInfo = captureBuildInfo(ROOT), buildStatus = createBuildStatus(ROOT, buildInfo);
  const server = createServer(async (req, res) => {
    if (!allowLocalRequest(req)) {res.writeHead(403).end('Local same-origin requests only');return;}
    try {decodeURIComponent(req.url);} catch {res.writeHead(400).end('Invalid URL');return;}
    const url = new URL(req.url, 'http://localhost');
    const path = decodeURIComponent(url.pathname);
    if (path === '/api/build-info') {
      res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      res.end(JSON.stringify(buildStatus()));return;
    }
    if (path === '/' || path === '/editor' || path === '/editor/') {
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
      pipePanelFile(req, res, join(ROOT,'workspace/editor-app/index.html'));return;
    }
    if (path.startsWith('/api/editor/')) return editorApi(req,res,url);
    if (path.startsWith('/fonts/')) {
      const name=path.slice(7);
      if (!/^[a-zA-Z0-9_.-]+$/.test(name)) {res.writeHead(404).end();return;}
      const font=join(TPL,'public/fonts',name);
      if(!existsSync(font)){res.writeHead(404).end();return;}
      res.writeHead(200,{'Content-Type':'font/ttf'});pipePanelFile(req, res, font);return;
    }

    try {
      // ── API ──
      if (path.startsWith('/api/')) {
        const route = path.slice(5);
        if (route === 'state') return json(res, 200, scanAll());
        if (route === 'inbox') return json(res, 200, inboxState());
        if (route === 'projects') return json(res, 200, (cache.projects ??= scanProjects()));
        if (route === 'finals') return json(res, 200, (cache.finals ??= scanFinals()));
        if (route === 'storage') return json(res, 200, (cache.storage ??= scanStorage()));
        if (route === 'health') return json(res, 200, runHealth());
        if (route === 'studio' && req.method === 'GET') return json(res, 200, await studioStatus());
        if (route === 'studio' && req.method === 'POST') {
          const {target} = JSON.parse((await readBody(req)) || '{}');
          const r = await studioStart(target || 'template');
          return json(res, r.error ? 400 : 200, r);
        }
        if (route === 'studio/stop' && req.method === 'POST') return json(res, 200, studioStop());
        if (route === 'upload' && req.method === 'POST') {
          const r = await handleUpload(req, res);
          invalidate();
          return r;
        }
        if (route === 'delete' && req.method === 'POST') {
          const {paths} = JSON.parse((await readBody(req)) || '{}');
          if (!Array.isArray(paths) || !paths.length) return json(res, 400, {error: '没有要删的东西'});
          const r = doDelete(paths);
          invalidate();
          return json(res, 200, r);
        }
        // 成片封面:按需抽帧 + 磁盘缓存。直接回图片字节,浏览器当 <img src> 用
        if (route === 'poster') {
          const r = await videoPoster(url.searchParams.get('path') || '');
          if (r.error) return json(res, 400, r);
          const size = statSync(r.file).size;
          res.writeHead(200, {
            'Content-Type': 'image/jpeg',
            'Content-Length': size,
            // 缓存键里已经带了 mtime,内容不会变,让浏览器一直用本地副本
            'Cache-Control': 'public, max-age=604800, immutable',
          });
          pipePanelFile(req, res, r.file);
          return;
        }
        // ── 改字幕 ──
        if (route === 'caption/projects') return json(res, 200, listCaptionProjects());
        if (route === 'caption/load') return json(res, 200, await loadCaption(url.searchParams.get('p') || ''));
        // 边打字边校验。**故意不在浏览器里重写一遍判据** —— 那会是第三份 INK 表,
        // 而三份表里改漏一份的错法是静默的:linter 放过实际超宽的行,谁都不报错。
        // localhost 上一个来回几毫秒,不值得为它复制规则。
        if (route === 'caption/lint' && req.method === 'POST') {
          const {script, duration} = JSON.parse((await readBody(req, 32 * 1024 * 1024)) || '{}');
          const spec = await captionSpec();
          return json(res, 200, lintScript(spec, script, duration || null));
        }
        if (route === 'caption/waveform') return json(res, 200, await waveform(url.searchParams.get('p') || ''));
        if (route === 'caption/save' && req.method === 'POST') {
          const {project, script} = JSON.parse((await readBody(req, 32 * 1024 * 1024)) || '{}');
          const r = await saveCaption(project, script);
          invalidate();
          return json(res, r.error ? 400 : 200, r);
        }
        if (route === 'caption/restore' && req.method === 'POST') {
          const {project, stamp} = JSON.parse((await readBody(req)) || '{}');
          const r = restoreCaption(project, stamp);
          return json(res, r.error ? 400 : 200, r);
        }
        if (route === 'caption/compare' && req.method === 'POST') {
          const {project, script, t} = JSON.parse((await readBody(req, 32 * 1024 * 1024)) || '{}');
          const r = await compareFrame(project, script, t);
          return json(res, r.error ? 400 : 200, r);
        }
        if (route === 'caption/render' && req.method === 'POST') {
          const {project} = JSON.parse((await readBody(req)) || '{}');
          const r = await startCaptionRender(project);
          return json(res, r.error ? 409 : 200, r);
        }
        if (route === 'caption/job') return json(res, 200, captionJob() || {idle: true});
        if (route === 'caption/job/cancel' && req.method === 'POST') {
          invalidate();
          return json(res, 200, cancelCaptionJob());
        }

        if (route === 'make/meta') return json(res, 200, makeMeta());
        // 预览类请求:浏览器一断开就把渲染进程组收掉。
        // 面板会在切模板时 abort 掉旧 fetch,这一行是那条"性能回收"真正落地的地方
        if (route === 'make/preview' && req.method === 'POST') {
          const body = JSON.parse((await readBody(req)) || '{}');
          req.on('close', () => {
            if (!res.writableEnded) cancelLane('preview');
          });
          const r = await makePreview(body);
          return json(res, r.error ? 500 : 200, r);
        }
        if (route === 'make/preview-video' && req.method === 'POST') {
          const body = JSON.parse((await readBody(req)) || '{}');
          req.on('close', () => {
            if (!res.writableEnded) cancelLane('preview-video');
          });
          const r = await makePreviewVideo(body);
          return json(res, r.error ? 500 : 200, r);
        }
        if (route === 'make/export' && req.method === 'POST') {
          const body = JSON.parse((await readBody(req)) || '{}');
          const r = await makeExport(body);
          invalidate();
          return json(res, r.error ? 500 : 200, r);
        }
        // 导出的成片在 ~/Downloads,不在 ROOT 里,静态服务托不了 ——
        // 页面上的 file:// 链接又会被浏览器拦掉,所以「在访达中显示」只能走服务端
        if (route === 'make/reveal' && req.method === 'POST') {
          const {name} = JSON.parse((await readBody(req)) || '{}');
          const r = revealExport(name);
          return json(res, r.error ? 400 : 200, r);
        }
        if (route === 'asset/delete' && req.method === 'POST') {
          const {kind, file, group} = JSON.parse((await readBody(req)) || '{}');
          const r = kind === 'reference' ? deleteReference(group, file) : deleteAsset(kind, file);
          return json(res, r.error ? 400 : 200, r);
        }
        if (route === 'brand/install' && req.method === 'POST') {
          const {file} = JSON.parse((await readBody(req)) || '{}');
          const r = installBrand(file);
          return json(res, r.error ? 400 : 200, r);
        }
        if (route === 'screen/install' && req.method === 'POST') {
          const {file} = JSON.parse((await readBody(req)) || '{}');
          const r = installScreen(file);
          return json(res, r.error ? 400 : 200, r);
        }
        if (route === 'footage/install' && req.method === 'POST') {
          const {file} = JSON.parse((await readBody(req)) || '{}');
          const r = installFootage(file);
          return json(res, r.error ? 400 : 200, r);
        }
        if (route === 'ocr/locate' && req.method === 'POST') {
          // 按文字在截图素材上定位(macOS Vision 离线 OCR)。只认文件名不认路径,
          // 目录固定 public/screens ——和 deleteAsset 同一套"类别+文件名"安全语义
          const {file, text} = JSON.parse((await readBody(req)) || '{}');
          const name = String(file || '').split(/[/\\]/).pop();
          const img = join(ROOT, 'templates/remotion-base/public/screens', name);
          if (!name || !existsSync(img)) return json(res, 400, {error: '截图不存在:' + name});
          if (!String(text || '').trim()) return json(res, 400, {error: '要找的文字是空的'});
          const r = ocrLocate(img, String(text));
          // 大小写原样命中的排前面:输 deepseek-v4-flash 时,正文代码块比标题 DeepSeek-V4-Flash 更可能是目标
          const exact = [];
          const loose = [];
          r.matches.forEach((m) => (m.text.includes(String(text)) ? exact : loose).push(m));
          return json(res, 200, {
            found: r.matches.length,
            matches: [...exact, ...loose].map((m) => ({line: m.text, slots: boxToMarkSlots(padBox(m.box))})),
          });
        }
        if (route === 'sfx/install' && req.method === 'POST') {
          const {file} = JSON.parse((await readBody(req)) || '{}');
          const r = installSfx(file);
          return json(res, r.error ? 400 : 200, r);
        }
        if (route === 'skin-preview' && req.method === 'POST') {
          const body = JSON.parse((await readBody(req)) || '{}');
          const r = await renderSkinPreview(body);
          return json(res, r.error ? 500 : 200, r);
        }
        if (route === 'skin-save' && req.method === 'POST') {
          const body = JSON.parse((await readBody(req)) || '{}');
          return json(res, 200, saveSkinProposal(body));
        }
        return json(res, 404, {error: '未知接口:' + route});
      }

      // ── 静态文件 ──
      // Remotion staticFile() 产出的 /footage、/screens、/sfx 等 URL 来自模板 public。
      // 仓库路径优先，随后才查 public，二者都做 realpath 边界检查。
      const p = resolvePanelStatic(path, {repoRoot: ROOT, publicRoot: join(TPL, 'public')});
      if (!p) {
        res.writeHead(404).end('not found');
        return;
      }
      const size = statSync(p).size;
      const type = MIME[extname(p).toLowerCase()] || 'application/octet-stream';
      // 视频要支持 Range,否则 <video controls> 在 Safari 里拖不动进度条
      const range = req.headers.range;
      if (range && /^bytes=/.test(range)) {
        const [s, e] = range.replace('bytes=', '').split('-');
        const start = Number(s) || 0;
        const end = e ? Number(e) : size - 1;
        res.writeHead(206, {
          'Content-Type': type,
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
        });
        pipePanelFile(req, res, p, {start, end});
        return;
      }
      res.writeHead(200, {'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes'});
      pipePanelFile(req, res, p);
    } catch (e) {
      if (path.startsWith('/api/')) return json(res, 500, {error: String(e.message || e)});
      res.writeHead(500).end('error');
    }
  });

  const port = Number(process.env.PANEL_PORT || 4321);
  const url = `http://localhost:${port}/editor`;

  /**
   * 端口被占了不该甩一段 Node 堆栈。
   *
   * 这个命令是**面向用户的唯一入口**,而端口冲突几乎总是同一件小事:
   * 上一个控制台还开着(忘了 Ctrl+C,或者被我留在后台了)。堆栈里那句
   * `Emitted 'error' event on Server instance` 对用户零信息量,还看着像坏了。
   *
   * 页面本身已经在上面重新生成过了,所以这时候**该做的是把链接给他,不是报错**:
   * 前端文件共享，但 API 模块驻留在进程中；刷新网页不能更新旧服务的 API。
   */
  server.on('error', (e) => {
    if (e.code !== 'EADDRINUSE') throw e;
    console.log(
      `\n控制台端口 ${port} 已被占用。前端已重新生成，但现有服务的 API 可能仍是旧版；刷新页面不能更新后端:\n` +
        `  ${url}\n\n` +
        `更新服务前请先保存编辑、确认没有导出任务，再停止该端口的旧 Node 服务并重新启动\n` +
        `想同时开两个:换端口       →  PANEL_PORT=4322 node tools/build-asset-browser.mjs --serve`,
    );
    try {
      if (process.env.PANEL_NO_OPEN !== '1') execFileSync('open', [url]);
    } catch {
      /* 打不开就让用户自己点链接 */
    }
    process.exit(0);
  });

  // 只绑 127.0.0.1:这个服务能删文件、能起进程,绝不该暴露到局域网
  server.listen(port, '127.0.0.1', () => {
    // 起服务时无条件收一次孤儿 Chrome。不是洁癖:攒够几十个就会把 swap 吃光,
    // 表现是「所有模板都渲不出来一直转圈」,极难联想到几天前那次 Ctrl+C。见 reapOrphanChrome 头注
    const reaped = process.env.PANEL_SKIP_REAP === '1' ? {killed:0} : reapOrphanChrome();
    if (reaped.killed) console.log(`\n回收了 ${reaped.killed} 个上次没退干净的 Chrome 渲染进程`);
    console.log(`\n控制台已开在 ${url}\n（这个终端窗口保持开着;看完按 Ctrl+C 关掉服务）`);
    try {
      if (process.env.PANEL_NO_OPEN !== '1') execFileSync('open', [url]);
    } catch {
      /* 打不开就让用户自己点链接 */
    }
  });

  // Ctrl+C 时把 Studio 一起带走,否则它会变成孤儿进程占着 3333 端口
  const bye = () => {
    studioStop();
    process.exit(0);
  };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
}
