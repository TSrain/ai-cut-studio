import React from 'react';
import type {CalculateMetadataFunction} from 'remotion';
import {CaptionLayer, type CaptionScript} from './CaptionLayer';
import {useCaptionFont, FULL_FONT} from './useCaptionFont';

/**
 * 一个渲染器渲任意脚本 —— 脚本从 --props 传进来,跟着内容项目走,不跟渲染器走。
 *
 *   npx remotion render CaptionFromProps --props=<脚本.json> ... out.mov
 *
 * **props 就是脚本本身**(顶层 durationSeconds / blocks / fontFile),不包 {script:…} 那一层:
 * 包一层的话脚本文件不能原样喂进来,每次要手动套壳,套错了还不报错——
 * 只会静默用 defaultProps 渲出一个 1.3 秒空片(实测踩过,所以下面加了显式抛错)。
 */
type Props = CaptionScript & {
  /** 子集化字体的相对路径,如 fonts/subset/broll-0806.otf。不填用完整字体 */
  fontFile?: string;
  /**
   * 画幅。**不填 = 竖屏 1080×1920**(历史脚本一律如此,不能改默认值)。
   * 横屏片子在脚本顶层写 `"canvas": {"width": 1920, "height": 1080}`,
   * 版式常数由 CaptionLayer 按宽高比自动切到 LAYOUT_LANDSCAPE,脚本其余部分一个字不用改。
   */
  canvas?: {width: number; height: number};
  _source?: string;
  _rules?: string;
  _fixes?: string;
};

const TAIL = 1.3; // 出场尾巴:EXIT.dropFrames/fps + fadeSeconds,留一点余量

const secondsOf = (p: Partial<Props> | undefined) => {
  const last = p?.blocks?.length ? Math.max(...p.blocks.map((b) => b.out)) : 0;
  return Math.max(p?.durationSeconds ?? 0, last + TAIL);
};

export const calculateCaptionMetadata: CalculateMetadataFunction<Props> = ({props}) => {
  const seconds = secondsOf(props);
  if (seconds <= TAIL + 0.01) {
    throw new Error('字幕脚本为空或没通过 --props 传进来:检查 --props=<脚本.json> 的路径');
  }
  const {width = 1080, height = 1920} = props.canvas ?? {};
  return {durationInFrames: Math.ceil(seconds * 30), fps: 30, width, height};
};

export const CaptionFromProps: React.FC<Props> = (props) => {
  const ready = useCaptionFont(props.fontFile ?? FULL_FONT);
  if (!ready) return null; // 字体没到位不画,免得首帧用回退字体
  return <CaptionLayer script={{durationSeconds: secondsOf(props), blocks: props.blocks ?? []}} />;
};
