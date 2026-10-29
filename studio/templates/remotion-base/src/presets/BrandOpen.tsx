import {EditableText, EditorScene} from '../editor/preset-editing';
// presets/BrandOpen.tsx —— 品牌开场卡 preset(docs/presets/brand-open/preset.json)
//
// 复刻来源:src/shotcraft/LetterspaceMaterialize.tsx / BrandInkOpen.tsx(video-shotcraft 逐帧验证版,2026-08-20)
// 配方卡:docs/catalog/recipes-external/ 下 opening/letterspace-materialize.md · opening/brand-ink-open.md
// 横版 demo 重排为 1080×1920 竖版;零 hex(颜色全部来自 useBaseline,衍生色相只从
// skin.accentHue 计算);字体走 textStyle(T, role);tune 旋钮齐全。
//
// 两档 variant:
// - letterspace(默认):宽字距字标全字符**并行**显形(软掩膜自底向上 + blur 收敛,
//   任何中间帧都像"显影到一半")+ 完成瞬间结晶提亮回落 + 地平线光带(accent 派生)。
//   配方卡两条命门:①连续(掩膜是连续生长的软边,不分段)②同步(全字符同帧起、
//   同帧收——逐字错峰是打字机语义,这里是整词一体的仪式感)。多词字标按空格拆行
//   竖排(竖版画布的品牌 lockup 惯例;单行会把字挤小)。
// - ink:强调色十字被无形笔画出(先竖后横,画完必须淡出——残留准星和字标抢焦点)
//   → wordmark 逐字凸版戳印(scale 1.6→1 + blur 6→0 + 字底 glint 闪光)
//   → tagline 等宽打字机 + 方块光标 → 整组静置 ≥0.8s →(时长 ≥4.5s 时)上浮缩小溶出。
//   ⚠️ 复刻注释里的坑:逐字 delay 按 wordmark 长度自适应压缩(总错峰窗口封顶 0.9s),
//   长字标不能把戳印挤出时长窗口。
//
// 时序(timing is frozen,enter 相位绝对秒,伸缩全部落在末段 hold):
//   letterspace: 0.30s 起全字符并行显形 1.33s → 1.63s 结晶闪 0.27s → 1.70s tagline 上浮 0.4s → hold
//   ink:        0.00s 竖线 0.3s → 0.27s 横线 0.33s → 0.33s 逐字戳印(步长自适应,单字 0.4s)
//               → 0.80s 十字淡出 0.33s → 0.93s 打字机(0.7f/字符)→ 静置 →(足够长时)末尾 0.3s 溶出
import React from 'react';
import {useManagedPresetExit} from './PresetExit';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {useBaseline, Backdrop, Foreground, textStyle, alpha} from '../style/baseline';
import {fitFontSize} from '../style/fit';
import {TuneSkin} from '../style/tune';
import {oklch} from '../lib/color';
import {ENTER, EXIT} from '../lib/anim';
import {TUNE_FONTS} from './KeyConcept';

export type PresetBrandOpenProps = {
  durationSeconds: number;
  variant?: {style?: 'letterspace' | 'ink'};
  slots: {wordmark: string; tagline?: string};
  /** 打磨旋钮(Studio 试玩用):调到满意把值发给主 agent,固化进皮肤/preset 升版本 */
  tune?: {
    font?: 'skin' | 'smiley' | 'archivo' | 'serif' | 'wenkai' | 'noto-serif';
    scale?: number;
    x?: number;
    y?: number;
    skin?: 'abyss' | 'ember' | 'slate' | 'paper';
    accentHue?: number;
    neutralHue?: number;
  };
};

// 与 style/fit.ts 同口径的 CJK 判定(只用来选字距档,不做估宽)
const CJK_RE = /[⺀-鿿豈-﫿＀-￯]/;

// 竖版内容宽(1080 - 2×pad72)
const CONTENT_W = 936;
// 视觉居中:竖版画面几何居中永远看着偏低
const OPTICAL_RISE = 60;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

// 字标专用估宽。**不用 fit.ts 的 fitFontSize 量 wordmark**:那边拉丁系数 0.52 是
// 混排正文均值,而品牌字标几乎全是大写(Inter caps 实测 ≈0.64em/字)——用 0.52 量
// 会放大约 25%,首渲两档都溢出安全区(2026-08-20 自查帧实锤)。系数含安全余量。
const brandCharEm = (ch: string): number => {
  if (ch === ' ' || ch === '　') return 0.3;
  if (ch >= '0' && ch <= '9') return 0.62;
  if (ch >= 'A' && ch <= 'Z') return 0.68;
  if (CJK_RE.test(ch)) return 1.0;
  return 0.56; // 小写/标点
};

const brandFit = (
  text: string,
  opts: {fontSize: number; maxWidthPx: number; shrinkFloorPx: number; gapEm: number},
): number => {
  const chars = Array.from(text);
  let em = chars.reduce((sum, ch) => sum + brandCharEm(ch), 0);
  if (chars.length > 1) em += opts.gapEm * (chars.length - 1);
  const width = em * opts.fontSize;
  if (width <= opts.maxWidthPx) return opts.fontSize;
  const scaled = Math.floor((opts.fontSize * opts.maxWidthPx) / width);
  if (scaled >= opts.shrinkFloorPx) return scaled;
  throw new Error(
    `[brand-open] 字标「${text}」在 ${opts.shrinkFloorPx}px(下限)仍超出 ${opts.maxWidthPx}px——请缩短字标`,
  );
};

// ---------------------------------------------------------------------------
// letterspace 档
// ---------------------------------------------------------------------------

const LS_PRE = 0.3; // 起笔前静置(底和光带先在)
const LS_DRAW = 1.33; // 全字符并行显形时长(40f@30,配方卡区间 30–80f)
const LS_TAG = 1.7; // tagline 上浮起点

const Letterspace: React.FC<PresetBrandOpenProps> = ({slots, tune}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const landscape = width > height;
  const contentW = landscape ? width - 192 : CONTENT_W;
  const {P, T, skin} = useBaseline();
  const tuneScale = tune?.scale ?? 1;
  const tuneFont = TUNE_FONTS[tune?.font ?? 'skin'];

  // 全字符共享同一进度:同帧起笔、同帧齐收(配方卡命门②)
  const p = interpolate(frame, [LS_PRE * fps, (LS_PRE + LS_DRAW) * fps], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  // easeInOut:起笔缓→中段匀→收笔缓(复刻的手写感曲线)
  const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
  // 显影完成瞬间轻微提亮回落(结晶收束)——全字符同帧发生
  const doneAt = (LS_PRE + LS_DRAW) * fps;
  const doneGlow = interpolate(frame, [doneAt, doneAt + 8], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const glowAmt = p >= 1 ? doneGlow : p > 0.7 ? (p - 0.7) / 0.3 : 0;

  // 多词字标拆行竖排;行内零空格,字距用 flex gap(居中不吃尾空)
  const lines = slots.wordmark
    .split(/\n+/)
    .flatMap((l) => landscape ? [l.trim()] : l.split(/\s+/))
    .filter(Boolean);
  const gapEmOf = (line: string) => (CJK_RE.test(line) ? (landscape ? 0.25 : 0.35) : (landscape ? 0.28 : 0.6));
  const size = Math.round(
    Math.min(
      ...lines.map((l) =>
        brandFit(l.toUpperCase(), {
          fontSize: landscape ? 180 : 160,
          maxWidthPx: contentW,
          shrinkFloorPx: 54,
          gapEm: gapEmOf(l),
        }),
      ),
    ) * tuneScale,
  );

  // 显影掩膜:自底向上的软边扫入。任何中间帧 = "显影到一半"(命门①连续)
  const reveal = e * 135;
  const maskImg = `linear-gradient(0deg, rgba(0,0,0,1) ${reveal - 32}%, rgba(0,0,0,0) ${reveal}%)`;

  // 地平线光带:颜色从皮肤 accent 派生(暖移 28° 的高明度近邻,不是固定紫/粉 hex)
  const bandHi = oklch(0.68, 0.12, skin.accentHue + 28);
  const bandIn = 0.55 + 0.45 * e;

  const tagIn = interpolate(frame, [LS_TAG * fps, (LS_TAG + 0.4) * fps], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ENTER,
  });

  return (
    <EditorScene style={{backgroundColor: P.bg, overflow: 'hidden'}}>
      <Backdrop />
      {/* 暮色地平线光带(复刻的氛围底景,横过字标身后) */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: landscape ? height * 0.32 : 720,
          height: landscape ? height * 0.38 : 400,
          background: `linear-gradient(180deg, ${alpha(bandHi, 0)} 0%, ${alpha(bandHi, 0.15 * bandIn)} 42%, ${alpha(P.accent, 0.11 * bandIn)} 64%, ${alpha(bandHi, 0)} 100%)`,
          filter: 'blur(26px)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: landscape ? width * 0.3 : 260,
          top: landscape ? height * 0.3 : 700,
          width: landscape ? width * 0.4 : 560,
          height: 280,
          background: `radial-gradient(ellipse at center, ${alpha(P.accent, 0.13 * bandIn)} 0%, ${alpha(P.accent, 0)} 70%)`,
          filter: 'blur(30px)',
        }}
      />
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          flexDirection: 'column',
          transform: `translate(${tune?.x ?? 0}px, ${-(landscape ? 30 : OPTICAL_RISE) + (tune?.y ?? 0)}px)`,
        }}
      >
        {lines.map((line, li) => (
          <div
            key={`${line}-${li}`}
            style={{
              display: 'flex',
              gap: gapEmOf(line) * size,
              justifyContent: 'center',
              marginTop: li > 0 ? Math.round(size * 0.42) : 0,
              filter: `drop-shadow(0 0 ${6 + glowAmt * 12}px ${alpha(P.ink, 0.3 + glowAmt * 0.35)})`,
            }}
          >
            {Array.from(line).map((ch, i) => (
              <EditableText as="span" part="wordmark"
                key={`${ch}-${i}`}
                style={{
                  ...textStyle(T, 'hero'),
                  ...(tuneFont ? {fontFamily: tuneFont} : {}),
                  fontSize: size,
                  letterSpacing: 0, // 字距由 flex gap 承担,盖掉 hero 的 -0.03em
                  lineHeight: 1.08,
                  textTransform: 'uppercase',
                  color: P.ink,
                  opacity: clamp01(e * 1.8),
                  filter: `blur(${(1 - e) * 9}px)`,
                  WebkitMaskImage: maskImg,
                  maskImage: maskImg,
                }}
              >
                {ch}
              </EditableText>
            ))}
          </div>
        ))}
        {slots.tagline ? (
          <EditableText as="div" part="tagline"
            style={{
              ...textStyle(T, 'label'),
              fontSize: fitFontSize(slots.tagline, {
                fontSize: 34,
                maxWidthPx: landscape ? width - 320 : 880,
                shrinkFloorPx: 22,
                letterSpacingEm: 0.3,
              }),
              letterSpacing: '0.3em',
              color: P.inkSecondary,
              marginTop: 84,
              paddingLeft: '0.3em', // 尾字距补偿,保持视觉居中
              opacity: tagIn,
              transform: `translateY(${22 * (1 - tagIn)}px)`,
            }}
          >
            {slots.tagline}
          </EditableText>
        ) : null}
      </AbsoluteFill>
      <Foreground />
    </EditorScene>
  );
};

// ---------------------------------------------------------------------------
// ink 档
// ---------------------------------------------------------------------------

const INK_STAMP_START = 0.33; // 逐字戳印起点(与十字描画重叠,复刻同款)
const INK_STAMP_DUR = 0.4; // 单字戳印时长
const INK_STAGGER_MAX = 0.9; // 逐字错峰总窗口封顶(坑:长字标自适应压缩)
const INK_KICK_START = 0.93; // 打字机起点
const INK_EXIT_DUR = 9; // 溶出帧数(退场快于入场——观众已读完)
const INK_MIN_HOLD = 0.8; // 整组静置硬底线(秒)

const InkOpen: React.FC<PresetBrandOpenProps> = ({durationSeconds, slots, tune}) => {
  const managedExit = useManagedPresetExit();
  const frame = useCurrentFrame();
  const {fps, durationInFrames, width, height} = useVideoConfig();
  const landscape = width > height;
  const contentW = landscape ? width - 192 : CONTENT_W;
  const {P, T} = useBaseline();
  const tuneScale = tune?.scale ?? 1;
  const tuneFont = TUNE_FONTS[tune?.font ?? 'skin'];

  // 十字准星:先竖后横,画完必须淡出(残留准星会和字标抢焦点)
  const vDraw = interpolate(frame, [0, 0.3 * fps], [100, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.3, 0, 0.2, 1),
  });
  const hDraw = interpolate(frame, [0.27 * fps, 0.6 * fps], [100, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.linear,
  });
  const crossFade = interpolate(frame, [0.8 * fps, 1.13 * fps], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // 逐字戳印:delay 步长按字标长度自适应压缩(总错峰窗口 ≤0.9s)
  const chars = Array.from(slots.wordmark);
  const stepF = Math.min(0.1 * fps, (INK_STAGGER_MAX * fps) / Math.max(1, chars.length - 1));
  const stampStartF = INK_STAMP_START * fps;
  const stampDurF = INK_STAMP_DUR * fps;
  const stampEndF = stampStartF + stepF * (chars.length - 1) + stampDurF;

  const wordSize = Math.round(
    brandFit(slots.wordmark, {
      fontSize: landscape ? 190 : 150,
      maxWidthPx: contentW,
      shrinkFloorPx: 60,
      gapEm: -0.01,
    }) * tuneScale,
  );

  // 打字机 tagline(0.7f/字符只适用于装饰性小字——配方卡判例)
  const tag = slots.tagline ?? '';
  const kickStartF = INK_KICK_START * fps;
  const kickPerF = 0.7 * (fps / 30);
  const kickDoneF = kickStartF + tag.length * kickPerF;
  const kickChars = Math.floor(Math.max(0, frame - kickStartF) / kickPerF);

  // lockup 全落定的时刻 → 静置 →(时长足够时)溶出
  const lockupDoneF = Math.max(stampEndF, tag ? kickDoneF : 0);
  const exitStartF = durationInFrames - INK_EXIT_DUR;
  const canExit =
    durationSeconds >= 4.5 && exitStartF - lockupDoneF >= INK_MIN_HOLD * fps;
  const brandOut = canExit
    ? interpolate(frame, [exitStartF, durationInFrames - 1], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
        easing: EXIT,
      })
    : 0;

  const cursorOn = (() => {
    if (!tag || brandOut > 0) return false;
    if (frame < kickStartF) return false;
    if (frame < kickDoneF) return true;
    if (frame > kickDoneF + 1.0 * fps) return false; // 打完约 1s 后停闪,进入完全静止
    return Math.floor((frame - kickDoneF) / 2) % 2 === 0;
  })();

  return (
    <EditorScene style={{backgroundColor: P.bg, overflow: 'hidden'}}>
      <Backdrop />
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          // Final opacity is supplied once by PresetExit.
          opacity: managedExit ? 1 : 1 - brandOut,
          transform: `translate(${tune?.x ?? 0}px, ${-(landscape ? 30 : OPTICAL_RISE) + (tune?.y ?? 0) - brandOut * 40}px) scale(${1 - brandOut * 0.12})`,
        }}
      >
        <div style={{textAlign: 'center'}}>
          {/* 强调色十字准星:被无形笔画出 */}
          <svg
            width={84}
            height={84}
            viewBox="0 0 64 64"
            style={{display: 'block', margin: '0 auto 56px', opacity: crossFade}}
          >
            <line
              x1={32}
              y1={2}
              x2={32}
              y2={62}
              stroke={P.accent}
              strokeWidth={5}
              strokeLinecap="round"
              pathLength={100}
              strokeDasharray={100}
              strokeDashoffset={vDraw}
            />
            <line
              x1={2}
              y1={32}
              x2={62}
              y2={32}
              stroke={P.accent}
              strokeWidth={5}
              strokeLinecap="round"
              pathLength={100}
              strokeDasharray={100}
              strokeDashoffset={hDraw}
            />
          </svg>

          {/* wordmark 逐字凸版戳印 */}
          <EditableText as="div" part="wordmark"
            style={{
              ...textStyle(T, 'hero'),
              ...(tuneFont ? {fontFamily: tuneFont} : {}),
              fontSize: wordSize,
              letterSpacing: '-0.01em',
              lineHeight: 1.06,
              color: P.ink,
              whiteSpace: 'pre',
              display: 'inline-flex',
              alignItems: 'flex-end',
            }}
          >
            {chars.map((ch, i) => {
              const delay = stampStartF + i * stepF;
              const t = interpolate(frame, [delay, delay + stampDurF], [0, 1], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
                easing: Easing.bezier(0.2, 0.7, 0.25, 1),
              });
              const glintCenter = delay + stampDurF;
              const glint = interpolate(
                frame,
                [glintCenter - 4, glintCenter, glintCenter + 4],
                [0, 1, 0],
                {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
              );
              return (
                <span
                  key={`${ch}-${i}`}
                  style={{
                    position: 'relative',
                    display: 'inline-block',
                    opacity: t,
                    transform: `scale(${1.6 - 0.6 * t})`,
                    transformOrigin: 'center bottom',
                    filter: `blur(${(1 - t) * 6}px)`,
                  }}
                >
                  {ch === ' ' ? ' ' : ch}
                  {/* 字底强调色 glint 短划闪过 */}
                  <span
                    style={{
                      position: 'absolute',
                      left: '50%',
                      bottom: -8,
                      transform: 'translateX(-50%)',
                      width: `${glint * 100}%`,
                      height: 3,
                      background: P.accent,
                      opacity: glint,
                      borderRadius: 2,
                    }}
                  />
                </span>
              );
            })}
          </EditableText>

          {/* tagline 等宽打字机 + 方块光标 */}
          {tag ? (
            <div
              style={{
                fontFamily: T.families.mono,
                fontSize: fitFontSize(tag, {
                  fontSize: 30,
                  maxWidthPx: landscape ? width - 320 : 880,
                  shrinkFloorPx: 20,
                  letterSpacingEm: 0.14,
                }),
                fontWeight: 500,
                letterSpacing: '0.14em',
                color: P.inkSecondary,
                marginTop: 44,
                height: 40,
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <EditableText as="span" part="tagline" style={{whiteSpace: 'pre'}}>{tag.slice(0, kickChars)}</EditableText>
              <span
                style={{
                  display: 'inline-block',
                  width: 15,
                  height: 28,
                  marginLeft: 5,
                  background: P.accent,
                  opacity: cursorOn ? 0.85 : 0,
                }}
              />
            </div>
          ) : null}
        </div>
      </AbsoluteFill>
      <Foreground />
    </EditorScene>
  );
};

const Inner: React.FC<PresetBrandOpenProps> = (props) => {
  const style = props.variant?.style ?? 'letterspace';
  return style === 'ink' ? <InkOpen {...props} /> : <Letterspace {...props} />;
};

// 不自带 Provider:无 Provider 时 useBaseline 落到默认皮肤;StyleBible 比稿时可用 Provider 覆盖
export const PresetBrandOpen: React.FC<PresetBrandOpenProps> = (props) => (
  <TuneSkin tune={props.tune}>
    <Inner {...props} />
  </TuneSkin>
);
