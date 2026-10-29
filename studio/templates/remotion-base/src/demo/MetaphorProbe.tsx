// demo/MetaphorProbe.tsx —— 「概念隐喻镜」的探路 styleframe(**不是 preset,不要在生产里引用**)
//
// 目的:回答"概念隐喻镜长什么样"这个问题时,拿一张真实渲染的画面代替一段散文。
// 母题取自参考帧 docs/reference/metaphorical/tewo-pullback-2-context.jpg:
// 一个干净的符号 + 一整片混乱的同类,靠"拉远"把这个关系揭出来。
//
// 用户点头之后,这个文件会被改写成 src/presets/PullbackField.tsx 并走完整登记流程;
// 用户摇头就整个删掉。现在它只是一张会动的草图。

import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate} from 'remotion';
import {Backdrop, Foreground, useBaseline} from '../style/baseline';
import {textStyle, alpha} from '../lib/theme';
import {SemanticIcon, type SemanticIconName} from '../components/SemanticIcon';
import {CALM, BEAT} from '../lib/anim';
import {fitFontSize} from '../style/fit';

/** mulberry32:确定性伪随机。同 seed 逐位可复现(design-principles §9) */
const rng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const NOISE: SemanticIconName[] = ['search', 'clock', 'duplicate', 'filter', 'decline', 'cross'];

export const MetaphorProbe: React.FC<{
  line?: string;
  hero?: SemanticIconName;
  cols?: number;
  rows?: number;
}> = ({line = '所有人都在找。\n只有一个人知道要找什么。', hero = 'check', cols = 9, rows = 16}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const {P, T} = useBaseline();

  // 唯一的动作:拉远。开场英雄符号占满画面,拉到全景露出周围那一片。
  // 4.2 秒拉完(BEAT 的 ~4.6 倍),之后全静止 —— 慢是这个镜头的全部性格
  const pull = interpolate(frame, [0, fps * 4.2], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: CALM,
  });
  const zoom = 7.4 - 6.4 * pull; // 7.4× → 1×

  // 噪声场:同类符号,朝向和明度都乱,但**位置是规整网格**——
  // 位置也乱的话读作"随便撒的",乱要乱在姿态上,不是乱在秩序上
  const r = rng(11);
  const cells: {x: number; y: number; rot: number; dim: number; icon: SemanticIconName}[] = [];
  const cw = 1080 / cols;
  const ch = 1920 / rows;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      cells.push({
        x: cw * (i + 0.5) + (r() - 0.5) * cw * 0.22,
        y: ch * (j + 0.5) + (r() - 0.5) * ch * 0.22,
        rot: (r() - 0.5) * 160,
        dim: 0.1 + r() * 0.14,
        icon: NOISE[Math.floor(r() * NOISE.length)],
      });
    }
  }

  const lineIn = interpolate(frame, [fps * 3.4, fps * 3.4 + BEAT * fps], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: CALM,
  });
  const size = Math.min(
    ...line.split('\n').map((l) => fitFontSize(l, {fontSize: 76, maxWidthPx: 880, shrinkFloorPx: 46})),
  );
  void durationInFrames;

  return (
    <AbsoluteFill style={{backgroundColor: P.bg, overflow: 'hidden'}}>
      <Backdrop />
      {/* 整个场随拉远缩放。缩放中心 = 英雄符号所在处,不是画面中心,
          否则拉远时英雄符号会在画面上滑动,读作"镜头在平移"而不是"在拉远" */}
      <AbsoluteFill style={{transform: `scale(${zoom})`, transformOrigin: '50% 46%'}}>
        {cells.map((c, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: c.x - 30,
              top: c.y - 30,
              transform: `rotate(${c.rot}deg)`,
              opacity: c.dim * (0.35 + 0.65 * pull),
            }}
          >
            <SemanticIcon name={c.icon} size={60} color={P.ink} strokeWidth={5} />
          </div>
        ))}
        {/* 英雄符号:唯一有底盘、唯一 accent、唯一正着放的那个 */}
        <div
          style={{
            position: 'absolute',
            left: 540 - 86,
            top: 1920 * 0.46 - 86,
            width: 172,
            height: 172,
            borderRadius: 86,
            background: P.bg,
            border: `2px solid ${alpha(P.accent, 0.9)}`,
            boxShadow: `0 0 60px ${alpha(P.accent, 0.3)}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <SemanticIcon name={hero} size={92} color={P.accent} strokeWidth={7} />
        </div>
      </AbsoluteFill>

      <div
        style={{
          position: 'absolute',
          left: 100,
          right: 100,
          top: 1400,
          ...textStyle(T, 'h2'),
          fontSize: size,
          lineHeight: 1.3,
          color: P.ink,
          opacity: lineIn,
        }}
      >
        {line.split('\n').map((l, i) => (
          <React.Fragment key={l}>
            {i > 0 ? <br /> : null}
            {l}
          </React.Fragment>
        ))}
      </div>
      <Foreground />
    </AbsoluteFill>
  );
};
