#!/usr/bin/env node
// 把一个 registry block 挂进 index.html 的 #root 里,用于批量出缩略图。
// 三个必须点(踩过才知道):
//   1. 挂载 div 必须在 #root **内部**——插到 </body> 前是在合成树外面,渲出来全黑;
//   2. 挂载 div 要有 data-start,只给 data-duration 不够;
//   3. #root 的 data-duration 必须 ≥ block 时长,否则后半段采样点落在空处。
// 用法: node mount.mjs <项目目录> <block名> <宽> <高> <时长秒>
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const [dir, name, w, h, dur] = process.argv.slice(2);
if (!dir || !name || !w || !h || !dur) {
  console.error(
    '用法: node tools/hyperframes-mount.mjs <项目目录> <block名> <宽> <高> <时长秒>\n' +
      '例:   node tools/hyperframes-mount.mjs ./hf-proj transitions-dissolve 1920 1080 24\n' +
      '之后: (cd <项目目录> && npx hyperframes snapshot --at <秒> --no-end -o snaps)',
  );
  process.exit(2);
}
const idx = join(dir, 'index.html');
let s = readFileSync(idx, 'utf8');

// 每次都从干净骨架重建 body,避免上一个 block 的残留叠加
const mount =
  `<div data-composition-id="probe" data-composition-src="compositions/${name}.html" ` +
  `data-start="0" data-duration="${dur}" data-width="${w}" data-height="${h}"></div>`;

const body = `  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${dur}"
         data-width="${w}" data-height="${h}">
      ${mount}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </body>`;

s = s.replace(/ {2}<body>[\s\S]*<\/body>/, body);
// 画布尺寸也要跟着 block 走,否则横版 block 挂在竖版工程里会被裁
s = s.replace(/width: \d+px;\s*\n\s*height: \d+px;/, `width: ${w}px;\n        height: ${h}px;`);
s = s.replace(/content="width=\d+, height=\d+"/, `content="width=${w}, height=${h}"`);
writeFileSync(idx, s);
console.log(`mounted ${name} ${w}x${h} ${dur}s`);
