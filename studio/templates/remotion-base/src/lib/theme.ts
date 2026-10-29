// 设计令牌总入口。三块:配色(color.ts)、字体排版(fonts.ts)、间距安全区(本文件)。
//
// 定色定字**从这里取,不现场手写 hex 和 fontFamily**。
// 方法论:docs/color.md(为什么这样配)、docs/typography.md(为什么这样排)。

import {oklch, scenePalette, ramp, alpha, contrast, shift} from './color';
import {
  TYPOGRAPHY_KITS,
  createTypography,
  SIZE,
  textStyle,
  numeric,
  width,
  latinInline,
} from './fonts';

export {oklch, scenePalette, ramp, alpha, contrast, shift};
export {TYPOGRAPHY_KITS, createTypography, SIZE, textStyle, numeric, width, latinInline};
export type {ScenePalette, SceneMode} from './color';
export type {
  TextStyleName,
  TypographyKitName,
  TypographyRole,
  TypographyContext,
} from './fonts';

/* ============ 配色 ============ */

// 画面底色。**不是纯黑/纯白**——带 8 点彩度的暖中性,和纯 #000/#fff 的区别在于
// 画面读起来像"被光照过的一个空间",而不是"一块没上色的画布"。
export const surface = {
  dark: '#1a1a19',
  light: '#fcfcfb',
};

// 深色画面上的墨色层级(浅色画面见 inkLight)
export const ink = {
  primary: '#ffffff',
  secondary: '#c3c2b7',
  muted: '#898781',
  grid: '#2c2c2a',
  baseline: '#383835',
};

export const inkLight = {
  primary: '#0b0b0b',
  secondary: '#52514e',
  muted: '#898781',
  grid: '#e1e0d9',
  baseline: '#c3c2b7',
};

// 分类系列色:固定顺序使用,不循环、不按排名重排。
// 前 4 位在任何图表形态下都两两可辨(CVD ΔE≥8);超过 4 个系列应合并为"其他"或拆分画面。
// **这是图表用的功能色,不是画面美学配色**——定画面调性用 scenePalette()。
export const seriesDark = ['#3987e5', '#008300', '#d55181', '#c98500'];
export const seriesLight = ['#2a78d6', '#008300', '#e87ba4', '#eda100'];

export const good = '#0ca30c'; // 上涨/正向,仅用于状态,不当系列色用

/**
 * 模板 demo 用的默认场景配色(冷蓝 250°,深色)。
 * **新项目应该自己调一次 scenePalette(hue, mode)**,而不是照抄这一套——
 * 每支片子的色相应该来自题材(见 docs/color.md §1),不是来自模板默认值。
 */
export const palette = scenePalette(250, 'dark');

/* ============ 排版 ============ */

// **这里没有 font 对象,也没有全局默认字体。** 曾经有过一个兼容别名(theme 里的 font 对象
// 指回正文字体),结果是每支片子的中文都回落到同一套思源黑体,所有成片看着像同一个模板。
// 现在每个合成必须自己 createTypography(kit),再把 TypographyContext 传给含文字的组件:
//
//   const typography = createTypography('modern');
//   <div style={textStyle(typography, 'h1')}>…</div>
//
// 五套 kit 的性格对照见 docs/typography.md,同屏样张渲 TypeSpecimen 合成。

/**
 * 1080p 基准字号阶梯。
 * **别只取这个数字**——用 textStyle(typography, 'h1') 拿到配套的字重/字距/行高,
 * 光有字号没有字距行高,就是那种"大是大了但还是很土"的画面。
 */
export const type = SIZE;

/* ============ 间距与安全区 ============ */

export const space = 24; // 基础间距单位,间距取其整数倍

// 竖版 1080x1920 安全区:避开平台 UI(标题栏/进度条/点赞栏)
export const safeVertical = {top: 220, bottom: 320, x: 96};
