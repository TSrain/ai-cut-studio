import React from 'react';
import {useCurrentFrame} from 'remotion';
import {ENTER, progress} from '../../lib/anim';
import {alpha} from '../../lib/theme';

// 暗角:径向压暗四边,把注意力收回画面中心。
//
// 移植自 HyperFrames registry 的 `vignette` component(纯 CSS radial-gradient),
// 入场从 CSS 变量补间改成 `frame` 推导。
//
// 为什么值得单独成一个组件:口播插片经常要把**别人的素材**(截图、录屏、图库图)放进来,
// 那些图的边缘往往又亮又杂,文字压上去就读不清。暗角是最省事的一层"降噪",
// 而且它比整体降低素材亮度好——中心信息量不受影响。
//
// 踩过的坑:
// 1. **`color` 必须传 hex。** 这里用 `alpha()` 算透明度,它只吃 `#rrggbb`;
//    传 'black' / 'rgba(...)' 会 parseInt 出 NaN,整层静默不显示(不报错)。
//    要纯黑就传 '#000000',不要传 'black'。
// 2. **`size` 别小于 30%。** 透明中心太小时,暗角会压到安全区里的文字上;
//    1080×1920 竖版配 theme.safeVertical 时,45%–60% 是安全区间。
// 3. **和 FilmGrain 叠放时 Vignette 在下。** 颗粒应该打在已经压暗的画面上,
//    反过来会让边缘的颗粒也被压掉,看起来像"边缘糊了"而不是"胶片感"。
//
// 用法: <Vignette />                                   // 默认 0.7 黑色椭圆
//       <Vignette strength={0.5} size="55%" fadeIn={20} />

export type VignetteProps = {
  /** 边缘压暗强度 0–1,默认 0.7 */
  strength?: number;
  /** 暗角颜色,**必须是 hex**(坑 1)。默认纯黑 */
  color?: string;
  /** 透明中心的半径,默认 '45%'。别低于 30%(坑 2) */
  size?: string;
  /** 形状,默认椭圆(跟画幅走);圆形在方画布上更均匀 */
  shape?: 'ellipse' | 'circle';
  /** 入场淡入帧数。0 = 一开始就在,默认 0 */
  fadeIn?: number;
  /** 层级,默认 90(留 100 给 FilmGrain,见坑 3) */
  zIndex?: number;
  style?: React.CSSProperties;
};

export const Vignette: React.FC<VignetteProps> = ({
  strength = 0.7,
  color = '#000000',
  size = '45%',
  shape = 'ellipse',
  fadeIn = 0,
  zIndex = 90,
  style,
}) => {
  const frame = useCurrentFrame();
  const k = fadeIn > 0 ? progress(frame, 0, fadeIn, ENTER) : 1;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex,
        background: `radial-gradient(${shape} at center, rgba(0,0,0,0) ${size}, ${alpha(
          color,
          strength * k,
        )} 100%)`,
        ...style,
      }}
    />
  );
};
