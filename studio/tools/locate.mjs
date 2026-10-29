#!/usr/bin/env node
/* locate.mjs — 在图片里定位"某个东西"的位置,不需要任何检测 API 或 key。
 *
 * 为什么需要它:模型直接目测像素坐标很不准(实测中心点平均误差 6.5%,圈注会落在
 * 目标外面),但"目标压在第几号条带上"这种离散选择很准。所以定位 = 在编号网格上
 * 选条带,再几何反推包围盒(RSVP grid-index,ACL 2025 long.715)。实测同一套流程下
 * 平均中心误差从 6.5% 降到 2.3%,且没有一例变差。
 *
 * 零 npm 依赖。ffmpeg 只用来解码/编码(rawvideo rgb24),网格线、编号、裁切、放大、
 * 标框全部在 JS 里做像素运算——因此不依赖 drawtext/drawbox 滤镜(本机 homebrew
 * ffmpeg 就没编译 drawtext,原版实现在这里会直接崩)。
 *
 * 协议全文:docs/locate-protocol.md
 *
 * 循环(每一步之间你要用 Read 看图):
 *   1) node tools/locate.mjs overlay <图> --out DIR
 *        → DIR/gv.png(纵向条带 1..9)+ DIR/gh.png(横向条带 1..9)
 *        读这两张图,挑出目标**压到的每一条**条带号。
 *   2) node tools/locate.mjs region <图> --vids 4,5 --hids 6,7 --out DIR
 *        → 打印粗区域 + 写 DIR/gc.png(该区域裁切放大,更细的 6×6 网格)
 *        读 gc.png,再挑一次条带号(仍然是挑号,不要改成估坐标)。
 *   3) node tools/locate.mjs final <图> --region x0,y0,x1,y1 --vids 3,4 --hids 3,4
 *        → {box, center},归一化到整张图的 0..1
 *   4) node tools/locate.mjs mark <图> --box x0,y0,x1,y1 --out DIR/check.png
 *        → 必做:读 check.png,红框在目标上吗?偏了就带着修正后的条带号重跑 2/3。
 *           这一步把"静默偏移"变成"一次便宜的重试",不许跳过。
 */
import { decode, encode, rect, label, GW, GH } from "./lib/pixels.mjs";

const N1 = 9, PAD1 = 0.4; // 第一阶段:每轴条带数,padding 以"条带"为单位
const N2 = 6, PAD2 = 0.25; // 第二阶段(裁切后)
const GREEN = [60, 220, 90], BLUE = [60, 130, 255], RED = [255, 50, 50];

// 编解码与像素绘制原语在 tools/lib/pixels.mjs(与 preset-preview 共用同一份点阵字与 rect/label)

function drawGrid(img, n, axis, s) {
  const { w, h } = img;
  if (axis === "v" || axis === "both") {
    for (let i = 1; i < n; i++) rect(img, Math.round((i * w) / n), 0, 2, h, GREEN, 0.85);
    for (let i = 0; i < n; i++) {
      const t = String(i + 1);
      const lw = t.length * (GW + 1) * s - s + Math.max(2, Math.round(s * 0.8)) * 2;
      label(img, Math.round(((i + 0.5) * w) / n - lw / 2), 6, t, s);
    }
  }
  if (axis === "h" || axis === "both") {
    for (let j = 1; j < n; j++) rect(img, 0, Math.round((j * h) / n), w, 2, BLUE, 0.85);
    for (let j = 0; j < n; j++) {
      const t = String(j + 1);
      const lh = GH * s + Math.max(2, Math.round(s * 0.8)) * 2;
      label(img, 6, Math.round(((j + 0.5) * h) / n - lh / 2), t, s);
    }
  }
}

// 裁切 + 双线性放大(替代 ffmpeg crop/scale,保持整条流水线在内存里)
function cropScale(src, cx, cy, cw, ch, uw, uh) {
  const dst = { w: uw, h: uh, buf: Buffer.alloc(uw * uh * 3) };
  for (let y = 0; y < uh; y++) {
    const sy = Math.min(ch - 1, (y * ch) / uh), y0 = Math.floor(sy), fy = sy - y0;
    const y1 = Math.min(ch - 1, y0 + 1);
    for (let x = 0; x < uw; x++) {
      const sx = Math.min(cw - 1, (x * cw) / uw), x0 = Math.floor(sx), fx = sx - x0;
      const x1 = Math.min(cw - 1, x0 + 1);
      const o = (y * uw + x) * 3;
      for (let k = 0; k < 3; k++) {
        const p = (yy, xx) => src.buf[((cy + yy) * src.w + (cx + xx)) * 3 + k];
        dst.buf[o + k] =
          p(y0, x0) * (1 - fx) * (1 - fy) + p(y0, x1) * fx * (1 - fy) +
          p(y1, x0) * (1 - fx) * fy + p(y1, x1) * fx * fy;
      }
    }
  }
  return dst;
}

// ── 几何 ───────────────────────────────────────────────────────────
const ids = (s) => String(s).split(",").filter(Boolean).map(Number);
const regionOf = (v, h, n, pad) => [
  Math.max(Math.min(...v) - 1 - pad, 0) / n,
  Math.max(Math.min(...h) - 1 - pad, 0) / n,
  Math.min(Math.max(...v) + pad, n) / n,
  Math.min(Math.max(...h) + pad, n) / n,
];
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const out = (o) => console.log(JSON.stringify(o, null, 2));
const glyphScale = (w, h) => Math.max(2, Math.round(Math.min(w, h) / 150));

// ── 极简参数解析: locate.mjs <cmd> <img> --k v ───────────────────────
const [cmd, ...rest] = process.argv.slice(2);
const pos = rest.filter((a) => !a.startsWith("--"));
const opt = {};
for (let i = 0; i < rest.length; i++) if (rest[i].startsWith("--")) opt[rest[i].slice(2)] = rest[i + 1];
const img = pos[0];
const need = (k) => { if (!opt[k]) { console.error(`缺少 --${k}`); process.exit(2); } return opt[k]; };

if (cmd === "overlay") {
  const dir = opt.out || ".";
  const n = Number(opt.n || N1);
  const src = decode(img);
  const s = glyphScale(src.w, src.h);
  for (const [axis, name] of [["v", "gv.png"], ["h", "gh.png"]]) {
    const im = { w: src.w, h: src.h, buf: Buffer.from(src.buf) };
    drawGrid(im, n, axis, s);
    encode(im, `${dir}/${name}`);
  }
  out({
    w: src.w, h: src.h, n,
    vertical: `${dir}/gv.png`, horizontal: `${dir}/gh.png`,
    next: `用 Read 看 gv.png 和 gh.png,挑出目标压到的所有条带号,然后: locate.mjs region <图> --vids .. --hids .. --out ${dir}`,
  });

} else if (cmd === "region") {
  const dir = opt.out || ".";
  const n = Number(opt.n || N1), nf = Number(opt.nf || N2);
  const reg = regionOf(ids(need("vids")), ids(need("hids")), n, PAD1);
  const src = decode(img);
  const cx = Math.floor(reg[0] * src.w), cy = Math.floor(reg[1] * src.h);
  const cw = Math.max(2, Math.min(src.w - cx, Math.floor((reg[2] - reg[0]) * src.w)));
  const ch = Math.max(2, Math.min(src.h - cy, Math.floor((reg[3] - reg[1]) * src.h)));
  const uw = Math.max(cw, 900), uh = Math.max(2, Math.round((ch * uw) / cw));
  const im = cropScale(src, cx, cy, cw, ch, uw, uh);
  drawGrid(im, nf, "both", glyphScale(uw, uh));
  encode(im, `${dir}/gc.png`);
  out({
    region: reg.map(r4), crop_grid: `${dir}/gc.png`, nf,
    next: `用 Read 看 gc.png 再挑一次条带号(不要改成估坐标),然后: locate.mjs final <图> --region ${reg.map(r4).join(",")} --vids .. --hids ..`,
  });

} else if (cmd === "final") {
  const nf = Number(opt.nf || N2);
  const reg = need("region").split(",").map(Number);
  const rl = regionOf(ids(need("vids")), ids(need("hids")), nf, PAD2);
  const [x0, y0, x1, y1] = reg;
  const box = [
    x0 + rl[0] * (x1 - x0), y0 + rl[1] * (y1 - y0),
    x0 + rl[2] * (x1 - x0), y0 + rl[3] * (y1 - y0),
  ].map(r4);
  out({
    box, center: [r4((box[0] + box[2]) / 2), r4((box[1] + box[3]) / 2)],
    next: `必做验证: locate.mjs mark <图> --box ${box.join(",")} --out <dir>/check.png,然后用 Read 看它`,
  });

} else if (cmd === "mark") {
  const box = need("box").split(",").map(Number);
  const im = decode(img);
  const bx = Math.round(box[0] * im.w), by = Math.round(box[1] * im.h);
  const bw = Math.max(2, Math.round((box[2] - box[0]) * im.w));
  const bh = Math.max(2, Math.round((box[3] - box[1]) * im.h));
  const t = Math.max(3, Math.round(Math.min(im.w, im.h) / 250));
  rect(im, bx, by, bw, t, RED); rect(im, bx, by + bh - t, bw, t, RED);
  rect(im, bx, by, t, bh, RED); rect(im, bx + bw - t, by, t, bh, RED);
  const dst = opt.out || "./check.png";
  encode(im, dst);
  out({ marked: dst, next: "用 Read 看它——红框套在目标上了吗?偏了就带修正后的条带号重跑 region/final。" });

} else {
  console.error("用法: locate.mjs overlay|region|final|mark …(见文件头注释与 docs/locate-protocol.md)");
  process.exit(1);
}
