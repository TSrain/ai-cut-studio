import React from 'react';
import {Img, interpolate} from 'remotion';
import {alpha} from '../../lib/theme';
import {MOVE} from '../../lib/anim';
import {PANEL_SHEEN, panelSurface} from './SurfacePanel';

// 截图舞台:一张**真实截图** + 裁切 + 焦点推近 + 圈注高亮。
//
// 解决什么问题:讲产品/界面/网页时,最有说服力的画面就是真的那一屏。
// 但直接把 1440×900 的截图缩到竖版里,结果是"一张糊掉的缩略图"——
// 观众看不清任何一处,也不知道该看哪。要做对得同时做三件事:
//   裁掉无关区域(crop) → 推近到焦点(focus.zoom) → 把要说的那一块圈出来(focus.box)。
// 这三步过去每次都在镜头里手搓,坐标靠目测,平均误差 6.5%(见 docs/locate-protocol.md)。
//
// 何时用:产品演示、界面讲解、"看这里"类镜头。
// 何时不用:截图只是氛围背景时——那种情况直接 <Img> 加一层暗色蒙版更省事;
//   以及需要设备外框时——外框交给 DeviceMockup,把本组件放进它的 children。
//
// **坐标从哪来:全部由调用方给,组件只管消费。**
// 用 `node tools/locate.mjs`(overlay → region → final → mark 四步)量出 box/center,
// 转成 0–1 归一化坐标传进来。**不许目测**——目测误差 6.5%,网格法 2.3%,
// 而且末步 `mark` 会把偏移当场画出来给你看。
//
// 坐标系约定(两套,别搞混):
//   `crop`  = 相对**原图**的 0–1 矩形。{x:0.1, y:0, width:0.6, height:0.5} 取原图左上偏右一块。
//   `focus` = 相对**裁切后画面**的 0–1 坐标。裁完再定焦,这样改 crop 不会连累焦点。
//
// 踩过的坑:
//
// 1. **必须用 remotion 的 `<Img>`,不是原生 `<img>`。** `<Img>` 内部走 delayRender,
//    渲染进程会等图片解码完再画这一帧。用原生 img 时首帧经常渲出一块空白,
//    而且只在正式渲染时出现、Studio 里看不见——这是最难查的一类问题。
// 2. **`src` 只能是 `staticFile('...')` 或 import 进来的资源,渲染期绝不 fetch。**
//    远程 URL 在渲染农场/离线重渲时会 404,而且每帧都要走一次网络。
//    素材一律先下载进项目 `assets/` 或 `public/`。
// 3. **推近必须给 `transformOrigin`,而且原点要用焦点的百分比坐标。** 只写 `scale()`
//    是从中心放大,焦点在角落时会被直接推出画外。
// 4. **高亮的"周围压暗"用 `boxShadow: 0 0 0 9999px rgba(...)`,不是四个遮罩 div。**
//    四块 div 的接缝在有圆角时永远对不齐,而且改一次尺寸要改四处。
//    9999px 的外扩阴影天然是"除了这个框以外全部压暗"。
// 5. **压暗层要放在缩放容器**内部**,跟着一起推近。** 放外面的话推近时高亮框和截图会错位
//    ——这是 v1 最常见的返工。
// 6. **裁切容器必须 `overflow:hidden` 且圆角与外框一致。** 少了圆角,截图的直角会从
//    圆角面板里戳出来,小尺寸下特别脏(同 StatusStrip 坑 2)。
// 7. `accent` **必须是 hex**:高亮描边走 `alpha()`,传 'red' 会算出 NaN,描边直接消失。
//
// 1080×1920 安全区行为:
//   组件按传入的 `width`/`height` 渲染,**自己不定位**。竖版里建议 width ≤ 888
//   (1080 - 96×2 安全边距),高度按截图比例给;超出安全区的部分会被平台 UI 压住,
//   而截图恰恰是"细节都在边上"的素材,压掉一条就读不全。
//   要做满幅出血的截图镜,请显式把 width 给到 1080 并接受上下被裁——那是一个决定,不是默认。

export type ScreenshotCrop = {
  /** 相对原图的 0–1 归一化矩形 */
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ScreenshotFocus = {
  /** 裁切后画面内的焦点中心,0–1 */
  x: number;
  y: number;
  /** 推近终点倍率,默认 1.16。>1.6 会把截图糊出像素 */
  zoom?: number;
  /** 可选圈注框(裁切后坐标,0–1)。给了才画高亮 + 周围压暗 */
  box?: {x: number; y: number; width: number; height: number};
};

export type ScreenshotStageProps = {
  /** `staticFile('assets/shot.png')` 或 import 的资源。**不接受远程 URL**(坑 2)。 */
  src: string;
  width: number;
  height: number;
  /** 裁切矩形(相对原图)。不裁就给 {x:0,y:0,width:1,height:1}。 */
  crop: ScreenshotCrop;
  /** 焦点与圈注(相对裁切后画面)。坐标来自 tools/locate.mjs。 */
  focus: ScreenshotFocus;
  /** 0–1 归一化进度:推近 + 高亮淡入都从它推导。会被钳到 0–1。 */
  progress: number;
  /** 外框材质。'none' 出血无框;'panel'/'glass' 复用 SurfacePanel 的面板质感。 */
  frameStyle: 'none' | 'panel' | 'glass';
  /** 强调色(hex),染圈注描边与外框描边。 */
  accent?: string;
  /** 圈注外的压暗强度 0–1,默认 0.5。 */
  dim?: number;
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const RADIUS = 18;
const PAD = 14; // 面板内边距:截图和面板边之间的一圈"卡纸"

export const ScreenshotStage: React.FC<ScreenshotStageProps> = ({
  src,
  width,
  height,
  crop,
  focus,
  progress,
  frameStyle,
  accent,
  dim = 0.5,
}) => {
  const p = clamp01(progress);
  const zoomTo = focus.zoom ?? 1.16;
  const pad = frameStyle === 'none' ? 0 : PAD;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const innerRadius = frameStyle === 'none' ? RADIUS : RADIUS - 6;

  // 推近:MOVE 曲线(同屏移动),不是 ENTER —— 这是镜头在走,不是元素在入场
  const zoom = interpolate(p, [0, 1], [1, zoomTo], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: MOVE,
  });
  // 圈注比推近晚一拍出现:先到位,再指出来
  const hi = interpolate(p, [0.42, 0.78], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const cw = Math.max(0.001, crop.width);
  const ch = Math.max(0.001, crop.height);

  const frame: React.CSSProperties =
    frameStyle === 'none'
      ? {}
      : panelSurface(frameStyle === 'glass' ? 'glass' : 'solid', true, accent);

  return (
    <div
      style={{
        position: 'relative',
        width,
        height,
        boxSizing: 'border-box',
        borderRadius: RADIUS,
        padding: pad,
        ...frame,
      }}
    >
      {frameStyle !== 'none' ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: RADIUS,
            background: PANEL_SHEEN,
            pointerEvents: 'none',
          }}
        />
      ) : null}

      {/* 裁切窗口(坑 6):固定尺寸 + overflow hidden + 与外框一致的圆角 */}
      <div
        style={{
          position: 'relative',
          width: innerW,
          height: innerH,
          overflow: 'hidden',
          borderRadius: innerRadius,
          background: 'rgba(0,0,0,0.35)', // 图片解码前的底,不是纯黑洞
        }}
      >
        {/* 推近容器:坑 3(原点=焦点)、坑 5(压暗和圈注都在这层里,一起被推) */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transform: `scale(${zoom})`,
            transformOrigin: `${clamp01(focus.x) * 100}% ${clamp01(focus.y) * 100}%`,
          }}
        >
          {/* 裁切:把原图放大到 1/crop 倍,再按 crop 原点平移 */}
          <div
            style={{
              position: 'absolute',
              width: `${(1 / cw) * 100}%`,
              height: `${(1 / ch) * 100}%`,
              left: `${(-crop.x / cw) * 100}%`,
              top: `${(-crop.y / ch) * 100}%`,
            }}
          >
            {/* 坑 1:remotion 的 Img,渲染前等解码完成 */}
            <Img
              src={src}
              style={{width: '100%', height: '100%', objectFit: 'fill', display: 'block'}}
            />
          </div>

          {focus.box ? (
            <div
              style={{
                position: 'absolute',
                left: `${clamp01(focus.box.x) * 100}%`,
                top: `${clamp01(focus.box.y) * 100}%`,
                width: `${clamp01(focus.box.width) * 100}%`,
                height: `${clamp01(focus.box.height) * 100}%`,
                borderRadius: 8,
                boxSizing: 'border-box',
                border: accent
                  ? `3px solid ${alpha(accent, 0.9 * hi)}`
                  : `3px solid rgba(255,255,255,${0.9 * hi})`,
                // 坑 4:一条 9999px 外扩阴影 = 除了这块以外全压暗
                boxShadow: `0 0 0 9999px rgba(0,0,0,${clamp01(dim) * hi})`,
                opacity: hi > 0 ? 1 : 0,
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
};
