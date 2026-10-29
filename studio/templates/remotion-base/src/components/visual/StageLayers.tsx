import React from 'react';
import {safeVertical} from '../../lib/theme';

// 三层舞台:visual-max 要求的「≥3 层空间」的骨架。
//
// 解决什么问题:密度不是"元素多",是**层多**。过去每个镜头都是一堆兄弟 div 平铺在
// 一个 AbsoluteFill 里,z 序靠书写顺序碰运气——加一个前景颗粒就把标题盖住,
// 于是又去给标题手写 zIndex,几轮下来同一个项目里出现三套互相矛盾的 z 值。
// 这里把三层钉死成合同的一部分:**层是槽位,不是顺序**。
//
// 何时用:每一镜的最外层容器(直接放在 <AbsoluteFill> 里,或它自己就是那个 AbsoluteFill)。
// 何时不用:纯素材镜(整屏一张图/一段视频,没有叠加物)——那种镜三个槽有两个是空的,
//   直接写 <AbsoluteFill> 更诚实。
//
// **z 序(硬约定,改之前先想清楚):**
//
//   zIndex 0  background —— 背景系统(BackgroundSystem)、底图、渐变场、网格。
//                            永远不承载需要阅读的信息。
//   zIndex 1  midground  —— 内容主体:标题、面板、图表、设备、拼贴。焦点住在这一层。
//   zIndex 2  foreground —— 前景叠加:颗粒、暗角、扫光、标注箭头、圈注、字幕安全条。
//                            它可以压在主体上,但**不许压住主焦点的文字**。
//
// 三层都是 `position:absolute; inset:0`,尺寸完全等于容器,**互不影响布局**——
// 这正是要点:改前景不会挤动主体,因为它们根本不在同一个流里。
//
// 踩过的坑:
//
// 1. **三层必须显式写 zIndex,不能只靠 DOM 顺序。** DOM 顺序在同一 stacking context 里
//    确实生效,但子层里任何一个 `transform` / `filter` / `mixBlendMode` 都会新建
//    stacking context,一旦主体层内部用了 transform(几乎必然),再往后加的兄弟节点
//    的层级就开始违反直觉。写死 zIndex 是最省事的免疫。
// 2. **前景层必须 `pointerEvents:'none'`。** 渲染出片时无所谓,但 Remotion Studio 里
//    调试时,一层看不见的前景会吃掉所有点击,让人以为界面卡死。
// 3. **不要给前景层加 `overflow:hidden` 的同时又给它 filter。** 两者叠加时 Chrome 会
//    把整层提升为独立合成层并重新光栅化,1080×1920 下每帧多几十毫秒。
// 4. **safeArea 只作用于 midground。** 背景要出血、前景的颗粒暗角也要出血,
//    只有内容主体需要避让平台 UI。给三层统一加 padding 是过去反复出现的错误。
//
// 1080×1920 安全区行为:
//   `safeArea` 传 `true` 时,midground 套用 `theme.safeVertical`(top 220 / bottom 320 / x 96),
//   即竖版短视频避开标题栏、进度条、点赞栏的默认值。传对象可覆盖单项(比如横版片子给
//   `{top: 60, bottom: 60, x: 80}`)。传 false / 不传则不加内边距——
//   **主体自己做绝对定位时必须选后者**,否则 padding 和绝对定位坐标会打两遍架。

export type StageSafeArea = {top: number; bottom: number; x: number};

export type StageLayersProps = {
  /** zIndex 0。背景系统 / 底图 / 渐变场。不放需要阅读的信息。 */
  background: React.ReactNode;
  /** zIndex 1。内容主体,焦点住在这里。 */
  midground: React.ReactNode;
  /** zIndex 2。前景叠加:颗粒、暗角、标注。不许压住主焦点文字。 */
  foreground: React.ReactNode;
  /** true = 用 theme.safeVertical;给对象可覆盖。**只作用于 midground**(坑 4)。 */
  safeArea?: boolean | Partial<StageSafeArea>;
  /** midground 的排布快捷方式。要精确定位就用 'none' 自己在里面绝对定位。 */
  align?: 'none' | 'center' | 'top' | 'bottom';
  /** 最外层样式覆盖(通常只用来钉底色;底色一般该交给 background 层)。 */
  style?: React.CSSProperties;
};

const layerBase: React.CSSProperties = {position: 'absolute', inset: 0};

const resolveSafe = (
  s: StageLayersProps['safeArea'],
): StageSafeArea | null => {
  if (!s) return null;
  if (s === true) return safeVertical;
  return {
    top: s.top ?? safeVertical.top,
    bottom: s.bottom ?? safeVertical.bottom,
    x: s.x ?? safeVertical.x,
  };
};

const alignStyle = (align: NonNullable<StageLayersProps['align']>): React.CSSProperties => {
  switch (align) {
    case 'center':
      return {display: 'flex', flexDirection: 'column', justifyContent: 'center'};
    case 'top':
      return {display: 'flex', flexDirection: 'column', justifyContent: 'flex-start'};
    case 'bottom':
      return {display: 'flex', flexDirection: 'column', justifyContent: 'flex-end'};
    case 'none':
    default:
      return {};
  }
};

export const StageLayers: React.FC<StageLayersProps> = ({
  background,
  midground,
  foreground,
  safeArea,
  align = 'none',
  style,
}) => {
  const safe = resolveSafe(safeArea);

  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', ...style}}>
      {/* z0 背景:出血到边缘 */}
      <div style={{...layerBase, zIndex: 0}}>{background}</div>

      {/* z1 主体:唯一吃安全区的一层(坑 4) */}
      <div
        style={{
          ...layerBase,
          zIndex: 1,
          boxSizing: 'border-box',
          ...(safe
            ? {
                paddingTop: safe.top,
                paddingBottom: safe.bottom,
                paddingLeft: safe.x,
                paddingRight: safe.x,
              }
            : null),
          ...alignStyle(align),
        }}
      >
        {midground}
      </div>

      {/* z2 前景:出血 + 不吃指针(坑 2) */}
      <div style={{...layerBase, zIndex: 2, pointerEvents: 'none'}}>{foreground}</div>
    </div>
  );
};
