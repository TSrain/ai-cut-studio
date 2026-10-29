import React from 'react';
import {AbsoluteFill, useCurrentFrame, interpolate} from 'remotion';
import {z} from 'zod';
import {createBaseline} from '../style/baseline';
import {KineticText, BackgroundSystem, DepthCam} from '../components/visual';
import {KenBurns} from '../components/KenBurns';
import {MOVE} from '../lib/anim';
import {shakeAt} from '../lib/shake';
import {Img, staticFile} from 'remotion';

// 资产面板用的**循环预览片**。渲成 2.5 秒小 MP4 挂进 assets/BROWSER.html,
// 让"运镜""文字出场"这类只存在于代码里的资产变成看得见的东西。
//
// 为什么单独开一个合成而不复用 ComponentGallery/VisualCatalog:
// 那两个是"一屏摆很多个"的样品册,看的是**静态版式**;这里要的是
// **一个手法占满整屏、动完整一遍**,看的是运动本身。两种诉求的构图相反。
//
// 尺寸 960×540:面板里一行摆 2–3 个,再大只是浪费渲染时间和磁盘。
// 渲染入口:node tools/build-asset-previews.mjs

export const assetLoopSchema = z.object({
  group: z.enum(['text', 'move', 'bg']),
  variant: z.string(),
});

const IMG_W = 1280;
const IMG_H = 720;

/** 平面运镜参数表。KenBurns 本身只是"焦点 A → 焦点 B + 缩放",
 *  下面四条就是这个组件能表达的四种镜头语言,不是四个新组件。
 *
 *  再往下 DEPTH_MOVES 那五式**不是 KenBurns 能做的**:它们需要"层",
 *  而 KenBurns 的模型里没有层这个概念(见 DepthCam 顶部注释)。 */
const MOVES: Record<
  string,
  {
    focusStart: {x: number; y: number};
    focusEnd: {x: number; y: number};
    scaleStart: number;
    scaleEnd: number;
  }
> = {
  // 慢推:焦点不动,只放大。最安全的一种——画面"活着"但不抢戏
  push: {
    focusStart: {x: 640, y: 360},
    focusEnd: {x: 640, y: 360},
    scaleStart: 1.02,
    scaleEnd: 1.18,
  },
  // 慢拉:从局部退到全景。用在"先看细节再交代全局"
  pull: {
    focusStart: {x: 900, y: 300},
    focusEnd: {x: 640, y: 360},
    scaleStart: 1.42,
    scaleEnd: 1.04,
  },
  // 横移:焦点左右走,缩放几乎不变。用在"顺着一条线读过去"
  pan: {
    focusStart: {x: 300, y: 360},
    focusEnd: {x: 980, y: 360},
    scaleStart: 1.24,
    scaleEnd: 1.26,
  },
  // 对角推:同时移动和放大,最有"摄影机在走"的感觉,也最容易过头
  diagonal: {
    focusStart: {x: 320, y: 480},
    focusEnd: {x: 940, y: 240},
    scaleStart: 1.08,
    scaleEnd: 1.5,
  },
};

// 分层运镜五式。前两式只用到单层(不需要抠图),后三式要真实前景层。
// 判据很简单:**"该动的地方动得不一样"才叫分层运镜**,否则退回 KenBurns。
const DEPTH_MOVES = new Set(['crash', 'dutch', 'parallax', 'dolly', 'orbit']);

const PageLayers: React.FC<{bg: React.ReactNode; subject?: boolean}> = ({bg, subject}) => (
  <>
    {bg}
    {subject ? (
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
        <Img src={staticFile('screens/sample-subject.png')} style={{width: 620}} />
      </AbsoluteFill>
    ) : null}
  </>
);

export const AssetLoop: React.FC<z.infer<typeof assetLoopSchema>> = ({
  group,
  variant,
}) => {
  const frame = useCurrentFrame();
  const B = createBaseline('abyss');

  if (group === 'move' && DEPTH_MOVES.has(variant)) {
    const flat = (
      <Img
        src={staticFile('sample-wide.png')}
        style={{width: 960, height: 540, objectFit: 'cover'}}
      />
    );
    // 单层式子(crash/dutch)不需要抠图,用整幅平面图就够 —— 它们要的是
    // 相机动作本身,不是深度差。这一点在面板文案里也写清楚了。
    // 背景层**必须和前景内容不同**。第一版背景和前景都用 sample-wide.png,
    // 于是背景里那个物体和抠出来的前景重影 —— dolly 那一式看起来像"主体在放大",
    // 其实是背景里的副本在放大,而真正钉死的主体被它盖住了。
    // 分层运镜的样张里,一眼要能分出哪层是哪层,否则演示的是混乱不是纵深。
    const wideBg = (
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', overflow: 'hidden'}}>
        <Img
          src={staticFile('screens/sample-page-tall.jpg')}
          style={{width: 1180, opacity: 0.55, filter: 'saturate(0.7)'}}
        />
      </AbsoluteFill>
    );

    if (variant === 'crash') {
      // 急推撞停:6–11 帧走完推进,落位那一帧起震屏。
      // **动作要短**——超过 15 帧就不是"撞"是"推"了。
      const shake = shakeAt(frame, {at: 34, dur: 14, amplitude: 11, seed: 3});
      return (
        <AbsoluteFill style={{backgroundColor: B.P.bg}}>
          <DepthCam
            width={960}
            height={540}
            offset={shake}
            keys={[
              {frame: 0, zoom: 1},
              {frame: 26, zoom: 1},
              {frame: 34, zoom: 1.55},
              {frame: 75, zoom: 1.55},
            ]}
            ease={MOVE}
            layers={[{parallax: 0, zoomGain: 1, node: flat}]}
          />
        </AbsoluteFill>
      );
    }

    if (variant === 'dutch') {
      // 斜角滚正:画框带着倾角进来,再转正。情绪是"纠偏""落定"。
      // 起手角度别超过 10°,再多就成了失误感而不是风格。
      return (
        <AbsoluteFill style={{backgroundColor: B.P.bg}}>
          <DepthCam
            width={960}
            height={540}
            keys={[
              {frame: 0, roll: -8, zoom: 1.12},
              {frame: 60, roll: 0, zoom: 1.02},
              {frame: 75, roll: 0, zoom: 1.02},
            ]}
            layers={[{parallax: 0, zoomGain: 1, node: flat}]}
          />
        </AbsoluteFill>
      );
    }

    if (variant === 'parallax') {
      // 多层视差:同一次横移,三层走三个速度 —— 纵深就是这么长出来的。
      //
      // **中景层不能是不透明的整屏底**。第一版拿 BackgroundSystem 当中景,
      // 它铺满整屏把远景整个盖住,三层当场退化成两层,视差看不出来。
      // 中景必须是"占一部分画面的东西",让远景从它旁边露出来。
      //
      // **层间速度差也贪心不得**:差 >0.5 会读成"两张图各自在滑",不是一个有厚度的空间。
      return (
        <AbsoluteFill style={{backgroundColor: B.P.bg}}>
          <DepthCam
            width={960}
            height={540}
            keys={[
              {frame: 0, x: -200},
              {frame: 70, x: 200},
            ]}
            ease={MOVE}
            layers={[
              {parallax: 0.16, zoomGain: 1, node: wideBg},
              {
                parallax: 0.5,
                zoomGain: 1,
                node: (
                  <AbsoluteFill style={{alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 40}}>
                    <Img
                      src={staticFile('screens/sample-docs.png')}
                      style={{width: 520, borderRadius: 10, boxShadow: '0 18px 50px rgba(0,0,0,0.55)'}}
                    />
                  </AbsoluteFill>
                ),
              },
              {parallax: 1, zoomGain: 1, node: <PageLayers bg={null} subject />},
            ]}
          />
        </AbsoluteFill>
      );
    }

    if (variant === 'dolly') {
      // dolly-zoom:主体尺寸**钉死**,背景压过来。一支片最多用一次。
      // 全部说服力来自 zoomGain 的差:主体 0、背景 1.9。
      return (
        <AbsoluteFill style={{backgroundColor: B.P.bg}}>
          <DepthCam
            width={960}
            height={540}
            keys={[
              {frame: 0, zoom: 1},
              {frame: 72, zoom: 1.55},
            ]}
            layers={[
              {parallax: 0.1, zoomGain: 1.9, node: wideBg},
              {parallax: 0.1, zoomGain: 0, node: <PageLayers bg={null} subject />},
            ]}
          />
        </AbsoluteFill>
      );
    }

    // orbit:冻结环绕。层带 z 偏移,在透视容器里扫 yaw —— 观众绕着主体走半步。
    return (
      <AbsoluteFill style={{backgroundColor: B.P.bg}}>
        <DepthCam
          width={960}
          height={540}
          keys={[
            {frame: 0, yaw: -16},
            {frame: 72, yaw: 16},
          ]}
          ease={MOVE}
          layers={[
            {parallax: 0.15, zoomGain: 1, z: 260, node: wideBg},
            {parallax: 0.4, zoomGain: 1, z: 0, node: <PageLayers bg={null} subject />},
          ]}
        />
      </AbsoluteFill>
    );
  }

  if (group === 'move') {
    const m = MOVES[variant] ?? MOVES.push;
    return (
      <AbsoluteFill style={{backgroundColor: B.P.bg}}>
        <KenBurns
          src="sample-wide.png"
          imgW={IMG_W}
          imgH={IMG_H}
          windowW={960}
          windowH={540}
          focusStart={m.focusStart}
          focusEnd={m.focusEnd}
          scaleStart={m.scaleStart}
          scaleEnd={m.scaleEnd}
          moveEnd={68}
        />
      </AbsoluteFill>
    );
  }

  if (group === 'bg') {
    // 底纹本身没有"结束",给它一段 drift 就够看出质感;叠一行字是为了
    // 看清底纹在有内容时是压得住还是抢戏——空底纹单看全都"挺好看"。
    const common = {palette: B.P, frame, intensity: 0.85, seed: 7, driftFrames: 75};
    return (
      <AbsoluteFill style={{backgroundColor: B.P.bg}}>
        {variant === 'ghost-type' ? (
          <BackgroundSystem
            {...common}
            variant="ghost-type"
            typography={B.T}
            text="密度"
          />
        ) : (
          <BackgroundSystem
            {...common}
            variant={variant as 'grid' | 'grain' | 'aurora'}
          />
        )}
        <AbsoluteFill
          style={{alignItems: 'center', justifyContent: 'center'}}
        >
          <KineticText
            typography={B.T}
            text="底纹压得住内容吗"
            mode="mask"
            progress={interpolate(frame, [6, 40], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
              easing: MOVE,
            })}
            role="h2"
            palette={B.P}
            align="center"
          />
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }

  // group === 'text'
  const p = interpolate(frame, [4, 56], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{backgroundColor: B.P.bg}}>
      <BackgroundSystem
        palette={B.P}
        frame={frame}
        intensity={0.5}
        seed={3}
        variant="grid"
        driftFrames={75}
      />
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          padding: 72,
        }}
      >
        <KineticText
          typography={B.T}
          text={variant === 'morph' ? '成本' : '这句话本身就是画面'}
          morphTo={variant === 'morph' ? '投资' : undefined}
          mode={variant as 'mask' | 'slam' | 'split' | 'morph'}
          progress={p}
          role={variant === 'split' || variant === 'morph' ? 'h1' : 'h2'}
          palette={B.P}
          align="center"
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
