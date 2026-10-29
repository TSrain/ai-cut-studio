import React from 'react';
import {AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame} from 'remotion';

// 2.5D 页面相机:在整页截图上做平移/缩放 + 可选的三轴倾斜与焦平面模糊。
//
// 移植自 video-shotcraft 的 PageCam(Apache-2.0),按本项目的竖屏画布重算。
// 原版是 1920×1080 横屏产品页语境、persp 默认 1400;竖屏 1080×1920 直接照搬会有两个问题:
//   ① 整页横向截图塞进竖版只能占很窄一条;② persp 1400 是按横屏视距调的,竖屏下透视会过强。
// 所以这里的 persp 默认按**画布短边**推算(短边 × 1.3),并在下面的注释里写死这条。
//
// **降级设计**:没有任何 key 声明 rotX/rotY/rotZ/persp 时,整个组件退化成纯平面 pan/zoom,
// 逐像素等同于不加 3D 的版本。所以引入它不会改变已有平面镜头的行为。
//
// 坐标怎么拿:**不要目测**。网页镜头用 `node tools/capture-page.mjs` 产出的 layout.json——
// 那里面的 {x,y,w,h} 是浏览器量的整页 CSS 坐标,误差为 0,比 locate.mjs 的网格法更准也更省事。
// 非网页素材(照片/长图)才走 docs/locate-protocol.md 的网格法。
//
// 三个坑:
//   1. **纹理要按原生尺寸 rasterize 再缩小**。3D 透视下把小图放大必糊,
//      文字发糊先查纹理分辨率链路(采集时 --scale 2),不要靠加锐化补救。
//   2. `pageW` 必须是截图的 **CSS 宽**(不是像素宽)。采集时是 2x 图,
//      pageW 给 CSS 宽、图按 CSS 宽渲染,浏览器才会用上那两倍像素。
//   3. 关键帧之间是线性插值,`ease` 只作用在整段进度上。想要分段不同节奏就多给几个 key。
export type PageCamKey = {
  /** 绝对帧号(在 <Sequence> 里要用 frame 参数把绝对帧传进来)。 */
  frame: number;
  /** 页面 CSS 坐标系里落在画面正中的那个点。 */
  cx: number;
  cy: number;
  /** 1 = 1 CSS px 对 1 输出像素。 */
  zoom: number;
  /** 可选 3D:任一 key 声明了才启用透视。 */
  rotX?: number;
  rotY?: number;
  rotZ?: number;
  /** 透视强度(px)。越小透视越强。不给则按画布短边推算。 */
  persp?: number;
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const PageCam: React.FC<{
  /** public/ 下的路径(走 staticFile),或已经是完整 src。 */
  src: string;
  /** 页面 **CSS** 宽高(不是纹理像素)。采集产物的 layout.json 里有。 */
  pageW: number;
  pageH: number;
  /** 输出画布尺寸。 */
  width: number;
  height: number;
  keys: PageCamKey[];
  /** 页面空间叠加层(批注/圈选/飞入卡片)。挂在这里才跟着运镜走。 */
  children?: React.ReactNode;
  ease?: (t: number) => number;
  /** 焦平面模糊:在页面坐标 focusY 附近清晰,远处糊。倾斜镜头用。 */
  dof?: {focusY: number; strength: number};
  /** 在 <Sequence> 里时把绝对帧传进来,否则 key 的 frame 会被 rebase。 */
  frame?: number;
  style?: React.CSSProperties;
}> = ({src, pageW, pageH, width, height, keys, children, ease, dof, frame: frameProp, style}) => {
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

  const cx = lerp(a.cx, b.cx, t);
  const cy = lerp(a.cy, b.cy, t);
  const zoom = lerp(a.zoom, b.zoom, t);
  const rotX = lerp(a.rotX ?? 0, b.rotX ?? 0, t);
  const rotY = lerp(a.rotY ?? 0, b.rotY ?? 0, t);
  const rotZ = lerp(a.rotZ ?? 0, b.rotZ ?? 0, t);

  const has3D = sorted.some((k) => k.rotX || k.rotY || k.rotZ || k.persp);
  // 竖屏下按短边推算:横屏那套 1400 是按 1920 宽的视距调的,
  // 直接用在 1080 宽的竖版上透视会明显过强。
  const persp = lerp(
    a.persp ?? Math.min(width, height) * 1.3,
    b.persp ?? Math.min(width, height) * 1.3,
    t,
  );

  const transform = [
    `translate(${width / 2}px, ${height / 2}px)`,
    has3D ? `rotateX(${rotX}deg) rotateY(${rotY}deg) rotateZ(${rotZ}deg)` : '',
    `scale(${zoom})`,
    `translate(${-cx}px, ${-cy}px)`,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <AbsoluteFill style={{overflow: 'hidden', ...style}}>
      <AbsoluteFill style={has3D ? {perspective: `${persp}px`} : undefined}>
        <div style={{position: 'absolute', left: 0, top: 0, transformOrigin: '0 0', transform}}>
          <div style={{position: 'relative', width: pageW, height: pageH}}>
            <Img
              src={src.startsWith('http') || src.startsWith('/') ? src : staticFile(src)}
              // 按 CSS 宽渲染:纹理是 2x 图时,浏览器才会用上那两倍像素(坑 1/坑 2)
              style={{width: pageW, height: pageH, display: 'block'}}
            />
            {dof ? (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  backdropFilter: `blur(${dof.strength}px)`,
                  WebkitMaskImage: `linear-gradient(to bottom, rgba(0,0,0,1) 0px, rgba(0,0,0,0) ${Math.max(
                    0,
                    dof.focusY - pageH * 0.12,
                  )}px, rgba(0,0,0,0) ${dof.focusY + pageH * 0.12}px, rgba(0,0,0,1) ${pageH}px)`,
                  maskImage: `linear-gradient(to bottom, rgba(0,0,0,1) 0px, rgba(0,0,0,0) ${Math.max(
                    0,
                    dof.focusY - pageH * 0.12,
                  )}px, rgba(0,0,0,0) ${dof.focusY + pageH * 0.12}px, rgba(0,0,0,1) ${pageH}px)`,
                  pointerEvents: 'none',
                }}
              />
            ) : null}
            {children}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
