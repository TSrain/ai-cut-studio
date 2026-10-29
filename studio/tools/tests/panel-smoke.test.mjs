// 控制台的冒烟测试:用真浏览器打开生成的页面,看有没有 JS 报错、墙有没有画出来。
//
// 为什么必须有它:2026-08-20 加「镜头配方」和「BGM」两区时,我把数据对象写成了 `DATA.`
// 而页面里它叫 `D.` —— 一个 ReferenceError,**后面所有靠 JS 画的墙全部停摆**:
// 运镜、文字出场、底纹、项目与产物全是空的。而导航计数是服务端渲染的,照常显示数字,
// 所以页面**看起来只是"没加载出来"**,不像坏了。生成脚本 exit 0、测试全绿、
// 我还亲口说了"控制台已刷新" —— 全是绿的,东西是坏的。
//
// 静态检查抓不到这类错(语法完全合法),只有真跑一次才知道。
// 好在做 G 的时候本机已经有 puppeteer + chromium 了,这条测试因此几乎是白捡的。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {existsSync, readdirSync} from 'node:fs';
import {join, resolve} from 'node:path';

const REQ = createRequire(resolve('tools/capture/package.json'));
const hasPuppeteer = existsSync('tools/capture/node_modules/puppeteer-core');

const findBrowser = () => {
  const base = join(process.env.HOME ?? '', 'Library/Caches/ms-playwright');
  if (!existsSync(base)) return null;
  for (const d of readdirSync(base).filter((x) => x.startsWith('chromium')).sort().reverse()) {
    for (const rel of [
      'chrome-headless-shell-mac-arm64/chrome-headless-shell',
      'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium',
      'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
    ]) {
      const p = join(base, d, rel);
      if (existsSync(p)) return p;
    }
  }
  return null;
};

const browserPath = hasPuppeteer ? findBrowser() : null;

test('控制台:打开无 JS 报错,且各墙都画出来了', {skip: browserPath ? false : '本机没有 puppeteer / chromium'}, async () => {
  const puppeteer = REQ('puppeteer-core');
  const browser = await puppeteer.launch({executablePath: browserPath, headless: true});
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    // 控制台里有几个区要连本地服务取数据(项目/成片/体检);file:// 打开时那些 fetch 必然失败,
    // 那是预期的,不算 JS 报错。这里只收未捕获异常。
    await page.goto(`file://${resolve('assets/BROWSER.html')}`, {waitUntil: 'load', timeout: 60000});
    await new Promise((r) => setTimeout(r, 1200));

    assert.deepEqual(errors, [], `页面抛了未捕获异常:\n${errors.join('\n')}`);

    // 墙是懒加载的(onView),**必须先滚过去**才会画 —— 这也顺带验了懒加载本身还在工作。
    for (const id of ['recipes', 'bgm']) {
      await page.evaluate((x) => document.getElementById(x)?.scrollIntoView(), id);
      await new Promise((r) => setTimeout(r, 700));
    }
    assert.deepEqual(errors, [], `滚动后抛了未捕获异常:\n${errors.join('\n')}`);

    // 墙是不是真画出来了。**只查静态数据画的墙** —— 要连服务器的那几个 file:// 下本来就画不出来。
    const counts = await page.evaluate(() => ({
      recipes: document.querySelectorAll('#recipeLocal .card').length,
      bgm: document.querySelectorAll('#bgmlist .card').length,
    }));
    assert.ok(counts.recipes >= 8, `镜头配方墙只有 ${counts.recipes} 张卡`);
    assert.ok(counts.bgm >= 5, `BGM 墙只有 ${counts.bgm} 张卡`);
    // 外部索引层那堵墙同样要画出来(209 式,默认收起,所以只查有没有卡)
    const ext = await page.evaluate(() => document.querySelectorAll('#recipeExt .card').length);
    assert.ok(ext > 0, '外部配方墙是空的');
  } finally {
    await browser.close();
  }
});
