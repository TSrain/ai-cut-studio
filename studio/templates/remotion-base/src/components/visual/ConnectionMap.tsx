import React from 'react';
import {interpolate} from 'remotion';
import type {TypographyContext} from '../../lib/theme';
import {alpha} from '../../lib/theme';
import {ENTER} from '../../lib/anim';
import {NodeChip} from './NodeChip';

// 连接图:节点 + 连线 + 沿线流动的数据包。
// 用来表达"东西从 A 流到 B"——架构图、产线、数据管道、调用链、地理连线。
//
// **何时用**:画面要说清楚"谁连谁、往哪个方向流、现在流到哪了"。
// **何时不用**:
// - 只有 2 个节点 1 条线 → 直接画个箭头,不必上组件;
// - 关系本身就是层级(树/组织架构)→ 那是嵌套排版问题,不是连接图;
// - 想让组件"自动排布好看"→ 见下面第一条硬规则,它做不到,也不该做。
//
// ============ 第一条硬规则:布局坐标由调用方传入 ============
//
// 组件**不做力导向 / 自动布局**。力导向是迭代收敛算法,同样的输入在不同机器、
// 不同迭代次数下会收敛到不同位置——那就违反了"任意一帧必须能独立算出来"
// (design-principles §9)。抽帧自查看到的和成片不一样,这个坑不值得踩。
// 所以 `nodes[].x / y` 是**像素坐标**,由调用方按镜头构图钉死。
// 好处不止确定性:构图平衡本来就是人来定的事(见记忆 feedback-layout-balance)。
//
// ============ 踩过的坑 ============
//
// 1. **数据包位置必须解析计算,不用 `path.getPointAtLength()`。**
//    那个 API 要等布局完成,渲染进程里抽帧会拿到 (0,0),包全堆在左上角。
//    这里所有连线都是**二次贝塞尔**,点位有闭式解(见 `bezierAt`),不问 DOM。
// 2. **`packetProgress` 会取小数部分循环。** 这是"循环"但不是"基于时间的循环":
//    值完全由调用方从 `useCurrentFrame()` 推导,任意一帧独立可算。
//    **不允许**改成 CSS animation / `@keyframes` ——那种循环的相位取决于元素
//    何时挂载,抽帧结果不可复现。
// 3. **每条边的数据包要有相位差。** 所有包同步出发会读成"节拍器",不是"流量"。
//    相位差从边的下标算(`i * 0.37` 黄金比附近的无理数步长),不是随机数。
// 4. **节点用 NodeChip,不要在这里另画一个方框。** 空框读不出"这是个东西"
//    (NodeChip 的四件解剖学构件:图标 / 名称 / 型号 / 状态点)。
//    这也是"手搓一个已有组件的等价物"这条最常见浪费的反面教材。
// 5. **连线画在 SVG 层、节点画在 HTML 层,两层用同一套坐标。**
//    SVG 里塞 foreignObject 装 NodeChip 会让字体和 backdrop-filter 失效。
//    分层的代价是连线会从节点底下穿过去——所以线要先画,并且端点要收进节点边缘
//    (`endShrink`),否则线头会从节点面板下面露出来。
// 6. **节点定位用 `translate(-50%,-50%)`**:NodeChip 宽度是内容自适应的,
//    用 left/top 直接钉左上角会让"坐标"变成"左上角在哪",而不是"节点中心在哪",
//    连线算出来就永远偏。
// 7. `accent` / 节点 `color` 必须是 hex(`alpha()` 内部 `parseInt(hex,16)`)。

export type MapNode = {
  id: string;
  label: string;
  sublabel?: string;
  icon?: React.ReactNode;
  /** 节点**中心**的像素坐标,在组件自己的 width×height 坐标系里(坑 6) */
  x: number;
  y: number;
  /** 必须是 hex。不给则用 accent */
  color?: string;
  /** 0–1,状态点活跃度。不给则跟随该节点的入场进度 */
  active?: number;
  /** 固定宽度。一列节点要对齐时给同一个值 */
  width?: number;
  /**
   * 节点高度。**只用来算连线端点收缩**,不改变 NodeChip 的实际渲染高度
   * (NodeChip 是内容自适应的,组件拿不到它的实测高度)。
   * 副标题换行或图标偏大导致节点变高时,把实际高度传进来,否则连线端点会插进面板里。
   */
  height?: number;
};

export type MapEdge = {
  from: string;
  to: string;
  /**
   * 弯曲量(垂直于连线方向的偏移像素)。0 = 直线。
   * 正负决定往哪一侧弯——同一对节点的往返两条边给相反符号才不会重叠。
   */
  curve?: number;
  /** 必须是 hex。不给则用 accent */
  color?: string;
  /** 这条边上跑几个包。默认 1;0 = 只有线没有包 */
  packets?: number;
};

export type ConnectionMapProps = {
  typography: TypographyContext;
  nodes: MapNode[];
  edges: MapEdge[];
  /** 0–1,节点与连线的入场进度。会被钳到 0–1 */
  progress: number;
  /**
   * 数据包沿线的位置。**不钳制、允许 >1**——组件取其小数部分,
   * 所以调用方可以直接喂 `frame / 40` 让包一圈圈跑(坑 2)。
   */
  packetProgress: number;
  /** 强调色,必须是 hex。连线与包的默认色 */
  accent: string;
  width: number;
  height: number;
  style?: React.CSSProperties;
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const fract = (x: number) => x - Math.floor(x);

/** 二次贝塞尔上的点(坑 1:闭式解,不问 DOM)。 */
const bezierAt = (
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
  t: number,
): [number, number] => {
  const u = 1 - t;
  return [
    u * u * x0 + 2 * u * t * cx + t * t * x1,
    u * u * y0 + 2 * u * t * cy + t * t * y1,
  ];
};

const windowed = (p: number, i: number, n: number, span = 0.5) => {
  const step = n > 1 ? (1 - span) / (n - 1) : 0;
  return interpolate(p, [i * step, i * step + span], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ENTER,
  });
};

/**
 * 端点要从节点中心往里收多少,免得线头从节点面板下面露出来(坑 5)。
 *
 * **这里原来是写死的 96px,渲帧审查时发现是错的**:NodeChip 的宽度是内容自适应的,
 * 一个 label 稍长的节点就有 372px 宽(半宽 186),96px 的收缩让端点停在面板**内部**;
 * 而 `panelSurface('solid')` 的填充是 `rgba(255,255,255,0.045)` 半透明,
 * 于是线头和跑到端点附近的数据包**从节点里透出来**,读成"数据包开进盒子里了"。
 * 类型检查、单测、lint 全都发现不了——只有把图渲出来盯着看才会发现。
 *
 * 现在按射线与轴对齐矩形的交点算真实半径:沿方向 (ux,uy) 走到边界的距离是
 * `min(halfW/|ux|, halfH/|uy|)`,再加一点缝隙。
 * 节点高度 NodeChip 不外露,用 `MapNode.height` 覆盖;不给就按默认单行高估。
 */
const NODE_W_FALLBACK = 300;
const NODE_H_FALLBACK = 132;
const END_GAP = 14;

const halfExtentToward = (nd: MapNode, ux: number, uy: number) => {
  const hw = (nd.width ?? NODE_W_FALLBACK) / 2;
  const hh = (nd.height ?? NODE_H_FALLBACK) / 2;
  const ax = Math.abs(ux);
  const ay = Math.abs(uy);
  const tx = ax > 1e-6 ? hw / ax : Number.POSITIVE_INFINITY;
  const ty = ay > 1e-6 ? hh / ay : Number.POSITIVE_INFINITY;
  return Math.min(tx, ty);
};

export const ConnectionMap: React.FC<ConnectionMapProps> = ({
  typography,
  nodes,
  edges,
  progress,
  packetProgress,
  accent,
  width,
  height,
  style,
}) => {
  const p = clamp01(progress);
  const byId = React.useMemo(() => {
    const m = new Map<string, MapNode>();
    for (const nd of nodes) m.set(nd.id, nd);
    return m;
  }, [nodes]);

  // 连线晚于节点出场:先有东西,才有东西之间的关系
  const nodeP = interpolate(p, [0, 0.55], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const edgeP = interpolate(p, [0.35, 1], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const geo = edges.map((e) => {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) {
      throw new Error(
        `ConnectionMap: 边 ${e.from} → ${e.to} 引用了不存在的节点。` +
          '节点 id 拼错时静默丢边会让画面少一条关系而不报错,所以这里直接抛。',
      );
    }
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    // 两端各按自己的尺寸收:节点宽度不同时,统一的收缩量必然有一端出错
    const shrinkA = Math.min(halfExtentToward(a, ux, uy) + END_GAP, len * 0.45);
    const shrinkB = Math.min(halfExtentToward(b, ux, uy) + END_GAP, len * 0.45);
    const x0 = a.x + ux * shrinkA;
    const y0 = a.y + uy * shrinkA;
    const x1 = b.x - ux * shrinkB;
    const y1 = b.y - uy * shrinkB;
    const c = e.curve ?? 0;
    // 控制点 = 中点 + 法向偏移
    const cx = (x0 + x1) / 2 + -uy * c;
    const cy = (y0 + y1) / 2 + ux * c;
    // 折线段的长度用弦长近似:只用来算 dasharray 的绘制进度,
    // 略短一点会让线"画完得早一点",视觉上无感
    const approx = Math.hypot(x1 - x0, y1 - y0) + Math.abs(c) * 0.6;
    return {e, x0, y0, cx, cy, x1, y1, approx};
  });

  return (
    <div style={{position: 'relative', width, height, ...style}}>
      {/* 坑 5:线在下 */}
      <svg width={width} height={height} style={{position: 'absolute', inset: 0}}>
        {geo.map((g, i) => {
          const color = g.e.color ?? accent;
          const dp = windowed(edgeP, i, geo.length);
          return (
            <path
              key={`e${i}`}
              d={`M ${g.x0} ${g.y0} Q ${g.cx} ${g.cy} ${g.x1} ${g.y1}`}
              fill="none"
              stroke={alpha(color, 0.42)}
              strokeWidth={3}
              strokeLinecap="round"
              strokeDasharray={g.approx}
              strokeDashoffset={g.approx * (1 - dp)}
            />
          );
        })}

        {/* 数据包:线画完到哪,包就只跑到哪 */}
        {geo.map((g, i) => {
          const count = g.e.packets ?? 1;
          if (count <= 0) return null;
          const color = g.e.color ?? accent;
          const drawn = windowed(edgeP, i, geo.length);
          if (drawn < 0.999) return null;
          return (
            <g key={`p${i}`}>
              {Array.from({length: count}, (_, k) => {
                // 坑 2/3:小数部分循环 + 从下标算的固定相位差,没有随机数、没有时钟
                const phase = i * 0.37 + k / count;
                const t = fract(packetProgress + phase);
                const [px, py] = bezierAt(
                  g.x0,
                  g.y0,
                  g.cx,
                  g.cy,
                  g.x1,
                  g.y1,
                  t,
                );
                // 两端淡入淡出:包"到站消失"比"撞进节点里"读起来干净
                const fade = interpolate(
                  t,
                  [0, 0.12, 0.88, 1],
                  [0, 1, 1, 0],
                  {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
                );
                return (
                  <g key={k} opacity={fade}>
                    {/* 尾迹:一个稍大的低透明晕,让包在暗底上有速度感 */}
                    <circle cx={px} cy={py} r={16} fill={alpha(color, 0.16)} />
                    <circle cx={px} cy={py} r={7} fill={color} />
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>

      {/* 坑 4/5/6:节点在上,HTML 层,中心对位 */}
      {nodes.map((nd, i) => {
        const np = windowed(nodeP, i, nodes.length);
        return (
          <div
            key={nd.id}
            style={{
              position: 'absolute',
              left: nd.x,
              top: nd.y,
              transform: `translate(-50%, -50%) scale(${0.94 + np * 0.06})`,
              opacity: np,
            }}
          >
            <NodeChip
              typography={typography}
              label={nd.label}
              sublabel={nd.sublabel}
              icon={nd.icon}
              color={nd.color ?? accent}
              active={nd.active ?? np}
              width={nd.width}
            />
          </div>
        );
      })}
    </div>
  );
};

/** 便捷:把 0–1 的归一化布局映射成像素坐标。构图仍由调用方定,这只是省一次乘法。 */
export const layoutAt = (
  nx: number,
  ny: number,
  width: number,
  height: number,
): {x: number; y: number} => ({x: nx * width, y: ny * height});
