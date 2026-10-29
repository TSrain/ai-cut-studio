// tools/lib/contact-sheet.mjs —— 把 N 张预览帧拼成一张带编号的接触印张
//
// 为什么要拼:一批 B-roll 有 5–15 镜,逐张贴给用户看是 N 次确认;
// 项目规则是「一批镜头只进行一次预览确认」,所以先拼成一张、编号、一次贴出。
// 编号用 tools/lib/pixels.mjs 的 5×7 点阵数字画(本机 ffmpeg 没有 drawtext),
// 编号 ↔ 镜号 的对照写在同目录的 contact-sheet.md 里,用户回「3 换成 quote-card」即可。

import {decode, encode, blank, rect, paste, resize, label, GH} from './pixels.mjs';

const BG = [18, 20, 26];
const BORDER = [90, 96, 110];

/**
 * 版面计算(纯函数,可测):列数取"接近正方形"的那个解,竖构图因此不会拼成一条长龙。
 * @returns {{columns, rows, width, height, cells: {x, y}[]}}
 */
export const sheetLayout = (count, {tileW, tileH, gap = 16, maxColumns = 6}) => {
  if (!Number.isInteger(count) || count < 1) throw new Error('count must be a positive integer');
  const ideal = Math.round(Math.sqrt((count * tileH) / tileW));
  const columns = Math.max(1, Math.min(count, maxColumns, ideal || 1));
  const rows = Math.ceil(count / columns);
  const cells = [];
  for (let i = 0; i < count; i += 1) {
    const c = i % columns;
    const r = Math.floor(i / columns);
    cells.push({x: gap + c * (tileW + gap), y: gap + r * (tileH + gap)});
  }
  return {
    columns,
    rows,
    width: gap + columns * (tileW + gap),
    height: gap + rows * (tileH + gap),
    cells,
  };
};

/**
 * 拼版并落盘。tiles: [{png, tag}] —— tag 是画在左上角的编号(纯数字字符串)。
 * 各图比例可以不同:统一装进同一个 tile 框里等比缩放居中,空白填底色。
 */
export const buildContactSheet = (tiles, {out, tileWidth = 260, gap = 16}) => {
  if (tiles.length === 0) throw new Error('没有可拼的预览帧');
  const images = tiles.map((tile) => ({...tile, img: decode(tile.png)}));
  const maxAspect = Math.max(...images.map((t) => t.img.h / t.img.w));
  const tileW = Math.round(tileWidth);
  const tileH = Math.round(tileWidth * maxAspect);
  const layout = sheetLayout(images.length, {tileW, tileH, gap});
  const sheet = blank(layout.width, layout.height, BG);
  const glyphScale = Math.max(2, Math.round(tileW / 90));

  images.forEach((tile, i) => {
    const {x, y} = layout.cells[i];
    const scale = Math.min(tileW / tile.img.w, tileH / tile.img.h);
    const w = Math.max(1, Math.round(tile.img.w * scale));
    const h = Math.max(1, Math.round(tile.img.h * scale));
    paste(sheet, resize(tile.img, w, h), x + Math.round((tileW - w) / 2), y + Math.round((tileH - h) / 2));
    // 细边框:相邻两镜底色相近时,没有边框会看成一张连续的图
    rect(sheet, x - 1, y - 1, tileW + 2, 1, BORDER, 0.9);
    rect(sheet, x - 1, y + tileH, tileW + 2, 1, BORDER, 0.9);
    rect(sheet, x - 1, y - 1, 1, tileH + 2, BORDER, 0.9);
    rect(sheet, x + tileW, y - 1, 1, tileH + 2, BORDER, 0.9);
    label(sheet, x + 6, y + 6, String(tile.tag), glyphScale);
  });

  encode(sheet, out);
  return {out, ...layout, tileW, tileH, labelHeight: GH * glyphScale};
};
