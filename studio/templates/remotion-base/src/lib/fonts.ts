// 字体系统:加载 + 角色 + 排版样式预设。方法论见 docs/typography.md。
//
// 为什么不用 system-ui:macOS 上 system-ui 的西文落到 Helvetica/SF、中文落到苹方,
// 这是"没有做选择"的字体——它出现在所有人的所有画面里,所以它自带"默认"的气味。
// 字体是画面性格的第一来源,把它交给系统 = 主动放弃性格。
//
// 关键机制:**西文字体必须写在中文字体前面**。
// 'Noto Sans SC', 'Inter' → 西文也由思源黑体渲染(它的西文是配角,窄、平、没细节)
// 'Inter', 'Noto Sans SC' → 西文走 Inter、中文回落到思源黑体,各用各的长处。
// 这一行顺序就是"看着专业"和"看着像 PPT"的分界线之一。

import type {CSSProperties} from 'react';
import {continueRender, delayRender, staticFile} from 'remotion';
// Remotion 4.0.490 的 no-react 入口也会初始化全局 delayRender 列表。
// 必须在创建字体 handle 前加载，否则后续 three/zod-types 导入它会清空
// handle，却留下 28 秒计时器：字体已加载、视频已出帧仍会误报超时。
import 'remotion/no-react';

type Face = {
  family: string;
  file: string;
  /** 可变字体给区间 '100 900';静态字体给单值 */
  weight: string;
  style?: string;
};

// public/fonts/ 下的字体,全部 SIL OFL 1.1 / 免费商用(版权见 assets/library/LIBRARY.md)
//
// family 名必须与 TYPOGRAPHY_KITS 里的字符串**逐字一致**。对不上不会报错,
// 浏览器会静默回退到系统默认字体——画面上看不出任何异常,只是中文突然"变普通了"。
// 这是本文件最容易踩且最难查的坑,改任何 family 名都要重渲 TypeSpecimen 肉眼确认。
const FACES: Face[] = [
  {family: 'Inter', file: 'fonts/InterVariable.ttf', weight: '100 900'},
  {family: 'Archivo', file: 'fonts/Archivo-VF.ttf', weight: '100 900'},
  {family: 'JetBrains Mono', file: 'fonts/JetBrainsMono-VF.ttf', weight: '100 800'},
  {family: 'Instrument Serif', file: 'fonts/InstrumentSerif-Regular.ttf', weight: '400'},
  {family: 'Noto Sans SC', file: 'fonts/NotoSansSC-VF.ttf', weight: '100 900'},
  {family: 'Noto Serif SC', file: 'fonts/NotoSerifSC-Bold.otf', weight: '700'},
  {family: 'Smiley Sans', file: 'fonts/SmileySans-Oblique.ttf', weight: '400'},
  // 霞鹜文楷:唯一一个手写/楷体骨架的中文字体,human kit 的性格全靠它。
  // 只有 Regular 一档,别叠 fontWeight 去"加粗",合成粗体会把楷体的笔锋糊掉。
  {family: 'LXGW WenKai', file: 'fonts/LXGWWenKai-Regular.ttf', weight: '400'},
  // 霞鹜新晰黑:现代细黑,骨架比思源黑体瘦而利落。minimal kit 的中文全靠它。
  // 只有 400 一档——所以整套系统都开了 font-synthesis: none(见 textStyle),
  // 请求 700 时它老老实实渲 400,而不是被浏览器拉成一坨假粗。
  {family: 'LXGW Neo XiHei', file: 'fonts/LXGWNeoXiHei.ttf', weight: '400'},
];

// 模块级加载 + delayRender:渲染进程会等字体就绪再画第一帧。
// 少了这一步,首帧会用回退字体渲染出去(抽帧自查看到的和成片不一样,而且很难查)。
const handle = delayRender('loading fonts');
Promise.all(
  FACES.map(async (f) => {
    const face = new FontFace(f.family, `url(${staticFile(f.file)})`, {
      weight: f.weight,
      style: f.style ?? 'normal',
    });
    await face.load();
    // tsconfig 的 lib 里 FontFaceSet 没声明 add(),运行时是有的
    (document.fonts as unknown as {add: (f: FontFace) => void}).add(face);
  }),
)
  .then(() => continueRender(handle))
  .catch((err) => {
    // 字体加载失败必须炸出来,不能静默回退到系统字体
    throw new Error(`字体加载失败: ${err?.message ?? err}`);
  });

/**
 * 字体套装(Typography Kit)。**字体是显式输入,不是库存里的可选项。**
 *
 * 旧系统的问题:全局有一个"默认字体",于是每支片子的中文都回落到思源黑体,
 * 所有片子看着像同一个模板。现在没有默认值了——每个合成必须自己 createTypography(kit),
 * 选哪套是一个创作决定,写在代码里能被看见、被 review、被换掉。
 *
 * 角色(role)不变:一支片子**最多用两个角色**(display + body),
 * 第三个角色只在有真实理由时加(数字密集 → data/mono;要编辑权威气质 → serif)。
 *
 * 中西文顺序规律仍然成立:西文 family 写在中文前面,西文才会走西文字体的长处。
 */
export type TypographyKitName = 'impact' | 'editorial' | 'human' | 'modern' | 'tech-data' | 'minimal';
export type TypographyRole = 'display' | 'body' | 'serif' | 'mono' | 'data';

type TypographyFamilies = Record<TypographyRole, string>;

export type TypographyContext = {
  name: TypographyKitName;
  families: TypographyFamilies;
  /**
   * 字重上限。**这是"中西文配套"的开关,不是省字重。**
   *
   * 单字重的中文字体(新晰黑 / 文楷 / 得意黑)配可变字重的西文字体时,
   * 同一行里请求 700:西文真的变粗了,中文还是 400 —— 一行字里两个重量,
   * 那种"中文看着虚"的感觉就是从这来的。给 kit 一个上限,两边一起压住。
   */
  weightCap?: number;
};

/** kit 的字重上限表。没列的 kit = 不限(西文中文都有真字重可用) */
const KIT_WEIGHT_CAP: Partial<Record<TypographyKitName, number>> = {
  // 新晰黑只有 400。西文压到 500 与它齐平——再高就是西文粗、中文细的拼贴
  minimal: 500,
};

export const TYPOGRAPHY_KITS: Record<TypographyKitName, TypographyFamilies> = {
  impact: {
    display: `'Archivo', 'Smiley Sans', 'Noto Sans SC', sans-serif`,
    body: `'Inter', 'Noto Sans SC', sans-serif`,
    serif: `'Instrument Serif', 'Noto Serif SC', serif`,
    mono: `'JetBrains Mono', 'Noto Sans SC', monospace`,
    data: `'Archivo', 'JetBrains Mono', 'Noto Sans SC', sans-serif`,
  },
  editorial: {
    display: `'Instrument Serif', 'Noto Serif SC', serif`,
    body: `'Inter', 'Noto Serif SC', serif`,
    serif: `'Instrument Serif', 'Noto Serif SC', serif`,
    mono: `'JetBrains Mono', 'Noto Sans SC', monospace`,
    data: `'Instrument Serif', 'Noto Serif SC', serif`,
  },
  human: {
    display: `'LXGW WenKai', 'Noto Serif SC', serif`,
    body: `'Inter', 'LXGW WenKai', serif`,
    serif: `'LXGW WenKai', 'Noto Serif SC', serif`,
    mono: `'JetBrains Mono', 'LXGW WenKai', monospace`,
    data: `'Inter', 'LXGW WenKai', serif`,
  },
  modern: {
    display: `'Archivo', 'Noto Sans SC', sans-serif`,
    body: `'Inter', 'Noto Sans SC', sans-serif`,
    serif: `'Instrument Serif', 'Noto Serif SC', serif`,
    mono: `'JetBrains Mono', 'Noto Sans SC', monospace`,
    data: `'Archivo', 'Noto Sans SC', sans-serif`,
  },
  'tech-data': {
    display: `'Archivo', 'Noto Sans SC', sans-serif`,
    body: `'Inter', 'Noto Sans SC', sans-serif`,
    serif: `'Instrument Serif', 'Noto Serif SC', serif`,
    mono: `'JetBrains Mono', 'Noto Sans SC', monospace`,
    data: `'JetBrains Mono', 'Noto Sans SC', monospace`,
  },
  /**
   * minimal —— 安静、瘦、留得住白。对标的是发布会大屏那种排版:
   * 一屏一句话、字很大、字重不重、周围全是空。
   *
   * 中文换成霞鹜新晰黑而不是思源黑体:思源黑体是安全网不是主角,
   * 它厚、方、没有骨相,大字号下尤其显得"默认"。西文用 Inter 不用 Archivo:
   * Archivo 的几何感偏工业,这一套要的是中性到近乎无名。
   */
  minimal: {
    display: `'Inter', 'LXGW Neo XiHei', 'Noto Sans SC', sans-serif`,
    body: `'Inter', 'LXGW Neo XiHei', 'Noto Sans SC', sans-serif`,
    serif: `'Instrument Serif', 'Noto Serif SC', serif`,
    mono: `'JetBrains Mono', 'LXGW Neo XiHei', monospace`,
    data: `'Inter', 'LXGW Neo XiHei', sans-serif`,
  },
};

export const createTypography = (name: TypographyKitName): TypographyContext => ({
  name,
  families: TYPOGRAPHY_KITS[name],
  ...(KIT_WEIGHT_CAP[name] === undefined ? {} : {weightCap: KIT_WEIGHT_CAP[name]}),
});

/** 字号阶梯(1080p 基准)。同一画面最多出现 3 级——见 design-principles §6 */
export const SIZE = {
  hero: 224,
  h1: 104,
  h2: 68,
  body: 44,
  label: 32,
  caption: 24,
} as const;

export type TextStyleName =
  | 'hero'
  | 'heroQuiet'
  | 'h1'
  | 'h2'
  | 'body'
  | 'label'
  | 'caption'
  | 'quote'
  | 'data';

/**
 * 排版样式预设。**字号从来不是一个数字**——它带着字重、字距、行高一起来,
 * 三者不配套就是那种"字号对了但还是很土"的画面。
 *
 * 字距规律(这是手写最容易漏的一条):
 * 字号越大,字与字之间的视觉间隙越显宽 → 大字要**负字距**收紧;
 * 字号越小,间隙越挤 → 小字要**正字距**撑开。
 * 所以 hero 是 -0.03em 而 caption 是 +0.06em,不是随手填的。
 *
 * **第一个参数没有默认值,也没有单参数重载**——那等于把"全局默认字体"又放回来一次。
 * 调用点必须先 createTypography(kit),字体套装才是被选出来的,不是被继承来的。
 */
export const textStyle = (
  typography: TypographyContext,
  name: TextStyleName,
): CSSProperties => {
  const base = textStyleRaw(typography, name);
  const cap = typography.weightCap;
  return {
    ...base,
    // ① 字重上限:见 TypographyContext.weightCap
    ...(cap !== undefined && typeof base.fontWeight === 'number' && base.fontWeight > cap
      ? {fontWeight: cap}
      : {}),
    // ② **全系统禁止合成字体**。库里有四款单字重中文字(新晰黑 400 / 文楷 400 /
    //    得意黑 400 / 思源宋 700),对它们请求更粗的字重时,浏览器会把字形横向拉胖
    //    伪造出一个"粗体"——笔锋糊掉、灰度变脏,而且**画面上不报错**,
    //    只是看着廉价。宁可渲出真实的 400,也不要一个假的 700。
    fontSynthesis: 'none',
    WebkitFontSmoothing: 'antialiased',
  };
};

const textStyleRaw = (
  typography: TypographyContext,
  name: TextStyleName,
): CSSProperties => {
  const f = typography.families;
  switch (name) {
    // 强冲击展示:短视频标题、金句。字重顶到 800+,字距收紧,行高压到近乎贴合
    case 'hero':
      return {
        fontFamily: f.display,
        fontSize: SIZE.hero,
        fontWeight: 800,
        letterSpacing: '-0.03em',
        lineHeight: 1.02,
      };
    // 安静展示:极简科技风的大标题。靠"大 + 细 + 松"拿高级感,而不是靠粗
    case 'heroQuiet':
      return {
        fontFamily: f.body,
        fontSize: SIZE.hero,
        fontWeight: 300,
        letterSpacing: '-0.02em',
        lineHeight: 1.08,
      };
    case 'h1':
      return {
        fontFamily: f.display,
        fontSize: SIZE.h1,
        fontWeight: 700,
        letterSpacing: '-0.02em',
        lineHeight: 1.15,
      };
    case 'h2':
      return {
        fontFamily: f.body,
        fontSize: SIZE.h2,
        fontWeight: 600,
        letterSpacing: '-0.01em',
        lineHeight: 1.3,
      };
    // 正文:中文行高要比西文松(方块字没有升降部帮忙分行),1.6 是下限
    case 'body':
      return {
        fontFamily: f.body,
        fontSize: SIZE.body,
        fontWeight: 400,
        letterSpacing: '0',
        lineHeight: 1.62,
      };
    // 小标签:正字距撑开,字重提到 500 补偿小字号的视觉重量流失
    case 'label':
      return {
        fontFamily: f.body,
        fontSize: SIZE.label,
        fontWeight: 500,
        letterSpacing: '0.03em',
        lineHeight: 1.4,
      };
    case 'caption':
      return {
        fontFamily: f.body,
        fontSize: SIZE.caption,
        fontWeight: 500,
        letterSpacing: '0.06em',
        lineHeight: 1.4,
      };
    // 引言:衬线 + 大字 + 松行高。中文衬线只有 Bold,别再叠字重
    case 'quote':
      return {
        fontFamily: f.serif,
        fontSize: SIZE.h1,
        fontWeight: 700,
        letterSpacing: '0',
        lineHeight: 1.45,
      };
    // 数据:等宽数字,纵向对齐才立得住
    case 'data':
      return {
        fontFamily: f.data,
        fontSize: SIZE.h2,
        fontWeight: 600,
        letterSpacing: '-0.01em',
        lineHeight: 1.1,
        fontVariantNumeric: 'tabular-nums',
      };
  }
};

/**
 * 大数字专用:等宽数字 + 负字距。
 * 主数字(hero 级单个数字)用**比例数字**更好看,所以 tabular 默认只在有数字列时开。
 */
export const numeric = (tabular = true): CSSProperties => ({
  fontVariantNumeric: tabular ? 'tabular-nums' : 'proportional-nums',
  fontFeatureSettings: tabular ? `'tnum' 1` : `'pnum' 1`,
});

/**
 * Archivo 的宽度轴(wdth 62–125)。做"超粗压缩标题"或"拉宽的横幅字"时用,
 * 是真正的排版工具,不是把字硬拉变形(scaleX 拉字会毁掉笔画粗细比例,禁止)。
 */
export const width = (wdth: number): CSSProperties => ({
  fontVariationSettings: `'wdth' ${wdth}`,
});

/**
 * 中西文混排微调:西文/数字在中文行里视觉偏小,给它单独抬一点。
 * 用法:把这段包在 <span> 里只套住西文部分。
 * (整行统一放大会把中文也带大,那不是这个问题的解法。)
 */
export const latinInline: CSSProperties = {
  fontSize: '1.06em',
  letterSpacing: '0.01em',
};
