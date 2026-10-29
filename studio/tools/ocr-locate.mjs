#!/usr/bin/env node
// 按文字在截图上定位(macOS Vision 离线 OCR)。
//   node tools/ocr-locate.mjs <图片> "<要找的文字>"     # 输出所有命中 + 第一处的 preset 槽位值
//   node tools/ocr-locate.mjs <图片> --list             # 只列识别出的全部文本行(不定位)
// 与网格法的分工:**文字目标先走这条**(秒出、子串级精度,实测和网格法误差 <0.3% 画幅);
// 查不到(艺术字/斜体/非文字目标)再走 docs/locate-protocol.md 的 locate.mjs 四步循环。
// 输出的 box/markX 等都是归一化左上原点,直接可填 visual-contract / presetProps。
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {ocrLocate, padBox, boxToMarkSlots} from './lib/ocr.mjs';

const [img, ...rest] = process.argv.slice(2);
if (!img || (!rest.length && !rest.includes('--list'))) {
  console.error('用法: node tools/ocr-locate.mjs <图片> "<要找的文字>" | --list');
  process.exit(1);
}
const path = resolve(img);
if (!existsSync(path)) {
  console.error('文件不存在: ' + path);
  process.exit(1);
}

const list = rest.includes('--list');
const query = list ? '' : rest.filter((a) => !a.startsWith('--')).join(' ');
const r = ocrLocate(path, query);

if (list) {
  console.log(JSON.stringify({items: r.items}, null, 2));
  process.exit(0);
}

if (!r.matches.length) {
  console.log(JSON.stringify({found: 0, hint: 'OCR 没找到这段文字。换个更短的独特片段试试;还不行就走网格法(tools/locate.mjs)。', lines: r.items.map((i) => i.text)}, null, 2));
  process.exit(2);
}

const first = padBox(r.matches[0].box);
console.log(JSON.stringify({
  found: r.matches.length,
  matches: r.matches.map((m) => ({line: m.text, box: m.box.map((v) => Math.round(v * 1e4) / 1e4)})),
  // 第一处命中,竖向已放 15% 气口,直接可填 screen-push 的槽位(也建议 focusX/Y 用同一中心)
  slots: boxToMarkSlots(first),
}, null, 2));
