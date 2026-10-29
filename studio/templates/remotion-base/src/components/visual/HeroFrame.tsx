import React from 'react';
import {interpolate} from 'remotion';
import type {ScenePalette, TextStyleName, TypographyContext} from '../../lib/theme';
import {alpha, textStyle} from '../../lib/theme';
import {ENTER} from '../../lib/anim';

// 英雄标题块:眉题 + 主标题 + 副标 + 强调线。一镜里**唯一的主焦点**。
//
// 解决什么问题:过去每个开场镜都在手搓「一行小字 + 一行大字 + 一条线」,
// 每次的字号级差、入场时序、强调色用法都不一样,于是同一支片子的两个镜头
// 标题看起来像两支片子。这里把三件事钉死:
//   角色显式(display 给主标题 / body 给副标 / mono 给眉题)、
//   层级用字号级差而不是颜色差、
//   入场是**眉题 → 主标题 → 副标**的编排,不是三行一起淡入。
//
// 何时用:开场镜、章节镜、结尾金句镜——任何"这一屏要说一句话"的镜头。
// 何时不用:画面主体是图表/截图/设备,标题只是配角时——那种镜用 MetadataRail
//   或直接一行 textStyle('h2') 就够,HeroFrame 的体量会把主体压下去。
//
// 排版角色(显式,不许内部暗选):
//   eyebrow  → `caption` 令牌 + `families.mono`。眉题是微型元数据(章节号、分类、时间),
//              等宽 + 正字距 + 大写间距,读成"标签"而不是"另一行正文"。
//   title    → 默认 `h1`(display 角色)。`titleStyle` 可换 'hero'(更冲)或
//              'heroQuiet'(大而细的高级感,走 body 角色)——这是一个创作决定,写在调用点。
//   subtitle → `body` 令牌。**永远比主标题小两级以上**,一级之差读成"两个标题在打架"。
//
// 踩过的坑:
//
// 1. **主标题的遮罩上滑必须裁在一个 `overflow:hidden` 的行盒里,不是给整块加 clip-path。**
//    clip-path 会连同副标和强调线一起裁,时序一乱就看不出编排;而且 clip-path 在
//    Chrome 里会新建 stacking context,前景层的叠加关系跟着变。
// 2. **行盒必须留 `paddingBottom`(这里 0.12em)。** 中文字体的下沉部(比如「夏」的捺)
//    和斜切字体(得意黑)的左下出血会被 overflow:hidden 削掉一条,渲小图看不出来,
//    渲 1080 宽一眼就是"字被切了"。
// 3. **副标不要用 opacity 做层级。** 一淡就糊,压缩后更糊。层级靠字号级差 + 中性墨色阶梯
//    (palette.inkSecondary),那是 OKLCH 里等差的明度,永远拉得开(docs/color.md §2)。
// 4. **强调色只染眉题和那条线,不染主标题。** 主标题是画面里最大的一块面积,
//    染上强调色一次就把 10–35% 的配额烧光,后面的焦点全无处安放。
// 5. **`progress` 是归一化的 0–1,不是帧。** 组件内部把它切成三段子区间;
//    调用方用 `progress(frame, delay, dur)`(lib/anim)算好再传进来,
//    这样同一个块在不同时长的镜头里编排比例一致。
// 6. `accent` **必须是 hex**:眉题底纹和线的渐变都走 `alpha()`,别的格式算出 NaN 会让它们消失。
//
// 1080×1920 安全区行为:
//   本组件**不做绝对定位、不设外边距**,宽度 100%,位置由调用方给
//   (通常是 StageLayers 的 midground 槽 + `safeArea`,即左右各 96、上 220 下 320)。
//   主标题在 1080 宽的安全区内(1080-192=888px)按 h1(104px)排,中文一行约 8 字,
//   **主动折行不缩字号**(visual-max §排版偏好)——所以标题里请自己写 `\n` 或传数组,
//   不要指望组件替你缩字。这里用 `whiteSpace:'pre-line'` 让 `\n` 生效。

export type HeroFrameProps = {
  typography: TypographyContext;
  /** 眉题:章节号 / 分类 / 时间码。是真信息,不是装饰词。传空字符串则不渲染。 */
  eyebrow: string;
  /** 主标题。用 `\n` 手动折行(见安全区说明)。 */
  title: string;
  /** 副标。可留空。 */
  subtitle: string;
  /** 强调色(hex)。只染眉题和强调线(坑 4)。 */
  accent: string;
  /** 0–1 归一化编排进度(坑 5)。会被钳到 0–1。 */
  progress: number;
  /** 主标题的排版令牌。默认 'h1';要更冲用 'hero',要大而细用 'heroQuiet'。 */
  titleStyle?: Extract<TextStyleName, 'hero' | 'heroQuiet' | 'h1'>;
  /** 给了就用 palette 的墨色阶梯;不给则退到中性白阶(**只在深色底上成立**)。 */
  palette?: ScenePalette;
  /** 左对齐(默认)或居中。居中只在纯金句镜用,信息镜一律左对齐。 */
  align?: 'left' | 'center';
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** 子区间 + 两端 clamp + ENTER 缓动。和 StatusStrip 的分段进度同一个写法。 */
const seg = (p: number, from: number, to: number) =>
  interpolate(p, [from, to], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ENTER,
  });

export const HeroFrame: React.FC<HeroFrameProps> = ({
  typography,
  eyebrow,
  title,
  subtitle,
  accent,
  progress,
  titleStyle = 'h1',
  palette,
  align = 'left',
}) => {
  const p = clamp01(progress);

  // 编排:眉题 0–0.30 / 主标题 0.14–0.72 / 线 0.40–0.78 / 副标 0.55–1
  // 区间重叠是故意的——完全不重叠会读成"一项一项蹦出来"的 PPT 动画
  const pEyebrow = seg(p, 0, 0.3);
  const pTitle = seg(p, 0.14, 0.72);
  const pRule = seg(p, 0.4, 0.78);
  const pSub = seg(p, 0.55, 1);

  // 坑 3:层级靠墨色阶梯,不靠 opacity
  const ink = palette?.ink ?? 'rgba(255,255,255,0.97)';
  const inkSecondary = palette?.inkSecondary ?? 'rgba(255,255,255,0.74)';

  const title0 = textStyle(typography, titleStyle);

  return (
    <div
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: align === 'center' ? 'center' : 'flex-start',
        textAlign: align,
        gap: 20,
      }}
    >
      {eyebrow ? (
        <div
          style={{
            ...textStyle(typography, 'caption'),
            fontFamily: typography.families.mono,
            letterSpacing: '0.18em',
            color: accent,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 12,
            padding: '8px 16px',
            borderRadius: 6,
            // 眉题给一点底色,读成"贴上去的标签"而不是"飘着的小字"
            background: alpha(accent, 0.12),
            border: `1px solid ${alpha(accent, 0.3)}`,
            opacity: pEyebrow,
            transform: `translateY(${(1 - pEyebrow) * 14}px)`,
            whiteSpace: 'nowrap',
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              background: accent,
              flexShrink: 0,
            }}
          />
          {eyebrow}
        </div>
      ) : null}

      {/* 坑 1:遮罩上滑裁在这个行盒里,不动外层 */}
      <div
        style={{
          overflow: 'hidden',
          width: '100%',
          paddingBottom: '0.12em', // 坑 2
        }}
      >
        <div
          style={{
            ...title0,
            color: ink, // 坑 4:主标题不染强调色
            whiteSpace: 'pre-line', // 让调用方的 \n 生效
            transform: `translateY(${(1 - pTitle) * 100}%)`,
            // 斜切/负字距的展示体首字左下会出血,补一点左内边距
            paddingLeft: '0.06em',
            marginLeft: '-0.06em',
          }}
        >
          {title}
        </div>
      </div>

      {/* 强调线:主标题和副标之间的分隔,同时是强调色的第二个落点 */}
      <div
        style={{
          height: 4,
          width: `${pRule * (align === 'center' ? 24 : 34)}%`,
          minWidth: pRule > 0 ? 40 : 0,
          borderRadius: 2,
          background: `linear-gradient(90deg, ${accent} 0%, ${alpha(accent, 0)} 100%)`,
        }}
      />

      {subtitle ? (
        <div
          style={{
            ...textStyle(typography, 'body'),
            color: inkSecondary,
            maxWidth: '92%',
            whiteSpace: 'pre-line',
            opacity: pSub,
            transform: `translateY(${(1 - pSub) * 18}px)`,
          }}
        >
          {subtitle}
        </div>
      ) : null}
    </div>
  );
};
