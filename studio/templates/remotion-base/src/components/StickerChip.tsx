import React from 'react';
import {interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {EXIT, ENTER, progress} from '../lib/anim';

// 贴纸 chip:叠在别人画面(口播人像/录屏)上的小信息块。
//
// 为什么要半透明深色底而不是直接放文字:贴纸会叠在**未知**的底片上,
// 纯文字在浅色/杂乱底片上直接不可读。半透明深色 chip + 极细亮边 + 投影,
// 保证任意底片上都可读,这是它存在的全部理由。
//
// 另一条实拍教训:**小信息点(一句金句、一个数字)不该占一个独立全屏画面**,
// 做成中上部的小 chip 叠在人物画面上更合适——全屏会让一个小信息显得很空。
//
// 透明底导出:合成不要设 backgroundColor,渲染时用 ProRes 4444(--codec prores --prores-profile 4444)
// 或 webm,才有 alpha 通道。

export const StickerChip: React.FC<{
  children: React.ReactNode;
  /** 弹入起始帧。 */
  enterFrame?: number;
  /** 收尾起始帧。给 null 则不收尾(一直留在画面上)。 */
  exitFrame?: number | null;
  /** 收尾时长(帧)。 */
  exitDur?: number;
  /** chip 背景。默认 90% 不透明的深色——再透就压不住花底片了。 */
  background?: string;
  padding?: string;
  radius?: number;
  gap?: number;
  style?: React.CSSProperties;
}> = ({
  children,
  enterFrame = 0,
  exitFrame = null,
  exitDur = 8,
  background = 'rgba(26,26,25,0.90)',
  padding = '30px 52px',
  radius = 44,
  gap = 30,
  style,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  // 一个干脆的 spring 弹入(轻微 overshoot)——贴纸是"啪"地贴上去的,不是淡出来的
  const s = spring({
    frame: frame - enterFrame,
    fps,
    config: {damping: 13, stiffness: 170, mass: 0.9},
  });
  const inScale = interpolate(s, [0, 1], [0.82, 1]);
  const inOpacity = progress(frame, enterFrame, 6, ENTER);

  // 收尾轻微缩 + 淡出,不硬切(硬切在叠加场景里像 bug)
  const exitP = exitFrame === null ? 0 : progress(frame, exitFrame, exitDur, EXIT);
  const scale = inScale * interpolate(exitP, [0, 1], [1, 0.94]);
  const opacity = inOpacity * interpolate(exitP, [0, 1], [1, 0]);

  return (
    <div
      style={{
        transform: `scale(${scale})`,
        transformOrigin: 'center top',
        opacity,
        display: 'inline-flex',
        alignItems: 'center',
        gap,
        padding,
        borderRadius: radius,
        background,
        border: '1px solid rgba(255,255,255,0.09)',
        boxShadow: '0 14px 44px rgba(0,0,0,0.45)',
        backdropFilter: 'blur(2px)',
        ...style,
      }}
    >
      {children}
    </div>
  );
};
