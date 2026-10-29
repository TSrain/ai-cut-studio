import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import {ENTER, MOVE, progress} from '../lib/anim';
import {ink} from '../lib/theme';

// 犹豫光标:朝目标走到一半就折返,永远到不了。
//
// 这是一个**语义**动效,不是装饰:用来表达"想选但选不下去""试了又退回来"
// ——比任何文字说明都直观。关键参数是 reach(走到几成),0.5–0.6 最像犹豫:
// 走太少看不出意图,走到 0.8 以上观众会以为它马上要点下去。
//
// 每次试探之间要回到 home 停一下,连续折返会变成无意义的抖动。

export type CursorAttempt = {
  /** 试探的目标点(画布坐标)。 */
  x: number;
  y: number;
  /** 起始帧。 */
  start: number;
  /** 走到目标的几成就折返。默认 0.55。 */
  reach?: number;
  /** 去程帧数。 */
  outDur?: number;
  /** 折返点停顿帧数——这一停是"犹豫"读出来的地方,别省。 */
  hold?: number;
  /** 回程帧数。 */
  backDur?: number;
};

export const HesitantCursor: React.FC<{
  /** 静止时待的位置。 */
  home: {x: number; y: number};
  attempts: CursorAttempt[];
  /** 光标淡入帧。 */
  enterFrame?: number;
  /** 光标淡出帧。给 null 则不淡出。 */
  exitFrame?: number | null;
  size?: number;
  color?: string;
}> = ({home, attempts, enterFrame = 0, exitFrame = null, size = 34, color = ink.primary}) => {
  const frame = useCurrentFrame();

  // 由 attempts 生成关键帧序列:home → 折返点 → (停) → home
  const fs: number[] = [enterFrame];
  const xs: number[] = [home.x];
  const ys: number[] = [home.y];

  for (const a of attempts) {
    const reach = a.reach ?? 0.55;
    const outDur = a.outDur ?? 16;
    const hold = a.hold ?? 6;
    const backDur = a.backDur ?? 14;
    const px = home.x + (a.x - home.x) * reach;
    const py = home.y + (a.y - home.y) * reach;

    // 起步前先确保在 home(避免上一次回程还没结束就被下一次覆盖)
    if (a.start > fs[fs.length - 1]) {
      fs.push(a.start);
      xs.push(home.x);
      ys.push(home.y);
    }
    fs.push(a.start + outDur);
    xs.push(px);
    ys.push(py);
    fs.push(a.start + outDur + hold);
    xs.push(px);
    ys.push(py);
    fs.push(a.start + outDur + hold + backDur);
    xs.push(home.x);
    ys.push(home.y);
  }

  const opts = {extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const, easing: MOVE};
  const cx = fs.length > 1 ? interpolate(frame, fs, xs, opts) : home.x;
  const cy = fs.length > 1 ? interpolate(frame, fs, ys, opts) : home.y;

  const inO = progress(frame, enterFrame, 12, ENTER);
  const outO = exitFrame === null ? 1 : 1 - progress(frame, exitFrame, 12, MOVE);
  const opacity = Math.min(inO, outO);

  return (
    <svg
      width={size}
      height={size * 1.4}
      viewBox="0 0 24 34"
      style={{position: 'absolute', left: cx, top: cy, opacity, pointerEvents: 'none'}}
    >
      {/* 标准箭头光标:白填充 + 深描边,任何底色上都可见 */}
      <path
        d="M2 1 L2 25 L8.5 19.5 L12.5 28.5 L16.5 26.5 L12.5 18 L20.5 17.5 Z"
        fill={color}
        stroke="rgba(0,0,0,0.55)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
};
