// StyleBible —— 皮肤样张册:每页 30 帧,用 <Freeze> 冻结**真实 preset 组件**的英雄帧。
// 样张 = 组件本身(零重复实现):preset 改了重渲即所见,皮肤/preset 升版必渲给用户过目。
// 页序与 PRESET_COMPOSITIONS 注册顺序一致。
// 抽帧(全分辨率,样张是确认物):
//   for i in 0 1 2 3 4; do npx remotion still StyleBible --frame=$((i*30+15)) review/skins/page-$i.png; done
// 换皮肤候选比稿:--props='{"skin":"ember|slate|paper|abyss"}'
import React from 'react';
import {AbsoluteFill, Freeze, useCurrentFrame} from 'remotion';
import {BaselineProvider, useBaseline, textStyle, alpha, SKINS, type SkinName} from '../style/baseline';
import {PRESET_COMPOSITIONS} from '../presets';

const FRAMES_PER_PAGE = 30;

/** 每个 preset 的英雄帧(hold 相位内、入场全部完成后的一帧) */
const HERO_FRAME: Record<string, number> = {
  PresetMediaStage: 75,
  PresetRecede: 75,
  PresetKeyConcept: 60,
  PresetQuoteCard: 70,
  PresetContrastPair: 95,
  PresetNumberBeat: 50,
  // 卡片群:取收束完成后的静止段(5s=150 帧,140 帧在末段静止里)
  PresetCardSwarm: 140,
  // 截图推近:取 78% 定格之后,说明句已上屏
  PresetScreenPush: 110,
  // 列点推进:7s=210 帧,最后一条在 62% 处(约 130 帧)点亮,取 205 帧的静止段
  PresetBulletRun: 205,
  // 流程推进:9s=270 帧,最后一步在 70% 处(189 帧)到达,取 250 帧的静止段
  PresetStepFlow: 250,
  // 趋势图表:8s=240 帧,图在 72% 处(173 帧)画完,取 225 帧的静止读数段
  PresetTrendChart: 225,
  // ==== 2026-08-20 shotcraft 移植批(默认时长下入场完毕后的静止段) ====
  PresetTitleReveal: 75,
  PresetBrandOpen: 80,
  PresetFlyingWords: 96, // 隧道满屏那一拍:finale 定格帧(词已散尽)在模板墙上认不出这是什么模板
  PresetCardShowcase: 150,
  PresetCubeNav: 175,
  PresetDocTypewriter: 120,
  PresetGlassPill: 60,
  PresetPhoneRipple: 140,
  PresetSegmentedThumb: 95,
  // ==== 2026-08-26 shotcraft 第二批(默认时长下末段总览/静止段) ====
  PresetSpaceSteps: 185,
  PresetTimelineTravel: 150,
  PresetTextMask: 60,
};

/** 页脚:皮肤与页面元数据(样张专用,不进生产画面) */
const FooterLabel: React.FC<{pageId: string}> = ({pageId}) => {
  const {P, T, skin} = useBaseline();
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 34,
        left: 0,
        right: 0,
        textAlign: 'center',
        ...textStyle(T, 'caption'),
        fontSize: 22,
        color: alpha(P.mode === 'light' ? '#000000' : '#ffffff', 0.4),
      }}
    >
      皮肤 {skin.id} · {skin.name} · {pageId}
    </div>
  );
};

export const StyleBible: React.FC<{
  skin?: SkinName;
  /**
   * 色相微调。给了就在选中皮肤的基础上覆盖对应轴——资产面板的「皮肤实时调参」靠这两个参数,
   * 拖滑杆 → 渲一张 StyleBible → 当场看到色相改了以后五个模板长什么样。
   * 不给就是纯粹的 SKINS 预设(历史行为不变,老的比稿命令照跑)。
   */
  accentHue?: number;
  neutralHue?: number;
}> = ({skin = 'abyss', accentHue, neutralHue}) => {
  const frame = useCurrentFrame();
  const index = Math.min(Math.floor(frame / FRAMES_PER_PAGE), PRESET_COMPOSITIONS.length - 1);
  const preset = PRESET_COMPOSITIONS[index];
  const base = SKINS[skin] ?? SKINS.abyss;
  const def = {
    ...base,
    ...(accentHue === undefined ? {} : {accentHue: Number(accentHue)}),
    ...(neutralHue === undefined ? {} : {neutralHue: Number(neutralHue)}),
  };
  const Component = preset.component;
  // 坑:每个 preset 的 defaultProps 里都带一份 `tune`(含 skin/accentHue/neutralHue),
  // 组件出口又包了 <TuneSkin>,于是**内层的 tune 会盖掉外层 BaselineProvider**。
  // 只改外层的话画面纹丝不动(底色变了、强调色没变,最难查的那种"改了一半")。
  // 所以这里把同一组值也灌进 props.tune,内外两层说同一件事。
  const props = {
    ...preset.defaultProps,
    tune: {
      ...(preset.defaultProps as {tune?: Record<string, unknown>}).tune,
      skin,
      ...(accentHue === undefined ? {} : {accentHue: Number(accentHue)}),
      ...(neutralHue === undefined ? {} : {neutralHue: Number(neutralHue)}),
    },
  };
  return (
    <BaselineProvider skin={def}>
      <AbsoluteFill style={{backgroundColor: '#000000'}}>
        <Freeze frame={HERO_FRAME[preset.id] ?? 60}>
          <Component {...props} />
        </Freeze>
        <FooterLabel pageId={preset.id} />
      </AbsoluteFill>
    </BaselineProvider>
  );
};
