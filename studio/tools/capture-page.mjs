#!/usr/bin/env node
// 把任意网页采成动画素材:全页 2x 截图(默认)+ 可选的元素抠图与 layout.json。
//
// 为什么值得有:本项目此前**完全没有网页截图链路**(全项目 grep 不到 puppeteer/playwright)。
// engine-routing 把「网页截图/DOM 重构」判给 HyperFrames,但那只是路由,没有采集工具兜底——
// 一旦有产品/UI 类镜头就得从零开始。
//
// 三档能力,只有第一档是零配置的:
//   档 1(默认)  给一个网址 → 全页 2x 截图 → 落进项目 assets/ → 交给 PageCam 做 2.5D 运镜
//   档 2(--config)元素抠图 + layout.json:每个元素在整页坐标系里的 {x,y,w,h}
//   档 3(config 里写 interact) 点开某个 tab / 展开菜单之后再截
//
// **layout.json 才是这条链路最值钱的产物**:有了它,卡片飞入、元素归位、推镜焦点
// 全部用真实坐标,不需要谁去猜位置。本项目的 docs/locate-protocol.md 存在的理由就是
// 「不许目测坐标:目测平均误差 6.5%,网格法 2.3%」——对网页镜头,layout.json 把误差降到 0,
// 那套四步网格定位法可以整个跳过。
//
// 确定性:截图一律落进项目 assets/ 用本地路径参与渲染。这不是可选项——
// 渲染期网络请求违反确定性条款(design-principles §9)。
//
// 用法:
//   node tools/capture-page.mjs --url https://example.com --out projects/<name>/assets/
//   node tools/capture-page.mjs --config capture.json --out projects/<name>/assets/
import {createRequire} from 'node:module';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'tools/capture/package.json'));

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const flag = (name) => argv.includes(`--${name}`);

if (flag('help') || argv.length === 0) {
  console.log(`用法:
  node tools/capture-page.mjs --url <网址> --out <目录> [--width 1440] [--scale 2] [--full] [--wait 1200]
  node tools/capture-page.mjs --config <capture.json> --out <目录>

选项:
  --url        目标网址(档 1 零配置)
  --config     采集配置(档 2/3:元素抠图 + layout.json + interact)
  --out        产物目录,**必须在项目 assets/ 下**(确定性:渲染只许引本地文件)
  --width      视口宽,默认 1440(2x 后纹理宽 2880,够 3D 透视下不糊)
  --scale      deviceScaleFactor,默认 2
  --full       整页截图(默认开);--no-full 只截首屏
  --wait       导航完成后额外静置毫秒,默认 1200(等字体和异步数据)
  --keep-banner 不尝试关闭 cookie 同意横幅(默认会关)
  --browser    指定 chrome 可执行文件;默认自动找本机 ms-playwright 缓存`);
  process.exit(0);
}

// 浏览器:优先用本机 ms-playwright 缓存里的 chrome-headless-shell,不另外下载。
// puppeteer-core 自己不带浏览器,这一步不做就只能报"找不到浏览器"。
const findBrowser = () => {
  const explicit = opt('browser', null);
  if (explicit) return explicit;
  const base = join(process.env.HOME ?? '', 'Library/Caches/ms-playwright');
  if (!existsSync(base)) return null;
  const {readdirSync} = require('node:fs');
  const dirs = readdirSync(base).filter((d) => d.startsWith('chromium')).sort().reverse();
  for (const d of dirs) {
    for (const rel of [
      'chrome-headless-shell-mac-arm64/chrome-headless-shell',
      'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
      'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium',
    ]) {
      const p = join(base, d, rel);
      if (existsSync(p)) return p;
    }
  }
  return null;
};

const outDir = resolve(opt('out', ''));
if (!opt('out', '')) {
  console.error('FAIL: 必须给 --out。截图要落进项目 assets/ 并以本地路径参与渲染(确定性条款)。');
  process.exit(2);
}
mkdirSync(outDir, {recursive: true});

const configPath = opt('config', null);
const config = configPath ? JSON.parse(readFileSync(configPath, 'utf8')) : null;
const pages = config
  ? config.pages
  : [{name: 'page', url: opt('url', ''), boxes: [], cutouts: []}];
if (!pages.length || !pages[0].url) {
  console.error('FAIL: 没有目标网址(--url 或 config.pages[].url)');
  process.exit(2);
}

const VIEWPORT_W = Number(opt('width', config?.width ?? 1440));
const SCALE = Number(opt('scale', config?.scale ?? 2));
const SETTLE = Number(opt('wait', config?.wait ?? 1200));
const FULL = !flag('no-full');

const browserPath = findBrowser();
if (!browserPath) {
  console.error('FAIL: 找不到浏览器。装一个或用 --browser 指定 chrome 可执行文件路径。');
  console.error('      本机通常在 ~/Library/Caches/ms-playwright/chromium*/…/chrome-headless-shell');
  process.exit(2);
}

const puppeteer = require('puppeteer-core');

// cookie 同意横幅不关掉,截出来的每张图上都横着一条 —— 而它和内容毫无关系。
// 用文本匹配点按钮:选择器每家网站都不同,文本反而稳定。
const dismissBanner = async (page) => {
  const WORDS = ['接受', '同意', '知道了', '允许全部', 'Accept', 'Accept all', 'I agree',
    'Agree', 'Got it', 'Allow all', 'OK', 'Continue'];
  return page.evaluate((words) => {
    const clickable = [...document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]')];
    for (const el of clickable) {
      const text = (el.innerText || el.value || '').trim();
      if (!text || text.length > 24) continue;
      if (words.some((w) => text.toLowerCase() === w.toLowerCase() || text === w)) {
        el.click();
        return text;
      }
    }
    return null;
  }, WORDS);
};

// 懒加载图片不滚一遍就截,截出来一堆占位灰块。滚到底再滚回顶。
const scrollThrough = async (page) => {
  await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.8);
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 300));
  });
};

const browser = await puppeteer.launch({
  executablePath: browserPath,
  headless: true,
  args: ['--hide-scrollbars', '--disable-lcd-text'],
});

const layout = {};
const written = [];
try {
  for (const spec of pages) {
    const page = await browser.newPage();
    await page.setViewport({width: VIEWPORT_W, height: Math.round(VIEWPORT_W * 0.75), deviceScaleFactor: SCALE});
    console.log(`采集 ${spec.url}`);
    await page.goto(spec.url, {waitUntil: 'networkidle2', timeout: 60000});
    await new Promise((r) => setTimeout(r, SETTLE));

    if (!flag('keep-banner')) {
      const hit = await dismissBanner(page);
      if (hit) {
        console.log(`  关掉了同意横幅(点了「${hit}」)`);
        await new Promise((r) => setTimeout(r, 400));
      }
    }
    await scrollThrough(page);
    if (spec.interact) {
      await page.evaluate(spec.interact);
      await new Promise((r) => setTimeout(r, spec.interactWaitMs ?? 800));
    }

    const shot = join(outDir, `${spec.name}.png`);
    await page.screenshot({path: shot, fullPage: FULL});
    const dims = await page.evaluate(() => ({
      w: document.documentElement.scrollWidth,
      h: document.documentElement.scrollHeight,
    }));
    written.push({file: `${spec.name}.png`, cssWidth: dims.w, cssHeight: dims.h, scale: SCALE});
    console.log(`  ✓ ${spec.name}.png  CSS ${dims.w}×${dims.h} @${SCALE}x = ${dims.w * SCALE}×${dims.h * SCALE}px`);

    // 档 2:元素坐标表 + 抠图
    const entry = {url: spec.url, cssWidth: dims.w, cssHeight: dims.h, scale: SCALE, boxes: {}, cutouts: {}};
    for (const box of spec.boxes ?? []) {
      const rects = await page.$$eval(box.selector, (els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return {x: Math.round(r.x + window.scrollX), y: Math.round(r.y + window.scrollY),
            w: Math.round(r.width), h: Math.round(r.height)};
        }));
      entry.boxes[box.key] = box.all ? rects.slice(0, box.max ?? 50) : rects[0] ?? null;
    }
    for (const cut of spec.cutouts ?? []) {
      const els = await page.$$(cut.selector);
      const list = cut.all ? els.slice(0, cut.max ?? 12) : els.slice(0, 1);
      const saved = [];
      for (const [i, el] of list.entries()) {
        const name = cut.all ? `${cut.name}${i + 1}` : cut.name;
        const file = join(outDir, `${name}.png`);
        await el.screenshot({path: file, omitBackground: !!cut.omitBackground});
        const r = await el.evaluate((node) => {
          const b = node.getBoundingClientRect();
          return {x: Math.round(b.x + window.scrollX), y: Math.round(b.y + window.scrollY),
            w: Math.round(b.width), h: Math.round(b.height)};
        });
        saved.push({file: `${name}.png`, ...r});
        written.push({file: `${name}.png`, cssWidth: r.w, cssHeight: r.h, scale: SCALE});
      }
      entry.cutouts[cut.name] = cut.all ? saved : saved[0] ?? null;
    }
    layout[spec.name] = entry;
    await page.close();
  }
} finally {
  await browser.close();
}

const layoutPath = join(outDir, 'layout.json');
writeFileSync(layoutPath, `${JSON.stringify({
  note: '页面空间协议:所有坐标是**整页 CSS 坐标系**里的 {x,y,w,h}。' +
    '卡片飞入、元素归位、推镜焦点直接用这些数,不要目测,也不用跑 locate.mjs 的网格法。' +
    '纹理是 scale 倍图,PageCam 里按 CSS 尺寸渲染(imgW = cssWidth × scale)。',
  capturedFrom: pages.map((p) => p.url),
  pages: layout,
}, null, 2)}\n`, 'utf8');

console.log(`\n产物 ${written.length} 个 → ${outDir}`);
console.log(`坐标表 → ${layoutPath}`);
console.log('下一步:把截图接给 PageCam 做 2.5D 运镜;登记 assets.md 的来源(非阻塞元数据)。');
