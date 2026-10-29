import React from 'react';
import {Easing, interpolate, useCurrentFrame} from 'remotion';
import {textStyle, type TypographyContext} from '../lib/theme';

// 标题降格成栏目标签:居中大字站稳一拍,然后**一次连续补间**缩小飞到左上角,
// 落成这一节的门牌。标题降格而不退场,观众因此拿到一次免费的空间记忆
// ——刚才那个大词就是现在左上角那个小词。
//
// 移植自 video-shotcraft 的 `title-demote-to-label`(Apache-2.0);
// 原卡是 1920×1080 产品页语境、落点 (150,110),这里按 1080×1920 竖屏安全区重算。
// 配方全文与参数手感见 docs/recipes/typography/title-demote-to-label.md。
//
// 三个不能改的地方(改了这个手法就不成立):
//   1. **scale 和位置必须走同一条曲线**。拆成"先缩后飞"两段会被读成两个动作,
//      而这个手法的全部说服力来自它是一个动作。
//   2. **居中修正量要随补间同步归零**(下面的 `-(1 - t) * 50`)。
//      起幅靠 translate(-50%,-50%) 居中,终幅是左上角定位;不归零终点会偏一个半宽。
//   3. **显影后必须站稳再降格**。没站稳就缩 = 宣告拍被吃掉,观众没读完标题它就跑了。
export const TitleDemote: React.FC<{
  typography: TypographyContext;
  title: string;
  color: string;
  /** 显影起始帧。 */
  appearAt?: number;
  /** 显影时长(blur + 淡入)。 */
  appearDur?: number;
  /** 站稳多少帧之后开始降格。**别低于 18**。 */
  holdFrames?: number;
  /** 降格补间时长。<14f 读作标题被弹走。 */
  demoteDur?: number;
  /** 落点(左上角标签位),竖版安全区内。 */
  landing?: {x: number; y: number};
  /** 终点缩放。>0.45 标签太大会压内容。 */
  scaleEnd?: number;
  /** 画面中心(起幅位置)。 */
  center?: {x: number; y: number};
}> = ({
  typography,
  title,
  color,
  appearAt = 0,
  appearDur = 12,
  holdFrames = 18,
  demoteDur = 20,
  landing = {x: 96, y: 150},
  scaleEnd = 0.3,
  center = {x: 540, y: 620},
}) => {
  const frame = useCurrentFrame();

  const appear = interpolate(frame, [appearAt, appearAt + appearDur], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  const demoteStart = appearAt + appearDur + holdFrames;
  const t = interpolate(frame, [demoteStart, demoteStart + demoteDur], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });

  const x = center.x + (landing.x - center.x) * t;
  const y = center.y + (landing.y - center.y) * t;
  const scale = 1 + (scaleEnd - 1) * t;

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        // 坑 2:居中修正量随 t 归零。起幅居中、终幅左上角,同一个元素两种定位口径。
        transform: `translate(${-(1 - t) * 50}%, -50%) scale(${scale})`,
        transformOrigin: 'left center',
        opacity: appear,
        filter: `blur(${(1 - appear) * 12}px)`,
        whiteSpace: 'nowrap',
        ...textStyle(typography, 'h1'),
        color,
      }}
    >
      {title}
    </div>
  );
};

/** 降格开始的帧号。内容生长要从 `demoteStartFrame(...) + 12` 起——
 *  等标题完全落位才生长会空 8f 冷场,那个重叠才是"交接无空档"的来源。 */
export const demoteStartFrame = (appearAt = 0, appearDur = 12, holdFrames = 18) =>
  appearAt + appearDur + holdFrames;
