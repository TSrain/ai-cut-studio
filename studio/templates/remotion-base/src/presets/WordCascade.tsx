import {EditableText, EditorScene, EditorBackground, useElementEdits} from '../editor/preset-editing';
// presets/WordCascade.tsx —— 逐词飞入动字 preset(docs/presets/word-cascade/preset.json)
//
// 学习来源:高高lindsey VZ8qrng2nIo(蓝图 docs/blueprints/kinetic-word-cascade.md,
// 参考帧 docs/reference/narrative/lindsey-kinetic-midflight.jpg / lindsey-qa-scatter.jpg)。
// 蓝图的四条命门,实现时一条都不能丢:
// 1. **模糊是这个手法的一半**——词从斜上方带 blur 飞进,落定前 2–3 帧模糊必须归零,
//    否则读作"没对上焦"而不是"停稳了";
// 2. **stagger(6f)比单词行程(8f)短**——第 n 词没落定第 n+1 词已出发,相与相重叠;
// 3. **不用弹簧**——落定要斩钉截铁,基线的「先偏后正」已经承担了活泼感;
// 4. **行漂移**——整行随新词加入向左缓移(可见部分始终光学居中),等速平移读起来像
//    字幕滚动,所以漂移速度由词的到达驱动,不是时间驱动。
//
// 两个模式(variant.mode):
// - cascade:lines 逐句飞入→静止→淡出换句(换句锚点上下交替,避免"原地刷新")
// - qa:lines[0] 是问题(装进白胶囊,词往里填,填完胶囊上移让位),
//       其余行是答案,在下方**散点**位置「虚→实」显影(散点不是没对齐,是要点不是列表)
//
// 中文没有空格:槽位提示用户**用空格控制词的分组**;没分组的长中文串自动按 2 字切块。
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {useBaseline, Backdrop, Foreground, textStyle, alpha} from '../style/baseline';
import {oklch} from '../lib/color';
import {estimateTextWidth, FIT_COEFF} from '../style/fit';
import {TuneSkin} from '../style/tune';
import {ENTER, CALM, progress} from '../lib/anim';
import {TUNE_FONTS} from './KeyConcept';

export type PresetWordCascadeProps = {
  durationSeconds: number;
  canvas?: string;
  /** 控制台预览通道传 true:透明底垫深灰演播室底 */
  preview?: boolean;
  variant?: {mode?: 'cascade' | 'qa'; bg?: 'aurora' | 'scene' | 'transparent'};
  slots: {lines: string[]};
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
// 分词与确定性伪随机
// ---------------------------------------------------------------------------

const CJK_RE = /[⺀-鿿豈-﫿＀-￯　-〿]/;

/** 空格分词;纯 CJK 的长 token 再按 2 字切块(蓝图:词是"到达"的单位,单字太碎) */
export const splitWords = (line: string): string[] => {
  const out: string[] = [];
  for (const tok of line.split(/\s+/).filter(Boolean)) {
    if (CJK_RE.test(tok) && Array.from(tok).length > 4 && !/[A-Za-z0-9]/.test(tok)) {
      const chars = Array.from(tok);
      for (let i = 0; i < chars.length; i += 2) out.push(chars.slice(i, i + 2).join(''));
    } else {
      out.push(tok);
    }
  }
  return out;
};

/** 确定性伪随机(0..1):同一 (line, word) 每帧每次渲染都得到同一个数 */
const rnd = (a: number, b: number, salt = 0) => {
  const x = Math.sin(a * 127.1 + b * 311.7 + salt * 74.7) * 43758.5453;
  return x - Math.floor(x);
};

// stagger 6f / 行程 8f:蓝图定的重叠率,改其一必须同时想另一个
export const STAGGER_F = 6;
export const TRAVEL_F = 8;
const EXIT_F = 8;

type WordAnim = {
  o: number; // 透明度
  dx: number;
  dy: number;
  blur: number;
  pLin: number; // 线性行程进度(行漂移用它算"已到达宽度")
};

export const wordAt = (frame: number, startF: number, li: number, wi: number): WordAnim => {
  const p = progress(frame, startF, TRAVEL_F, ENTER);
  const pLin = Math.min(1, Math.max(0, (frame - startF) / TRAVEL_F));
  // 出发点:最终位置的斜上方,幅度带伪随机(每个词的弧线都略不同,但每次渲染一致)
  const offX = 30 + 34 * rnd(li, wi, 1);
  const offY = -(20 + 22 * rnd(li, wi, 2));
  // 基线先偏后正:行程后 30% 内从 ±6px 收敛到 0
  const wob = (rnd(li, wi, 3) - 0.5) * 12 * (1 - Math.min(1, Math.max(0, (pLin - 0.7) / 0.3)));
  return {
    o: Math.min(1, p * 2.2),
    dx: offX * (1 - p),
    dy: offY * (1 - p) + wob,
    // 模糊在行程前 70% 内归零 —— 落定那一刻必须已经是锐的(蓝图命门 1)
    blur: 10 * (1 - Math.min(1, pLin / 0.7)),
    pLin,
  };
};

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

const Inner: React.FC<PresetWordCascadeProps> = ({durationSeconds, preview, variant, slots, tune}) => {
  const edits = useElementEdits();
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const {P, T, skin} = useBaseline();
  const landscape = width > height;
  const mode = variant?.mode ?? 'cascade';
  const bg = variant?.bg ?? 'aurora';
  const tuneScale = tune?.scale ?? 1;
  const tuneFont = TUNE_FONTS[tune?.font ?? 'skin'];
  const totalF = Math.round(durationSeconds * fps);

  const hue = skin.accentHue;
  // aurora:浅紫渐变底(Lindsey 原片的光感);ink 取同色相深档
  const auroraInk = oklch(0.42, 0.14, hue);
  const inkColor = bg === 'aurora' ? auroraInk : bg === 'scene' ? P.ink : '#ffffff';
  const usableW = Math.round(width * 0.84);
  const baseFont = Math.round((landscape ? 78 : 60) * tuneScale);

  const rawLines = (slots.lines ?? []).filter((l) => l.trim() !== '');
  const lines = rawLines.map(splitWords);

  // 每行按估宽缩字号(单行制;蓝图:句子 ≤8 词,超长就该拆行或换 preset)
  const lineFont = (ws: string[], font: number, maxW: number) => {
    const w = lineWidth(ws, font);
    return w <= maxW ? font : Math.max(30, Math.floor((font * maxW) / w));
  };
  const spaceW = (font: number) => FIT_COEFF.space * font;
  const lineWidth = (ws: string[], font: number) =>
    ws.reduce((s, w) => s + estimateTextWidth(w, font), 0) + spaceW(font) * (ws.length - 1);

  const sceneStyle: React.CSSProperties = {overflow: 'hidden'};

  // —— 背景 ——
  const sec = frame / fps;
  const bgLayer =
    bg === 'aurora' ? (
      <AbsoluteFill
        style={{
          backgroundColor: oklch(0.975, 0.012, hue),
          // 两团大软斑缓慢漂移(确定性正弦):底是活的,不是纯色死底(蓝图)
          backgroundImage: [
            `radial-gradient(52% 46% at ${18 + 7 * Math.sin(sec * 0.5)}% ${30 + 8 * Math.cos(sec * 0.37)}%, ${oklch(0.9, 0.05, hue)} 0%, transparent 70%)`,
            `radial-gradient(58% 52% at ${82 + 6 * Math.cos(sec * 0.43)}% ${68 + 7 * Math.sin(sec * 0.31)}%, ${oklch(0.93, 0.045, hue + 38)} 0%, transparent 72%)`,
          ].join(','),
        }}
      />
    ) : bg === 'scene' ? (
      <EditorScene style={{backgroundColor: P.bg}}>
        <Backdrop />
      </EditorScene>
    ) : preview ? (
      <AbsoluteFill
        style={{background: `radial-gradient(90% 60% at 50% 45%, #232329 0%, #141417 100%)`}}
      />
    ) : null;

  // 透明底上的字要有一层软影把自己从未知实拍里托出来
  const overlayShadow =
    bg === 'transparent' ? {textShadow: `0 2px 18px ${alpha('#000000', 0.55)}`} : {};

  if (lines.length === 0) {
    return <AbsoluteFill style={sceneStyle}><EditorBackground>{bgLayer}</EditorBackground></AbsoluteFill>;
  }

  // =========================================================================
  // cascade:逐句飞入 → 静止 → 淡出换句
  // =========================================================================
  if (mode === 'cascade') {
    // 时间分配:build(词数决定) + exit(8f) 是固定成本,剩下全给静止,按字数加权。
    // 蓝图:静止 ≥ 入场总时长的 70% —— 时长不够时宁可压缩句数也别压静止。
    const builds = lines.map((ws) => STAGGER_F * (ws.length - 1) + TRAVEL_F);
    const fixed = builds.reduce((a, b) => a + b, 0) + EXIT_F * (lines.length - 1);
    const weights = lines.map((ws) => ws.join('').length + 4);
    const wSum = weights.reduce((a, b) => a + b, 0);
    const free = Math.max(lines.length * 12, totalF - fixed);
    const holds = weights.map((w) => Math.max(12, Math.floor((free * w) / wSum)));

    let cursor = 0;
    const spans = lines.map((ws, i) => {
      const s = {start: cursor, build: builds[i], hold: holds[i]};
      cursor += builds[i] + holds[i] + (i < lines.length - 1 ? EXIT_F : 0);
      return s;
    });

    return (
      <AbsoluteFill style={sceneStyle}>
        <EditorBackground>{bgLayer}</EditorBackground>
        {lines.map((ws, li) => {
          const {start, build, hold} = spans[li];
          const end = start + build + hold;
          if (frame < start || (li < lines.length - 1 && frame >= end + EXIT_F)) return null;
          const exitO = li < lines.length - 1 ? 1 - progress(frame, end, EXIT_F, ENTER) : 1;
          if (exitO <= 0) return null;

          const edit = edits[`line-${li}`];
          const font = edit?.fontSize ?? lineFont(ws, baseFont, usableW);
          const widths = ws.map((w) => estimateTextWidth(w, font) + Math.max(0,w.length-1)*(edit?.letterSpacing??0));
          const gapW = spaceW(font);
          const totalW = widths.reduce((a, b) => a + b, 0) + gapW * (ws.length - 1);

          // 行漂移:可见部分始终光学居中。shownW 由每个词的线性行程进度驱动——
          // 词到了行才挪,不是钟表在推(蓝图命门 4)
          let shownW = 0;
          const anims = ws.map((w, wi) => {
            const a = wordAt(frame, start + wi * STAGGER_F, li, wi);
            shownW += (widths[wi] + (wi > 0 ? gapW : 0)) * a.pLin;
            return a;
          });
          const rowLeft = (width - shownW) / 2 - (width - usableW) / 2 + (tune?.x ?? 0);

          // 换句锚点上下交替(蓝图:新句在稍偏的锚点重新组装,不原地刷新)
          const anchorY = li === 0 ? 0 : (li % 2 === 1 ? 1 : -1) * Math.round(height * 0.03);

          let x = 0;
          return (
            <div
              // eslint-disable-next-line react/no-array-index-key
              key={li}
              style={{
                position: 'absolute',
                left: (width - usableW) / 2,
                top: Math.round(height / 2 - font * 0.7) + anchorY + (tune?.y ?? 0),
                width: usableW,
                height: font * 1.4,
                opacity: exitO,
              }}
            >
              {ws.map((w, wi) => {
                const a = anims[wi];
                const wx = x;
                x += widths[wi] + gapW;
                if (a.o <= 0) return null;
                return (
                  <EditableText as="div" part={`line-${li}`}
                    // eslint-disable-next-line react/no-array-index-key
                    key={wi}
                    style={{
                      position: 'absolute',
                      left: rowLeft + wx + a.dx,
                      top: a.dy,
                      ...textStyle(T, 'hero'),
                      ...(tuneFont ? {fontFamily: tuneFont} : {}),
                      fontSize: font,
                      lineHeight: 1.3,
                      color: inkColor,
                      whiteSpace: 'pre',
                      opacity: a.o,
                      filter: a.blur > 0.2 ? `blur(${a.blur.toFixed(1)}px)` : undefined,
                      ...overlayShadow,
                    }}
                  >
                    {w}
                  </EditableText>
                );
              })}
            </div>
          );
        })}
        {bg === 'scene' ? <Foreground quiet /> : null}
      </AbsoluteFill>
    );
  }

  // =========================================================================
  // qa:问题装白胶囊 → 胶囊上移 → 答案散点显影
  // =========================================================================
  const qWords = lines[0];
  const answers = lines.slice(1);
  const qFont0 = Math.round(baseFont * 0.72);
  const qMaxW = Math.round(usableW * 0.86);
  const qFont = lineFont(qWords, qFont0, qMaxW - 120);
  const qWidths = qWords.map((w) => estimateTextWidth(w, qFont));
  const qGap = spaceW(qFont);
  const qTextW = qWidths.reduce((a, b) => a + b, 0) + qGap * (qWords.length - 1);
  const pillH = Math.round(qFont * 2.1);
  const pillW = Math.min(qMaxW, Math.round(qTextW + qFont * 2.2));

  // 时序:胶囊滑入(12f,空着——「搜索框等待输入」的悬念,蓝图点名别跳过)
  //      → 0.4s 词开始填 → 填完 +8f 胶囊上移(14f) → 答案每 22f 一条显影
  const qStart = Math.round(0.4 * fps);
  const qBuild = STAGGER_F * (qWords.length - 1) + TRAVEL_F;
  const liftStart = qStart + qBuild + 8;
  const lift = progress(frame, liftStart, 14, CALM);
  const ansStart = liftStart + 10;

  const pillIn = progress(frame, 0, 12, ENTER);
  const yCenter = Math.round(height * (landscape ? 0.46 : 0.42));
  const yTop = Math.round(height * (landscape ? 0.24 : 0.26));
  const pillY = yCenter + (yTop - yCenter) * lift + (tune?.y ?? 0);

  const aFont = Math.round(baseFont * 0.62);
  // 打散不单调:偏移一路递增会读作楼梯,那是「没对齐的列表」不是散点
  const xFrac = [-0.28, 0.18, -0.06, 0.3, -0.2];
  const aRowH = Math.round(aFont * 2.0);

  // 胶囊内文字左缘(文字在胶囊内居中)
  const pillX = Math.round((width - pillW) / 2) + (tune?.x ?? 0);
  const qTextLeft = pillX + Math.round((pillW - qTextW) / 2);

  let qx = 0;
  return (
    <AbsoluteFill style={sceneStyle}>
      <EditorBackground>{bgLayer}</EditorBackground>
      {/* 白胶囊 */}
      <div
        style={{
          position: 'absolute',
          left: pillX,
          top: pillY - pillH / 2,
          width: pillW,
          height: pillH,
          borderRadius: pillH / 2,
          background: oklch(0.99, 0.003, hue),
          boxShadow: `0 ${Math.round(pillH * 0.14)}px ${Math.round(pillH * 0.5)}px ${alpha('#000000', bg === 'aurora' ? 0.1 : 0.28)}`,
          opacity: pillIn,
          transform: `translateX(${-40 * (1 - pillIn)}px)`,
        }}
      />
      {/* 问题词(与胶囊同步位移) */}
      {qWords.map((w, wi) => {
        const a = wordAt(frame, qStart + wi * STAGGER_F, 0, wi);
        const wx = qx;
        qx += qWidths[wi] + qGap;
        if (a.o <= 0) return null;
        return (
          <EditableText as="div" part="line-0"
            // eslint-disable-next-line react/no-array-index-key
            key={wi}
            style={{
              position: 'absolute',
              left: qTextLeft + wx + a.dx,
              top: pillY - qFont * 0.62 + a.dy,
              ...textStyle(T, 'hero'),
              ...(tuneFont ? {fontFamily: tuneFont} : {}),
              fontSize: qFont,
              lineHeight: 1.25,
              color: auroraInk,
              whiteSpace: 'pre',
              opacity: a.o,
              filter: a.blur > 0.2 ? `blur(${a.blur.toFixed(1)}px)` : undefined,
            }}
          >
            {w}
          </EditableText>
        );
      })}
      {/* 答案散点:虚→实显影。x 至少错开 15% 画宽——散点的「散」要有下限,
          不然读作没对齐的列表(蓝图踩过的坑) */}
      {answers.map((ws, ai) => {
        const text = ws.join(' ');
        const startF = ansStart + ai * 22;
        const o = progress(frame, startF, 10, ENTER);
        if (o <= 0) return null;
        const f = lineFont(ws, aFont, Math.round(usableW * 0.6));
        const w = lineWidth(ws, f);
        const cx = width / 2 + xFrac[ai % xFrac.length] * usableW * 0.5 + (tune?.x ?? 0);
        const y = yTop + pillH + Math.round(height * 0.06) + ai * aRowH + (tune?.y ?? 0);
        const blur = 12 * (1 - Math.min(1, ((frame - startF) / 10) / 0.75));
        return (
          <EditableText as="div" part={`line-${ai + 1}`}
            // eslint-disable-next-line react/no-array-index-key
            key={ai}
            style={{
              position: 'absolute',
              left: Math.round(cx - w / 2),
              top: y + Math.round(18 * (1 - o)),
              ...textStyle(T, 'hero'),
              ...(tuneFont ? {fontFamily: tuneFont} : {}),
              fontSize: f,
              lineHeight: 1.3,
              color: inkColor,
              whiteSpace: 'pre',
              opacity: o,
              filter: blur > 0.2 ? `blur(${blur.toFixed(1)}px)` : undefined,
              ...overlayShadow,
            }}
          >
            {text}
          </EditableText>
        );
      })}
      {bg === 'scene' ? <Foreground quiet /> : null}
    </AbsoluteFill>
  );
};

export const PresetWordCascade: React.FC<PresetWordCascadeProps> = (props) => (
  <TuneSkin tune={props.tune}>
    <Inner {...props} />
  </TuneSkin>
);
