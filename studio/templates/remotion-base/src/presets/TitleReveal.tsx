import {EditableText, EditorScene, useElementEdit} from '../editor/preset-editing';
// presets/TitleReveal.tsx —— 标题入场卡 preset(docs/presets/title-reveal/preset.json)
//
// 三档入场(variant.style),同一坐标骨架(title 主体 y≈880,subtitle 其下,底部留白):
//   blur   —— 逐词入场:y 90→0 + blur 22→0 + opacity 三通道**共用同一个 p、同一条 outCubic**
//             (分开写三条缓动会出现"位移到了但还糊着"的错位,柔和感立刻散掉——配方卡判例)。
//             词间 stagger ≈3.5f;subtitle 错峰重叠(标题收完前就跟进,排队会读成两拍)。
//             中文不含空格时按标点/2–4 字切段,**不许逐字**(逐字太碎,词级才有"念出来"的语感)。
//   marker —— 标题整块从下方 36px 落定(22f)后停一拍,手绘马克笔笔划在 accent 子串下
//             10f 从左到右扫过(慢了读作加载条)。正体中文 → 中轴水平微抖,不做斜体上斜;
//             抖动 ≤±0.2 笔宽(用户反馈:直中带手感)。accent 不是 title 子串就整行不划。
//   brace  —— 一对花括号 7f 处**硬切**出现(不淡入,先建立"这是一对括号"),15f→39f 带
//             outBack 过冲弹开并放大 0.6→1;文字 clip 宽度**严格绑括号间距**(命门:文字
//             自己淡入括号就退化成装饰)。accent 存在时只括 accent,pre/post 随弹开被推出;
//             落定后字距细微松弛("呼一口气",全片最后一次运动)。
//
// 时序纪律:enter 相位是绝对秒(2.5s 和 6s 的版本前 2.4s 完全一样),durationSeconds
// 伸缩全部落在末段 hold。弹簧名额:0 个 spring() 调用;唯一过冲 = brace 档的 outBack
// (全片唯一峰值,配方卡:再叠别的 back 缓动就贬值)。
// 颜色零 hex(全部 useBaseline);字体只走 textStyle(T, role) + tune.font 覆盖;
// 确定性:一切由 useCurrentFrame 推导,伪随机用 seed 式 rand。
// 复刻来源:src/shotcraft/{BlurSlide,MarkerUnderlineTitle,BraceExpand}.tsx(逐帧验证版,
// 参数按 480→1080 ×2.25 换算);**不 import src/shotcraft**。
import React, {useId} from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {useBaseline, Backdrop, Foreground, textStyle, alpha} from '../style/baseline';
import {estimateTextWidth, fitFontSize} from '../style/fit';
import {TuneSkin} from '../style/tune';
import {TUNE_FONTS} from './KeyConcept';

export type PresetTitleRevealProps = {
  durationSeconds: number;
  variant?: {style?: 'blur' | 'marker' | 'brace'};
  slots: {title: string; subtitle?: string; accent?: string};
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

// ---------------------------------------------------------------------------
// 纯函数工具(确定性)
// ---------------------------------------------------------------------------

/** seed 式伪随机:同种子跨帧/跨渲染恒定 */
const rand = (s: number) => {
  const x = Math.sin(s * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const outCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const inOutQuad = (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);
const outBack = (t: number) => {
  const s = 1.70158;
  return 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
};

/** frame 在 [fromF, fromF+durF] 内归一化 + 缓动,两端钳制 */
const seg = (frame: number, fromF: number, durF: number, ease: (t: number) => number) =>
  ease(
    interpolate(frame, [fromF, fromF + durF], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );

const CJK_RE = /[㐀-鿿豈-﫿]/;
/** 切段后允许附着在段尾的标点 */
const TAIL_PUNCT = '，。、；：！？…—·,';

/** 把一段无空格中文按 2–4 字切块(整块 ≤4 字不切;否则 3 字优先,避免孤字尾块) */
const chunkCjk = (part: string): string[] => {
  const chars = Array.from(part);
  if (chars.length <= 4) return chars.length > 0 ? [part] : [];
  const out: string[] = [];
  let i = 0;
  while (i < chars.length) {
    const remain = chars.length - i;
    const take = remain <= 4 ? (remain === 4 ? 2 : remain) : remain % 3 === 1 ? 2 : 3;
    out.push(chars.slice(i, i + take).join(''));
    i += take;
  }
  return out;
};

/**
 * 逐词入场的拆分(blur 档用)。配方卡的坑:中文 `split(' ')` 得到一整块,须按
 * 标点/语义切成 3–5 段,不许逐字。accent 是子串时优先让它独立成段(语义边界最准)。
 */
const splitUnits = (text: string, accent?: string): string[] => {
  const trimmed = text.trim();
  if (trimmed === '') return [];
  if (!CJK_RE.test(trimmed)) return trimmed.split(/\s+/);
  if (/\s/.test(trimmed)) return trimmed.split(/\s+/);
  // accent 命中 → pre / accent / post 各自切块
  if (accent && accent.trim() !== '' && trimmed.includes(accent) && trimmed !== accent) {
    const idx = trimmed.indexOf(accent);
    return [
      ...splitUnits(trimmed.slice(0, idx)),
      accent,
      ...splitUnits(trimmed.slice(idx + accent.length)),
    ];
  }
  // 先按标点断(标点附着前段),再对超长段 2–4 字切块
  const parts: string[] = [];
  let buf = '';
  for (const ch of trimmed) {
    buf += ch;
    if (TAIL_PUNCT.includes(ch)) {
      parts.push(buf);
      buf = '';
    }
  }
  if (buf !== '') parts.push(buf);
  return parts.flatMap(chunkCjk);
};

/**
 * 马克笔笔画:中轴水平微抖(正体中文,**不做斜体上斜**——斜向画反是配方卡点名的
 * 一眼假判例,斜向只跟斜体字势)+ 变宽轮廓(起笔略细→中段饱满→收笔收尖)。
 * 抖动幅度:中轴 ±0.009·size、宽度 ±0.0125·size,均 ≤ 0.2×笔宽(0.115·size)。
 */
const buildStroke = (len: number, sizePx: number, seed: number): string => {
  const N = 40;
  const H = 0.5 * sizePx; // 与 svg height 保持一致
  const top: string[] = [];
  const bot: string[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = t * len;
    const j = rand(seed + i) - 0.5; // [-0.5, 0.5]
    const mid = H * 0.5 + Math.sin(t * Math.PI * 1.6 + 0.4) * 0.022 * sizePx + j * 0.018 * sizePx;
    const wBase =
      sizePx * (0.115 + Math.sin(t * Math.PI) * 0.05) - Math.max(0, t - 0.86) * sizePx * 0.38;
    const w = Math.max(0.02 * sizePx, wBase + j * 0.025 * sizePx);
    top.push(`${x.toFixed(1)},${(mid - w / 2).toFixed(1)}`);
    bot.push(`${x.toFixed(1)},${(mid + w / 2).toFixed(1)}`);
  }
  return `M${top.join('L')}L${bot.reverse().join('L')}Z`;
};

/** 带附加宽度(em)的 shrink-to-fit(brace 档:标题两侧还要装括号) */
const fitWithExtraEm = (
  text: string,
  extraEm: number,
  spec: {fontSize: number; maxWidthPx: number; shrinkFloorPx: number},
): number => {
  const perEm = estimateTextWidth(text, 100, -0.03) / 100 + extraEm;
  const size = Math.floor(spec.maxWidthPx / perEm);
  if (size >= spec.fontSize) return spec.fontSize;
  if (size >= spec.shrinkFloorPx) return size;
  throw new Error(
    `[fit] 标题「${text}」加括号后在 ${spec.shrinkFloorPx}px(下限)仍超出 ${spec.maxWidthPx}px——请缩短文案`,
  );
};

// ---------------------------------------------------------------------------
// 坐标骨架(三档共用):title 主体 y≈880,subtitle 其下,底部留白
// ---------------------------------------------------------------------------
const TITLE_TOP = 880;
const SUB_GAP = 56; // 标题行底 → 副标题顶

// ---------------------------------------------------------------------------
// blur 档:逐词三通道同缓动收敛
// ---------------------------------------------------------------------------
const BlurLine: React.FC<{
  units: string[];
  frame: number;
  startF: number;
  staggerF: number;
  durF: number;
  dy: number;
  maxBlur: number;
  gap: string;
  style: React.CSSProperties;
}> = ({units, frame, startF, staggerF, durF, dy, maxBlur, gap, style}) => (
  <div
    style={{
      display: 'flex',
      justifyContent: 'center',
      flexWrap: 'wrap',
      columnGap: gap,
      ...style,
    }}
  >
    {units.map((u, i) => {
      // 三通道共用同一个 p、同一条 outCubic —— 这一卡的专业感来源,不许拆
      const p = seg(frame, startF + i * staggerF, durF, outCubic);
      return (
        <span
          key={`${u}-${i}`}
          style={{
            display: 'inline-block',
            opacity: p,
            transform: `translateY(${(1 - p) * dy}px)`,
            filter: `blur(${((1 - p) * maxBlur).toFixed(2)}px)`,
          }}
        >
          {u}
        </span>
      );
    })}
  </div>
);

// ---------------------------------------------------------------------------
// 组件本体
// ---------------------------------------------------------------------------
const Inner: React.FC<PresetTitleRevealProps> = ({variant, slots, tune}) => {
  const titleEdit = useElementEdit('title');
  const subtitleEdit = useElementEdit('subtitle');
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const landscape = width > height;
  const {P, T, pad} = useBaseline();
  const clipId = `tr-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  const styleKind = variant?.style ?? 'blur';
  const tuneScale = tune?.scale ?? 1;
  const tuneFont = TUNE_FONTS[tune?.font ?? 'skin'];

  const title = slots.title;
  const subtitle = slots.subtitle?.trim() ? slots.subtitle : undefined;
  const accent =
    slots.accent && slots.accent.trim() !== '' && title.includes(slots.accent)
      ? slots.accent
      : undefined;

  const maxW = (landscape ? width - 160 : 1080) - pad * 2; // 936

  // 标题字号:blur/marker 满宽 shrink-to-fit;brace 要给两只括号留 ~2.6em
  const baseSize =
    styleKind === 'brace'
      ? fitWithExtraEm(title, accent ? 2.6 : 2.4, {fontSize: 104, maxWidthPx: maxW, shrinkFloorPx: 56})
      : fitFontSize(title, {fontSize: 118, maxWidthPx: maxW, shrinkFloorPx: 64, letterSpacingEm: -0.03});
  const titleSize = titleEdit?.fontSize ?? Math.round(baseSize * tuneScale);
  const subSize = subtitleEdit?.fontSize ?? (subtitle
    ? Math.round(
        fitFontSize(subtitle, {fontSize: 40, maxWidthPx: maxW, shrinkFloorPx: 28}) * tuneScale,
      )
    : 0);

  const titleStyle: React.CSSProperties = {
    ...textStyle(T, 'hero'),
    ...(tuneFont ? {fontFamily: tuneFont} : {}),
    ...(titleEdit?.fontFamily ? {fontFamily: titleEdit.fontFamily} : {}),
    fontSize: titleSize,
    lineHeight: 1.18,
    color: P.ink,
  };
  const subStyle: React.CSSProperties = {
    ...textStyle(T, 'body'),
    ...(subtitleEdit?.fontFamily ? {fontFamily: subtitleEdit.fontFamily} : {}),
    fontSize: subSize,
    lineHeight: 1.5,
    color: P.inkSecondary,
  };
  const titleTop = landscape ? height * .38 : TITLE_TOP;
  const subTop = titleTop + Math.round(titleSize * 1.18) + SUB_GAP;

  // ---- 各档动效 ----------------------------------------------------------
  let titleNode: React.ReactNode = null;
  let subNode: React.ReactNode = null;

  if (styleKind === 'blur') {
    // 逐词:主 stagger 3.5f / 词窗 20f / dy 90(=40×2.25);副 stagger 2.5f / dy 58(=26×2.25)。
    // blur 峰值 22px(=10×2.25,与逐帧验证版视觉一致)。
    const tUnits = splitUnits(title, accent);
    const sUnits = subtitle ? splitUnits(subtitle) : [];
    const T_START = Math.round(0.23 * fps); // ≈7f
    const T_STAG = 3.5;
    const W_DUR = 20;
    // 错峰重叠:副标题在标题末词入场进行到 ~45% 时起手(排队会读成两拍)
    const S_START = T_START + (tUnits.length - 1) * T_STAG + Math.round(W_DUR * 0.45);
    const cjkGap = CJK_RE.test(title) ? '0' : '0.32em';
    titleNode = (
      <BlurLine
        units={tUnits}
        frame={frame}
        startF={T_START}
        staggerF={T_STAG}
        durF={W_DUR}
        dy={90}
        maxBlur={22}
        gap={cjkGap}
        style={titleStyle}
      />
    );
    if (subtitle) {
      subNode = (
        <BlurLine
          units={sUnits}
          frame={frame}
          startF={S_START}
          staggerF={2.5}
          durF={W_DUR}
          dy={58}
          maxBlur={22}
          gap={CJK_RE.test(subtitle) ? '0' : '0.32em'}
          style={subStyle}
        />
      );
    }
  } else if (styleKind === 'marker') {
    // 标题整块 22f 从下方 36px 落定(outCubic);32f→42f 马克笔 10f 扫过 accent(提速档,
    // 慢了读作加载条);落定与起笔之间停一拍(划线是"看完标题后的强调")。
    const en = interpolate(frame, [0, 22], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    const eo = outCubic(en);
    const draw = interpolate(frame, [32, 42], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    const drawE = 1 - Math.pow(1 - draw, 2.2);

    let line: React.ReactNode = title;
    if (accent) {
      const idx = title.indexOf(accent);
      const accentW = estimateTextWidth(accent, titleSize, -0.03);
      const LEN = Math.round(accentW + 0.24 * titleSize);
      const H = Math.round(0.5 * titleSize);
      const path = buildStroke(LEN, titleSize, 77);
      line = (
        <>
          {title.slice(0, idx)}
          <span style={{position: 'relative', display: 'inline-block'}}>
            {accent}
            <svg
              width={LEN}
              height={H}
              viewBox={`0 0 ${LEN} ${H}`}
              style={{
                position: 'absolute',
                left: Math.round(-0.12 * titleSize),
                bottom: Math.round(-0.24 * titleSize),
                overflow: 'visible',
              }}
            >
              <defs>
                <clipPath id={clipId}>
                  <rect x={0} y={-H} width={drawE * (LEN + 6)} height={H * 3} />
                </clipPath>
              </defs>
              {draw > 0 && <path d={path} fill={P.accent} clipPath={`url(#${clipId})`} />}
            </svg>
          </span>
          {title.slice(idx + accent.length)}
        </>
      );
    }
    titleNode = (
      <div
        style={{
          ...titleStyle,
          textAlign: 'center',
          opacity: Math.min(1, en * 1.6),
          transform: `translateY(${(1 - eo) * 36}px)`,
        }}
      >
        {line}
      </div>
    );
    if (subtitle) {
      const sIn = seg(frame, 18, 14, outCubic);
      subNode = (
        <div
          style={{
            ...subStyle,
            textAlign: 'center',
            opacity: sIn,
            transform: `translateY(${(1 - sIn) * 20}px)`,
          }}
        >
          {subtitle}
        </div>
      );
    }
  } else {
    // brace:7f 硬切出现(紧贴、0.6 倍)→ 15f→39f outBack 弹开+放大(唯一过冲名额)
    // → 48f→71f 字距松弛。clip 宽度严格绑括号间距:clipW = 2x − M(M 给括号笔画留位)。
    const on = frame >= Math.round(0.23 * fps) ? 1 : 0;
    const ex = seg(frame, 15, 24, outBack);
    const sc = 0.6 + 0.4 * ex;
    const relax = seg(frame, 48, 23, inOutQuad);
    const ls = 2 + 3.5 * relax; // 落定后"呼一口气";>8px(≈设计坐标 4px)标题散架

    const braced = accent ?? title;
    const bracedW = estimateTextWidth(braced, titleSize, 0.06); // 按松弛后字距估,宁宽勿裁
    const M = 0.9 * titleSize; // 括号笔画留位(=设计坐标 34/38em 换算)
    const HALF = (bracedW + M + 0.3 * titleSize) / 2;
    const x = HALF * ex * sc;
    const clipW = Math.max(0, 2 * x - M);
    const braceGlyph: React.CSSProperties = {
      ...textStyle(T, 'hero'),
      ...(tuneFont ? {fontFamily: tuneFont} : {}),
      fontSize: Math.round(titleSize * 1.16),
      lineHeight: 1,
      color: P.accent,
      position: 'absolute',
      top: '50%',
    };
    const rowH = Math.round(titleSize * 1.5);
    const sideStyle = (dir: -1 | 1): React.CSSProperties => ({
      opacity: ex,
      transform: `translateX(${dir * (1 - ex) * 24}px)`,
      whiteSpace: 'nowrap',
    });
    titleNode = (
      <div
        style={{
          ...titleStyle,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: rowH,
          whiteSpace: 'nowrap',
        }}
      >
        {accent ? <span style={sideStyle(1)}>{title.slice(0, title.indexOf(accent))}</span> : null}
        <div
          style={{
            position: 'relative',
            width: Math.round(2 * x),
            height: rowH,
            margin: `0 ${Math.round(0.38 * titleSize)}px`,
            flex: 'none',
            opacity: on,
          }}
        >
          {/* 文字揭示宽度严格绑括号间距(幕布感,不是打字/淡入) */}
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%,-50%)',
              width: Math.round(clipW),
              height: Math.round(titleSize * 1.35),
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span
              style={{
                whiteSpace: 'nowrap',
                letterSpacing: `${ls.toFixed(2)}px`,
                transform: `scale(${sc.toFixed(4)})`,
              }}
            >
              {braced}
            </span>
          </div>
          {/* 括号与文字共用同一个 sc(分两条曲线会在过冲帧错位——配方卡判例) */}
          <span style={{...braceGlyph, left: 0, transform: `translate(-50%,-50%) scale(${sc.toFixed(4)})`}}>
            {'{'}
          </span>
          <span style={{...braceGlyph, left: '100%', transform: `translate(-50%,-50%) scale(${sc.toFixed(4)})`}}>
            {'}'}
          </span>
        </div>
        {accent ? (
          <span style={sideStyle(-1)}>{title.slice(title.indexOf(accent) + accent.length)}</span>
        ) : null}
      </div>
    );
    if (subtitle) {
      const sIn = seg(frame, 45, 15, outCubic);
      subNode = (
        <div
          style={{
            ...subStyle,
            textAlign: 'center',
            opacity: sIn,
            transform: `translateY(${(1 - sIn) * 20}px)`,
          }}
        >
          {subtitle}
        </div>
      );
    }
  }

  // brace 档标题行以 rowH 垂直居中,基线略高于 blur/marker;统一用块顶坐标对齐
  const titleBlockTop =
    styleKind === 'brace' ? titleTop - Math.round(titleSize * 0.16) : titleTop;

  return (
    <EditorScene style={{backgroundColor: P.bg, overflow: 'hidden'}}>
      <Backdrop />
      <EditableText as="div" part="title"
        style={{
          position: 'absolute',
          top: titleBlockTop + (tune?.y ?? 0),
          left: pad,
          right: pad,
          transform: `translateX(${tune?.x ?? 0}px)`,
        }}
      >
        {titleNode}
      </EditableText>
      {subNode ? (
        <EditableText as="div" part="subtitle"
          style={{
            position: 'absolute',
            top: subTop + (tune?.y ?? 0),
            left: pad,
            right: pad,
            transform: `translateX(${tune?.x ?? 0}px)`,
          }}
        >
          {subNode}
        </EditableText>
      ) : null}
      {/* 底部留白锚点:一条几乎没有墨量的短线,免得竖版下半场全空(退让级,不抢戏) */}
      <div
        style={{
          position: 'absolute',
          top: landscape ? height * .84 : 1648,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 88,
          height: 3,
          borderRadius: 2,
          background: alpha(P.ink, 0.22),
        }}
      />
      <Foreground />
    </EditorScene>
  );
};

// 不自带 Provider:无 Provider 时 useBaseline 落到默认皮肤;StyleBible 比稿时可用 Provider 覆盖
export const PresetTitleReveal: React.FC<PresetTitleRevealProps> = (props) => (
  <TuneSkin tune={props.tune}>
    <Inner {...props} />
  </TuneSkin>
);
