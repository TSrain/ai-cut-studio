import React from 'react';

// 程序化语义图标:纯 SVG,零素材,88px 内一眼可读。
//
// 存在理由:插片里经常要用一个图标点明"这一侧是什么意思"(耗时间 / 变值钱 / 被过滤掉)。
// 去图库找图标会引入版权登记、风格不统一、下载失败三个麻烦,而这类图标本身只有几条线。
// 描边一律 round 端 + round 连接,strokeWidth 6–7(100 viewBox 基准),在 80–120px 显示尺寸下最清晰。
//
// 用法: <SemanticIcon name="clock" size={88} color={ink.muted} />

export type SemanticIconName =
  | 'clock' // 耗时间 / 拖延 / 平台想要你停留
  | 'growth' // 增值 / 成长 / 上升
  | 'decline' // 下滑 / 衰减
  | 'filter' // 过滤 / 筛选 / 漏斗
  | 'duplicate' // 重复 / 同质化
  | 'check' // 通过 / 保留
  | 'cross' // 排除 / 淘汰
  | 'search' // 检索 / 发现
  | 'doc' // 文章 / 内容
  | 'alert'; // 风险 / 注意

export const SemanticIcon: React.FC<{
  name: SemanticIconName;
  size: number;
  color: string;
  /** 线宽,100 viewBox 基准。默认 7;需要更细腻时给 5–6。 */
  strokeWidth?: number;
  style?: React.CSSProperties;
}> = ({name, size, color, strokeWidth = 7, style}) => {
  const s = {
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" style={style}>
      {name === 'clock' && (
        <>
          <circle cx="50" cy="50" r="33" {...s} />
          {/* 时针指上、分针指 2 点方向——静态钟面也要读起来"在走" */}
          <line x1="50" y1="50" x2="50" y2="29" {...s} />
          <line x1="50" y1="50" x2="67" y2="43" {...s} />
          <circle cx="50" cy="50" r="4" fill={color} stroke="none" />
        </>
      )}
      {name === 'growth' && (
        <>
          <polyline points="14,70 40,46 55,57 84,26" {...s} />
          <polyline points="66,26 84,26 84,44" {...s} />
        </>
      )}
      {name === 'decline' && (
        <>
          <polyline points="14,30 40,54 55,43 84,74" {...s} />
          <polyline points="66,74 84,74 84,56" {...s} />
        </>
      )}
      {name === 'filter' && (
        <>
          <polyline points="16,22 84,22 58,54 58,82 42,72 42,54 16,22" {...s} />
        </>
      )}
      {name === 'duplicate' && (
        <>
          {/* 后面那张只画左上 L 形——两张完整矩形叠在一起线会交叉,读起来糊 */}
          <path d="M38 16 H23 a7 7 0 0 0 -7 7 V62" {...s} />
          <rect x="38" y="38" width="46" height="46" rx="7" {...s} />
        </>
      )}
      {name === 'check' && <polyline points="20,52 41,72 80,28" {...s} />}
      {name === 'cross' && (
        <>
          <line x1="26" y1="26" x2="74" y2="74" {...s} />
          <line x1="74" y1="26" x2="26" y2="74" {...s} />
        </>
      )}
      {name === 'search' && (
        <>
          <circle cx="44" cy="44" r="26" {...s} />
          <line x1="63" y1="63" x2="84" y2="84" {...s} />
        </>
      )}
      {name === 'doc' && (
        <>
          <path d="M26 16 H60 L76 32 V84 H26 Z" {...s} />
          <polyline points="60,16 60,32 76,32" {...s} />
          <line x1="38" y1="50" x2="64" y2="50" {...s} />
          <line x1="38" y1="64" x2="56" y2="64" {...s} />
        </>
      )}
      {name === 'alert' && (
        <>
          <path d="M50 18 L84 78 H16 Z" {...s} />
          <line x1="50" y1="42" x2="50" y2="58" {...s} />
          <circle cx="50" cy="68" r="3.5" fill={color} stroke="none" />
        </>
      )}
    </svg>
  );
};
