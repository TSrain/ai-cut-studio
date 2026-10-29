// document-typewriter-reveal 复刻:源自 video-shotcraft template/src/aifl/live/SceneWbr.tsx。
// 原实现在页面截图纹理上做纸片遮罩擦除;此版改为自绘文档(preset 化的目标形态:
// 用户填文字即可,不需要截图)。动效词汇逐项保留:
// ① 内容块两两一组被"写出"(纸色遮罩左→右擦开,琥珀光标骑在书写前沿)
// ② 左右侧栏纸片自上而下擦入,内缘琥珀线亮起后淡出
// ③ 历史条目从上方逐条落进左栏(带轻微回弹)
// ④ 屏幕空间 kicker 右上角戳入;相机由标题特写缓缓拉到全页
// 110f@30fps,1920×1080。
import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, Easing} from 'remotion';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const SANS = 'ui-sans-serif, system-ui, -apple-system, sans-serif';
const SERIF = 'ui-serif, Georgia, "Times New Roman", serif';
const PAPER = '#fdfcfa';
const AMBER = 'oklch(52% 0.115 65)';
const AMBER_WASH = 'oklch(95% 0.05 85)';
const INK = '#1f2937';
const MID = '#6b7280';

// ---- 文档内容(自绘;h2 第 2 个起视作成员名,擦出后补琥珀 @ 底纹) ----
type Doc = {tag: 'h1' | 'meta' | 'h2' | 'p' | 'li'; text: string};
const DOC: Doc[] = [
  {tag: 'h1', text: '2026-W34 · 产品周报'},
  {tag: 'meta', text: '8 月 20 日 · 自动汇总 · 12 位成员'},
  {tag: 'h2', text: '本周摘要'},
  {tag: 'p', text: '发布节奏恢复正常,两条主线全部按期合入;新版控制台的留存数据首次转正。'},
  {tag: 'p', text: '线上事故 0 起,评审积压从 14 项降到 3 项。'},
  {tag: 'h2', text: '@陈默'},
  {tag: 'li', text: '完成渲染队列重构,峰值内存下降 38%'},
  {tag: 'li', text: '修复字幕层在 4K 下的基线漂移'},
  {tag: 'h2', text: '@林晚'},
  {tag: 'li', text: '上线模板预览墙,滚动即播零等待'},
  {tag: 'li', text: '素材库新增 HDRI 样品球流水线'},
  {tag: 'h2', text: '@苏澈'},
  {tag: 'li', text: '打通剪映工程导出,字幕成原生文本轨'},
  {tag: 'p', text: '下周焦点:批量模式的接触印张确认流,以及音效库的调性分层。'},
];

// 版式常数(1920×1080 页面坐标)
const PAGE_W = 1920;
const DOC_X = 560;
const DOC_W = 800;
const RAIL_L = {x: 120, y: 150, w: 360, h: 810};
const RAIL_R = {x: 1440, y: 150, w: 360, h: 810};

const STYLE: Record<Doc['tag'], {size: number; weight: number; color: string; lh: number; gapBefore: number; family?: string; indent?: number}> = {
  h1: {size: 44, weight: 700, color: INK, lh: 56, gapBefore: 0, family: SERIF},
  meta: {size: 16, weight: 400, color: MID, lh: 24, gapBefore: 10},
  h2: {size: 24, weight: 650, color: INK, lh: 34, gapBefore: 26},
  p: {size: 18, weight: 400, color: '#374151', lh: 28, gapBefore: 10},
  li: {size: 18, weight: 400, color: '#374151', lh: 28, gapBefore: 8, indent: 28},
};

// 逐块布局:y 向下累计,估宽 = 字数 × 字号(中文近似方块字宽)
const blocks = (() => {
  let y = 170;
  return DOC.map((b) => {
    const s = STYLE[b.tag];
    y += s.gapBefore;
    const w = Math.min(DOC_W - (s.indent ?? 0), Math.round(b.text.length * s.size * (b.text.startsWith('@') || /^[\x00-\xff]+$/.test(b.text) ? 0.62 : 1.0)) + 8);
    const box = {...b, x: DOC_X + (s.indent ?? 0), y, w, h: s.lh};
    y += s.lh;
    return box;
  });
})();

const cueFor = (i: number) => 6 + Math.floor(i / 2) * 3.5;
const WIPE = 8;
const REVEAL_EASE = Easing.bezier(0.4, 0, 0.6, 1);

const PAST_WEEKS = [
  {week: '2026 第 33 周', date: '8月13日'},
  {week: '2026 第 32 周', date: '8月6日'},
  {week: '2026 第 31 周', date: '7月30日'},
  {week: '2026 第 30 周', date: '7月23日'},
  {week: '2026 第 29 周', date: '7月16日'},
  {week: '2026 第 28 周', date: '7月9日'},
];
const WEEK_Y0 = RAIL_L.y + 78;
const WEEK_H = 56;
const WEEK_CUE = (i: number) => 58 + i * 5;
const WEEK_DROP = Easing.bezier(0.2, 1.15, 0.3, 1);

const COMMENTS = [
  {who: '陈默', text: '留存那张图可以直接进月报'},
  {who: '林晚', text: '预览墙的首屏帧还能再压 200ms'},
  {who: '苏澈', text: '剪映通道下周补 Windows 验证'},
];

const memberH2 = new Set<number>();
{
  let seen = 0;
  blocks.forEach((b, i) => {
    if (b.tag === 'h2' && seen++ > 0) memberH2.add(i);
  });
}

export const DocumentTypewriterReveal: React.FC = () => {
  const frame = useCurrentFrame();

  // 相机:标题特写 → 全页(等效原 CAM_KEYS 的 1.25→1.0 + 焦点从标题移到页心)
  const camEase = Easing.bezier(0.33, 0, 0.15, 1);
  const zoom = interpolate(frame, [0, 22, 64, 78, 102], [1.25, 1.21, 0.997, 1.003, 0.995], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: camEase,
  });
  const cx = interpolate(frame, [0, 64], [920, 960], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: camEase});
  const cy = interpolate(frame, [0, 64], [300, 540], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: camEase});

  const kick = interpolate(frame, [8, 16], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  let caretIdx = -1;
  blocks.forEach((_, i) => {
    if (frame >= cueFor(i) && frame <= cueFor(i) + WIPE + 2) caretIdx = i;
  });

  return (
    <AbsoluteFill style={{background: PAPER, overflow: 'hidden'}}>
      <div
        style={{
          position: 'absolute', width: PAGE_W, height: 1080,
          transform: `translate(${960 - cx * zoom}px, ${540 - cy * zoom}px) scale(${zoom})`,
          transformOrigin: 'top left',
        }}
      >
        {/* 文档正文(自绘) */}
        {blocks.map((b, i) => {
          const s = STYLE[b.tag];
          const cue = cueFor(i);
          const coverT = interpolate(frame, [cue, cue + WIPE], [1, 0], {
            extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: REVEAL_EASE,
          });
          const bx = b.tag === 'li' ? b.x - 28 : b.x - 4;
          const bw = b.w + (b.tag === 'li' ? 34 : 10);
          const caretX = bx + bw * (1 - coverT);
          const caretH = Math.min(22, b.h - 2);
          const nameCue = cue + WIPE + 4;
          const nameGrow = memberH2.has(i)
            ? interpolate(frame, [nameCue, nameCue + 8], [0, 1], {
                extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.3, 0, 0.2, 1),
              })
            : 0;
          return (
            <div key={i}>
              {nameGrow > 0 ? (
                <div style={{
                  position: 'absolute', left: b.x - 6, top: b.y - 1, width: (b.w + 12) * nameGrow,
                  height: b.h + 2, background: AMBER_WASH, opacity: 0.7, borderRadius: 3,
                }} />
              ) : null}
              <div style={{
                position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h,
                fontFamily: s.family ?? SANS, fontSize: s.size, fontWeight: s.weight, color: s.color,
                lineHeight: `${b.h}px`, whiteSpace: 'nowrap',
              }}>
                {b.tag === 'li' ? <span style={{position: 'absolute', left: -22, color: MID}}>·</span> : null}
                {b.text}
              </div>
              {coverT > 0 ? (
                <div style={{position: 'absolute', left: bx, top: b.y - 3, width: bw, height: b.h + 6, overflow: 'hidden'}}>
                  <div style={{position: 'absolute', right: 0, top: 0, bottom: 0, width: `${coverT * 100}%`, background: PAPER}} />
                </div>
              ) : null}
              {i === caretIdx ? (
                <div style={{
                  position: 'absolute', left: caretX, top: b.y + (b.h - caretH) / 2, width: 2.5, height: caretH,
                  background: AMBER,
                  opacity: coverT > 0 ? 1 : interpolate(frame, [cue + WIPE, cue + WIPE + 2], [1, 0], {
                    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
                  }),
                }} />
              ) : null}
            </div>
          );
        })}

        {/* 左右侧栏:栏体 + 顶→底纸片擦入 + 内缘琥珀线 */}
        {[
          {rail: RAIL_L, cue: 46, inner: 'right' as const},
          {rail: RAIL_R, cue: 54, inner: 'left' as const},
        ].map(({rail, cue, inner}, ri) => {
          const t = interpolate(frame, [cue, cue + 10], [0, 1], {
            extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.3, 0, 0.2, 1),
          });
          const lineFade = interpolate(frame, [cue + 10, cue + 24], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
          return (
            <div key={`rail${ri}`}>
              {/* 栏内容 */}
              <div style={{
                position: 'absolute', left: rail.x, top: rail.y, width: rail.w, height: rail.h,
                background: '#faf8f4', borderRadius: 10, border: '1px solid rgba(31,41,55,0.08)',
                padding: '18px 16px', boxSizing: 'border-box', fontFamily: SANS,
              }}>
                <div style={{fontSize: 14, fontWeight: 650, color: INK, letterSpacing: '0.04em'}}>
                  {ri === 0 ? '往期周报' : '评论'}
                </div>
                {ri === 0 ? (
                  <div style={{marginTop: 12, fontSize: 13, color: MID, borderBottom: '1px solid rgba(31,41,55,0.07)', paddingBottom: 8}}>
                    <span style={{fontWeight: 600, color: INK}}>2026 第 34 周</span>
                    <span style={{float: 'right', fontSize: 11}}>本期</span>
                  </div>
                ) : (
                  COMMENTS.map((c, i) => (
                    <div key={i} style={{marginTop: 14, paddingBottom: 10, borderBottom: '1px solid rgba(31,41,55,0.06)'}}>
                      <div style={{fontSize: 12, fontWeight: 650, color: INK}}>{c.who}</div>
                      <div style={{fontSize: 12, color: MID, marginTop: 3, lineHeight: 1.5}}>{c.text}</div>
                    </div>
                  ))
                )}
              </div>
              {t < 1 ? (
                <div style={{
                  position: 'absolute', left: rail.x - 2, top: rail.y - 2 + (rail.h + 4) * t,
                  width: rail.w + 4, height: (rail.h + 4) * (1 - t), background: PAPER,
                }} />
              ) : null}
              {frame >= cue && lineFade > 0 ? (
                <div style={{
                  position: 'absolute',
                  left: inner === 'right' ? rail.x + rail.w - 1.5 : rail.x,
                  top: rail.y, width: 1.5, height: rail.h * t, background: AMBER, opacity: lineFade,
                }} />
              ) : null}
            </div>
          );
        })}

        {/* 历史条目自上而下落进左栏 */}
        {PAST_WEEKS.map((w, i) => {
          const cue = WEEK_CUE(i);
          if (frame < cue) return null;
          const t = interpolate(frame, [cue, cue + 8], [0, 1], {
            extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: WEEK_DROP,
          });
          const appear = interpolate(frame, [cue, cue + 3], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
          const air = Math.max(0, 1 - t);
          return (
            <div
              key={w.week}
              style={{
                position: 'absolute', left: RAIL_L.x + 6, top: WEEK_Y0 + i * WEEK_H,
                width: RAIL_L.w - 12, height: WEEK_H,
                transform: `translateY(${-44 * air}px)`, opacity: appear,
                boxShadow: air > 0.02 ? `0 ${10 * air}px ${20 * air}px rgba(30,25,18,${0.16 * air})` : 'none',
                background: '#faf8f4', borderBottom: '1px solid rgba(31,41,55,0.07)',
                padding: '8px 10px 0', boxSizing: 'border-box', fontFamily: SANS,
              }}
            >
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'baseline'}}>
                <span style={{fontSize: 13, fontWeight: 500, color: INK}}>{w.week}</span>
                <span style={{fontSize: 10, color: '#9ca3af'}}>{w.date}</span>
              </div>
              <div style={{marginTop: 2, fontSize: 11, color: MID, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                {w.week.replace('2026 第 ', '2026-W').replace(' 周', '')} · 产品周报
              </div>
            </div>
          );
        })}
      </div>

      {/* 屏幕空间 kicker */}
      <div style={{
        position: 'absolute', top: 24, right: 96, textAlign: 'right', fontFamily: MONO,
        fontSize: 24, letterSpacing: '0.14em', color: 'oklch(50% 0.006 82)',
        textTransform: 'uppercase', opacity: kick,
      }}>
        Weekly Brief · 2026-W34
      </div>
    </AbsoluteFill>
  );
};
