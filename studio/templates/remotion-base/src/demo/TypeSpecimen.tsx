// 五套 Typography Kit 的同屏样张。改了 lib/fonts.ts 就渲这张肉眼看一遍:
//   npx remotion still TypeSpecimen --frame=60 review/type-kits-60.png
//
// 这张图存在的唯一理由:**中文字体对不上 family 名时不会报错,只会静默回退。**
// 自动检查查不出来,只有把五套摆在同一背景、同一字号、同一栏宽下横着比,
// 才能一眼看出某一套的中文有没有塌回思源黑体。
//
// 三行样例内容是固定的,不要改:
//   第 1 行 中文 → display 角色(看中文字形骨架:黑体 / 衬线 / 楷体)
//   第 2 行 拉丁+数字 → data 角色(看数字字形和等宽与否)
//   第 3 行 中文 → body 角色(看正文尺寸下的可读性)

import React from 'react';
import {AbsoluteFill} from 'remotion';
import {
  createTypography,
  numeric,
  scenePalette,
  space,
  textStyle,
  TYPOGRAPHY_KITS,
} from '../lib/theme';
import type {TypographyKitName} from '../lib/theme';

const P = scenePalette(250, 'dark');

// 标签自己也需要一套字体——用 tech-data 的 mono,五行标签才是同一个中性参照物。
const LABEL = createTypography('tech-data');

// 固定样例内容。三行一字不差,换内容就失去了跨 kit 横比的意义。
const SAMPLE_DISPLAY = '中文的形状决定气质';
const SAMPLE_DATA = 'Automation 2026 / 72.4%';
const SAMPLE_BODY = '字体不是库存，而是选择';

// 每套 kit 一句性格注解,用来判断"渲出来的样子"和"当初选它的理由"对不对得上。
const CHARACTER: Record<TypographyKitName, string> = {
  impact: '品牌冲击 · 大标题',
  editorial: '编辑 · 文化 · 权威',
  human: '人文 · 叙事 · 温度',
  modern: '科技 · 产品 · 现代商业',
  'tech-data': '数据 · 代码 · 界面',
  minimal: '克制 · 留白 · 发布会大屏',
};

// 五行共用的字号。**必须一致**——字号一变,字形差异就没法归因了。
const SIZE_DISPLAY = 60;
const SIZE_DATA = 34;
const SIZE_BODY = 30;

const KitRow: React.FC<{kit: TypographyKitName}> = ({kit}) => {
  const typography = createTypography(kit);
  const f = typography.families;
  return (
    <div
      style={{
        borderTop: `1px solid ${P.line}`,
        paddingTop: space * 0.9,
        paddingBottom: space * 0.9,
      }}
    >
      {/* 行标签:kit 名 + 性格,mono 字体,和样例字体无关 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: space,
          marginBottom: space * 0.6,
        }}
      >
        <div
          style={{
            ...textStyle(LABEL, 'caption'),
            fontFamily: LABEL.families.mono,
            fontSize: 26,
            fontWeight: 700,
            color: P.accent,
          }}
        >
          {kit}
        </div>
        <div
          style={{
            ...textStyle(LABEL, 'caption'),
            fontFamily: LABEL.families.mono,
            fontSize: 19,
            color: P.inkMuted,
          }}
        >
          {CHARACTER[kit]}
        </div>
      </div>

      {/* 1 · display 角色:中文字形骨架 */}
      <div
        style={{
          fontFamily: f.display,
          fontSize: SIZE_DISPLAY,
          // 500:低于 Chrome 合成粗体的门槛。楷体/宋体只有一档字重,
          // 一旦触发合成粗体,笔锋会被糊掉,那就不是这套字体真实的样子了。
          fontWeight: 500,
          letterSpacing: '-0.01em',
          lineHeight: 1.18,
          color: P.ink,
        }}
      >
        {SAMPLE_DISPLAY}
      </div>

      {/* 2 · data 角色:拉丁 + 数字 */}
      <div
        style={{
          ...numeric(true),
          fontFamily: f.data,
          fontSize: SIZE_DATA,
          fontWeight: 500,
          letterSpacing: '0',
          lineHeight: 1.35,
          color: P.inkSecondary,
          marginTop: 6,
        }}
      >
        {SAMPLE_DATA}
      </div>

      {/* 3 · body 角色:正文尺寸下的中文 */}
      <div
        style={{
          fontFamily: f.body,
          fontSize: SIZE_BODY,
          fontWeight: 400,
          letterSpacing: '0',
          lineHeight: 1.5,
          color: P.inkMuted,
          marginTop: 4,
        }}
      >
        {SAMPLE_BODY}
      </div>
    </div>
  );
};

const KITS = Object.keys(TYPOGRAPHY_KITS) as TypographyKitName[];

export const TypeSpecimen: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: P.bg,
        padding: `${space * 3}px ${space * 3.5}px`,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          ...textStyle(LABEL, 'caption'),
          fontFamily: LABEL.families.mono,
          color: P.accent,
          marginBottom: space * 0.6,
        }}
      >
        AI MOTION STUDIO ／ TYPOGRAPHY KITS
      </div>
      <div
        style={{
          fontFamily: LABEL.families.body,
          fontSize: 40,
          fontWeight: 600,
          letterSpacing: '-0.01em',
          lineHeight: 1.3,
          color: P.ink,
          marginBottom: space * 0.5,
        }}
      >
        五套字体套装 · 同字号同栏宽横比
      </div>
      <div
        style={{
          fontFamily: LABEL.families.body,
          fontSize: 22,
          fontWeight: 400,
          lineHeight: 1.5,
          color: P.inkMuted,
          marginBottom: space * 1.2,
        }}
      >
        字体是显式输入。每个合成必须 createTypography(kit)，没有全局默认值。
      </div>

      {KITS.map((kit) => (
        <KitRow key={kit} kit={kit} />
      ))}

      <div style={{flex: 1, minHeight: space}} />

      {/* 明度阶梯:配色的骨架是明度,不是色相 */}
      <div
        style={{
          ...textStyle(LABEL, 'caption'),
          fontFamily: LABEL.families.mono,
          fontSize: 20,
          color: P.inkMuted,
          marginBottom: 10,
        }}
      >
        scenePalette(250, &apos;dark&apos;) ／ 骨架是明度阶梯
      </div>
      <div style={{display: 'flex', gap: 4}}>
        {[
          ['bg', P.bg],
          ['surface', P.surface],
          ['raised', P.surfaceRaised],
          ['line', P.line],
          ['muted', P.inkMuted],
          ['second', P.inkSecondary],
          ['ink', P.ink],
          ['accent', P.accent],
          ['soft', P.accentSoft],
        ].map(([name, hex]) => (
          <div key={name} style={{flex: 1}}>
            <div
              style={{
                height: 48,
                backgroundColor: hex,
                border: `1px solid ${P.line}`,
              }}
            />
            <div
              style={{
                fontFamily: LABEL.families.mono,
                fontSize: 15,
                fontWeight: 500,
                color: P.inkMuted,
                marginTop: 6,
              }}
            >
              {name}
            </div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
