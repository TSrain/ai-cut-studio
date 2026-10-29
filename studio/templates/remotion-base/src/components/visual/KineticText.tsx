import React from 'react';
import {interpolate} from 'remotion';
import type {ScenePalette, TextStyleName, TypographyContext} from '../../lib/theme';
import {alpha, ink as inkDark, textStyle} from '../../lib/theme';
import {ENTER, EXIT, MOVE} from '../../lib/anim';

// 动态文字:四种被验证过的文字入场手法,全部由 `progress` 驱动。
//
// **何时用**:标题、金句、章节名、强调词——即"这句话本身就是画面"的时候。
// **何时不用**:
// - 正文/说明文字 → 整段淡入位移就够,逐字动画会让人读不下去;
// - 已经有别的主体在动 → 文字再动就是两个主角,画面散了;
// - 字幕 → 走 remotion-captions,不是这里。
//
// ============ 硬规则:不许有基于时间的 CSS 循环 ============
//
// 没有 `@keyframes`、没有 `animation`、没有 `transition`。原因不是审美:
// CSS 动画的相位取决于**元素何时挂载**,而离线渲染是一帧一帧独立跑的,
// 抽帧自查看到的和成片不一样,而且两次渲染结果可能都不一样
// (design-principles §9)。这里所有位移/透明度/模糊都是 `progress` 的纯函数。
//
// ============ 四种 mode ============
//
// | mode  | 读起来是 | 用在哪 |
// |---|---|---|
// | mask  | 一句话被"擦"出来 | 章节标题、旁白同步的句子。最克制,几乎不会出错 |
// | slam  | 字砸到位 | 短促的强调词、数字结论、节奏点。必须配硬切/音效 |
// | split | 字被拆开再合拢 | 片头、品牌名。字数 ≤8 时才成立 |
// | morph | 一句话变成另一句 | 概念替换("成本"→"投资")。必须给 `morphTo` |
//
// ============ 踩过的坑 ============
//
// 1. **mask 的遮罩方向必须跟阅读方向一致(左→右)。** 反向擦出来读作"文字在退场"。
//    实现走 `clipPath: inset()`,不是给一个色块盖上去再挪走——盖色块在
//    非纯色背景上会露馅(那块矩形和背景对不上)。
// 2. **slam 的缩放要从大到小(1.28 → 1),不是从小到大。**
//    从小到大是"弹出来"(可爱),从大到小才是"砸下来"(有力)。
//    同时配一点点模糊衰减,读作"高速运动停住",没有模糊只会像在缩放。
// 3. **slam 不能给回弹。** 弹簧回弹会把"砸"读成"跳"。用 ENTER 的强出缓,停就是停。
// 4. **split 必须用 `Array.from(text)` 拆字,不能 `text.split('')`。**
//    后者会把 emoji 和部分生僻字的代理对拆成两个乱码半字。
// 5. **split 的每个字要 `display:inline-block`。** 行内元素吃不到 transform,
//    不加的话整行原地不动,而且完全不报错——这是最难查的一种"没生效"。
// 6. **中文没有词间空格,`white-space: pre` 必须开着**,否则连续空格被折叠,
//    中英混排的排版就和设计稿对不上。
// 7. **morph 的两句话必须叠在同一个格子里**(grid 单元格重叠),不是前后排。
//    用 position:absolute 会让容器塌成 0 高度,外面的布局全跟着跳。
// 8. `color` 必须是 hex(下划线/描边走 `alpha()`)。

export type KineticMode = 'mask' | 'slam' | 'split' | 'morph';

export type KineticTextProps = {
  typography: TypographyContext;
  /** 要显示的文字。`\n` 会被拆成多行,各行独立交错 */
  text: string;
  mode: KineticMode;
  /** 0–1,会被钳到 0–1 */
  progress: number;
  /** 排版角色。默认 'h1' */
  role?: TextStyleName;
  /** 给了就用它的墨色;不给按深色画面默认墨色 */
  palette?: ScenePalette;
  /** 覆盖文字颜色,必须是 hex */
  color?: string;
  /** morph 模式的目标文字。mode='morph' 时必填 */
  morphTo?: string;
  align?: 'left' | 'center' | 'right';
  /** 交错强度 0–1:0 = 全体同时,1 = 完全依次。默认 0.55 */
  stagger?: number;
  style?: React.CSSProperties;
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** 第 i / n 项的子进度。stagger=0 时所有项同相位。 */
const windowed = (
  p: number,
  i: number,
  n: number,
  stagger: number,
  easing: (t: number) => number = ENTER,
) => {
  const span = 1 - clamp01(stagger) * (n > 1 ? 0.72 : 0);
  const step = n > 1 ? (1 - span) / (n - 1) : 0;
  return interpolate(p, [i * step, i * step + span], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing,
  });
};

export const KineticText: React.FC<KineticTextProps> = ({
  typography,
  text,
  mode,
  progress,
  role = 'h1',
  palette,
  color,
  morphTo,
  align = 'left',
  stagger = 0.55,
  style,
}) => {
  const p = clamp01(progress);
  const ink = color ?? palette?.ink ?? inkDark.primary;
  const base: React.CSSProperties = {
    ...textStyle(typography, role),
    color: ink,
    textAlign: align,
    // 坑 6
    whiteSpace: 'pre',
  };
  const lines = text.split('\n');

  if (mode === 'morph') {
    if (!morphTo) {
      throw new Error(
        'KineticText: mode="morph" 必须给 morphTo。' +
          '没有目标文字的 morph 只是淡出,那用不着这个组件。',
      );
    }
    // 坑 7:两句叠在同一个 grid 单元里,容器高度取两者较高的那个
    const outP = interpolate(p, [0, 0.48], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: EXIT,
    });
    const inP = interpolate(p, [0.42, 1], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: ENTER,
    });
    return (
      <div style={{display: 'grid', ...style}}>
        <div
          style={{
            ...base,
            gridArea: '1 / 1',
            opacity: 1 - outP,
            transform: `translateY(${-outP * 22}px) scale(${1 - outP * 0.06})`,
            filter: `blur(${outP * 10}px)`,
          }}
        >
          {text}
        </div>
        <div
          style={{
            ...base,
            gridArea: '1 / 1',
            opacity: inP,
            transform: `translateY(${(1 - inP) * 26}px) scale(${0.96 + inP * 0.04})`,
            filter: `blur(${(1 - inP) * 12}px)`,
          }}
        >
          {morphTo}
        </div>
      </div>
    );
  }

  if (mode === 'mask') {
    return (
      <div style={{...base, ...style}}>
        {lines.map((line, i) => {
          const lp = windowed(p, i, lines.length, stagger);
          return (
            <div
              key={i}
              style={{
                // 坑 1:左→右的 inset 裁剪,不是盖色块
                clipPath: `inset(-0.2em ${(1 - lp) * 100}% -0.3em 0)`,
                // 轻微上移:纯裁剪会读成"打印机在出纸",加一点位移才是"进场"
                transform: `translateY(${(1 - lp) * 12}px)`,
              }}
            >
              {line}
            </div>
          );
        })}
      </div>
    );
  }

  if (mode === 'slam') {
    // 逐行砸。行内不再拆字——一行里的字分别砸会读成"打字机",不是"砸"
    return (
      <div style={{...base, ...style}}>
        {lines.map((line, i) => {
          // 坑 3:ENTER 是强出缓,没有回弹
          const lp = windowed(p, i, lines.length, stagger);
          // 坑 2:1.28 → 1,配模糊衰减
          const scale = interpolate(lp, [0, 1], [1.28, 1]);
          const blur = interpolate(lp, [0, 0.6, 1], [14, 2, 0], {
            extrapolateRight: 'clamp',
          });
          return (
            <div
              key={i}
              style={{
                opacity: interpolate(lp, [0, 0.25], [0, 1], {
                  extrapolateRight: 'clamp',
                }),
                transform: `scale(${scale})`,
                transformOrigin:
                  align === 'center' ? 'center' : align === 'right' ? 'right' : 'left',
                filter: `blur(${blur}px)`,
              }}
            >
              {line}
            </div>
          );
        })}
      </div>
    );
  }

  // mode === 'split'
  // 坑 4:Array.from 按码位拆,不是 split('')
  const splitLines = lines.map((line) => Array.from(line));
  // 交错序号必须**跨行连续**:每行各自从 0 数会让第二行的第一个字
  // 和第一行的第一个字同时出现,读成"两行分别在动"而不是"一句话被拆开"
  const lineOffset: number[] = [];
  let running = 0;
  for (const chars of splitLines) {
    lineOffset.push(running);
    running += chars.length;
  }
  const totalChars = Math.max(1, running);

  return (
    <div style={{...base, ...style}}>
      {splitLines.map((chars, li) => {
        return (
          <div key={li} style={{display: 'block'}}>
            {chars.map((ch, ci) => {
              const cp = windowed(p, lineOffset[li] + ci, totalChars, stagger, MOVE);
              // 奇偶分上下:同向位移读成"整块在动",分向才读成"被拆开过"
              const dir = ci % 2 === 0 ? -1 : 1;
              return (
                <span
                  key={ci}
                  style={{
                    // 坑 5:必须 inline-block,否则 transform 静默失效
                    display: 'inline-block',
                    transform: `translateY(${(1 - cp) * 46 * dir}px) rotate(${
                      (1 - cp) * 5 * dir
                    }deg)`,
                    opacity: cp,
                    // 空格拆出来后宽度会塌,给它一个显式宽度
                    minWidth: ch === ' ' ? '0.32em' : undefined,
                  }}
                >
                  {ch}
                </span>
              );
            })}
            {/* 尾部一条随进度展开的强调线:split 常用于片头,一条线能把散开的字收住。
                **只画在最后一行下面**——每行都画会变成表格框线 */}
            {li === splitLines.length - 1 ? (
              <div
                style={{
                  height: 3,
                  marginTop: 14,
                  background: alpha(ink, 0.34),
                  width: `${clamp01(interpolate(p, [0.5, 1], [0, 1])) * 100}%`,
                  marginLeft: align === 'right' ? 'auto' : undefined,
                  marginRight: align === 'center' ? 'auto' : undefined,
                }}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
};
