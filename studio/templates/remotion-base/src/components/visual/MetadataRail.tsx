import React from 'react';
import {interpolate} from 'remotion';
import type {ScenePalette, TypographyContext} from '../../lib/theme';
import {alpha, textStyle} from '../../lib/theme';
import {ENTER, staggerDelay} from '../../lib/anim';

// 元数据边栏:贴着画面一侧的一列结构性信息(镜号、时间码、单位、来源、章节)。
//
// 解决什么问题:密度不能靠"多摆几个装饰方块"堆出来——那是假密度,
// lint 过得了、观众一眼看出是填充物。真密度来自**真信息的层次**:
// 主焦点之外还有一圈可读但不抢戏的元数据,画面就像"一个系统的界面"而不是一张海报。
// 这是 visual-max 里「三个主要语义层级 + 微型元数据(眉题/单位/时间码/署名)不计入」
// 那一条的执行件。
//
// 何时用:数据镜、界面镜、任何需要"这是第几镜 / 数据到什么时候 / 单位是什么"的画面。
// 何时不用:**没有真信息可写的时候**。编一个 "SYS.4471" 出来假装专业,
//   是本组件唯一的滥用方式,也是明令禁止的(props 的 items 必须来自 brief / storyboard /
//   真实数据源)。宁可不放这条边栏。
//
// 踩过的坑:
//
// 1. **序号是组件自动生成的(01、02……),不许调用方传。** 传进来的序号迟早和顺序对不上
//    (插一条忘了改号),那正好是"假信息"的开始。要不同的编号体系就写进 `label`。
// 2. **序号和值都必须 `tabular-nums`。** 比例数字下 "01→02" 宽度不同,整列会左右抖。
// 3. **值的字号不能大于 label 的两倍。** 边栏一旦有一行比主体还显眼,它就不再是元数据,
//    而是第二个焦点——这时候该把它挪进主体层,不是继续放大。
// 4. **`side` 决定的是发丝线在哪一侧 + 文字对齐,不是靠 `direction: rtl`。** 用 rtl 会把
//    中英混排里的标点位置一起翻掉(逗号跑到左边),那是排版事故。
// 5. **每条之间的分隔用 `borderTop` 发丝线,不要用点或图标。** 点和图标不携带信息,
//    属于 design-principles §8 禁的装饰;发丝线是结构(它划分条目)。
// 6. `accent` **必须是 hex**:竖线渐变和序号色都走 `alpha()`,别的格式算出 NaN 会让它们消失。
//
// 1080×1920 安全区行为:
//   本组件不做绝对定位。**在竖版里的标准用法是**:放进 StageLayers 的 midground,
//   由 `safeArea` 提供左右各 96 的边距,再用 flex 把它推到一侧;或者调用方自己写
//   `position:'absolute', left: safeVertical.x`(左栏)/ `right: safeVertical.x`(右栏)。
//   竖版画面的可用宽度是 888,边栏建议 200–280 宽,**不要超过 1/3**——
//   再宽就不是边栏了,主体会被挤成一条。组件自己不设宽度,宽度由调用方容器给。

export type MetadataItem = {
  /** 结构性标签:'镜号' / '数据截止' / '单位' / '来源'。必须是真的。 */
  label: string;
  /** 值:'SHOT 03' / '2026-07' / '亿元' / 'SEC 10-K'。必须是真的(坑 1 的原因)。 */
  value: string;
};

export type MetadataRailProps = {
  typography: TypographyContext;
  /** 条目。顺序即序号顺序;组件自动编 01、02……(坑 1)。 */
  items: MetadataItem[];
  /** 边栏贴哪一侧。决定发丝线位置与文字对齐(坑 4)。 */
  side: 'left' | 'right';
  /** 0–1 归一化编排进度。会被钳到 0–1;条目按 stagger 依次进入。 */
  progress: number;
  /** 强调色(hex)。染序号和竖线。 */
  accent?: string;
  /** 给了就用 palette 的墨色阶梯;不给则退到中性白阶(**只在深色底上成立**)。 */
  palette?: ScenePalette;
  /** 是否显示自动序号。数据来源类边栏可以关掉。默认 true。 */
  showIndex?: boolean;
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export const MetadataRail: React.FC<MetadataRailProps> = ({
  typography,
  items,
  side,
  progress,
  accent,
  palette,
  showIndex = true,
}) => {
  const p = clamp01(progress);
  const ink = palette?.ink ?? 'rgba(255,255,255,0.95)';
  const inkMuted = palette?.inkMuted ?? 'rgba(255,255,255,0.55)';
  const line = palette?.line ?? 'rgba(255,255,255,0.18)';
  const mark = accent ?? inkMuted;

  const alignItems = side === 'right' ? 'flex-end' : 'flex-start';
  const textAlign: React.CSSProperties['textAlign'] = side === 'right' ? 'right' : 'left';

  // 竖线:整条边栏的"脊柱",它先长出来,条目再挂上去
  const spine = interpolate(p, [0, 0.34], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ENTER,
  });

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: side === 'right' ? 'row-reverse' : 'row',
        gap: 20,
        alignItems: 'stretch',
      }}
    >
      {/* 脊柱:竖向发丝线,自上而下长出。是结构不是装饰(它标出边栏的范围) */}
      <div
        style={{
          width: 2,
          flexShrink: 0,
          borderRadius: 1,
          background: `linear-gradient(180deg, ${alpha(mark, 0.85)} 0%, ${alpha(mark, 0.08)} 100%)`,
          transformOrigin: 'top',
          transform: `scaleY(${spine})`,
        }}
      />

      <div style={{display: 'flex', flexDirection: 'column', alignItems, minWidth: 0}}>
        {items.map((item, i) => {
          // stagger:每条延后 0.06 个归一化单位,和 anim.staggerDelay 的 2 帧同一节奏
          const d = staggerDelay(i, 0, 0.06);
          const t = interpolate(p, [0.2 + d, 0.55 + d], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: ENTER,
          });
          return (
            <div
              key={`${item.label}-${i}`}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '14px 0',
                // 坑 5:条目分隔用发丝线,第一条不画
                borderTop: i === 0 ? 'none' : `1px solid ${alpha(line, 0.9)}`,
                display: 'flex',
                flexDirection: 'column',
                alignItems,
                textAlign,
                gap: 4,
                opacity: t,
                transform: `translateX(${(1 - t) * (side === 'right' ? 16 : -16)}px)`,
              }}
            >
              <div
                style={{
                  ...textStyle(typography, 'caption'),
                  fontFamily: typography.families.mono,
                  letterSpacing: '0.16em',
                  color: inkMuted,
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  flexDirection: side === 'right' ? 'row-reverse' : 'row',
                  gap: 8,
                  // 坑 2
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {showIndex ? (
                  <span style={{color: mark}}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                ) : null}
                <span>{item.label}</span>
              </div>
              <div
                style={{
                  // 坑 3:值最多到 label 令牌(32),不再往上
                  ...textStyle(typography, 'label'),
                  fontFamily: typography.families.mono,
                  fontWeight: 600,
                  letterSpacing: '0.02em',
                  color: ink,
                  fontVariantNumeric: 'tabular-nums',
                  whiteSpace: 'nowrap',
                }}
              >
                {item.value}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
