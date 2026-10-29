import React from 'react';
import {Img, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {MOVE, progress} from '../lib/anim';

// Ken Burns 静图运镜:在一个固定裁窗里,把源图从焦点 A 缓慢推移到焦点 B。
//
// 核心是"焦点映射窗心 + 边缘钳制"这两件事,自己手搓最容易错的也是这两件:
// - **焦点映射窗心**:你指定的是"源图上的哪个点"(像素坐标),组件负责把它挪到裁窗中心。
//   直接写 translate 百分比会在缩放变化时飘。
// - **边缘钳制**:防止图边进入裁窗露出底色。原始实现只钳了水平方向,末帧经常出现
//   竖直方向被裁掉半截图例/文字的问题——这里两个轴都钳,并处理"图比窗小"的退化情况。
//
// 焦点坐标怎么拿:**不要目测**。跑 docs/locate-protocol.md 的网格定位循环
// (node tools/locate.mjs overlay/region/final/mark),拿到归一化 box 后
// 乘上源图宽高就是这里要的像素坐标。目测平均误差 6.5%,推镜会推偏。
//
// 速度以"看清内容"为准,忌快;末段务必留静止定格(moveEnd 早于合成总长)。

export const KenBurns: React.FC<{
  /** public/ 下的文件名(走 staticFile),或已经是完整 src。 */
  src: string;
  /** 源图**原始**像素尺寸,必须准确,否则焦点映射会偏。 */
  imgW: number;
  imgH: number;
  /** 裁窗尺寸。裁窗本身的位置由外层容器决定。 */
  windowW: number;
  windowH: number;
  /** 起止焦点,源图像素坐标。 */
  focusStart: {x: number; y: number};
  focusEnd: {x: number; y: number};
  /** 起止缩放。1 = 源图原始像素比例。 */
  scaleStart?: number;
  scaleEnd?: number;
  /** 运镜结束帧;之后定格。留足静止读取时间。 */
  moveEnd: number;
  /** 运镜起始帧。插片默认 0(首帧图已完整可见,不淡入,避免黑帧)。 */
  moveStart?: number;
  /**
   * 是否钳制图边不进入裁窗。默认 true;确实想露底时才关。
   *
   * 取舍要知道:**钳制优先于对准**。焦点靠近图边时,把它挪到窗心就会露出底色,
   * 这时组件会选择贴边而不是对准——所以末帧焦点可能不在窗正中。这是正确行为不是 bug。
   * 想让焦点真正落在窗心:把 scale 调大(图更大 → 可平移余量更多),或把焦点往图内挪。
   */
  clampEdges?: boolean;
  style?: React.CSSProperties;
  /**
   * 叠加层,渲染在**源图像素坐标系**里并跟随运镜(批注/圈选/标记就挂这儿)。
   * 之所以由 KenBurns 自己提供,是因为在外层贴标记必须复算同一套 transform,
   * 时序上还差一帧就会"标记漂移"——2026-08-19 做 AnnotationMark 时为此把
   * transform 从 Img 挪到了包裹层,视觉结果不变。
   */
  children?: React.ReactNode;
}> = ({
  src,
  imgW,
  imgH,
  windowW,
  windowH,
  focusStart,
  focusEnd,
  scaleStart = 0.75,
  scaleEnd = 1.04,
  moveEnd,
  moveStart = 0,
  clampEdges = true,
  style,
  children,
}) => {
  const frame = useCurrentFrame();
  // MOVE 两端缓、中段近匀速——运镜要的就是这个手感
  const p = progress(frame, moveStart, moveEnd - moveStart, MOVE);

  const s = interpolate(p, [0, 1], [scaleStart, scaleEnd]);
  const fx = interpolate(p, [0, 1], [focusStart.x, focusEnd.x]);
  const fy = interpolate(p, [0, 1], [focusStart.y, focusEnd.y]);

  // 把焦点挪到裁窗中心
  const rawTx = windowW / 2 - fx * s;
  const rawTy = windowH / 2 - fy * s;

  // 边缘钳制:图缩放后若比窗大,把平移限制在不露边的区间;若比窗小(退化情况),居中。
  const clamp1D = (raw: number, imgLen: number, winLen: number) => {
    const scaled = imgLen * s;
    if (!clampEdges) return raw;
    if (scaled <= winLen) return (winLen - scaled) / 2;
    return Math.min(0, Math.max(winLen - scaled, raw));
  };

  const tx = clamp1D(rawTx, imgW, windowW);
  const ty = clamp1D(rawTy, imgH, windowH);

  return (
    <div
      style={{
        position: 'absolute',
        width: windowW,
        height: windowH,
        overflow: 'hidden',
        ...style,
      }}
    >
      {/* transform 施加在包裹层而不是 Img 上:children(批注等叠加物)以源图像素坐标
          摆进来,和图共享同一套运镜变换,天然不漂 */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: imgW,
          height: imgH,
          transformOrigin: '0 0',
          transform: `translate(${tx}px, ${ty}px) scale(${s})`,
        }}
      >
        <Img
          // 只有**真正的外部 URL**才原样用;其余一律走 staticFile。
          // 老版本判的是「含斜杠就当完整 src」,于是 public 子目录里的文件(screens/x.png)
          // 会绕过 staticFile 变成裸相对路径,渲染时 404 —— 而且报错只出现在浏览器控制台里,
          // 画面就是一片空白底,极难查(2026-08-12 做截图推近 preset 时踩到)。
          src={/^(https?:|data:|blob:|\/)/.test(src) ? src : staticFile(src)}
          style={{position: 'absolute', left: 0, top: 0, width: imgW, height: imgH}}
        />
        {children}
      </div>
    </div>
  );
};
