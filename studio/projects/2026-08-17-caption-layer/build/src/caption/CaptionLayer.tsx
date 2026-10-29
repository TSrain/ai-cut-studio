import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing} from 'remotion';
import {
  layoutFor, INK, inkRatioForText, BASELINE_SHIFT, CENTER, COLOR, shadowPx as shadowPxOf, ENTER, EXIT, fontFamily,
  type Role, type EnterKind, type Layout,
} from './spec';

/** 档位的墨高(占画幅高)。横屏整套放大 layout.inkScale 倍,见 spec 的 LAYOUT_LANDSCAPE */
const inkOf = (role: Role, layout: Layout) => INK[role] * layout.inkScale;

/* ────────────────────────────── 数据结构 ──────────────────────────────
 * 一个 block 是"同时挂在屏幕上的一组行"。行有各自的 in 时间,
 * 所以「上一行不动、下面追加一行」就是同一个 block 里两行不同 in。
 * block.out 之后整块一起走慢淡出场,和下一个 block 重叠——这是原片的关键。 */

/**
 * run 是行内的一段。`in` 让一段字比同一行的其他字晚出现——
 * 原片 2.8s 的「系统」就是这样滑到「都没听说过的」后面的。
 *
 * ⚠️ 晚出现的 run **始终占位**,只有透明度和位移在动。
 *    如果让它不占位、出现时再撑开,整行就会重新居中——那正是原片全片都在避免的重排。
 */
export type Run = {t: string; c?: 'white' | 'amber'; in?: number; enter?: 'slide' | 'fade'};
export type Line = {role: Role; in: number; enter?: EnterKind; runs: Run[]; center?: number};
export type Block = {in: number; out: number; lines: Line[]; /** 出场残影不透明度 0–1,默认 0 = 干净切走 */ ghost?: number};
export type CaptionScript = {durationSeconds: number; blocks: Block[]};

/* ⚠️ 这个文件的**出入场逻辑有第二份实现**:控制台「改字幕」区的实时预览
 *    (`tools/lib/panel-page.html` 的 capLineHTML / capBlockHTML)。
 *    常数不用同步(那边从本目录的 spec.ts 转译过来),但**动效逻辑改了这里就得改那边**,
 *    否则用户在控制台里调得满意的东西和渲出来的不是一个。
 *    验证手段是控制台上的「对拍一帧」:用这个渲染器渲同一时刻,和预览比。
 *    实测两边墨迹框差 ≤0.21% 画幅(见 ../../CALIBRATION.md)。
 */

/* ────────────────────────────── 单行 ────────────────────────────── */

const Text: React.FC<{runs: Run[]; base: string; fontSize: number; shadow: string; t: number}> = ({
  runs, base, fontSize, shadow, t,
}) => (
  <span style={{fontFamily, fontWeight: 700, fontSize, lineHeight: 1, whiteSpace: 'pre', textShadow: shadow}}>
    {runs.map((r, i) => {
      // 没有 in 的 run 一直在;有 in 的 run 在到点前是全透明的**占位符**(不是不存在)
      let opacity = 1;
      let dx = 0;
      if (r.in !== undefined) {
        const since = t - r.in;
        const d = 0.24;
        opacity = interpolate(since, [0, d * 0.4], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
        if (r.enter !== 'fade') {
          dx = interpolate(since, [0, d], [fontSize * 1.1, 0], {
            extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
          });
        }
      }
      return (
        <span
          key={i}
          style={{
            color: r.c === 'amber' ? COLOR.amber : base,
            opacity,
            display: 'inline-block',
            transform: dx ? `translateX(${dx.toFixed(1)}px)` : undefined,
          }}
        >
          {r.t}
        </span>
      );
    })}
  </span>
);

/** 两个 hex 颜色按 k 混合。弹入换色用它做平滑过渡,避免硬切 */
const mixHex = (a: string, b: string, k: number) => {
  if (k <= 0) return a;
  if (k >= 1) return b;
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r1, g1, b1] = p(a), [r2, g2, b2] = p(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * k).toString(16).padStart(2, '0');
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`;
};

const LineView: React.FC<{line: Line; layout: Layout; W: number; H: number; fps: number; blockOut: number; ghostOpacity: number}> = ({
  line, layout, W, H, fps, blockOut, ghostOpacity,
}) => {
  const frame = useCurrentFrame();
  const t = frame / fps;
  const fontSize = (inkOf(line.role, layout) * H) / inkRatioForText(line.runs.map((r) => r.t).join(''));
  const sh = shadowPxOf(W, H);
  const shadow = `${sh.toFixed(1)}px ${sh.toFixed(1)}px 0 rgba(0,0,0,.85)`;
  const kind: EnterKind = line.enter ?? 'cut';
  const since = t - line.in;

  if (since < 0) return null;

  /* ── 出场 ──
     默认 ghostOpacity=0 → 2 帧内切净,不留痕(实测原片多数转场就是这样)。
     ghostOpacity>0 → 掉到该值、平住 holdSeconds、然后瞬间归零(原片 61.7s 那种重叠)。
     注意是「平住后硬切」不是缓动淡出:实测曲线在 1.3 秒里几乎是一条水平线。 */
  const sinceOut = t - blockOut;
  let exitOpacity = 1;
  let ghosted = false;
  if (sinceOut >= 0) {
    const cutT = EXIT.cutFrames / fps;
    if (ghostOpacity <= 0) {
      exitOpacity = interpolate(sinceOut, [0, cutT], [1, 0], {extrapolateRight: 'clamp'});
    } else {
      ghosted = sinceOut >= cutT;
      exitOpacity =
        sinceOut < cutT
          ? interpolate(sinceOut, [0, cutT], [1, ghostOpacity])
          : sinceOut < cutT + EXIT.holdSeconds
            ? ghostOpacity
            : 0;
    }
    if (exitOpacity <= 0.002) return null;
  }

  const base = ghosted ? COLOR.ghost : COLOR.white;

  /* ── 入场 ── */
  let dx = 0, scale = 1, enterOpacity = 1, flashMix = 0, clipRight = 0, headX: number | null = null;

  if (kind === 'whip') {
    const d = ENTER.whip.duration;
    dx = interpolate(since, [0, d], [ENTER.whip.fromX * W, 0], {
      extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
    });
    enterOpacity = interpolate(since, [0, d * 0.35], [0, 1], {extrapolateRight: 'clamp'});
  } else if (kind === 'pop') {
    const d = ENTER.pop.duration;
    scale = interpolate(since, [0, d * 0.68, d], [ENTER.pop.fromScale, ENTER.pop.overshoot, 1], {
      extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
    });
    enterOpacity = interpolate(since, [0, d * 0.3], [0, 1], {extrapolateRight: 'clamp'});
    // 辉光:先闪亮黄再落回目标色
    flashMix = interpolate(since, [0, d * 0.5, d * 1.9], [1, 0.75, 0], {extrapolateRight: 'clamp'});
  } else if (kind === 'write') {
    const chars = line.runs.reduce((n, r) => n + r.t.length, 0);
    const total = chars * ENTER.write.perChar;
    const p = interpolate(since, [0, total], [0, 1], {extrapolateRight: 'clamp'});
    // 按字取整,得到"一个字一个字蹦出来"而不是平滑抹开
    const shown = Math.min(chars, Math.floor(p * chars + 0.0001));
    clipRight = 1 - shown / chars;
    if (p < 1) headX = shown / chars;
  }

  /* 方向性动态模糊:Chrome 的 filter:blur 是各向同性的,做不出横向拖影。
     用一串沿 X 递减的残影叠出来——这也是原片那一帧的实际观感(离散的重影,不是均匀糊)。 */
  const blurGhosts =
    kind === 'whip' && dx > 2
      ? Array.from({length: ENTER.whip.ghosts}, (_, i) => {
          const k = (i + 1) / ENTER.whip.ghosts;
          return {x: dx * k * 0.55, o: (1 - k) * 0.34};
        })
      : [];

  const centerFrac = line.center ?? CENTER[line.role];
  // 辉光半径由 spec 给(默认 0 = 关掉)。半径写死 0.03×H 会让弹入的那一下糊成一团黄。
  const glowR = (ENTER.pop as {glowRadius?: number}).glowRadius ?? 0;
  const glow = flashMix > 0 && glowR > 0 ? `0 0 ${(glowR * H * flashMix).toFixed(0)}px ${COLOR.flash}` : '';
  const fullShadow = glow ? `${shadow}, ${glow}` : shadow;

  return (
    <div
      style={{
        position: 'absolute',
        left: 0, right: 0,
        display: 'flex',
        justifyContent: 'center',
        opacity: exitOpacity * enterOpacity,
        filter: ghosted ? 'grayscale(1)' : undefined,
      }}
    >
      {/* 用 translateX 把行心推到 centerFrac —— 这样"标签行偏左上、术语行偏右下"的对角错位
          就是一个数,不用手摆。实测 41% / 56%。 */}
      <div
        style={{
          transform: `translateX(${((centerFrac - 0.5) * W).toFixed(1)}px) translateX(${dx.toFixed(1)}px) scale(${scale.toFixed(4)})`,
          transformOrigin: 'center center',
          position: 'relative',
          maxWidth: layout.maxLineWidth * W,
        }}
      >
        {blurGhosts.map((g, i) => (
          <div key={i} style={{position: 'absolute', inset: 0, transform: `translateX(${g.x.toFixed(1)}px)`, opacity: g.o}}>
            <Text runs={line.runs} base={base} fontSize={fontSize} shadow="none" t={t} />
          </div>
        ))}
        <div style={{clipPath: clipRight > 0 ? `inset(-20% ${(clipRight * 100).toFixed(2)}% -20% -20%)` : undefined}}>
          {/* 换色用平滑过渡,不再在 flashMix=0.5 处硬切 —— 硬切会看到字"啪"地变黄再"啪"地变回来 */}
          <Text runs={line.runs} base={mixHex(base, COLOR.flash, Math.min(1, flashMix * 0.85))} fontSize={fontSize} shadow={fullShadow} t={t} />
        </div>
        {headX !== null && (
          <div
            style={{
              position: 'absolute', top: '50%', left: `${(headX * 100).toFixed(2)}%`,
              width: fontSize * 0.5, height: fontSize * 1.15,
              transform: 'translate(-50%,-50%)',
              background: `radial-gradient(closest-side, ${COLOR.head} 0%, rgba(255,216,77,.55) 45%, transparent 78%)`,
            }}
          />
        )}
      </div>
    </div>
  );
};

/* ────────────────────────────── 块 ──────────────────────────────
 * 行从底边(baseline)往上码。**按最终行数预留**——第一行一出场就站在它的最终位置,
 * 不会等第二行来了再被顶上去。这是原片最容易被忽略、也最影响观感的一条。 */

const BlockView: React.FC<{block: Block; layout: Layout; W: number; H: number; fps: number}> = ({
  block, layout, W, H, fps,
}) => {
  const bottom = layout.baseline * H;
  const gap = layout.lineGap * H;

  // 从最后一行往上累加:第 i 行的墨迹底边
  const inkH = block.lines.map((l) => inkOf(l.role, layout) * H);
  const bottoms: number[] = [];
  let acc = bottom;
  for (let i = block.lines.length - 1; i >= 0; i--) {
    // 数字档要下探到 baseline 以下,见 spec.BASELINE_SHIFT
    bottoms[i] = acc + (BASELINE_SHIFT[block.lines[i].role] ?? 0) * H;
    acc = acc - inkH[i] - gap;
  }

  return (
    <>
      {block.lines.map((line, i) => {
        const fontSize = (inkOf(line.role, layout) * H) / inkRatioForText(line.runs.map((r) => r.t).join(''));
        // 墨迹底边 → 容器 top。字身框比墨迹高,居中放置补差值。
        const top = bottoms[i] - inkH[i] - (fontSize - inkH[i]) / 2;
        return (
          <div key={i} style={{position: 'absolute', left: 0, right: 0, top}}>
            <LineView line={line} layout={layout} W={W} H={H} fps={fps} blockOut={block.out}
              ghostOpacity={block.ghost ?? EXIT.ghostOpacity} />
          </div>
        );
      })}
    </>
  );
};

/* ────────────────────────────── 层 ────────────────────────────── */

export const CaptionLayer: React.FC<{script: CaptionScript}> = ({script}) => {
  const {width: W, height: H, fps} = useVideoConfig();
  const frame = useCurrentFrame();
  const t = frame / fps;
  // 竖屏 / 横屏两套版式常数,按画幅宽高比自动选。脚本本身不区分比例
  const layout = layoutFor(W, H);
  const tail = EXIT.cutFrames / fps + EXIT.holdSeconds;

  return (
    // 背景必须留空:这一层要带 alpha 渲成 ProRes 4444,任何底色都会把透明填掉
    <AbsoluteFill style={{backgroundColor: 'transparent'}}>
      {script.blocks.map((b, i) =>
        t >= b.in - 0.001 && t <= b.out + tail ? (
          <BlockView key={i} block={b} layout={layout} W={W} H={H} fps={fps} />
        ) : null,
      )}
    </AbsoluteFill>
  );
};
