// style/tune.tsx —— Studio 打磨旋钮的皮肤级部分
//
// 「能编辑什么 = 模板暴露了什么旋钮」。文字/大小/位置的旋钮在各 preset 组件里;
// 这里是**全局观感**的旋钮:换整套皮肤、调强调色相、调底色相(背景颜色跟着变)。
// 旋钮只用于 Studio 试玩:调到满意把值发给主 agent,固化进 docs/presets/baseline.json
// 升 baselineVersion;生产合同不携带 tune。
import React, {useMemo} from 'react';
import {BaselineProvider, SKINS, DEFAULT_SKIN, type SkinName} from './baseline';

export type SkinTune = {
  /** 整套换皮肤(abyss 深海蓝 / ember 暖炭琥珀 / slate 冷蓝钢 / paper 纸白) */
  skin?: SkinName;
  /** 强调色相 0–360(蓝 250 / 青 195 / 绿 145 / 黄 85 / 橙 55 / 红 25 / 紫 300) */
  accentHue?: number;
  /** 底/背景的染色色相 0–360(深蓝黑底就是 232;想要墨绿底调 160 附近) */
  neutralHue?: number;
};

export const TuneSkin: React.FC<{tune?: SkinTune; children: React.ReactNode}> = ({tune, children}) => {
  const active = Boolean(tune && (tune.skin || tune.accentHue !== undefined || tune.neutralHue !== undefined));
  const def = useMemo(() => {
    const base = SKINS[tune?.skin ?? DEFAULT_SKIN];
    return {
      ...base,
      ...(tune?.accentHue === undefined ? {} : {accentHue: tune.accentHue}),
      ...(tune?.neutralHue === undefined ? {} : {neutralHue: tune.neutralHue}),
    };
  }, [tune?.skin, tune?.accentHue, tune?.neutralHue]);
  if (!active) return <>{children}</>;
  return <BaselineProvider skin={def}>{children}</BaselineProvider>;
};
