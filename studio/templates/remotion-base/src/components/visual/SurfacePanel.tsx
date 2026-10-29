import React from 'react';
import {alpha} from '../../lib/theme';

// 面板材质。抽自 projects/2026-07-31-srt-automotion-ab 的 v2 `stage.tsx#panelStyle` + `SHEEN`。
//
// 当初解决的问题:v1 的节点是「一个描边矩形」,渲出来像线框图占位符。
// 面板质感的四件套缺一不可——抬升底色 + 发丝描边 + 投影 + 顶部微高光(受光面)。
// 这不是 design-principles §8 禁的氛围装饰:氛围装饰是"无信息理由的光",
// 而这里的明暗编码的是**层级关系**(谁浮在谁上面),和 MetalCoin 用 inset 阴影做厚度同类。
//
// 踩过的坑(全部来自源码实测):
//
// 1. **高光必须是独立的绝对定位层,而且必须是第一个子节点。**
//    写进 background 的第二个渐变会被 material / style 的 background 覆盖掉;
//    放在 children 之后则会盖在文字上,把字"蒙"掉一层灰。
// 2. **高光层的圆角必须跟外层一致——源码这里是错的。** v2 的 sheen 层写死
//    `borderRadius: 14`,而 `panelStyle(raised)` 的圆角是 18,于是抬升面板的四角
//    有一圈 4px 的高光溢出(深色底上不明显,浅色底上一眼看见)。这里改成同一个
//    `radius` 变量,并且 `style.borderRadius` 是数字时会被一起读走。
// 3. **高光渐变止于 42%,不是 100%。** 铺到底会读成"整面变亮"(氛围灯),
//    只有上半段才读成"顶光打在一个物体上"。
// 4. **本组件不吃 palette**(props 契约如此,见 SurfacePanelProps)。默认材质全部是
//    相对底色的半透明层,所以贴在任何底色上都成立;要钉死表面色(比如 `P.surface`)
//    就用 `style={{background: P.surface}}` 覆盖——`style` 在材质之后展开,一定赢。
// 5. `accent` 只染描边和高光,**不染填充**。强调色面积 ≤10% 是硬规则,
//    一整块面板铺强调色一次就把配额用光了。
// 6. `boxSizing: 'border-box'` 必须写死:描边有 1.5–2px,不写的话 width/height
//    传进来是多少、量出来就多几个像素,并排的面板会对不齐。

export type SurfacePanelProps = {
  children: React.ReactNode;
  width: number;
  height: number;
  raised?: boolean;
  material?: 'solid' | 'glass' | 'metal';
  accent?: string;
  style?: React.CSSProperties;
};

export type PanelMaterial = NonNullable<SurfacePanelProps['material']>;

/** 顶部受光面。见上文坑 1/3:独立层、第一个子节点、只覆盖上 42%。 */
export const PANEL_SHEEN =
  'linear-gradient(180deg, rgba(255,255,255,0.055) 0%, rgba(255,255,255,0) 42%)';

/**
 * 面板材质样式。抽出来是因为 NodeChip / StatusStrip 也要用同一套质感——
 * 三处各写一遍就是这套东西过去"每个镜头重新发挥一次"的原因。
 *
 * @param accent 可选强调色,**必须是 hex**(scenePalette()/oklch() 的输出都是)。
 *               传 'red' 或 'rgb(...)' 会让 alpha() 算出 NaN,描边直接消失。
 */
export const panelSurface = (
  material: PanelMaterial = 'solid',
  raised = false,
  accent?: string,
): React.CSSProperties => {
  const line = accent ? alpha(accent, 0.34) : 'rgba(255,255,255,0.14)';
  // 抬升阴影:两层(近距离硬影 + 远距离软影)。单层投影读起来像贴纸。
  const lift = raised
    ? '0 14px 40px rgba(0,0,0,0.5), 0 2px 6px rgba(0,0,0,0.35)'
    : '0 8px 22px rgba(0,0,0,0.42)';

  switch (material) {
    case 'glass':
      return {
        background: 'rgba(255,255,255,0.035)',
        border: `1.5px solid ${accent ? alpha(accent, 0.28) : 'rgba(255,255,255,0.18)'}`,
        // 透明面板必须有内描边,否则贴在暗底上"什么都看不见,只有一点点亮"
        boxShadow: `${lift}, inset 0 1px 0 rgba(255,255,255,0.16)`,
        backdropFilter: 'blur(14px)',
      };
    case 'metal':
      return {
        // 斜向而非纵向渐变:纵向渐变读作"塑料",斜向才有金属的方向性反射
        background:
          'linear-gradient(148deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.045) 38%, rgba(0,0,0,0.12) 100%)',
        border: `1.5px solid ${line}`,
        boxShadow: `${lift}, inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -2px 6px rgba(0,0,0,0.35)`,
      };
    case 'solid':
    default:
      return {
        background: raised ? 'rgba(255,255,255,0.075)' : 'rgba(255,255,255,0.045)',
        border: `1.5px solid ${line}`,
        boxShadow: lift,
      };
  }
};

/**
 * 一块有质感的面板。内容、尺寸、位置全部走 props / style。
 * 位置由调用方给(`style={{position:'absolute', left, top}}`),组件自己不做定位。
 */
export const SurfacePanel: React.FC<SurfacePanelProps> = ({
  children,
  width,
  height,
  raised = false,
  material = 'solid',
  accent,
  style,
}) => {
  // 坑 2:高光层要和外层同圆角,包括调用方通过 style 覆盖圆角的情况
  const radius =
    typeof style?.borderRadius === 'number' ? style.borderRadius : raised ? 18 : 14;

  return (
    <div
      style={{
        position: 'relative',
        width,
        height,
        boxSizing: 'border-box',
        borderRadius: radius,
        ...panelSurface(material, raised, accent),
        ...style,
      }}
    >
      {/* 坑 1:第一个子节点 + pointerEvents none,永远在内容之下 */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: radius,
          background: PANEL_SHEEN,
          pointerEvents: 'none',
        }}
      />
      {children}
    </div>
  );
};
