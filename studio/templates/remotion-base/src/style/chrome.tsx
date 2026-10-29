// style/chrome.tsx —— 镜头的「外挂层」:品牌标记 + 音效。
//
// 为什么不写进 5 个 preset 各自的组件里:它们和版式无关。
// 品牌标记在哪个角、音效响不响,换成任何一个模板都成立;真写进去就是同一段代码抄五遍,
// 以后加第六个模板还得再抄一遍。所以做成一层**统一在合成层套上去的壳**(见 presets/index.ts 的 withChrome)。
//
// 两条硬约束:
// 1. **不许挡住安全区里的主体。** 品牌标记默认贴角、默认小、默认半透明——
//    它是签名不是主角。想让它变主角,那是另一个镜头(片头/片尾),不是这一层。
// 2. **音效必须引本地文件。** `staticFile('sfx/xxx.wav')`,不许直接引 remotion.media 的 URL——
//    渲染期网络请求违反确定性条款(design-principles §9)。控制台在渲染前会把选中的
//    音效从 assets/library/sfx/ 拷进 public/sfx/。

import React from 'react';
import {AbsoluteFill, Audio, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import {ENTER} from '../lib/anim';

export const brandCorner = z.enum(['tl', 'tr', 'bl', 'br']);

/**
 * 挂进每个 preset schema 的字段。两个都可选——不给就完全不渲染,
 * 老的 props.json 原样能跑(向后兼容是硬要求,历史项目还要能重渲)。
 */
export const chromeFields = {
  /** 品牌标记:public/brand/ 下的文件名 */
  brand: z
    .object({
      file: z.string(),
      corner: brandCorner.default('br'),
      /** 短边像素。默认 132 —— 1080 宽画布上约 12%,是"看得见但不抢戏"的量 */
      size: z.number().min(48).max(420).default(132),
      opacity: z.number().min(0.2).max(1).default(0.92),
    })
    .optional(),
  /** 音效:public/sfx/ 下的文件名 + 从第几帧起播 */
  sfx: z
    .object({
      file: z.string(),
      atFrame: z.number().min(0).max(300).default(2),
      volume: z.number().min(0).max(1).default(0.7),
    })
    .optional(),
};

export type ChromeProps = {
  brand?: {file: string; corner?: z.infer<typeof brandCorner>; size?: number; opacity?: number};
  sfx?: {file: string; atFrame?: number; volume?: number};
};

/** 角落坐标。pad 取 72:和各 preset 的安全边距同量级,贴边但不压边 */
const CORNER: Record<string, React.CSSProperties> = {
  tl: {top: 72, left: 72},
  tr: {top: 72, right: 72},
  bl: {bottom: 72, left: 72},
  br: {bottom: 72, right: 72},
};

export const ShotChrome: React.FC<ChromeProps> = ({brand, sfx}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  if (!brand && !sfx) return null;

  // 品牌标记跟着画面一起进场,但比主体晚半拍——它是落款,不是开场白
  const enter = interpolate(frame, [Math.round(fps * 0.5), Math.round(fps * 1.0)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ENTER,
  });

  return (
    <>
      {sfx ? (
        <Audio
          src={staticFile(`sfx/${sfx.file}`)}
          // Remotion 的 Audio 用 startFrom 对齐时间线;这里的 atFrame 是"第几帧开始响",
          // 所以用 trimBefore 反过来推是错的——直接用 Sequence 的语义:延迟到那一帧再挂载
          volume={(f) => (f < (sfx.atFrame ?? 2) ? 0 : (sfx.volume ?? 0.7))}
        />
      ) : null}
      {brand ? (
        <AbsoluteFill style={{pointerEvents: 'none'}}>
          <Img
            src={staticFile(`brand/${brand.file}`)}
            style={{
              position: 'absolute',
              ...CORNER[brand.corner ?? 'br'],
              width: brand.size ?? 132,
              height: 'auto',
              opacity: (brand.opacity ?? 0.92) * enter,
              transform: `translateY(${10 * (1 - enter)}px)`,
            }}
          />
        </AbsoluteFill>
      ) : null}
    </>
  );
};
