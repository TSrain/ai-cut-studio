// macOS Vision 离线 OCR 的 Node 封装(底层是 tools/lib/ocr-vision.jxa.js,经 osascript 跑)。
// 用途:按**文字**在截图上定位,替代/前置网格法——文字目标秒出,失手再走 locate.mjs。
// box 一律 [x,y,w,h] 归一化左上原点。Vision 的框贴着字形,做批注框时通常要竖向放一点气口
// (padBox,默认 15%),否则荧光笔/圈会显得勒得太紧。
import {execFileSync} from 'node:child_process';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const JXA = join(dirname(fileURLToPath(import.meta.url)), 'ocr-vision.jxa.js');

/**
 * @returns {{items:Array<{text:string,box:number[]}>, matches:Array<{text:string,box:number[]}>}}
 * query 为空时只回 items(整图逐行文本)。识别失败/无文字时 items 为空数组,不抛。
 */
export function ocrLocate(imgPath, query = '') {
  const out = execFileSync('osascript', ['-l', 'JavaScript', JXA, imgPath, query], {
    encoding: 'utf8',
    timeout: 30000,
  });
  const parsed = JSON.parse(out.trim());
  if (parsed.error) throw new Error(parsed.error);
  // Vision 偶尔给出 -1e-10 这类浮点渣,顺手夹回 [0,1]
  const clean = (m) => ({...m, box: m.box.map((v) => Math.min(1, Math.max(0, v)))});
  return {items: parsed.items.map(clean), matches: (parsed.matches || []).map(clean)};
}

/** 竖向放气口:h 两头各扩 pad 比例(默认 0.15),夹在 [0,1] 内。 */
export function padBox([x, y, w, h], pad = 0.15) {
  const dy = h * pad;
  const y2 = Math.max(0, y - dy);
  return [x, y2, w, Math.min(1 - y2, h + dy * 2)];
}

/** 把 box 换算成 screen-push preset 的四个槽位值(中心 + 宽高,4 位小数)。 */
export function boxToMarkSlots([x, y, w, h]) {
  const r = (v) => Math.round(v * 1e4) / 1e4;
  return {markX: r(x + w / 2), markY: r(y + h / 2), markW: r(w), markH: r(h)};
}
