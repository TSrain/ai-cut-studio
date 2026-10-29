import React from 'react';
import {Img, interpolate} from 'remotion';
import {alpha} from '../../lib/theme';
import {ENTER} from '../../lib/anim';
import {mulberry32} from './BackgroundSystem';
import {PANEL_SHEEN, panelSurface} from './SurfacePanel';

// Logo 墙:一组**真实品牌 logo**,可选强调其中一个。
//
// 解决什么问题:"这些公司都在用" / "覆盖这些平台" / "对比这几家",
// 这类信息用文字列表说要三行字,用 logo 一眼就读完了——logo 是观众**已经认识**的图形,
// 认知成本几乎为零。visual-first 合同明确允许真实品牌 logo(`assets.allowBrandLogos`),
// 版权是非阻塞元数据,不再卡画面。
//
// 何时用:客户墙、生态位、平台覆盖、竞品对比的开场。
// 何时不用:超过 12 个 logo 时——再多就只剩"一片图形噪点",该改成数字("覆盖 40+ 平台");
//   以及 logo 之间需要表达关系(谁连着谁)时——那是 ConnectionMap 的活。
//
// **素材约束:`src` 只能是 `staticFile('assets/logo-x.svg')` 或 import 的资源。**
// 渲染期绝不 fetch(远程 URL 在重渲/离线时会 404,而且每帧走一次网络)。
// 选中的网络 logo 先下载进项目 `assets/`,再引本地路径。
//
// **布局稳定性:`seed` 相同 → 布局逐像素相同。**
// scatter 的抖动全部来自 mulberry32(seed)(见 BackgroundSystem 里的说明),
// 没有 `Math.random()`。这意味着换一个 seed 是"换一版排布"的**创作动作**,
// 而不是每次重渲随机换一次——后者会让抽帧自查看到的和成片对不上。
//
// 踩过的坑:
//
// 1. **非强调的 logo 必须去色 + 压暗,只有强调项保留原色。** 一堆彩色 logo 平铺时,
//    最鲜艳的那个自动变成焦点——那通常不是你想强调的那个。
//    去色之后焦点才由 `emphasisIndex` 说了算。
// 2. **每个 logo 必须装在等大的格子里,而不是让图片自然排布。** 各家 logo 的宽高比
//    差 3 倍以上(方形图标 vs 横排字标),不给统一格子会排成锯齿状。
//    格子内用 `objectFit:'contain'` + `maxWidth/maxHeight` 百分比留白。
// 3. **`name` 是必填的,即使不显示。** 它是这条素材在 assets.md 里的身份;
//    也是 alt 文本;没有它,三个月后没人知道 `logo-3.png` 是谁。
// 4. **强调项用"放大 + 面板托底 + 描边",不要用发光。** 发光在压缩后糊成一团光斑,
//    面板托底(复用 SurfacePanel 的材质)在任何码率下都立得住。
// 5. **入场 stagger 的顺序必须是固定的索引顺序,不能是随机顺序。** 随机顺序读成"闪烁",
//    索引顺序读成"依次点亮"。随机只用来定位置,不用来定时间。
// 6. `accent` **必须是 hex**:描边、托底都走 `alpha()`,别的格式算出 NaN 会让它们消失。
//
// 1080×1920 安全区行为:
//   组件按 `width`/`height` 渲染,自己不定位。竖版里建议 width ≤ 888(安全区宽)。
//   scatter 的抖动幅度被钳在格子内(最多 ±18% 格宽/格高),**永远不会溢出组件边界**,
//   所以只要组件本身在安全区内,就不会有 logo 被平台 UI 压住。

export type LogoItem = {
  /** `staticFile(...)` 或 import 的本地资源。不接受远程 URL。 */
  src: string;
  /** 品牌名。必填,即使不显示(坑 3)。 */
  name: string;
};

export type LogoCloudProps = {
  items: LogoItem[];
  /** 0–1 归一化进度。会被钳到 0–1;按索引顺序 stagger 点亮(坑 5)。 */
  progress: number;
  /** 排布方式。'row' 单排、'grid' 规则网格、'scatter' 网格 + 种子抖动。 */
  layout: 'row' | 'grid' | 'scatter';
  /** 强调第几个(索引)。不给或越界则全部平等。 */
  emphasisIndex?: number;
  width: number;
  height: number;
  /** 整数种子:决定 scatter 的抖动。同 seed 同布局。默认 7。 */
  seed?: number;
  /** 强调色(hex):强调项的描边与托底。 */
  accent?: string;
  /** 每行几个。不给则按 'row' 一行排完、其余取 ceil(sqrt(n))。 */
  columns?: number;
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export const LogoCloud: React.FC<LogoCloudProps> = ({
  items,
  progress,
  layout,
  emphasisIndex,
  width,
  height,
  seed = 7,
  accent,
  columns,
}) => {
  const p = clamp01(progress);
  const n = items.length;
  if (n === 0) return null;

  const cols =
    columns ?? (layout === 'row' ? n : Math.max(1, Math.ceil(Math.sqrt(n))));
  const rows = Math.max(1, Math.ceil(n / cols));
  const cellW = width / cols;
  const cellH = height / rows;

  // 坑:取值顺序即布局。每个 logo 固定消费 2 个随机数,中途不要插新的
  const rnd = mulberry32(seed);
  const jitter = items.map(() => {
    // 每个 logo 无条件消费两个随机数(哪怕当前 layout 用不上),
    // 这样同一个 seed 在 grid / scatter 之间切换时随机序列不会整体错位
    const jx = (rnd() - 0.5) * 0.36;
    const jy = (rnd() - 0.5) * 0.36;
    return layout === 'scatter' ? {jx, jy} : {jx: 0, jy: 0};
  });

  return (
    <div style={{position: 'relative', width, height}}>
      {items.map((item, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const isHero = emphasisIndex === i;

        // 坑 5:stagger 走索引顺序
        const d = Math.min(0.45, i * 0.055);
        const t = interpolate(p, [d, d + 0.4], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: ENTER,
        });

        const left = (col + 0.5 + jitter[i].jx) * cellW;
        const top = (row + 0.5 + jitter[i].jy) * cellH;
        const box = Math.min(cellW, cellH) * (isHero ? 0.92 : 0.74);

        return (
          <div
            key={`${item.name}-${i}`}
            style={{
              position: 'absolute',
              left,
              top,
              width: box,
              height: box,
              marginLeft: -box / 2,
              marginTop: -box / 2,
              boxSizing: 'border-box',
              borderRadius: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              // 坑 4:强调项靠面板托底 + 描边,不靠发光
              ...(isHero
                ? panelSurface('glass', true, accent)
                : {background: 'rgba(255,255,255,0.02)'}),
              opacity: t,
              transform: `scale(${interpolate(t, [0, 1], [0.9, 1])})`,
            }}
          >
            {isHero ? (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: 16,
                  background: PANEL_SHEEN,
                  pointerEvents: 'none',
                }}
              />
            ) : null}
            <Img
              src={item.src}
              alt={item.name}
              style={{
                // 坑 2:统一格子 + contain,不让原始宽高比决定排布
                maxWidth: '72%',
                maxHeight: '58%',
                objectFit: 'contain',
                display: 'block',
                // 坑 1:非强调项去色压暗,焦点由 emphasisIndex 决定
                filter: isHero
                  ? 'none'
                  : 'grayscale(1) brightness(1.5) contrast(0.85) opacity(0.62)',
              }}
            />
            {isHero && accent ? (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: 16,
                  border: `2px solid ${alpha(accent, 0.55 * t)}`,
                  pointerEvents: 'none',
                }}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
};
