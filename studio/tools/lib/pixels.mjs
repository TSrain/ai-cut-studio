// tools/lib/pixels.mjs —— 零依赖像素原语(ffmpeg 只做编解码)
//
// 本机 homebrew 的 ffmpeg **没编译 drawtext**,任何靠该滤镜画字的写法都会直接崩,
// 所以画线、画字、缩放、拼版一律在 JS 里做像素运算。这份是 tools/locate.mjs 与
// tools/preset-preview.mjs 共用的那一层,改一处两边都受益(别再各抄一份)。

import {execFileSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';

export const MAXBUF = 1 << 30;

export function probe(img) {
  const out = execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', img,
  ]).toString().trim();
  const [w, h] = out.split(',').map(Number);
  if (!w || !h) throw new Error(`读不出图片尺寸: ${img}`);
  return {w, h};
}

export function decode(img) {
  const {w, h} = probe(img);
  const buf = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', img, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    {maxBuffer: MAXBUF},
  );
  if (buf.length !== w * h * 3) throw new Error(`解码尺寸不符: ${buf.length} != ${w * h * 3}`);
  return {w, h, buf};
}

export function encode({w, h, buf}, dst) {
  mkdirSync(dirname(dst), {recursive: true});
  execFileSync(
    'ffmpeg',
    // -v fatal:rawvideo 从管道读会刷 "Truncating packet" 提示,无害但吵;真失败仍会非零退出抛错
    ['-v', 'fatal', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${w}x${h}`, '-i', '-', dst],
    {input: buf, maxBuffer: MAXBUF},
  );
}

export function blank(w, h, [r, g, b] = [0, 0, 0]) {
  const buf = Buffer.alloc(w * h * 3);
  for (let i = 0; i < buf.length; i += 3) {
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
  }
  return {w, h, buf};
}

export function blend(img, x, y, [r, g, b], a = 1) {
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
  const i = (y * img.w + x) * 3;
  const B = img.buf;
  B[i] = B[i] * (1 - a) + r * a;
  B[i + 1] = B[i + 1] * (1 - a) + g * a;
  B[i + 2] = B[i + 2] * (1 - a) + b * a;
}

export function rect(img, x, y, w, h, color, a = 1) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) blend(img, i, j, color, a);
}

/** 把 src 整幅贴到 dst 的 (x,y);越界部分丢弃 */
export function paste(dst, src, x, y) {
  for (let j = 0; j < src.h; j++) {
    const dy = y + j;
    if (dy < 0 || dy >= dst.h) continue;
    for (let i = 0; i < src.w; i++) {
      const dx = x + i;
      if (dx < 0 || dx >= dst.w) continue;
      const s = (j * src.w + i) * 3;
      const d = (dy * dst.w + dx) * 3;
      dst.buf[d] = src.buf[s];
      dst.buf[d + 1] = src.buf[s + 1];
      dst.buf[d + 2] = src.buf[s + 2];
    }
  }
}

/** 面积平均缩放(缩小时比最近邻干净得多;放大时退化为最近邻,够用) */
export function resize(src, uw, uh) {
  const dst = {w: uw, h: uh, buf: Buffer.alloc(uw * uh * 3)};
  const sx = src.w / uw;
  const sy = src.h / uh;
  for (let j = 0; j < uh; j++) {
    const y0 = Math.floor(j * sy);
    const y1 = Math.max(y0 + 1, Math.min(src.h, Math.ceil((j + 1) * sy)));
    for (let i = 0; i < uw; i++) {
      const x0 = Math.floor(i * sx);
      const x1 = Math.max(x0 + 1, Math.min(src.w, Math.ceil((i + 1) * sx)));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const p = (y * src.w + x) * 3;
          r += src.buf[p];
          g += src.buf[p + 1];
          b += src.buf[p + 2];
          n += 1;
        }
      }
      const d = (j * uw + i) * 3;
      dst.buf[d] = r / n;
      dst.buf[d + 1] = g / n;
      dst.buf[d + 2] = b / n;
    }
  }
  return dst;
}

// 5×7 点阵数字(零依赖,不需要系统字体——drawtext 不可用时唯一可靠的画字方式)
export const GLYPH = {
  0: [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  1: [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  2: [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  3: [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  4: [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  5: [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  6: [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  7: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  8: [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  9: [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
};
export const GW = 5;
export const GH = 7;

/** 在 (x,y) 画一个白底黑字的编号标签,返回它占的宽高 */
export function label(img, x, y, text, s) {
  const pad = Math.max(2, Math.round(s * 0.8));
  const tw = text.length * (GW + 1) * s - s;
  const th = GH * s;
  const bw = tw + pad * 2;
  const bh = th + pad * 2;
  rect(img, x, y, bw, bh, [255, 255, 255], 0.95);
  rect(img, x, y, bw, 1, [0, 0, 0], 0.35);
  rect(img, x, y + bh - 1, bw, 1, [0, 0, 0], 0.35);
  let cx = x + pad;
  for (const ch of text) {
    const g = GLYPH[ch];
    if (g) {
      for (let r = 0; r < GH; r++) {
        for (let c = 0; c < GW; c++) {
          if ((g[r] >> (GW - 1 - c)) & 1) rect(img, cx + c * s, y + pad + r * s, s, s, [0, 0, 0], 1);
        }
      }
    }
    cx += (GW + 1) * s;
  }
  return {w: bw, h: bh};
}
