import {EditableText, EditorScene} from '../editor/preset-editing';
// presets/SpaceSteps.tsx —— 空间步进 preset(docs/presets/space-steps/preset.json)
//
// 复刻来源:src/shotcraft/Basic3DScene.tsx(video-shotcraft 逐帧验证版,合成 ScBasic3DScene)
// 配方卡:docs/catalog/recipes-external/camera/basic-3d-scene.md
//
// 本体(一行):**camera = stepTransform.inverse()**。每站只写卡片自己的 pose
// (x/y/z/rx/ry/rz/s),相机严格取逆:`scale(1/s) rotateZ(-rz) rotateY(-ry)
// rotateX(-rx) translate3d(-x,-y,-z)`,**顺序反着正变换**。乱序在单轴旋转时看不
// 出来,多轴复合站(第 4 站带 rx+ry)会歪。
//
// 与 demo(480×270 横版设计坐标)的换算与**刻意偏差**,1080×1920 竖版重新标定:
// 1. **横版散点 → 竖版下行纵队**。demo 四站散在横向平面(x 最大 520、y 最大 300);
//    竖版画框高是宽的 1.78 倍,横向散点在总览时会被宽度卡死、上下大片空。改成
//    左右交替的下行纵队:x=0/+340/-340/+340、y 每站 +700、z 每站 -260。总览时
//    是一列自上而下的瀑布,天然吃满竖画幅,读序也从"到处找下一张"变成"顺着往下读"。
// 2. **OVERVIEW 从"空间中一张巨卡"改成"纵队末端的结论板",且板内一切按屏幕像素
//    授权**。demo 的总览卡 s=3.1、内容预除 2.2,压在别的卡上(见 ref-190:标题
//    被 STEP01 挡掉半行)。竖版里英雄帧必须字大且不许被挡,所以:板固定挂在
//    纵队下方 540px 处、z=0(最靠前的一层),世界缩放 k = OVER_S / mag(z=0),
//    于是**不论 3 站还是 4 站,板在总览里恒为 800×N 屏幕像素、标题恒为 88px**。
//    槽位 fit 因此可以直接用屏幕像素口径写(preset.json 的 overview.fontSize=88)。
// 3. **rz90 站的卡内文字在末段反向旋转,不是淡掉**。参考 CubeNav 的顶/底面处理
//    (拉出时淡掉方向敏感文字),但这里几何不同:rz 是**面内**旋转,反向旋转是
//    精确可解的——相机 rz 从 -90 归 0 的同时,文字 rz 从 0 走到 -90,屏幕上净旋转
//    **恒为 0**(-90(1-u) + 90 + (-90u) ≡ 0),文字全程稳定不动,只有卡片绕着它转。
//    CubeNav 的顶面办不到(法线朝上,两个姿态差 180° 面内旋转,数学上无解)所以只能
//    淡掉;这里能解就别丢信息。**进站方向的"转正瞬间"照旧保留**(相机 0→-90 时
//    文字是从侧躺被转正的),被稳住的只有出站。
// 4. **灰阶骨架条 → 真实中文文案**。demo 卡内是两根灰条占位;这里是「标题 | 一句话」,
//    标题 h1 估宽 shrink-to-fit,小注 body 按 0.46 比、最多 2 行(layoutEmphasisText)。
//    保留一根 accent 细规作为图形锚点,骨架条全删——占位条在真文案面前只是噪音。
// 5. **每站背后加一枚 400px 幽灵序号(01/02/…),左右交替,总览时淡掉**。对齐单站时
//    画面只有一张卡 + 底,墨量与层次都薄、构图还偏压一侧(实测质心 0.37);幽灵序号
//    补层次又补身份,且是方向中性的图元(rz90 站转过去也不别扭)。总览时三张卡自己
//    撑满画幅,序号必须让位(否则一屏三个 400px 数字)。
//    首版还在右边缘做过一条竖排进度轨,没通过反事实删除测试(卡上有 01/02/03、身后
//    有幽灵序号,进度已有两处;第三处在 320px 缩略图里只读作边缘一道杂线)——已删。
// 6. 站点色相从皮肤 accentHue 派生邻近色相(0/+28/−28/+56),照 CubeNav 的做法——
//    "我在第几站"的第一识别信号是颜色,全同色 = 飞了但不知道飞到哪。
//
// 坑(别拆):
// - **逆变换的旋转顺序 Z→Y→X 反着正变换的 X→Y→Z**,两处 transform 字符串成对存在,
//   加站只改 POSE 表,别动字符串。
// - `scale(1/s)` 是 **2D** scale:它只缩 x/y 不缩 z,所以透视放大率 mag=P/(P−z_rel)
//   与 s 无关。总览取景的算式(见 OVERVIEW 常量注释)依赖这一点,换成 scale3d 会全崩。
// - **perspective : max|z| ≈ 2:1**(1600 : 780)。z 再深要同步加大 perspective,否则
//   最近的一站会被拉成鱼眼。
// - **离焦底值 0.28 / blur 峰值 5px,底别再压低**:离焦卡要"在场",压到纯黑就丢了
//   空间感,总览也就没有"原来它们一直都在"的收束。
// - 总览之后**无返程**,这一式作段落收尾用;要循环回第 1 站得在末尾补一段 fly back。
// - 卡内文字块用 `top:50% + translateY(-50%)` 居中(不是顶对齐):rz 反向旋转绕块
//   中心,顶对齐会把文字甩出卡外。块宽 512 ≤ 卡高 580、块高 ≈300 ≤ 卡宽 640,
//   所以 90° 转过去仍在 overflow:hidden 里面。
//
// 时序(timing is frozen,绝对秒;3 站 @7s;伸缩优先落在末段定格,不够再压 hold):
//   0.00  第 1 站正视,首帧即在;世界自 z+80 CALM 落位 0.7s(轻推入,不是入场)
//   1.05  飞第 2 站 0.85s(MOVE≈inOutCubic):右移 + 下行 + 后退 + ry−38°(世界左转)
//   1.90  停留 0.95s 读卡
//   2.75  飞第 3 站 0.85s:左移 + 下行 + 后退 + rz90°(画框侧躺,相机把它转正)
//   3.70  停留 0.95s
//   4.65  飞 OVERVIEW 1.10s:相机退到 z+180 并 1/1.80 拉远,全员点亮,幽灵序号淡出,结论板与 caption 入画
//   5.75  总览定格(英雄帧),剩余全部时长给它;末段真静止 ≥0.85s
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {useBaseline, Backdrop, Foreground, textStyle, alpha} from '../style/baseline';
import {oklch} from '../lib/color';
import {fitFontSize, layoutEmphasisText} from '../style/fit';
import {TuneSkin} from '../style/tune';
import {CALM, MOVE, progress} from '../lib/anim';
import {TUNE_FONTS} from './KeyConcept';

export type PresetSpaceStepsProps = {
  durationSeconds: number;
  variant?: {spin?: 'on' | 'off'};
  slots: {steps: string[]; overview?: string; caption?: string};
  /** 打磨旋钮(Studio 试玩用):调到满意把值发给主 agent,固化进皮肤/preset 升版本 */
  tune?: {
    font?: 'skin' | 'smiley' | 'archivo' | 'serif' | 'wenkai' | 'noto-serif';
    scale?: number;
    x?: number;
    y?: number;
    skin?: 'abyss' | 'ember' | 'slate' | 'paper';
    accentHue?: number;
    neutralHue?: number;
  };
};

// —— 世界几何(1080×1920 直接标定,不走 DesignStage)
const CARD_W = 640;
const CARD_H = 580;
const CARD_INNER = 512; // 卡内文字块宽 = preset.json 的 steps.fit.maxWidthPx
const XOFF = 340; // 左右交替的横向摆幅
const YSTEP = 700; // 每站下行
const ZSTEP = 260; // 每站后退
const PERSP = 1600; // persp : max|z|(780)≈ 2:1
const ANCHOR_X = 540;
const ANCHOR_Y = 900; // 世界锚点略高于几何中心:底部让给 caption(竖版视觉居中)
const OVER_Z = 180; // 总览时相机退到所有站之前,拿到"整体后撤"的体感

// 结论板:**尺寸与字号写的是总览时的屏幕像素**,世界尺寸由 k = OVER_S/mag 反推
const BAND_W = 800;
const BAND_LINE = 110; // 88px 标题 × 1.25 行高
const BAND_PAD_Y = 41;
const BAND_TITLE = 88;

// —— 总览取景(手算,已逐帧核对)。设相机 y=u、缩放 s,近层 mag=P/(P−(0−OVER_Z))=0.899:
//   上缘(第 1 站):0.899·u + 360·0.899 ≤ 690·s
//   下缘(结论板):0.899·(Yband−u) + (BAND_H/2)·s ≤ 690·s   ← 板半高恒为屏幕像素
//   两式取等联立即得下表。690 = 锚点到 caption 上缘的可用半高,450 = 可用半宽。
const BAND_GAP = 540; // 结论板挂在末站下方多远:小到能在末站底部露一角(预告),大到不挤压末站
const OVERVIEW = {
  3: {s: 1.8, y: 1020},
  4: {s: 2.32, y: 1380},
} as const;

// —— 时间表(绝对秒)
const HOLD0 = 1.05;
const FLY = 0.85; // 有旋转的段不许快于 0.7s——观众需要时间理解"世界在转"
const HOLD = 0.95;
const FINAL = 1.1;
const END_MIN = 0.85; // 末段真静止保底
const HOLD_FLOOR = 0.5; // hold 最多压到一半
const FLY_FLOOR = 0.72; // 再不够才动飞行(4 站 <6.5s 才会走到这里)

// 离焦衰减:底值 0.28(离焦卡要"在场",压到纯黑就丢空间感)。峰值模糊 5px ——
// demo 在 480 设计坐标下是 3.5px,等效到 1080 是 7.9px;竖版卡面积大得多,糊到 7.9
// 就成色块了,5px 是"认得出是张卡、读不出字"的位置。
const DEFOCUS_BLUR = 5;
const HUE_OFFSETS = [0, 28, -28, 56];
const lerp = (f: number, a: number, b: number) => a + f * (b - a);

type Pose = {x: number; y: number; z: number; rx: number; ry: number; rz: number; s: number};

/** 第 i 站的姿态。**每站至少换一个新的变换维度**,只挪 x/y 就是平移幻灯片。 */
const stepPose = (i: number, spin: boolean): Pose => ({
  x: i === 0 ? 0 : i % 2 === 1 ? XOFF : -XOFF,
  y: i * YSTEP,
  z: -i * ZSTEP,
  rx: i === 3 ? -24 : 0, // 第 4 站:俯仰(新维度)
  ry: i === 1 ? -38 : i === 2 && !spin ? 38 : i === 3 ? -20 : 0,
  rz: i === 2 && spin ? 90 : 0, // 第 3 站:画框侧躺(记忆点,一支片只用一次)
  s: 1,
});

const Inner: React.FC<PresetSpaceStepsProps> = ({durationSeconds, variant, slots, tune}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const landscape = width > height;
  const ANCHOR_X = landscape ? width / 2 : 540;
  const ANCHOR_Y = landscape ? height * .44 : 900;
  const CARD_W = landscape ? 620 : 640;
  const CARD_H = landscape ? 420 : 580;
  const {P, T, slab} = useBaseline();
  const tuneFont = TUNE_FONTS[tune?.font ?? 'skin'];
  const fontOverride = tuneFont ? {fontFamily: tuneFont} : {};
  const ts = tune?.scale ?? 1;
  const tx = tune?.x ?? 0;
  const ty = tune?.y ?? 0;

  const spin = (variant?.spin ?? 'on') === 'on';
  const steps = slots.steps.slice(0, 4);
  const N = Math.max(1, steps.length);
  const poses = Array.from({length: N}, (_, i) => {const p = stepPose(i, spin); return landscape ? {...p, x: i * 880, y: i % 2 ? 65 : -65} : p;});
  const ov = landscape ? {s: Math.max(1.15, ((N - 1) * 880 + 680) / (width - 200)), y: 0} : OVERVIEW[N === 4 ? 4 : 3];
  const bandY = landscape ? height * .29 * ov.s : (N - 1) * YSTEP + BAND_GAP;
  const bandX = landscape ? (N - 1) * 440 : 0;
  const magBand = PERSP / (PERSP - (0 - OVER_Z)); // 结论板在 z=0,总览时的透视放大率
  const bandK = ov.s / magBand; // 板的世界缩放:让它在屏幕上恒为 BAND_W 宽
  const overCam: Pose = {x: bandX, y: ov.y, z: OVER_Z, rx: 0, ry: 0, rz: 0, s: ov.s};

  // —— 时长伸缩:优先把余量留给末段定格;装不下先压 hold,再压飞行
  const flyFixed = (N - 1) * FLY + FINAL;
  const holdNominal = HOLD0 + (N - 1) * HOLD;
  const holdScale = Math.min(1, Math.max(HOLD_FLOOR, (durationSeconds - END_MIN - flyFixed) / holdNominal));
  const flyScale = Math.min(
    1,
    Math.max(FLY_FLOOR, (durationSeconds - END_MIN - holdNominal * holdScale) / flyFixed),
  );
  const seg = (k: number) => {
    const isFinal = k === N - 1;
    const start = HOLD0 * holdScale + k * (FLY * flyScale + HOLD * holdScale);
    return {start, dur: (isFinal ? FINAL : FLY) * flyScale};
  };

  // —— 相机:链式插值到各站姿态。af = 累计飞行进度,决定谁在焦点上
  const cam: Pose = {...poses[0]};
  let af = 0;
  let overT = 0;
  for (let k = 0; k < N; k++) {
    const {start, dur} = seg(k);
    const f = progress(frame, Math.round(start * fps), Math.max(1, Math.round(dur * fps)), MOVE);
    const next = k === N - 1 ? overCam : poses[k + 1];
    af += f;
    cam.x = lerp(f, cam.x, next.x);
    cam.y = lerp(f, cam.y, next.y);
    cam.z = lerp(f, cam.z, next.z);
    cam.rx = lerp(f, cam.rx, next.rx);
    cam.ry = lerp(f, cam.ry, next.ry);
    cam.rz = lerp(f, cam.rz, next.rz);
    cam.s = lerp(f, cam.s, next.s);
    if (k === N - 1) overT = f;
  }
  // 首帧即在的轻推入:世界从 z+80 落位,不是入场动画
  cam.z += 80 * (1 - progress(frame, 0, Math.round(0.7 * fps), CALM));

  // —— 文案排版(确定性估宽,口径与 preset.json 的 fit 一致)
  const heads = steps.map((s) => s.split(' | ')[0]);
  const notes = steps.map((s) => {
    const parts = s.split(' | ');
    return parts.slice(1).join(' | ');
  });
  const titleSize = Math.min(
    ...heads.map((h) => fitFontSize(h, {fontSize: 72, maxWidthPx: CARD_INNER, shrinkFloorPx: 36})),
  );
  const noteBase = Math.round(titleSize * 0.46);
  // emphasisRatio:1 —— 不给 emphasis 时 layoutEmphasisText 把整段当主焦点、按 base×1.6 折行,
  // 若仍按 baseSize 渲染,折行宽度与实际字号就对不上(会莫名多折一行)。这里两者取齐。
  const noteSpec = {fontSize: noteBase, maxWidthPx: CARD_INNER, maxLines: 2, shrinkFloorPx: 18, emphasisRatio: 1};
  const noteSize = notes.some((n) => n)
    ? Math.min(
        ...notes.filter((n) => n).map((n) => layoutEmphasisText(n, noteSpec).baseSize),
      )
    : noteBase;
  const noteLines = notes.map((n) =>
    n ? layoutEmphasisText(n, {...noteSpec, fontSize: noteSize}).lines.map((r) => r.map((x) => x.text).join('')) : [],
  );

  const bandText = slots.overview ?? heads[0];
  const bandLayout = layoutEmphasisText(bandText, {
    fontSize: BAND_TITLE,
    maxWidthPx: 680,
    maxLines: 2,
    shrinkFloorPx: 48,
    emphasisRatio: 1,
  });
  const bandLines = bandLayout.lines.map((r) => r.map((x) => x.text).join(''));
  const bandH = BAND_PAD_Y * 2 + bandLines.length * BAND_LINE;

  const bandFocus = Math.max(1 - Math.min(1, Math.abs(af - N)), overT);
  const capIn = progress(frame, Math.round((seg(N - 1).start + 0.3) * fps), Math.round(0.5 * fps), CALM);
  const capLines = slots.caption ? slots.caption.split('\n') : [];
  const capSize = capLines.length
    ? Math.min(...capLines.map((l) => fitFontSize(l, {fontSize: 44, maxWidthPx: 888, shrinkFloorPx: 32})))
    : 0;

  const renderCard = (i: number) => {
    const p = poses[i];
    const hue = P.accentHue + HUE_OFFSETS[i];
    const focus = Math.max(1 - Math.min(1, Math.abs(af - i)), overT);
    // rz90 站:出站时文字反向旋转,屏幕上净旋转恒为 0(见文件头偏差 3)
    const counter = -p.rz * overT;
    const ink = oklch(0.95, 0.03, hue);
    return (
      <div
        key={i}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          transformStyle: 'preserve-3d',
          transform: `translate3d(${p.x}px,${p.y}px,${p.z}px) rotateX(${p.rx}deg) rotateY(${p.ry}deg) rotateZ(${p.rz}deg)`,
          opacity: 0.28 + focus * 0.72,
          filter: `blur(${((1 - focus) * DEFOCUS_BLUR).toFixed(2)}px)`,
        }}
      >
        {/* 幽灵序号:补层次与身份,总览时让位给三张卡本身 */}
        <div
          style={{
            position: 'absolute',
            left: i % 2 === 1 ? 20 : -500,
            top: landscape ? -310 : -530,
            width: 480,
            textAlign: i % 2 === 1 ? 'left' : 'right',
            transform: 'translateZ(-30px)',
            ...textStyle(T, 'h1'),
            ...fontOverride,
            fontSize: 400,
            lineHeight: 1,
            color: alpha(oklch(0.72, 0.11, hue), 0.14 * (1 - overT)),
          }}
        >
          {String(i + 1).padStart(2, '0')}
        </div>
        <div
          style={{
            position: 'absolute',
            left: -CARD_W / 2,
            top: -CARD_H / 2,
            width: CARD_W,
            height: CARD_H,
            borderRadius: 28,
            overflow: 'hidden',
            background: `linear-gradient(155deg, ${oklch(0.38, 0.085, hue)}, ${oklch(0.21, 0.055, hue - 8)})`,
            border: `1.5px solid ${alpha(oklch(0.78, 0.1, hue), 0.5)}`,
            boxSizing: 'border-box',
            boxShadow: `0 44px 120px ${alpha('#000000', 0.55)}, inset 0 1px 0 ${alpha(oklch(0.88, 0.07, hue), 0.22)}`,
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: (CARD_W - CARD_INNER) / 2,
              top: '50%',
              width: CARD_INNER,
              transform: `translateY(-50%) rotateZ(${counter}deg)`,
            }}
          >
            <div
              style={{
                ...textStyle(T, 'caption'),
                ...fontOverride,
                fontSize: 30,
                letterSpacing: '0.22em',
                color: oklch(0.8, 0.12, hue),
              }}
            >
              {String(i + 1).padStart(2, '0')}
            </div>
            <div
              style={{
                width: 68,
                height: 5,
                borderRadius: 3,
                margin: '22px 0 26px',
                background: oklch(0.72, 0.14, hue),
              }}
            />
            <EditableText as="div" part={`step-${i}-head`}
              style={{
                ...textStyle(T, 'h1'),
                ...fontOverride,
                fontSize: titleSize,
                color: ink,
                whiteSpace: 'pre',
              }}
            >
              {heads[i]}
            </EditableText>
            {noteLines[i].length ? (
              <EditableText as="div" part={`step-${i}-note`}
                style={{
                  ...textStyle(T, 'body'),
                  ...fontOverride,
                  fontSize: noteSize,
                  lineHeight: 1.55,
                  marginTop: 18,
                  color: alpha(ink, 0.6),
                }}
              >
                {noteLines[i].map((l, k) => (
                  <div key={`${k}-${l}`} style={{whiteSpace: 'pre'}}>
                    {l}
                  </div>
                ))}
              </EditableText>
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  return (
    <EditorScene style={{backgroundColor: P.bg, overflow: 'hidden'}}>
      <Backdrop />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `translate(${tx}px, ${ty}px) scale(${ts})`,
          transformOrigin: `${ANCHOR_X}px ${ANCHOR_Y}px`,
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            perspective: PERSP,
            perspectiveOrigin: `${ANCHOR_X}px ${ANCHOR_Y}px`,
          }}
        >
          {/* world:相机 = 场景逆变换 —— 先反平移,再反旋转(Z→Y→X),最后 1/scale */}
          <div
            style={{
              position: 'absolute',
              left: ANCHOR_X,
              top: ANCHOR_Y,
              width: 0,
              height: 0,
              transformStyle: 'preserve-3d',
              willChange: 'transform',
              transform: `scale(${1 / cam.s})
                rotateZ(${-cam.rz}deg) rotateY(${-cam.ry}deg) rotateX(${-cam.rx}deg)
                translate3d(${-cam.x}px,${-cam.y}px,${-cam.z}px)`,
            }}
          >
            {poses.map((_, i) => renderCard(i))}
            {/* 结论板:纵队末端,z=0 最前层;世界缩放 k 让它在总览里恒为 BAND_W 屏幕像素 */}
            <div
              style={{
                position: 'absolute',
                left: -BAND_W / 2,
                top: -bandH / 2,
                width: BAND_W,
                height: bandH,
                transform: `translate3d(${bandX}px,${bandY}px,0px) scale(${bandK})`,
                borderRadius: 22,
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: `linear-gradient(168deg, ${slab.from} 0%, ${slab.from} 44%, ${slab.to} 130%)`,
                boxShadow: `0 40px 120px ${alpha('#000000', 0.5)}, inset 0 1px 0 ${alpha(P.ink, 0.18)}`,
                opacity: 0.28 + bandFocus * 0.72,
                filter: `blur(${((1 - bandFocus) * DEFOCUS_BLUR).toFixed(2)}px)`,
              }}
            >
              <EditableText as="div" part="overview"
                style={{
                  ...textStyle(T, 'h1'),
                  ...fontOverride,
                  fontSize: bandLayout.baseSize,
                  lineHeight: `${BAND_LINE}px`,
                  color: slab.ink,
                  textAlign: 'center',
                }}
              >
                {bandLines.map((l, k) => (
                  <div key={`${k}-${l}`} style={{whiteSpace: 'pre'}}>
                    {l}
                  </div>
                ))}
              </EditableText>
            </div>
          </div>
        </div>
      </div>
      {slots.caption ? (
        <EditableText as="div" part="caption"
          style={{
            position: 'absolute',
            top: landscape ? height - 95 : 1640,
            left: 96,
            right: 96,
            textAlign: 'center',
            ...textStyle(T, 'body'),
            ...fontOverride,
            fontSize: capSize,
            lineHeight: 1.55,
            color: P.inkSecondary,
            opacity: capIn,
            transform: `translateY(${22 * (1 - capIn)}px)`,
          }}
        >
          {capLines.map((l, i) => (
            <React.Fragment key={`${i}-${l}`}>
              {i > 0 ? <br /> : null}
              {l}
            </React.Fragment>
          ))}
        </EditableText>
      ) : null}
      <Foreground />
    </EditorScene>
  );
};

// 不自带 Provider:无 Provider 时 useBaseline 落到默认皮肤;比稿时可用 Provider 覆盖
export const PresetSpaceSteps: React.FC<PresetSpaceStepsProps> = (props) => (
  <TuneSkin tune={props.tune}>
    <Inner {...props} />
  </TuneSkin>
);
