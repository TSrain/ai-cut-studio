import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {surface, ink, seriesDark, createTypography, type} from '../lib/theme';
import {ENTER, progress} from '../lib/anim';
import {SemanticIcon, SemanticIconName} from '../components/SemanticIcon';
import {MetalCoin} from '../components/MetalCoin';
import {StickerChip} from '../components/StickerChip';
import {SkeletonCard} from '../components/SkeletonCard';
import {StalledProgress} from '../components/StalledProgress';
import {HesitantCursor} from '../components/HesitantCursor';
import {KeywordHighlight} from '../components/KeywordHighlight';
import {AnnotationMark, type AnnotationMarkStyle} from '../components/AnnotationMark';

// 组件画廊:把可复用组件摆在一屏上,用来渲帧目视验收。
// 这不是一个能直接用的镜头,只是组件库的"样品册"——改了组件就渲这个看一眼。
//
// 样品册用中性的 modern,让组件本身而不是字体性格成为被看的对象。

const typography = createTypography('modern');

const ICONS: SemanticIconName[] = [
  'clock', 'growth', 'decline', 'filter', 'duplicate',
  'check', 'cross', 'search', 'doc', 'alert',
];

const Section: React.FC<{title: string; top: number; children: React.ReactNode}> = ({
  title,
  top,
  children,
}) => (
  <div style={{position: 'absolute', left: 96, right: 96, top}}>
    <div
      style={{
        fontFamily: typography.families.body,
        fontSize: 26,
        fontWeight: 600,
        color: ink.muted,
        letterSpacing: 4,
        marginBottom: 18,
      }}
    >
      {title}
    </div>
    {children}
  </div>
);

// —— 第 2 页:AnnotationMark 四种笔迹 ——
// 目标框不量图,靠"纯 CJK 字符 = 1em 步进"直接算出来(prefix 字数 × 字号),
// 所以样品里的行只用 CJK,不掺西文。真实用法(截图上)坐标必须走网格法。
const ANNO_FONT = 44;
const ANNO_ROWS: Array<{
  style: AnnotationMarkStyle;
  prefix: string;
  target: string;
  suffix: string;
  label: string;
}> = [
  {style: 'underline', prefix: '重点是', target: '当场画', suffix: '出来的', label: 'underline — 红笔下划线'},
  {style: 'marker', prefix: '荧光笔把', target: '关键字', suffix: '描出来', label: 'marker — 荧光笔描字(multiply,字透出来)'},
  {style: 'circle', prefix: '圈住要看的', target: '那一个词', suffix: '', label: 'circle — 手绘圈'},
  {style: 'box', prefix: '方框适合框住', target: '整行结论', suffix: '', label: 'box — 方框'},
];

const AnnotationPage: React.FC = () => (
  <Section title="ANNOTATION MARK — 四种笔迹,当场画出来(页 2/2,ScreenPush preset 用它勾截图关键字)" top={200}>
    <div
      style={{
        position: 'relative',
        width: 888,
        height: 4 * 160 + 80,
        borderRadius: 20,
        background: '#f7f6f2',
        overflow: 'hidden',
      }}
    >
      {ANNO_ROWS.map((row, i) => {
        const rowY = 60 + i * 160;
        const box = {
          x: 64 + row.prefix.length * ANNO_FONT,
          y: rowY - 2,
          w: row.target.length * ANNO_FONT,
          h: ANNO_FONT + 8,
        };
        return (
          <React.Fragment key={row.style}>
            <div
              style={{
                position: 'absolute',
                left: 64,
                top: rowY,
                fontSize: ANNO_FONT,
                fontWeight: 600,
                color: '#1c1e22',
                lineHeight: 1,
                whiteSpace: 'nowrap',
              }}
            >
              {row.prefix}
              {row.target}
              {row.suffix}
            </div>
            <div
              style={{
                position: 'absolute',
                left: 64,
                top: rowY + 66,
                fontSize: 22,
                color: '#8a8f99',
              }}
            >
              {row.label}
            </div>
            <AnnotationMark box={box} markStyle={row.style} delay={165 + i * 15} seed={i + 1} />
          </React.Fragment>
        );
      })}
    </div>
  </Section>
);

export const ComponentGallery: React.FC = () => {
  const frame = useCurrentFrame();
  // 两页:0–149 原样品页,150–299 批注笔迹页。渲帧验收:--frame=100 和 --frame=250
  if (frame >= 150) {
    return (
      <AbsoluteFill style={{backgroundColor: surface.dark, fontFamily: typography.families.body}}>
        <AnnotationPage />
        <div
          style={{
            position: 'absolute',
            left: 96,
            top: 1810,
            fontSize: type.label,
            color: ink.muted,
          }}
        >
          templates/remotion-base — 组件样品册(渲帧验收用)
        </div>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill
      style={{backgroundColor: surface.dark, fontFamily: typography.families.body}}
    >
      <Section title="SEMANTIC ICON" top={140}>
        {/* 10 个图标一行:888 可用宽 = 10×68 + 9×20 = 860,不换行 */}
        <div style={{display: 'flex', gap: 20}}>
          {ICONS.map((n) => (
            <SemanticIcon key={n} name={n} size={68} color={ink.secondary} />
          ))}
        </div>
      </Section>

      <Section title="METAL COIN — gold / silver / copper(反光一次扫过)" top={340}>
        <div style={{display: 'flex', gap: 40, alignItems: 'center'}}>
          <MetalCoin typography={typography} size={124} tone="gold" face="¥" sweepStart={10} />
          <MetalCoin typography={typography} size={124} tone="silver" face="★" sweepStart={20} />
          <MetalCoin typography={typography} size={124} tone="copper" sweepStart={30} />
        </div>
      </Section>

      <Section title="SKELETON CARD — 普通 / 选中 / 变暗" top={580}>
        <div style={{display: 'flex', gap: 24}}>
          <SkeletonCard typography={typography} w={266} h={150} title="某个自媒体标题" />
          <SkeletonCard typography={typography} w={266} h={150} title="被选中的那条" highlight />
          <SkeletonCard typography={typography} w={266} h={150} title="被过滤掉的" dim={0.35} />
        </div>
      </Section>

      <Section title="STALLED PROGRESS — 卡在 6%,试探 +1% 又缩回" top={800}>
        <StalledProgress
          pct={6}
          probes={[{frame: 40, delta: 1}, {frame: 90, delta: 1}]}
          width={620}
          showLabel
        />
      </Section>

      <Section title="KEYWORD HIGHLIGHT — 色带后扫,整句保持可读" top={940}>
        <div style={{fontSize: 52, fontWeight: 700, color: ink.primary, lineHeight: 1.5}}>
          真正稀缺的是{' '}
          <KeywordHighlight delay={30} dur={26}>
            判断力
          </KeywordHighlight>
          ,不是信息量
        </div>
      </Section>

      <Section title="STICKER CHIP — 半透明贴纸,叠在任意底片上都可读" top={1130}>
        {/* 用一块浅色"假底片"证明可读性 */}
        <div
          style={{
            width: 888,
            height: 260,
            borderRadius: 20,
            background:
              'linear-gradient(115deg, #f3efe6 0%, #d8c9a8 45%, #8fa3b8 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <StickerChip enterFrame={12}>
            <MetalCoin typography={typography} size={92} tone="gold" face="¥" sweepStart={16} />
            <div style={{display: 'flex', flexDirection: 'column', gap: 2}}>
              <div style={{display: 'flex', alignItems: 'baseline', gap: 12}}>
                <span style={{fontSize: 38, fontWeight: 800, color: ink.secondary}}>不到</span>
                <span style={{fontSize: 66, fontWeight: 900, color: seriesDark[0]}}>5毛</span>
              </div>
              <div style={{fontSize: 28, fontWeight: 700, color: ink.muted, letterSpacing: 4}}>
                / 天
              </div>
            </div>
          </StickerChip>
        </div>
      </Section>

      <Section title="HESITANT CURSOR — 走到 55% 折返,永远到不了" top={1470}>
        <div
          style={{
            position: 'relative',
            width: 888,
            height: 210,
            borderRadius: 16,
            border: `2px dashed ${ink.grid}`,
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 700,
              top: 40,
              width: 150,
              height: 90,
              borderRadius: 12,
              border: `2px solid ${seriesDark[0]}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 24,
              color: seriesDark[0],
            }}
          >
            目标
          </div>
          <HesitantCursor
            home={{x: 90, y: 120}}
            attempts={[
              {x: 760, y: 80, start: 20},
              {x: 760, y: 80, start: 70, reach: 0.45},
            ]}
            enterFrame={6}
          />
        </div>
      </Section>

      {/* 页脚:提示这是样品册 */}
      <div
        style={{
          position: 'absolute',
          left: 96,
          top: 1810,
          fontSize: type.label,
          color: ink.muted,
          opacity: progress(frame, 0, 20, ENTER),
        }}
      >
        templates/remotion-base — 组件样品册(渲帧验收用)
      </div>
    </AbsoluteFill>
  );
};
