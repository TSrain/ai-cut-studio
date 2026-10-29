import {EditableText, EditorScene} from '../editor/preset-editing';
// presets/CubeNav.tsx —— 立方体导航 preset(docs/presets/cube-nav/preset.json)
//
// 复刻来源:src/shotcraft/CubeNavigation.tsx(video-shotcraft 逐帧验证版,2026-08-20)
// 配方卡:docs/catalog/recipes-external/transition/cube-navigation.md
//
// 与配方卡(190px 横版 demo)的换算与偏差,1080×1920 竖版:
// - 棱长 S=560(≤640),perspective 2240 —— persp/S≈4 是配方卡标定的
//   「看清棱角又不畸变」均衡点;立方体中心 (540, 800),居中偏上,底部让给 caption。
// - 特写 d=+690 / 等轴 d=-380,对齐 demo 的 235/-130(≈ +1.24S / -0.68S),
//   两值差决定「推近拉远」的呼吸幅度。
// - demo 固定 3 面、面↔等轴各排独立停点;这里 faces 3–6 个,改为 N-1 步
//   「面→面」过渡:中段用 sin(π·u) 把 d 拉到等轴距离、rx 加 -24° 俯角——
//   等轴测过渡视角还在,但停点数减半,3–6 面都装得进 4–8s。
// - 第 5/6 个面贴顶/底面,正视姿态是 {rx:∓90, ry:-360}:只有 ry≡0(mod 360)
//   时净变换 Rx(∓90)·Ry(-360)·Rx(±90)=I,面上文字才是正立的。**别改这两个停点的 ry**。
// - 末段 0.6s 拉出到等轴测全景 {rx:-26, ry:再退 38°, d:-380} 定格(英雄帧),
//   durationSeconds 的伸缩全部落在定格;时长不够时巡览整段等比压缩(END_MIN 保底)。
//
// 坑(继承自逐帧复刻验证,别拆):
// - 面上文字任何时刻不许镜像正对观众:每面 backfaceVisibility:'hidden' 剔除背面,
//   再加法线明暗 brightness(0.5+lit·0.62) 把背离面沉下去 —— 双保险。
// - 相机动的是 rig(translateZ → rotateX → rotateY,顺序固定),法线明暗公式
//   (z2 = ny·sin rx + (-nx·sin ry + nz·cos ry)·cos rx)依赖这个矩阵,别改成动每个面。
// - 六面色相是「我在哪一面」的第一识别:从皮肤 accentHue 派生邻近色相
//   (offsets 0/±28/±56/+84,oklch 算色,零 hex),素面退到中性 surface。
//   全部同色 = 转了但不知道到了哪。
// - filter 出现在 preserve-3d 子元素上:Chrome 实测(shotcraft 逐帧对照)绘制
//   顺序与深度排序都正常,凸立方体 + 背面剔除下也不存在面相交问题。
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {useBaseline, Backdrop, Foreground, textStyle, alpha} from '../style/baseline';
import {oklch} from '../lib/color';
import {fitFontSize} from '../style/fit';
import {TuneSkin} from '../style/tune';
import {ENTER, MOVE, progress} from '../lib/anim';
import {TUNE_FONTS} from './KeyConcept';

export type PresetCubeNavProps = {
  durationSeconds: number;
  variant?: Record<string, never>;
  slots: {faces: string[]; caption?: string};
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

// —— 立方体几何(1080 竖版直接标定,不走 DesignStage)
const S = 560; // 棱长(≤640)
const HF = S / 2;
const PERSP = 2240; // persp/S ≈ 4
const CX = 540;
const CY = 800; // 立方体中心:居中偏上
const D_CLOSE = 690; // 特写:面≈809px 宽,两侧各留 ~135px
const D_ISO = -380; // 等轴:整体≈0.85 倍,三面全入画
const ISO_DIP_RX = -24; // 面→面过渡中段的俯角(等轴测过渡视角)

// —— 时间表(绝对秒,timing is frozen;短时长整段等比压缩,长时长全落末段定格)
const HOLD0 = 0.55; // 正视第 1 面(首帧即在,含读面)
const STEP = 0.55; // 每步转面
const HOLD = 0.45; // 每面停留读面
const FINAL = 0.6; // 拉出到等轴测全景
const END_MIN = 0.8; // 末段定格保底

const RAD = Math.PI / 180;

// 六个贴面槽位:变换 / 法线(nm 供明暗公式)。0–3 侧环,4 顶,5 底。
const FACE_SLOTS = [
  {tr: `translateZ(${HF}px)`, nm: [0, 0, 1]},
  {tr: `rotateY(90deg) translateZ(${HF}px)`, nm: [1, 0, 0]},
  {tr: `rotateY(180deg) translateZ(${HF}px)`, nm: [0, 0, -1]},
  {tr: `rotateY(-90deg) translateZ(${HF}px)`, nm: [-1, 0, 0]},
  {tr: `rotateX(90deg) translateZ(${HF}px)`, nm: [0, -1, 0]},
  {tr: `rotateX(-90deg) translateZ(${HF}px)`, nm: [0, 1, 0]},
] as const;
const GLYPHS = ['◧', '◆', '◔', '▤', '⊙', '↥'];
// 邻近色相散开:面身份可辨,又不脱离皮肤的 accent 家族
const HUE_OFFSETS = [0, 28, -28, 56, -56, 84];

// 确定性伪随机(骨架线宽度用;同种子跨帧/跨渲染一致)
const rand = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

type Cam = {rx: number; ry: number; d: number};
// 第 i 个内容面的正视姿态:侧环 ry 每步 -90 单调退;顶/底面必须停在 ry=-360(见文件头)
const facePose = (i: number): Cam =>
  i === 4
    ? {rx: -90, ry: -360, d: D_CLOSE}
    : i === 5
      ? {rx: 90, ry: -360, d: D_CLOSE}
      : {rx: 0, ry: -90 * i, d: D_CLOSE};

const Inner: React.FC<PresetCubeNavProps> = ({durationSeconds, slots, tune}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const landscape = width > height;
  const cx = landscape ? width * 0.34 : CX;
  const cy = landscape ? height * 0.48 : CY;
  const {P, T} = useBaseline();
  const tuneFont = TUNE_FONTS[tune?.font ?? 'skin'];
  const ts = tune?.scale ?? 1;
  const tx = tune?.x ?? 0;
  const ty = tune?.y ?? 0;

  const faces = slots.faces.slice(0, 6);
  const N = Math.max(1, faces.length);

  // —— 相机时间表:N-1 步转面 + 末段拉出;时长不足 nominalEnd+END_MIN 时等比压缩
  const finalStart = HOLD0 + (N - 1) * (STEP + HOLD);
  const nominalEnd = finalStart + FINAL;
  const tourScale = Math.min(1, Math.max(0.3, (durationSeconds - END_MIN) / nominalEnd));

  const poses: Cam[] = Array.from({length: N}, (_, i) => ({...facePose(i), ...(landscape ? {d: 350} : {})}));
  // 等轴测全景(英雄帧):俯角 -26 + ry 在最后一面的基础上再退 38°,三面受光
  poses.push({rx: -26, ry: poses[N - 1].ry - 38, d: D_ISO});

  // 累加式关键帧插值(照配方卡的 acc):各段独立过缓动后按差值叠加,窗间即 hold
  const cam: Cam = {...poses[0]};
  let active = 0; // 当前正视到第几面(进度点用;过渡过半即切)
  let finalT = 0; // 末段拉出的进度(顶/底面标题据此淡出,见下)
  for (let k = 1; k < poses.length; k++) {
    const isFinal = k === poses.length - 1;
    const startSec = (isFinal ? finalStart : HOLD0 + (k - 1) * (STEP + HOLD)) * tourScale;
    const durSec = (isFinal ? FINAL : STEP) * tourScale;
    const u = progress(frame, Math.round(startSec * fps), Math.max(1, Math.round(durSec * fps)), MOVE);
    const prev = poses[k - 1];
    const next = poses[k];
    cam.rx += u * (next.rx - prev.rx);
    cam.ry += u * (next.ry - prev.ry);
    cam.d += u * (next.d - prev.d);
    if (!isFinal) {
      // 等轴测过渡视角:中段拉远到等轴距离;侧环转面时再加俯角
      // (去顶/底面的步 rx 本来在大幅动,不叠加)。sin(π·u) 两端归零,无跳变。
      const arc = Math.sin(Math.PI * u);
      cam.d += (D_ISO - D_CLOSE) * 0.85 * arc;
      if (prev.rx === next.rx) cam.rx += ISO_DIP_RX * arc;
      if (u > 0.5) active = k;
    } else {
      finalT = u;
    }
  }

  // 顶/底面的标题在末段拉出时淡掉。
  // 为什么:顶面贴在 rotateX(90°) 上,从等轴测(俯角 -26°)看过去它的字头朝着观众
  // ——文字是**倒着**的。这不是 bug 而是几何必然:同一块面文字要在「特写正视」和
  // 「俯视全景」两个姿态里都正立,数学上办不到(差 180° 面内旋转)。
  // 特写是观众真正读面标题的时刻,必须保它正立;全景里那面只是块斜纹理,
  // 于是把标题与角标淡掉,只留方向中性的骨架条。2026-08-21 定格帧实锤。
  const capTopFade = 1 - finalT;

  // 法线明暗:Rx(rx)·Ry(ry)·n 的 z 分量(公式与旋转矩阵绑定,见文件头)
  const cyv = Math.cos(cam.ry * RAD);
  const syv = Math.sin(cam.ry * RAD);
  const cxv = Math.cos(cam.rx * RAD);
  const sxv = Math.sin(cam.rx * RAD);

  const capIn = progress(frame, Math.round(0.25 * fps), Math.round(0.4 * fps), ENTER);
  const capLines = slots.caption ? slots.caption.split('\n') : [];
  const capSize = capLines.length
    ? Math.min(...capLines.map((l) => fitFontSize(l, {fontSize: 44, maxWidthPx: landscape ? width * 0.29 : 888, shrinkFloorPx: 32})))
    : 0;

  return (
    <EditorScene style={{backgroundColor: P.bg, overflow: 'hidden'}}>
      <Backdrop />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `translate(${tx}px, ${ty}px) scale(${ts})`,
          transformOrigin: `${cx}px ${cy}px`,
        }}
      >
        {/* 地面软阴影:把立方体钉在画面里,不让它浮着 */}
        <div
          style={{
            position: 'absolute',
            left: cx - 330,
            top: landscape ? cy + 320 : 1180,
            width: 660,
            height: 130,
            background: `radial-gradient(50% 50% at 50% 50%, ${alpha('#000000', 0.4)} 0%, transparent 70%)`,
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            perspective: PERSP,
            perspectiveOrigin: `${cx}px ${cy}px`,
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: cx,
              top: cy,
              width: 0,
              height: 0,
              transformStyle: 'preserve-3d',
              transform: `translateZ(${cam.d}px) rotateX(${cam.rx}deg) rotateY(${cam.ry}deg)`,
            }}
          >
            {FACE_SLOTS.map((f, i) => {
              const [nx, ny, nz] = f.nm;
              const z1 = -nx * syv + nz * cyv;
              const lit = Math.max(0, ny * sxv + z1 * cxv);
              const title = i < N ? faces[i] : undefined;
              const hue = P.accentHue + HUE_OFFSETS[i];
              // 内容面:accent 邻近色相;素面(faces<6 的剩余面):中性 surface,退到布景
              const bgA = title ? oklch(0.36, 0.085, hue) : P.surfaceRaised;
              const bgB = title ? oklch(0.23, 0.06, hue - 8) : P.surface;
              const edge = title ? alpha(oklch(0.78, 0.09, hue), 0.45) : alpha(P.line, 0.8);
              const barInk = title ? oklch(0.82, 0.07, hue) : P.inkMuted;
              const titleSize = title
                ? fitFontSize(title, {fontSize: 56, maxWidthPx: 476, shrinkFloorPx: 30})
                : 0;
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    left: -HF,
                    top: -HF,
                    width: S,
                    height: S,
                    transform: f.tr,
                    backfaceVisibility: 'hidden',
                    borderRadius: 16,
                    overflow: 'hidden',
                    background: `linear-gradient(155deg, ${bgA}, ${bgB})`,
                    boxShadow: `inset 0 0 0 2px ${edge}`,
                    filter: `brightness(${(0.5 + lit * 0.62).toFixed(3)}) saturate(${(0.8 + lit * 0.4).toFixed(2)})`,
                  }}
                >
                  {title ? (
                    <EditableText as="div" part={`face-${i}`}
                      style={{
                        position: 'absolute',
                        left: 44,
                        top: 40,
                        ...textStyle(T, 'label'),
                        ...(tuneFont ? {fontFamily: tuneFont} : {}),
                        fontSize: titleSize,
                        letterSpacing: '0.06em',
                        color: oklch(0.94, 0.045, hue),
                        // 顶/底面(i≥4)在等轴测定格里字是倒的,末段拉出时淡掉
                        opacity: i >= 4 ? capTopFade : 1,
                      }}
                    >
                      {title}
                    </EditableText>
                  ) : null}
                  {/* 四条骨架信息条,宽度按 rand(i*9+k) 定(确定性) */}
                  {Array.from({length: 4}, (_, k) => (
                    <div
                      key={k}
                      style={{
                        position: 'absolute',
                        left: 44,
                        top: 176 + k * 64,
                        height: 24,
                        borderRadius: 12,
                        width: `${34 + rand(i * 9 + k) * 44}%`,
                        background: alpha(barInk, (title ? 0.5 : 0.28) - k * 0.08),
                      }}
                    />
                  ))}
                  {title ? (
                    <div
                      style={{
                        position: 'absolute',
                        right: 44,
                        bottom: 36,
                        ...textStyle(T, 'label'),
                        fontSize: 88,
                        lineHeight: 1,
                        color: alpha(oklch(0.85, 0.08, hue), 0.55),
                        opacity: i >= 4 ? capTopFade : 1,
                      }}
                    >
                      {GLYPHS[i]}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {/* 进度点:巡到哪一面,哪个点亮成那面的色相(导航感的第二信号) */}
      <div
        style={{
          position: 'absolute',
          left: landscape ? cx - 320 : 0,
          right: landscape ? undefined : 0,
          width: landscape ? 640 : undefined,
          top: landscape ? height * 0.89 : 1348,
          display: 'flex',
          justifyContent: 'center',
          gap: 26,
        }}
      >
        {faces.map((_, i) => (
          <div
            key={i}
            style={{
              width: 14,
              height: 14,
              borderRadius: '50%',
              background:
                i === active
                  ? oklch(0.78, 0.12, P.accentHue + HUE_OFFSETS[i])
                  : alpha(P.inkMuted, 0.38),
            }}
          />
        ))}
      </div>
      {slots.caption ? (
        <EditableText as="div" part="caption"
          style={{
            position: 'absolute',
            top: landscape ? height * 0.42 : 1560,
            left: landscape ? width * 0.65 : 96,
            right: 96,
            textAlign: landscape ? 'left' : 'center',
            ...textStyle(T, 'body'),
            ...(tuneFont ? {fontFamily: tuneFont} : {}),
            fontSize: capSize,
            lineHeight: 1.55,
            color: P.inkSecondary,
            opacity: capIn,
            transform: `translateY(${24 * (1 - capIn)}px)`,
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
export const PresetCubeNav: React.FC<PresetCubeNavProps> = (props) => (
  <TuneSkin tune={props.tune}>
    <Inner {...props} />
  </TuneSkin>
);
