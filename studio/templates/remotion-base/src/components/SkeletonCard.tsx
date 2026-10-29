import React from 'react';
import {ink, seriesDark} from '../lib/theme';
import type {TypographyContext} from '../lib/theme';

// 骨架卡:表达"一堆内容"的视觉母题(信息流、搜索结果、同质化内容、待筛选条目)。
//
// 关键在**信息层级要压下去**:这些卡是"肌理",不是要读的内容。
// 标题用 ink.muted + 小字号 + 低透明度,正文用灰条不用真文字。
// 一旦卡片里的字变得可读,观众就会去读它们,焦点就散了——而这类镜头的焦点
// 永远是"数量"或"其中某一张",不是任何一张的内容。
//
// highlight=true 的那一张用强调色描边 + 微光,表达"幸存的/被选中的那个"。
// dim<1 表达"被淘汰/变暗"。

export const SkeletonCard: React.FC<{
  /** 字体套装,必填。卡片标题是压下去的肌理文字,走 body 角色。 */
  typography: TypographyContext;
  w: number;
  h: number;
  /** 卡片标题。留空则只有骨架条(更纯粹的"一堆东西")。 */
  title?: string;
  /** 选中态:强调色描边 + 微光。 */
  highlight?: boolean;
  /** 0–1,整体明暗。用来演"被过滤掉"。 */
  dim?: number;
  /** 强调色,默认系列 1 蓝。 */
  accent?: string;
  /** 卡面底色。默认比画面底色微亮一档。 */
  background?: string;
  /** 骨架条行数。 */
  lines?: number;
  style?: React.CSSProperties;
}> = ({
  typography,
  w,
  h,
  title,
  highlight = false,
  dim = 1,
  accent = seriesDark[0],
  background = '#201f1e',
  lines = 2,
  style,
}) => {
  const widths = ['92%', '72%', '84%', '61%'];
  return (
    <div
      style={{
        width: w,
        height: h,
        background,
        borderRadius: 14,
        border: `2px solid ${highlight ? accent : '#2a2926'}`,
        boxShadow: highlight ? `0 0 22px ${accent}55` : 'none',
        boxSizing: 'border-box',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        padding: 14,
        ...style,
      }}
    >
      {/* 顶部强调色条:让卡片一眼像"一条内容",不是一个空盒子 */}
      <div
        style={{
          height: 6,
          width: '52%',
          borderRadius: 4,
          background: accent,
          opacity: dim * 0.9,
        }}
      />
      {title ? (
        <div
          style={{
            marginTop: 12,
            color: ink.muted,
            opacity: dim * 0.7,
            fontFamily: typography.families.body,
            fontSize: 20,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
          }}
        >
          {title}
        </div>
      ) : null}
      <div style={{marginTop: 14, display: 'flex', flexDirection: 'column', gap: 9}}>
        {Array.from({length: lines}).map((_, i) => (
          <div
            key={i}
            style={{
              height: 9,
              width: widths[i % widths.length],
              borderRadius: 5,
              background: ink.grid,
              opacity: dim,
            }}
          />
        ))}
      </div>
    </div>
  );
};
