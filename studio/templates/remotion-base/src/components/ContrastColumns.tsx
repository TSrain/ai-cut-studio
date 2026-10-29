import React from 'react';
import {useCurrentFrame} from 'remotion';
import {ENTER, progress} from '../lib/anim';
import {surface, ink, seriesDark} from '../lib/theme';
import type {TypographyContext} from '../lib/theme';

// 对照双列:「A ≠ B」「旧 vs 新」这类一对一对照的标准版式(竖版友好)。
//
// 三个已验证的要点(照抄自实拍验证过的镜头,别自己重发明):
// 1. **绝不左右同时淡入。**逐个出——左列先到位,右列再出,然后中线,最后中央符号。
//    同时淡入观众不知道先读哪边,对照关系反而糊掉。
// 2. **各列贴中线向内对齐**(左列右对齐 / 右列左对齐),两列内缘距中线留同样的 gap
//    给中央符号让位。这样两侧重点句在视觉上"面对面",对照关系一眼可读。
// 3. **中央符号压一个底色圆盘**,把中线交叉处 knockout 掉,符号才能干净地"填进"线的缺口,
//    不与线打架。圆盘色 = 画面底色。
//
// 语义靠色承载:默认左侧用弱化墨色(不值得/被动的一方),右侧用强调色(值得/主动的一方)。
// 这是"颜色必须承载意义"(design-principles §5),不是装饰。

export type ContrastSide = {
  /** 小灰标签,如「平台要的:」 */
  label: string;
  /** 大重点句。用 \n 主动折行——窄竖版里放大字号靠折行,不靠改字。 */
  payoff: string;
  /** 图标,建议 <SemanticIcon size={88} .../>。不给则不占位。 */
  icon?: React.ReactNode;
  /** 重点句颜色。默认左 ink.secondary / 右 seriesDark[0]。 */
  color?: string;
};

export const ContrastColumns: React.FC<{
  /** 字体套装,必填。组件不挑默认字体——那会让画面性格取决于谁先写的组件。 */
  typography: TypographyContext;
  left: ContrastSide;
  right: ContrastSide;
  /** 中央符号,如 ≠ / vs / →。给 null 则不画符号和圆盘。 */
  symbol?: string | null;
  /** 画面宽度,用于算中线。竖版 1080。 */
  width?: number;
  /** 内容垂直中心。竖版建议落在安全区内(如 940)。 */
  centerY?: number;
  /** 每列内缘距中线的距离,给中央符号让位。 */
  halfGap?: number;
  /** 左右安全边距。 */
  margin?: number;
  /** 时间线(帧):左列 → 右列 → 中线 → 符号。默认 0/22/44/60,总节奏约 2.5s 到位。 */
  timing?: {left: number; right: number; divider: number; symbol: number};
  /** 中线长度。 */
  dividerHeight?: number;
  /** 圆盘底色,必须等于画面底色才能 knockout 干净。 */
  knockoutColor?: string;
  symbolColor?: string;
  symbolSize?: number;
  labelSize?: number;
  payoffSize?: number;
}> = ({
  typography,
  left,
  right,
  symbol = '≠',
  width = 1080,
  centerY = 940,
  halfGap = 130,
  margin = 96,
  timing = {left: 0, right: 22, divider: 44, symbol: 60},
  dividerHeight = 600,
  knockoutColor = surface.dark,
  symbolColor = seriesDark[0],
  symbolSize = 190,
  labelSize = 32,
  payoffSize = 62,
}) => {
  const frame = useCurrentFrame();
  const centerX = width / 2;
  const colW = centerX - halfGap - margin;

  const Column: React.FC<{side: ContrastSide; isLeft: boolean; delay: number}> = ({
    side,
    isLeft,
    delay,
  }) => {
    const p = progress(frame, delay, 16, ENTER);
    const color = side.color ?? (isLeft ? ink.secondary : seriesDark[0]);
    return (
      <div
        style={{
          position: 'absolute',
          top: centerY,
          width: colW,
          left: isLeft ? margin : centerX + halfGap,
          transform: `translateY(calc(-50% + ${(1 - p) * 26}px))`,
          opacity: Math.min(1, p * 1.5),
          display: 'flex',
          flexDirection: 'column',
          alignItems: isLeft ? 'flex-end' : 'flex-start',
          gap: 16,
        }}
      >
        {side.icon ? (
          <div style={{display: 'flex', marginBottom: 4}}>{side.icon}</div>
        ) : null}
        <div
          style={{
            fontFamily: typography.families.body,
            fontSize: labelSize,
            fontWeight: 600,
            color: ink.muted,
            letterSpacing: 1,
          }}
        >
          {side.label}
        </div>
        <div
          style={{
            fontFamily: typography.families.body,
            fontSize: payoffSize,
            fontWeight: 800,
            lineHeight: 1.1,
            color,
            textAlign: isLeft ? 'right' : 'left',
            whiteSpace: 'pre-line',
          }}
        >
          {side.payoff}
        </div>
      </div>
    );
  };

  const divP = progress(frame, timing.divider, 14, ENTER);
  const symP = progress(frame, timing.symbol, 14, ENTER);

  return (
    <>
      {/* 中线:自上而下画出,配合两列已到位的节奏 */}
      <div
        style={{
          position: 'absolute',
          left: centerX - 2,
          top: centerY - dividerHeight / 2,
          width: 4,
          height: dividerHeight * divP,
          background: ink.baseline,
          borderRadius: 2,
        }}
      />
      <Column side={left} isLeft delay={timing.left} />
      <Column side={right} isLeft={false} delay={timing.right} />
      {symbol !== null && (
        <div
          style={{
            position: 'absolute',
            left: centerX,
            top: centerY,
            transform: `translate(-50%, -50%) scale(${0.7 + 0.3 * symP})`,
            opacity: Math.min(1, symP * 2),
            width: symbolSize * 1.1,
            height: symbolSize * 1.1,
            borderRadius: 999,
            background: knockoutColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              fontFamily: typography.families.display,
              fontSize: symbolSize,
              fontWeight: 900,
              lineHeight: 1,
              color: symbolColor,
            }}
          >
            {symbol}
          </div>
        </div>
      )}
    </>
  );
};
