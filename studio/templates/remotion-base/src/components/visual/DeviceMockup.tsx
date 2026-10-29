import React from 'react';
import {interpolate} from 'remotion';
import type {TypographyContext} from '../../lib/theme';
import {alpha, textStyle} from '../../lib/theme';
import {ENTER} from '../../lib/anim';

// 设备外框:手机 / 浏览器窗口 / 平板。给界面内容一个**物理载体**。
//
// 解决什么问题:一块贴在画面里的 UI 截图,观众读成"一张图片";
// 同一块内容套上机身或浏览器 chrome 之后,读成"一个正在被使用的东西"。
// 差别不在好看,在于**它给了内容一个空间位置**——有了机身就有厚度、投影、朝向,
// 三层空间里的"内容主体"层立刻立起来(visual-max §材质)。
//
// 何时用:产品界面、App 流程、网页演示。内容放 children(通常是 ScreenshotStage)。
// 何时不用:内容本身已经占满画面且要看清细节时——外框会吃掉边上一圈像素;
//   以及只想要"一个有质感的框"时——那是 SurfacePanel 的活,别用设备外框假装。
//
// **核心约束:chrome 绝不遮住内容。**
// 手机的刘海不是浮在屏幕上的黑条,而是画在**顶部机身条**里(内容区从它下面开始);
// 浏览器的标题栏同理是内容区上方的一条,不是叠加层。
// 真机上刘海确实压在屏幕上,但在视频里那会正好盖掉界面顶部的标题——
// 还原真机不是这里的目标,不遮内容才是。
//
// 踩过的坑:
//
// 1. **内容区必须 `overflow:hidden` + 自己的圆角。** children 常常是一张比内容区大的图,
//    不裁的话会盖到机身边框上,读成"图片没对齐",而不是"屏幕里显示着东西"。
// 2. **机身圆角和屏幕圆角必须差一个边框宽度**(`bodyRadius - bezel`),
//    两者相等时视觉上是"两个圆角套着",中间那圈会显得歪。
// 3. **投影必须两层**(近距硬影 + 远距软影),和 SurfacePanel 的 `lift` 同一个原则。
//    单层投影读成"贴纸"。
// 4. **入场只用 translateY + scale,不要用 rotate/perspective。** 3D 旋转的设备在
//    H.264 压缩后边缘会抖,而且一旋转就没法和别的元素对齐。要斜置就静态斜置。
// 5. **浏览器地址栏里的字要么是真 URL,要么不放。** 编一个域名出来是假信息;
//    所以 `label` 是可选的,而**一旦给了 label 就必须同时给 typography**——
//    类型上把它们绑在一个对象里,组件内部没有任何暗选字体的余地。
// 6. **不要给机身加 `backdrop-filter`。** 机身是不透明实体,加了只会拖慢渲染;
//    玻璃质感属于 SurfacePanel('glass') 的场景。
// 7. `color` **必须是 hex**:机身描边、状态点都走 `alpha()`,别的格式算出 NaN 会让它们消失。
//
// 1080×1920 安全区行为:
//   组件按 `width`/`height` 渲染,自己不做定位。竖版里手机外框建议 width 600–760
//   (安全区宽 888,两侧还要留呼吸),浏览器外框建议 width 880 以内。
//   **手机外框的高度不要顶满安全区高度**——机身上下各有 chrome,顶满之后屏幕里的内容
//   反而被压扁;宁可缩小整机、把余下的空间给标题。

export type DeviceKind = 'phone' | 'browser' | 'tablet';

export type DeviceLabel = {
  /** 真实 URL / 应用名。编造的域名是假信息(坑 5)。 */
  text: string;
  /** 有文字就必须有字体套装,组件内部不暗选(坑 5)。 */
  typography: TypographyContext;
};

export type DeviceMockupProps = {
  kind: DeviceKind;
  children: React.ReactNode;
  width: number;
  height: number;
  /** 0–1 归一化入场进度。会被钳到 0–1。 */
  progress: number;
  /** 机身强调色(hex):描边、状态点、地址栏描边。 */
  color: string;
  /** 浏览器地址栏 / 手机状态栏的文字。不给就不渲染文字(坑 5)。 */
  label?: DeviceLabel;
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** 各设备的机身参数:边框宽、机身圆角、顶部 chrome 高、底部 chrome 高 */
const SPEC: Record<DeviceKind, {bezel: number; radius: number; top: number; bottom: number}> = {
  phone: {bezel: 14, radius: 54, top: 44, bottom: 30},
  tablet: {bezel: 18, radius: 34, top: 34, bottom: 34},
  browser: {bezel: 10, radius: 18, top: 58, bottom: 10},
};

export const DeviceMockup: React.FC<DeviceMockupProps> = ({
  kind,
  children,
  width,
  height,
  progress,
  color,
  label,
}) => {
  const p = clamp01(progress);
  const spec = SPEC[kind];

  // 坑 4:只有位移 + 缩放
  const t = interpolate(p, [0, 1], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ENTER,
  });
  const lift = (1 - t) * 46;
  const scale = interpolate(t, [0, 1], [0.94, 1]);

  const screenW = width - spec.bezel * 2;
  const screenH = height - spec.bezel * 2 - spec.top - spec.bottom;
  // 坑 2:屏幕圆角 = 机身圆角 - 边框宽
  const screenRadius = Math.max(4, spec.radius - spec.bezel);

  return (
    <div
      style={{
        position: 'relative',
        width,
        height,
        boxSizing: 'border-box',
        borderRadius: spec.radius,
        padding: spec.bezel,
        // 机身:斜向金属渐变(纵向渐变读作塑料,同 SurfacePanel 的 metal 材质)
        background:
          'linear-gradient(152deg, rgba(255,255,255,0.13) 0%, rgba(255,255,255,0.04) 40%, rgba(0,0,0,0.22) 100%)',
        border: `1.5px solid ${alpha(color, 0.34)}`,
        // 坑 3:两层投影
        boxShadow:
          '0 26px 70px rgba(0,0,0,0.55), 0 4px 12px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.24)',
        transform: `translateY(${lift}px) scale(${scale})`,
        opacity: interpolate(t, [0, 0.35], [0, 1], {extrapolateRight: 'clamp'}),
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* ── 顶部 chrome:内容区**上方**的一条,不是叠加层 ── */}
      <div
        style={{
          height: spec.top,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: kind === 'browser' ? '0 12px' : 0,
          justifyContent: kind === 'browser' ? 'flex-start' : 'center',
        }}
      >
        {kind === 'browser' ? (
          <>
            {/* 三个窗口点:浏览器的身份标识,不是装饰(没有它就认不出是浏览器) */}
            {[0.5, 0.34, 0.22].map((a, i) => (
              <div
                key={i}
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 6,
                  background: alpha(color, a),
                  flexShrink: 0,
                }}
              />
            ))}
            {label ? (
              <div
                style={{
                  ...textStyle(label.typography, 'caption'),
                  fontFamily: label.typography.families.mono,
                  color: alpha(color, 0.8),
                  background: 'rgba(0,0,0,0.28)',
                  border: `1px solid ${alpha(color, 0.22)}`,
                  borderRadius: 999,
                  padding: '5px 16px',
                  marginLeft: 10,
                  maxWidth: '70%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {label.text}
              </div>
            ) : null}
          </>
        ) : (
          <>
            {/* 手机/平板的听筒条:画在机身条里,不压屏幕 */}
            <div
              style={{
                width: kind === 'phone' ? 120 : 90,
                height: 8,
                borderRadius: 4,
                background: 'rgba(0,0,0,0.55)',
                boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.6)',
              }}
            />
            {label ? (
              <div
                style={{
                  ...textStyle(label.typography, 'caption'),
                  fontFamily: label.typography.families.mono,
                  color: alpha(color, 0.72),
                  position: 'absolute',
                  right: spec.bezel + 16,
                  top: spec.bezel + 8,
                  whiteSpace: 'nowrap',
                }}
              >
                {label.text}
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* ── 屏幕:唯一装内容的地方,chrome 从不越界(坑 1) ── */}
      <div
        style={{
          width: screenW,
          height: screenH,
          flexShrink: 0,
          overflow: 'hidden',
          borderRadius: screenRadius,
          background: 'rgba(0,0,0,0.4)',
          position: 'relative',
          // 屏幕比机身低一档:内凹阴影给出"嵌进去"的厚度
          boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.55)',
        }}
      >
        {children}
      </div>

      {/* ── 底部 chrome:home 条 / 浏览器底边 ── */}
      <div
        style={{
          height: spec.bottom,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {kind !== 'browser' ? (
          <div
            style={{
              width: Math.min(180, screenW * 0.34),
              height: 6,
              borderRadius: 3,
              background: alpha(color, 0.45),
            }}
          />
        ) : null}
      </div>
    </div>
  );
};
