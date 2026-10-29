import React from 'react';
import {useCurrentFrame} from 'remotion';
import {MOVE, progress} from '../lib/anim';

// 关键词高亮色带(marker band):在整句里把一两个词"划出来",而不是把它放大占满画面。
//
// 三条硬约束,违反哪条都会毁掉这个手法:
// 1. 色带必须**长出来**(background-size 从 0% 到 100%),不是预先就画好在那里。
// 2. 色带必须在**句子安定之后**才扫过——句子还在位移时就开始高亮,读起来是乱的。
// 3. **绝不缩放关键词去填满画面**。整句保持可读,重点在句子"之内"被强调;
//    把关键词 zoom 成大字会丢掉上下文,观众反而不知道在说什么。
//
// 用 background-size 而不是一条 scaleX 的色块,是为了 box-decoration-break: clone ——
// 关键词跨行折行时色带能连续覆盖每一行;scaleX 色块做不到。
export const KeywordHighlight: React.FC<{
  children: React.ReactNode;
  /** 色带开始长出的帧。必须晚于整句入场结束的帧。 */
  delay: number;
  /** 长出时长(帧)。关键词越长可适当加长,建议 15–45f。 */
  dur?: number;
  /** 色带颜色。默认暖黄记号笔色;深色画面上换成低饱和度的强调色。 */
  color?: string;
  /** 色带高度占文字行高的比例,和垂直位置。默认贴着基线偏下,像真的记号笔。 */
  bandHeight?: string;
  bandY?: string;
  style?: React.CSSProperties;
}> = ({
  children,
  delay,
  dur = 24,
  color = 'rgba(250, 222, 99, 0.6)',
  bandHeight = '64%',
  bandY = '72%',
  style,
}) => {
  const frame = useCurrentFrame();
  const p = progress(frame, delay, dur, MOVE);
  return (
    <span
      style={{
        backgroundImage: `linear-gradient(${color}, ${color})`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: `0 ${bandY}`,
        backgroundSize: `${p * 100}% ${bandHeight}`,
        boxDecorationBreak: 'clone',
        WebkitBoxDecorationBreak: 'clone',
        ...style,
      }}
    >
      {children}
    </span>
  );
};
