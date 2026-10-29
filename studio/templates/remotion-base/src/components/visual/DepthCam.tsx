import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';

// 分层运镜:把画面拆成几层,各层按自己的深度对同一次相机运动作出不同反应。
//
// **为什么 KenBurns 装不下这些**:KenBurns 是"一张平面图上的裁窗推移",
// 它的模型里没有"层"这个概念,所以做不了视差、dolly-zoom、冻结环绕 ——
// 那三式的全部说服力都来自**不同深度的东西动得不一样**。
//
// 分层素材哪来:`swiftc -O tools/matte.swift -o /tmp/matte` 编一次,
// 然后 `matte <图> <前景.png> --trim --alpha-gamma 3.2 --width <显示宽>` 抠前景。
// 抠不出来就退回 KenBurns,不要拿两张平面图假装分层 —— 假分层比不分层更难看,
// 因为观众能看出"该动的地方没动"。
//
// 每层两个旋钮,故意不做成一个"深度"数字:
//   · parallax —— 跟着相机平移动多少。1 = 完全跟随(最近),0 = 纹丝不动(无穷远)。
//   · zoomGain —— 跟着相机推拉缩放多少。1 = 正常,0 = **尺寸钉死**,>1 = 比相机推得更狠。
// 两个旋钮分开,三式就都能表达:
//   多层视差 = 各层 parallax 拉开、zoomGain 都给 1
//   dolly-zoom = 主体 zoomGain 0(钉死)、背景 zoomGain 1.8(压过来)
//   冻结环绕 = 给各层不同的 z 偏移,在透视容器里扫 yaw
//
// 三个坑:
//   1. **视差幅度别贪**。层间 parallax 差 >0.5 会露馅:前景飞得比背景快太多,
//      观众读到的是"两张图在各自滑动",不是"一个有厚度的空间"。
//   2. **dolly-zoom 一支片最多一次**。它是戏剧性蓄力,用两次第二次就没有了。
//   3. 前景层必须真有 alpha。没有 alpha 的"前景"会把背景整块盖住,视差完全看不见。
export type DepthCamKey = {
  frame: number;
  /** 相机平移(px)。正值 = 画面内容向左/向上走。 */
  x?: number;
  y?: number;
  /** 相机推拉。1 = 原始大小。 */
  zoom?: number;
  /** 环绕角(deg)。需要层带 z 偏移才看得出来。 */
  yaw?: number;
  /** 画框滚转(deg)。斜角滚正就是它从 −8 走到 0。 */
  roll?: number;
};

export type DepthLayer = {
  /** 跟随相机平移的比例:1 = 最近,0 = 无穷远。 */
  parallax: number;
  /** 跟随相机推拉的比例:0 = 尺寸钉死(dolly-zoom 的主体),1 = 正常。 */
  zoomGain?: number;
  /** 空间纵深(px)。只有做冻结环绕(yaw)时才需要;正值 = 更远。 */
  z?: number;
  /** 这一层画什么。 */
  node: React.ReactNode;
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const DepthCam: React.FC<{
  width: number;
  height: number;
  layers: DepthLayer[];
  keys: DepthCamKey[];
  ease?: (t: number) => number;
  /** 透视强度(px)。不给则按画布短边 ×1.4 —— 竖版直接用横屏的经验值透视会过强。 */
  persp?: number;
  /** 整体位移,给震屏用(见 lib/shake.ts)。 */
  offset?: {x: number; y: number};
  /** 在 <Sequence> 里时把绝对帧传进来,否则 key 的 frame 会被 rebase。 */
  frame?: number;
  style?: React.CSSProperties;
}> = ({width, height, layers, keys, ease, persp, offset, frame: frameProp, style}) => {
  const ownFrame = useCurrentFrame();
  const frame = frameProp ?? ownFrame;
  const easing = ease ?? Easing.bezier(0.33, 0, 0.15, 1);

  const sorted = [...keys].sort((a, b) => a.frame - b.frame);
  let a = sorted[0];
  let b = sorted[sorted.length - 1];
  for (let i = 0; i < sorted.length - 1; i++) {
    if (frame >= sorted[i].frame && frame <= sorted[i + 1].frame) {
      a = sorted[i];
      b = sorted[i + 1];
      break;
    }
  }
  const t =
    a.frame === b.frame
      ? 1
      : interpolate(frame, [a.frame, b.frame], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing,
        });

  const camX = lerp(a.x ?? 0, b.x ?? 0, t);
  const camY = lerp(a.y ?? 0, b.y ?? 0, t);
  const camZoom = lerp(a.zoom ?? 1, b.zoom ?? 1, t);
  const camYaw = lerp(a.yaw ?? 0, b.yaw ?? 0, t);
  const camRoll = lerp(a.roll ?? 0, b.roll ?? 0, t);

  const has3D = sorted.some((k) => k.yaw) || layers.some((l) => l.z);
  const perspective = persp ?? Math.min(width, height) * 1.4;

  return (
    <AbsoluteFill style={{overflow: 'hidden', ...style}}>
      <AbsoluteFill
        style={{
          perspective: has3D ? `${perspective}px` : undefined,
          transform:
            `translate(${offset?.x ?? 0}px, ${offset?.y ?? 0}px)` +
            (camRoll ? ` rotate(${camRoll}deg)` : ''),
        }}
      >
        {layers.map((layer, i) => {
          const gain = layer.zoomGain ?? 1;
          // zoomGain 作用在"相对 1 的增量"上,而不是整体缩放:
          // 这样 gain=0 才真的是"尺寸钉死"而不是"缩到 0"。
          const scale = 1 + (camZoom - 1) * gain;
          const transform = [
            `translate(${-camX * layer.parallax}px, ${-camY * layer.parallax}px)`,
            has3D && camYaw ? `rotateY(${camYaw}deg)` : '',
            layer.z ? `translateZ(${-layer.z}px)` : '',
            `scale(${scale})`,
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <AbsoluteFill
              key={i}
              style={{
                transform,
                transformOrigin: 'center center',
                transformStyle: has3D ? 'preserve-3d' : undefined,
              }}
            >
              {layer.node}
            </AbsoluteFill>
          );
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
