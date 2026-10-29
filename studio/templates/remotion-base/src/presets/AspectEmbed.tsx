import {EditableText, EditorScene} from '../editor/preset-editing';
// presets/AspectEmbed.tsx —— 尺寸镶嵌 preset(docs/presets/aspect-embed/preset.json)
//
// 来源:高高lindsey 拉片时用户笔记「16:9 画面中配 9:16 的画面旁边配合文字也不会显得
// 很脱节,各类尺寸的镶嵌都可以」。设计要点:
// - 视频装进**卡片**(圆角+落影+细描边),四周留出的底就是「这是被展示的素材」的语义,
//   直接铺满等于硬切(同 white-sweep 蓝图的卡片纪律);
// - 嵌入画幅是参数(9:16 / 1:1 / 4:5 / 16:9 / auto 从源尺寸推),画布横竖都支持:
//   横画布卡片靠一侧、文字在另一侧;竖画布卡片在上、文字在下;
// - 文字入场动画三档(variant.textFx):rise 上浮 / cascade 逐词飞入 / typewriter 打字机。
//
// 视频槽(slots.clip)只认 build/public/footage/ 下的本地文件(确定性条款);
// srcW/srcH/srcDur 由控制台装载素材时 ffprobe 自动填(derivedFrom),
// 比 srcDur 长的时长用 <Loop> 循环,不会渲到素材末尾崩掉。
import React from 'react';
import {
  AbsoluteFill,
  Loop,
  OffthreadVideo,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {useBaseline, Backdrop, Foreground, textStyle, alpha} from '../style/baseline';
import {fitFontSize} from '../style/fit';
import {TuneSkin} from '../style/tune';
import {ENTER, CALM, progress} from '../lib/anim';
import {TUNE_FONTS} from './KeyConcept';
import {splitWords, wordAt, STAGGER_F} from './WordCascade';

export type PresetAspectEmbedProps = {
  durationSeconds: number;
  canvas?: string;
  variant?: {
    ratio?: 'auto' | '9:16' | '1:1' | '4:5' | '16:9';
    side?: 'left' | 'right';
    textFx?: 'rise' | 'cascade' | 'typewriter';
    sound?: 'off' | 'keep';
  };
  slots: {
    clip: string;
    srcW?: number;
    srcH?: number;
    srcDur?: number;
    title: string;
    sub?: string;
  };
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

const RATIOS: Record<string, number> = {'9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5, '16:9': 16 / 9};

const Inner: React.FC<PresetAspectEmbedProps> = ({durationSeconds, variant, slots, tune}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const {P, T, skin} = useBaseline();
  const landscape = width > height;
  const side = variant?.side ?? 'left';
  const textFx = variant?.textFx ?? 'rise';
  const tuneScale = tune?.scale ?? 1;
  const tuneFont = TUNE_FONTS[tune?.font ?? 'skin'];

  // —— 嵌入画幅:参数优先,auto 从源尺寸推,什么都没有按 9:16(这个 preset 的本命场景)——
  const ratioKey = variant?.ratio ?? 'auto';
  const ratio =
    ratioKey !== 'auto'
      ? RATIOS[ratioKey]
      : slots.srcW && slots.srcH
        ? slots.srcW / slots.srcH
        : 9 / 16;

  // —— 卡片几何:装进约束盒(横画布=侧栏,竖画布=上半区),按嵌入画幅取最大内接 ——
  const pad = landscape ? 96 : 72;
  const box = landscape
    ? {w: Math.round(width * 0.46), h: Math.round(height * 0.84)}
    : {w: Math.round(width * 0.86), h: Math.round(height * 0.5)};
  let cardW = box.w;
  let cardH = Math.round(cardW / ratio);
  if (cardH > box.h) {
    cardH = box.h;
    cardW = Math.round(cardH * ratio);
  }
  const cardX = landscape
    ? side === 'left'
      ? pad
      : width - pad - cardW
    : Math.round((width - cardW) / 2);
  // 竖画布:卡片+文字整组垂直居中(先估文字块高度)。卡片钉在 9% 的话,
  // 16:9 这类矮卡片会让下半屏空掉 40%,空画面能过掉其余所有检查(check-density 的教训)
  const titleLineCount = (slots.title ?? '').split('\n').filter((l) => l.trim() !== '').length;
  const estTextH =
    (slots.sub ? 90 : 0) + titleLineCount * Math.round(72 * tuneScale * 1.22);
  const groupGap = Math.round(height * 0.05);
  const cardY = landscape
    ? Math.round((height - cardH) / 2)
    : Math.max(Math.round(height * 0.07), Math.round((height - cardH - groupGap - estTextH) / 2));

  // —— 文字区:横画布在卡片对侧垂直居中,竖画布在卡片下方 ——
  const textX = landscape ? (side === 'left' ? cardX + cardW + Math.round(pad * 0.9) : pad) : pad;
  const textW = landscape ? width - textX - (side === 'left' ? pad : cardW + Math.round(pad * 1.9)) : width - pad * 2;
  const textY = landscape ? 0 : cardY + cardH + groupGap;

  // —— 标题排版:按行拆(\n),逐行 fit,取最小字号统一整块 ——
  const titleLines = (slots.title ?? '').split('\n').filter((l) => l.trim() !== '');
  const titleBase = Math.round((landscape ? 84 : 72) * tuneScale);
  const titleSize = Math.min(
    ...titleLines.map((l) =>
      fitFontSize(l, {fontSize: titleBase, maxWidthPx: textW, shrinkFloorPx: 34}),
    ),
  );
  const lineH = Math.round(titleSize * 1.22);

  // —— 入场:卡片先落(CALM,0.5s),文字随后(0.3s 起)。首帧底已在(Backdrop)——
  const cardIn = progress(frame, 0, Math.round(0.5 * fps), CALM);
  const textStartF = Math.round(0.3 * fps);
  const subIn = progress(frame, textStartF, Math.round(0.3 * fps), ENTER);

  // —— 视频:srcDur 比镜头短就 Loop;声音默认关(b-roll 的声音在剪映里配)——
  const src = staticFile(slots.clip.includes("/") ? slots.clip : `footage/${slots.clip}`);
  const muted = (variant?.sound ?? 'off') !== 'keep';
  const clipFrames = slots.srcDur ? Math.max(1, Math.floor(slots.srcDur * fps) - 1) : null;
  const video = (
    <OffthreadVideo
      src={src}
      muted={muted}
      style={{width: '100%', height: '100%', objectFit: 'cover'}}
    />
  );

  // —— 文字入场三档 ——
  const renderTitleLine = (line: string, li: number) => {
    const y = li * lineH;
    if (textFx === 'cascade') {
      const ws = splitWords(line);
      let acc = 0;
      const start = textStartF + li * Math.round(0.35 * fps);
      return (
        <div key={li} style={{position: 'relative', height: lineH}}>
          {ws.map((w, wi) => {
            const a = wordAt(frame, start + wi * STAGGER_F, li, wi);
            const el =
              a.o <= 0 ? null : (
                <span
                  // eslint-disable-next-line react/no-array-index-key
                  key={wi}
                  style={{
                    position: 'relative',
                    display: 'inline-block',
                    marginRight: '0.3em',
                    opacity: a.o,
                    transform: `translate(${a.dx.toFixed(1)}px, ${a.dy.toFixed(1)}px)`,
                    filter: a.blur > 0.2 ? `blur(${a.blur.toFixed(1)}px)` : undefined,
                  }}
                >
                  {w}
                </span>
              );
            acc += 1;
            return el;
          })}
        </div>
      );
    }
    if (textFx === 'typewriter') {
      const chars = Array.from(line);
      const start = textStartF + li * Math.round(0.5 * fps);
      const perChar = 2; // 帧/字,匀速(加 ease 读作「有人在犹豫」,同 glass-pill 配方)
      const shown = Math.max(0, Math.min(chars.length, Math.floor((frame - start) / perChar)));
      const done = shown >= chars.length;
      const caretOn = done ? (frame % 24 < 15 ? 1 : 0.1) : 1;
      return (
        <div key={li} style={{height: lineH, whiteSpace: 'pre'}}>
          {chars.slice(0, shown).join('')}
          {frame >= start ? (
            <span
              style={{
                display: 'inline-block',
                width: Math.max(4, Math.round(titleSize * 0.08)),
                height: Math.round(titleSize * 0.92),
                background: P.accent,
                marginLeft: 4,
                verticalAlign: '-0.08em',
                opacity: caretOn,
              }}
            />
          ) : null}
        </div>
      );
    }
    // rise(默认):逐行上浮淡入
    const p = progress(frame, textStartF + li * Math.round(0.12 * fps), Math.round(0.4 * fps), CALM);
    return (
      <div
        key={li}
        style={{
          height: lineH,
          opacity: p,
          transform: `translateY(${Math.round(22 * (1 - p))}px)`,
        }}
      >
        {line}
      </div>
    );
  };

  return (
    <EditorScene style={{backgroundColor: P.bg, overflow: 'hidden'}}>
      <Backdrop />
      {/* —— 视频卡片 —— */}
      <div
        style={{
          position: 'absolute',
          left: cardX + (tune?.x ?? 0),
          top: cardY + (tune?.y ?? 0),
          width: cardW,
          height: cardH,
          borderRadius: 28,
          overflow: 'hidden',
          border: `1.5px solid ${alpha(P.ink, 0.14)}`,
          boxShadow: `0 40px 110px ${alpha('#000000', P.mode === 'light' ? 0.24 : 0.55)}`,
          opacity: cardIn,
          transform: `translateY(${Math.round(40 * (1 - cardIn))}px)`,
          backgroundColor: '#000',
        }}
      >
        {clipFrames && clipFrames < Math.round(durationSeconds * fps) ? (
          <Loop durationInFrames={clipFrames}>{video}</Loop>
        ) : (
          video
        )}
      </div>
      {/* —— 文字块 —— */}
      <div
        style={{
          position: 'absolute',
          left: textX,
          width: textW,
          ...(landscape
            ? {top: 0, height, display: 'flex', flexDirection: 'column', justifyContent: 'center'}
            : {top: textY}),
        }}
      >
        {slots.sub ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              marginBottom: Math.round(titleSize * 0.5),
              opacity: subIn,
              transform: `translateY(${Math.round(10 * (1 - subIn))}px)`,
            }}
          >
            <div style={{width: 46, height: 5, background: P.accent, borderRadius: 3}} />
            <EditableText as="div" part="sub" style={{...textStyle(T, 'caption'), color: P.inkMuted}}>{slots.sub}</EditableText>
          </div>
        ) : null}
        <EditableText as="div" part="title"
          style={{
            ...textStyle(T, 'hero'),
            ...(tuneFont ? {fontFamily: tuneFont} : {}),
            fontSize: titleSize,
            color: P.ink,
          }}
        >
          {titleLines.map(renderTitleLine)}
        </EditableText>
      </div>
      <Foreground />
    </EditorScene>
  );
};

export const PresetAspectEmbed: React.FC<PresetAspectEmbedProps> = (props) => (
  <TuneSkin tune={props.tune}>
    <Inner {...props} />
  </TuneSkin>
);
