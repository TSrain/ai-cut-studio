// style/baseline.tsx —— 个人品牌风格皮肤(skin)+ 口播 preset 共用的视觉基元
//
// 这是「骨架/皮肤」两层里的皮肤层:颜色、字体、材质集中在这里,preset 组件
// 只从 useBaseline() 取值,自己不带任何 hex / fontFamily。
// **改这里 = 改所有 preset 的样子**;换默认皮肤或大改令牌要 bump baselineVersion
// (docs/presets/baseline.json)并重渲 StyleBible 给用户过目,不许静默换脸。
//
// 蓝本:projects/2026-08-04-broll-SC-0025-keyframes/build/src/shots/system.tsx
// (13 镜验证过的批次冻结视觉系统),通用化时吸收的教训:
// - 一行字必须统一字族:「10 年 = $2,000」是一个表达,不是三个零件——不许中西文
//   在同一短语里换字族拼贴(textStyle 的 display 栈自己会处理 fallback,别手动拆)。
// - Foreground(颗粒+暗角)每镜必有,它是「这画面是拍出来的」的材质信号;
//   退让镜用 quiet 档压到最弱。
// - 得意黑 8° 斜切 + 负字距会把首字左下角裁出血 → 大字容器补 paddingLeft 0.14em。

import React, {createContext, useContext, useMemo} from 'react';
import {EditableText, EditorScene, useElementEdit, useTransparentBackground} from '../editor/preset-editing';
import {AbsoluteFill, useVideoConfig} from 'remotion';
import {
  createTypography,
  textStyle,
  type TypographyContext,
  type TypographyKitName,
} from '../lib/fonts';
import {scenePalette, alpha, oklch, type ScenePalette} from '../lib/color';
import type {TextRun} from './fit';

// ---------------------------------------------------------------------------
// 皮肤定义
// ---------------------------------------------------------------------------

export type SkinDef = {
  id: string;
  /** 给用户看的名字 */
  name: string;
  /** 一句话性格描述(样张页脚也会印) */
  note: string;
  accentHue: number;
  mode: 'dark' | 'light';
  neutralChroma: number;
  /** 中性底的染色色相(不给则跟随 accentHue)。深蓝黑底就是靠它 */
  neutralHue?: number;
  accentChroma?: number;
  kit: TypographyKitName;
  /** 底的质感层:网格+点(2026-08-06 用户反馈"底不要纯黑,要层次") */
  texture?: 'grid-dots' | 'none';
  /** 强调色板的深浅:bright=亮色板(琥珀那种),deep=深色板配反白字(科技蓝) */
  slabTone?: 'bright' | 'deep';
};

/** v0.1 候选皮肤。用户选定后把选中 id 写进 docs/presets/baseline.json。 */
export const SKINS = {
  graphite: {
    id: 'graphite', name: '冷中性减法', note: '炭黑灰白，语义低饱和冷蓝，无装饰边框与底部楔形',
    accentHue: 250, neutralHue: 250, mode: 'dark', neutralChroma: 0.003,
    accentChroma: 0.055, kit: 'minimal', texture: 'none', slabTone: 'deep',
  },
  abyss: {
    id: 'abyss',
    name: '深海科技蓝',
    note: '深蓝黑渐变底 + 网格点质感 + 霞鹜新晰黑,克制留白',
    accentHue: 252,
    mode: 'dark',
    neutralChroma: 0.022,
    neutralHue: 232,
    accentChroma: 0.15,
    // v2:modern → minimal。用户 2026-08-15 原话「字体不好看…口播就要设计的和
    // 乔布斯的 ppt 一样,简单直接高级」。modern 的中文是思源黑体——厚、方、没骨相,
    // 大字号下就是"默认字体"的气味。换成霞鹜新晰黑 + 西文 Inter,字重上限 500。
    kit: 'minimal',
    texture: 'grid-dots',
    slabTone: 'deep',
  },
  ember: {
    id: 'ember',
    name: '暖炭琥珀',
    note: '暖炭底 + 琥珀橙强调 + 得意黑,SC-0025 直系',
    accentHue: 55,
    mode: 'dark',
    neutralChroma: 0.01,
    kit: 'impact',
  },
  slate: {
    id: 'slate',
    name: '冷蓝钢',
    note: '冷炭底 + 钢蓝强调 + Archivo,更硬更科技',
    accentHue: 250,
    mode: 'dark',
    neutralChroma: 0.008,
    kit: 'modern',
  },
  paper: {
    id: 'paper',
    name: '纸上杂志',
    note: '纸白底 + 朱砂强调 + 衬线,亮场编辑感',
    accentHue: 30,
    mode: 'light',
    neutralChroma: 0.006,
    kit: 'editorial',
  },
} as const satisfies Record<string, SkinDef>;

export type SkinName = keyof typeof SKINS;
/** 当前生效皮肤 = docs/presets/baseline.json 冻结的那版(v0.1 = abyss,2026-08-06 用户确认) */
export const DEFAULT_SKIN: SkinName = 'abyss';

// ---------------------------------------------------------------------------
// 令牌构建 + Context
// ---------------------------------------------------------------------------

export type Baseline = {
  skin: SkinDef;
  P: ScenePalette;
  T: TypographyContext;
  pad: number;
  /** 强调色板令牌(AccentSlab 与压板文字消费它,不直接读 P.accent) */
  slab: {from: string; to: string; ink: string};
};

export const createBaseline = (skin: SkinDef | SkinName): Baseline => {
  const def: SkinDef = typeof skin === 'string' ? SKINS[skin] : skin;
  const P = scenePalette(def.accentHue, def.mode, {
    neutralChroma: def.neutralChroma,
    ...(def.neutralHue === undefined ? {} : {neutralHue: def.neutralHue}),
    ...(def.accentChroma === undefined ? {} : {accentChroma: def.accentChroma}),
  });
  // deep 色板:比 P.accent 深两档的同色相板,配反白字(科技蓝方向);
  // bright 色板:P.accent 直接铺(琥珀方向),配 onAccent 深字
  const slab =
    def.slabTone === 'deep'
      ? {
          from: oklch(0.37, (def.accentChroma ?? 0.16) * 0.72, def.accentHue),
          to: oklch(0.26, (def.accentChroma ?? 0.16) * 0.58, def.accentHue - 8),
          ink: oklch(0.975, 0.008, def.accentHue),
        }
      : {from: P.accent, to: P.accentSoft, ink: P.onAccent};
  return {skin: def, P, T: createTypography(def.kit), pad: 72, slab};
};

const DEFAULT_BASELINE = createBaseline(DEFAULT_SKIN);
const BaselineContext = createContext<Baseline | null>(null);

export const BaselineProvider: React.FC<{
  skin: SkinDef | SkinName;
  children: React.ReactNode;
}> = ({skin, children}) => {
  const value = useMemo(() => createBaseline(skin), [skin]);
  return <BaselineContext.Provider value={value}>{children}</BaselineContext.Provider>;
};

/** 无 Provider 时用默认皮肤(生产路径);StyleBible 等比稿场景用 Provider 覆盖 */
export const useBaseline = (): Baseline => useContext(BaselineContext) ?? DEFAULT_BASELINE;

// ---------------------------------------------------------------------------
// 视觉基元(全部从 useBaseline 取令牌;dark/light 双模式)
// ---------------------------------------------------------------------------

/** 前景噪点颗粒(确定性:固定 seed 的 feTurbulence) */
export const GRAIN = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves="2" stitchTiles="stitch" seed="7"/><feColorMatrix type="saturate" values="0"/></filter><rect width="240" height="240" filter="url(#n)" opacity="0.6"/></svg>`,
)}`;

/** 前景叠加层(颗粒 + 暗角)。每镜必有;退让镜用 quiet。 */
export const Foreground: React.FC<{quiet?: boolean}> = ({quiet = false}) => {
  const {P} = useBaseline();
  const transparent = useTransparentBackground();
  if (transparent) return null;
  const light = P.mode === 'light';
  const edge = light ? (quiet ? 0.16 : 0.1) : quiet ? 0.62 : 0.4;
  return (
    <>
      <AbsoluteFill
        style={{
          backgroundImage: `url(${GRAIN})`,
          backgroundRepeat: 'repeat',
          opacity: light ? (quiet ? 0.03 : 0.05) : quiet ? 0.04 : 0.08,
          mixBlendMode: light ? 'multiply' : 'overlay',
          pointerEvents: 'none',
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(140% 105% at 50% 42%, transparent ${quiet ? 40 : 58}%, ${alpha('#000000', edge)} 100%)`,
          pointerEvents: 'none',
        }}
      />
    </>
  );
};

/** 网格+点质感底(确定性静态 SVG 平铺):黑色网格线上叠交点亮点,给底一层"有东西"的层次 */
export const GRID_DOTS = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><path d="M0 .5H72M.5 0V72" stroke="#ffffff" stroke-opacity="0.045"/><circle cx="0.5" cy="0.5" r="1.7" fill="#ffffff" fill-opacity="0.14"/><circle cx="36" cy="36" r="1" fill="#ffffff" fill-opacity="0.07"/></svg>`,
)}`;

/** 常规镜背景系统:低频渐变场 + 大尺度斜切几何(+ 皮肤声明的质感层)。退让镜不用这个,见 RecedeStage。 */
export const Backdrop: React.FC<{cool?: boolean}> = ({cool = false}) => {
  const {P, skin} = useBaseline();
  const transparent = useTransparentBackground();
  if (transparent) return null;
  const light = P.mode === 'light';
  if (skin.id === 'graphite') {
    return <AbsoluteFill style={{background: `radial-gradient(ellipse 70% 45% at 45% 45%,${alpha(P.surfaceRaised, 0.22)},transparent)`}} />;
  }
  return (
    <>
      <AbsoluteFill
        style={{
          background: `radial-gradient(120% 70% at 18% 6%, ${alpha(P.surfaceRaised, cool ? 0.55 : 0.9)} 0%, ${alpha(P.surface, 0.4)} 38%, transparent 70%),
            linear-gradient(196deg, transparent 55%, ${alpha('#000000', light ? 0.08 : 0.34)} 100%)`,
        }}
      />
      {skin.texture === 'grid-dots' ? (
        <AbsoluteFill
          style={{
            backgroundImage: `url(${GRID_DOTS})`,
            backgroundRepeat: 'repeat',
            opacity: light ? 0.5 : 0.85,
            // 中部留给主体,质感在边缘更明显,不跟文字抢
            maskImage: 'radial-gradient(130% 90% at 50% 44%, rgba(0,0,0,0.35) 30%, rgba(0,0,0,1) 100%)',
            WebkitMaskImage:
              'radial-gradient(130% 90% at 50% 44%, rgba(0,0,0,0.35) 30%, rgba(0,0,0,1) 100%)',
            pointerEvents: 'none',
          }}
        />
      ) : null}
      {/* 两块大尺度斜切几何。**边缘必须羽化**:它们本来是硬边矩形转 8°,
          在信息密集的画面里看不出来,一放到留白多的画面上就是一道横穿全屏的折痕
          (2026-08-15 用户说画面"不高级",这道缝是其中一处)。加径向遮罩后
          它从"一块斜板"变成"一片光",该有的层次还在,缝没了。 */}
      <div
        style={{
          position: 'absolute',
          top: -420,
          left: -260,
          width: 1800,
          height: 560,
          transform: 'rotate(-8deg)',
          background: `linear-gradient(170deg, ${cool ? alpha(P.line, 0.5) : P.accentSoft} 0%, transparent 88%)`,
          maskImage: 'radial-gradient(74% 130% at 42% 50%, #000 0%, transparent 82%)',
          WebkitMaskImage: 'radial-gradient(74% 130% at 42% 50%, #000 0%, transparent 82%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 1620,
          left: -300,
          width: 1500,
          height: 520,
          transform: 'rotate(-8deg)',
          background: `linear-gradient(150deg, ${cool ? alpha(P.line, 0.4) : P.accentSoft} 0%, transparent 82%)`,
          maskImage: 'radial-gradient(74% 130% at 46% 50%, #000 0%, transparent 82%)',
          WebkitMaskImage: 'radial-gradient(74% 130% at 46% 50%, #000 0%, transparent 82%)',
        }}
      />
    </>
  );
};

/** 强调斜切色块(英雄区承托)。退让镜禁用。 */
export const AccentSlab: React.FC<{
  top: number;
  left?: number;
  width?: number;
  height?: number;
}> = ({top, left = -160, width = 1500, height = 620}) => {
  const {P, slab} = useBaseline();
  const light = P.mode === 'light';
  return (
    <>
      <div
        style={{
          position: 'absolute',
          top: top - 28,
          left,
          width,
          height: 4,
          transform: 'rotate(-8deg)',
          background: alpha(P.ink, 0.5),
        }}
      />
      <div
        style={{
          position: 'absolute',
          top,
          left,
          width,
          height,
          transform: 'rotate(-8deg)',
          background: `linear-gradient(168deg, ${slab.from} 0%, ${slab.from} 42%, ${slab.to} 130%)`,
          boxShadow: `0 40px 120px ${alpha('#000000', light ? 0.22 : 0.45)}`,
        }}
      />
    </>
  );
};

/** 引用卡:几何/圆角/厚度/描边冻结,cool 只换色温。 */
export const QuoteCard: React.FC<{
  top: number;
  source?: string;
  cool?: boolean;
  children: React.ReactNode;
  minHeight?: number;
}> = ({top, source, cool = false, children, minHeight}) => {
  const {P, T, pad} = useBaseline();
  const {width, height} = useVideoConfig();
  const landscape = width > height;
  const light = P.mode === 'light';
  return (
    <div
      style={{
        position: 'absolute',
        top,
        left: landscape ? 160 : pad,
        right: landscape ? 160 : pad,
        minHeight,
        transform: 'rotate(-1.6deg)',
        background: cool
          ? `linear-gradient(180deg, ${alpha(P.line, 0.34)} 0%, ${alpha(P.surface, 0.9)} 100%)`
          : `linear-gradient(180deg, ${P.surfaceRaised} 0%, ${P.surface} 100%)`,
        border: `1.5px solid ${P.line}`,
        borderRadius: 26,
        boxShadow: light
          ? `0 24px 60px ${alpha('#000000', 0.14)}, inset 0 1px 0 ${alpha('#ffffff', 0.7)}`
          : `0 34px 90px ${alpha('#000000', 0.55)}, inset 0 1px 0 ${alpha(P.ink, 0.09)}, inset 0 -1px 0 ${alpha('#000000', 0.4)}`,
        padding: '42px 48px 46px',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(115deg, transparent 30%, ${alpha(P.ink, 0.05)} 46%, transparent 62%)`,
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          ...textStyle(T, 'hero'),
          position: 'absolute',
          top: -34,
          right: 30,
          fontSize: 210,
          color: alpha(cool ? P.inkMuted : P.accent, 0.11),
          lineHeight: 1,
        }}
      >
        {'”'}
      </div>
      {source ? (
        <div style={{display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 26}}>
          <div
            style={{
              width: 12,
              height: 12,
              background: cool ? P.inkMuted : P.accent,
              borderRadius: 3,
              marginTop: 10,
            }}
          />
          <EditableText part="source" style={{...textStyle(T, 'caption'), color: P.inkMuted, maxWidth: landscape ? width - 480 : 640}}>{source}</EditableText>
        </div>
      ) : null}
      {children}
    </div>
  );
};

/** 作者换算/推断类小字条:视觉层级明确弱于官方原句 */
export const AuthorNote: React.FC<{
  top: number;
  text: string;
  tag?: string;
  onSlab?: boolean;
  left?: number;
}> = ({top, text, tag = '作者换算', onSlab = false, left}) => {
  const {P, T, pad} = useBaseline();
  const c = onSlab ? P.onAccent : P.inkMuted;
  return (
    <div
      style={{
        position: 'absolute',
        top,
        left: left ?? pad + 8,
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        transform: 'rotate(-1.6deg)',
      }}
    >
      <div style={{width: 5, height: 34, background: c, borderRadius: 3}} />
      <EditableText part="note" style={{...textStyle(T, 'label'), color: c}}>{text}</EditableText>
      <EditableText part="noteTag"
        style={{
          ...textStyle(T, 'caption'),
          color: c,
          border: `1.5px solid ${alpha(c, 0.55)}`,
          borderRadius: 999,
          padding: '3px 14px',
        }}
      >
        {tag}
      </EditableText>
    </div>
  );
};

/**
 * 退让镜舞台:纯色底 + 一行字 + 单次极简动作。
 * 禁止 AccentSlab / Backdrop / 粒子 / 纹理 / 装饰。level 1 最亮 → 4 最暗。
 */
export const RecedeStage: React.FC<{level: 1 | 2 | 3 | 4; children: React.ReactNode}> = ({
  level,
  children,
}) => {
  const {P, skin} = useBaseline();
  const transparent = useTransparentBackground();
  if (transparent) return <EditorScene style={{overflow: 'hidden'}}>{children}</EditorScene>;
  const light = P.mode === 'light';
  // dark:不用纯黑纱压(会把底色的色相杀掉,黑得死)——直接在 OKLCH 里带着色相把底压暗,
  //       再垫一层极轻的中心微光,"暗但有层次"(2026-08-06 用户反馈:底不要纯黑)
  // light:轻纱一层,同样逐级安静但不发灰
  if (light) {
    const dim = {1: 0.03, 2: 0.06, 3: 0.09, 4: 0.13}[level];
    return (
      <AbsoluteFill style={{backgroundColor: P.bg, overflow: 'hidden'}}>
        <AbsoluteFill style={{backgroundColor: alpha('#000000', dim)}} />
        {children}
        <Foreground quiet />
      </AbsoluteFill>
    );
  }
  const L = {1: 0.145, 2: 0.125, 3: 0.1, 4: 0.075}[level];
  const bg = oklch(L, skin.neutralChroma * 0.9, P.hue);
  // 中心微光要压缩后仍可见:亮度差 ≥0.07,不然等于没有(2026-08-06 实测 0.045 肉眼不可见)
  const glow = oklch(L + 0.075, skin.neutralChroma * 1.6, P.hue);
  return (
    <AbsoluteFill style={{backgroundColor: bg, overflow: 'hidden'}}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(96% 60% at 50% 44%, ${glow} 0%, transparent 70%),
            radial-gradient(70% 40% at 20% 6%, ${alpha(P.accentSoft, 0.5)} 0%, transparent 62%)`,
        }}
      />
      {skin.texture === 'grid-dots' ? (
        <AbsoluteFill
          style={{
            backgroundImage: `url(${GRID_DOTS})`,
            backgroundRepeat: 'repeat',
            opacity: 0.5,
            pointerEvents: 'none',
          }}
        />
      ) : null}
      {children}
      <Foreground quiet />
    </AbsoluteFill>
  );
};

/**
 * 退让镜的字块(recede v2):折行 + 主焦点分档 + 一条锚点细线。
 *
 * 版式工艺(v2 相对 v1 补的那部分,都住在皮肤层,所有 preset 共享同一套手感):
 * - **视觉居中**:整块比几何中心上移 OPTICAL_RISE,竖版画面里几何居中永远看着偏低;
 * - **字号层次**:命中 hero 的那段用 emphasisSize + 满墨色,其余降到 baseSize + 62% 墨,
 *   一句话内部因此有主次,而不是通体一个字号(没给 hero 时全段都是主焦点,等同 v1);
 * - **多行收紧行距**:1 行 1.20 / 2 行 1.14 / 3 行 1.06,行数越多越紧,免得字块散开;
 * - **锚点细线**:88×2px,对齐字块左缘(不是画面中心),用一条几乎没有墨量的线打破纯对称。
 *   它是**锚点不是装饰**:退让镜没有眉题没有色板,少了它整屏只剩一团浮在中间的字。
 *   亮度随 level 一起递减 —— 镜头越安静,连锚点也跟着退。
 */
const OPTICAL_RISE = 56;

export const RecedeBlock: React.FC<{
  lines: TextRun[][];
  baseSize: number;
  emphasisSize: number;
  maxLineWidthPx: number;
  level: 1 | 2 | 3 | 4;
  /** Explicit sizing is already fitted; do not reapply an oversized editor override. */
  fitted?: boolean;
  evenInk?: boolean;
  /** 0→1 入场进度:锚点线用它生长 */
  enter?: number;
  /** 字体覆盖(打磨旋钮用);不传走皮肤 kit 的 display 栈 */
  fontFamily?: string;
}> = ({lines, baseSize, emphasisSize, maxLineWidthPx, level, enter = 1, fontFamily, fitted = false, evenInk = false}) => {
  const {P, T} = useBaseline();
  const edit = useElementEdit('line');
  const emphasisRatio = emphasisSize / Math.max(1, baseSize);
  if (!fitted && edit?.fontSize !== undefined) {baseSize = edit.fontSize; emphasisSize = baseSize * emphasisRatio;}
  const lineCount = lines.length;
  const lineHeight = Math.round(
    (lines.some(runs => runs.some(run => run.em)) ? emphasisSize : baseSize) * (lineCount >= 3 ? 1.06 : lineCount === 2 ? 1.14 : 1.2),
  );
  // Explicit opacity is absolute for this text block; the legacy ink hierarchy
  // only applies while the user has not overridden it.
  const restInk = evenInk || edit?.opacity !== undefined ? P.ink : alpha(P.ink, 0.62);
  const ruleInk = alpha(P.ink, 0.42 - 0.055 * (level - 1));
  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        transform: `translateY(${-OPTICAL_RISE}px)`,
      }}
    >
      <div style={{width: maxLineWidthPx, display: 'flex', marginBottom: 42}}>
        <div
          style={{
            width: 88,
            height: 2,
            background: ruleInk,
            transform: `scaleX(${0.55 + 0.45 * enter})`,
            transformOrigin: 'left center',
          }}
        />
      </div>
      <EditableText part="line"
        style={{
          ...textStyle(T, 'hero'),
          ...(fontFamily ? {fontFamily} : {}),
          fontSize: baseSize,
          lineHeight: `${lineHeight}px`,
          color: restInk,
          textAlign: 'center',
        }}
      >
        {lines.map((runs, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <div key={i} style={{whiteSpace: 'pre'}}>
            {runs.map((run, j) => (
              // eslint-disable-next-line react/no-array-index-key
              <span
                key={j}
                style={{fontSize: run.em ? emphasisSize : baseSize, ...(run.em ? {color: edit?.color !== undefined ? 'inherit' : P.ink} : {})}}
              >
                {run.text}
              </span>
            ))}
          </div>
        ))}
      </EditableText>
    </AbsoluteFill>
  );
};

/** 顶部眉题(微型元数据,不计入三级语义层次) */
export const Eyebrow: React.FC<{text: string; top?: number}> = ({text, top = 132}) => {
  const {P, T, pad} = useBaseline();
  return (
    <div style={{position: 'absolute', top, left: pad, display: 'flex', alignItems: 'center', gap: 14}}>
      <div style={{width: 46, height: 5, background: P.accent, borderRadius: 3}} />
      <EditableText part="eyebrow" style={{...textStyle(T, 'caption'), color: P.inkMuted}}>{text}</EditableText>
    </div>
  );
};

export {textStyle, alpha};
