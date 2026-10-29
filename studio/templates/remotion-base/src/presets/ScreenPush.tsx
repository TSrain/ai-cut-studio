import {EditableText, EditorScene} from '../editor/preset-editing';
// presets/ScreenPush.tsx —— 截图推近 preset(docs/presets/screen-push/preset.json)
//
// 定位:口播提到某个网页/产品/曲线图时,把那张截图搬上屏并**指着看**。
// 历史上手搓过四次(METR 曲线、WideSeek 精选列表…),`KenBurns` 组件早就抽出来了,
// 一直缺的是"整镜"这一层:窗口多大、眉题放哪、来源角标怎么写、末段留多久静止。
//
// ============ 为什么静图 + 推镜就够,不需要真录屏 ============
//
// 口播插片只有 3–8 秒,观众要的是"哦,是这个东西"+"注意这一处",不是完整操作流程。
// 一张高清截图 + 一次缓慢推镜,信息到位、成本极低、而且**天然满足确定性条款**
// (无网络、无外部进程、任意一帧可独立算出)。真要演操作流程,那是另一个模板(伪 UI 录屏)。
//
// ============ 踩过的坑 ============
//
// 1. **焦点不许目测。** focusX/focusY 是归一化坐标,要用 docs/locate-protocol.md 的网格法拿
//    (`node tools/locate.mjs`)。目测平均误差 6.5%,在推近末帧会明显偏出画。
//    控制台的表单里给了「用网格定位」的提示,别自己估。
// 2. **末段必须定格。** moveEnd 卡在 78%,剩下的时间画面完全静止 —— 推镜到最后一帧还在动的话,
//    观众读不完那处细节,而且和下一镜硬切时会"撞车"。
// 3. **来源角标全程可见。** 用了第三方网页/产品截图,署名要烧进画面,不是可选项。
//    (这是 assets.md 之外的第二道:文件里记了,画面上也要有。)
// 4. **imgW/imgH 必须是源图真实像素。** KenBurns 用它把归一化焦点映射成像素坐标,
//    填错了推镜会偏。控制台会自动探测填入,手写合同时用 `sips -g pixelWidth -g pixelHeight`。

import React from 'react';
import {AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {Backdrop, Eyebrow, Foreground, useBaseline} from '../style/baseline';
import {textStyle, alpha} from '../lib/theme';
import {KenBurns} from '../components/KenBurns';
import {AnnotationMark, ANNOTATION_INK, type AnnotationMarkStyle} from '../components/AnnotationMark';
import {TUNE_FONTS} from './KeyConcept';
import {TuneSkin} from '../style/tune';
import {ENTER} from '../lib/anim';
import {fitFontSize} from '../style/fit';

export type PresetScreenPushProps = {
  durationSeconds: number;
  variant?: {
    move?: 'push' | 'pull' | 'pan' | 'static' | 'graze';
    mark?: 'none' | AnnotationMarkStyle;
    ink?: 'auto' | 'red' | 'yellow' | 'accent';
  };
  slots: {
    image: string;
    imgW: number;
    imgH: number;
    focusX?: number;
    focusY?: number;
    /** graze 巡览的第 2/3 站(可省;只有 move='graze' 时被读)。坐标走 ocr-locate/网格法,不许目测。 */
    focus2X?: number;
    focus2Y?: number;
    focus3X?: number;
    focus3Y?: number;
    /** 批注框(归一化中心 + 宽高)。缺 markW 就不画批注;坐标同样走网格法,不许目测。 */
    markX?: number;
    markY?: number;
    markW?: number;
    markH?: number;
    eyebrow?: string;
    caption?: string;
    credit?: string;
  };
  tune?: {
    font?: 'skin' | 'smiley' | 'archivo' | 'serif' | 'wenkai' | 'noto-serif';
    scale?: number;
    y?: number;
    skin?: 'abyss' | 'ember' | 'slate' | 'paper';
    accentHue?: number;
    neutralHue?: number;
  };
};

const CANVAS = {w: 1080, h: 1920};
/** 窗口:上留眉题、下留说明句。这两个数改了要重渲样张(版式是模板的一部分) */
const WIN = {top: 380, h: 1020};
const MOVE_END_RATIO = 0.78; // 之后完全静止,留读取时间

/**
 * 四种镜头语言。**全部由起止焦点 + 起止缩放表达**,不是四段不同的代码。
 * push 收紧到焦点(默认,最安全);pull 从焦点退到全景(先看细节再交代全局);
 * pan 横向扫过(顺着一条线读:时间轴、长列表、流程图);
 * static 镜头完全不动(轻推都没有)——批注本身就是动作时选它,双动会互相抢。
 *
 * **这些数字是相对 fit 的倍率,1.0 = 整图按宽度正好装进窗口。**
 * v4 及之前直接把它们当源图像素倍率:1280 宽的样例图 0.98 倍将将好,用户一传
 * 2000+ 像素宽的 16:9 截图,0.98 倍还是比 1080 窗口宽一大截,两边被硬裁——
 * preset 承诺的"截图第 0 帧完整在场"从没对大图成立过(2026-08-20 用户报修)。
 * static 用 1.0 不用 1.06:相对语义下 1.06 会把宽图两边各裁 3%,静止镜没理由裁。
 */
const MOVES = {
  push: {s0: 0.98, s1: 1.34, spread: 0},
  pull: {s0: 1.34, s1: 0.98, spread: 0},
  pan: {s0: 1.2, s1: 1.24, spread: 0.34},
  static: {s0: 1.0, s1: 1.0, spread: 0},
} as const;

// ============ graze:低掠贴面巡览(源自 shotcraft graze-face-tour,2026-08-20 融合) ============
//
// 相机以低掠视角贴着截图表面飞:从 (focusX,focusY) 起,依次巡览 focus2、focus3,
// 每站短暂停留,站间一条稳的 bezier 位移 + 微调倾角;末站定格为英雄帧。
// 复刻参考 src/shotcraft/GrazeFaceTour.tsx 的三件套照搬:
// ① 机位 = perspective + 大倾角 rotateX/rotateY,平面按"焦点映射窗心"平移
//    (translate = dispW/2 - cx,和参考实现 SEGS 注释同一公式);
// ② 浅景深 = 整个舞台渲两层,模糊层用 radial-gradient mask 只留焦点带外——
//    焦点恒在窗心,所以 mask 固定在屏幕空间即可,不用跟踪;
// ③ 远端压暗 = 屏幕空间顶部渐变到底色。它同时是穿帮保险:大倾角下平面远边
//    偏进窗口时会被雾化吞掉,而不是露出一条生硬的图边。
//
// 踩过的坑(调参时别回退):
// - 倾角别学"大倾角"字面开到 45°+:参考实现的 rx 只有 12–20°,贴面感来自
//   "巨大平面 + 近 perspective(≈1000)",不是来自角度。角度一大文字就读不了。
// - 站点钳制优先于对准(和 KenBurns 的 clampEdges 同一取舍):焦点太靠图边时
//   钳 cx/cy 而不是硬对窗心,否则平面边缘会飞进画面。GRAZE_MARGIN 是按
//   ry≤22°、scale 低谷 0.93 时"远侧边经透视收缩后仍在窗外"倒算的,别随手改小。
// - 批注只在末站停留段画(飞行途中画了也读不到),默认框也挪到末站坐标。
const easeGraze = Easing.bezier(0.45, 0, 0.25, 1); // 参考实现的 easeIO:两端缓、中段稳

/** 每站机位微调:巡览站在两组倾角间交替(飞行途中倾角随位移一起插值),末站收到最平的英雄机位 */
const GRAZE_TOUR_CAMS = [
  {rx: 16, ry: 22, rz: -6},
  {rx: 18, ry: -16, rz: 5},
] as const;
const GRAZE_HERO_CAM = {rx: 12, ry: 14, rz: -3} as const;
/** 站点钳制边距(px,显示坐标系):窗半宽 540 × 透视收缩补偿。见上方头注,别改小 */
const GRAZE_MARGIN = {x: 780, y: 620} as const;

type GrazeCamPose = {cx: number; cy: number; rx: number; ry: number; rz: number; s: number};

const GrazeWindow: React.FC<{
  src: string;
  imgW: number;
  imgH: number;
  /** 巡览站点,归一化坐标,≥2 站(单焦点时调用方已补起飞站) */
  stations: {x: number; y: number}[];
  moveEnd: number;
  bg: string;
  /** 叠加层,渲染在源图像素坐标系里(批注挂这儿),与图共享同一套相机变换 */
  children?: React.ReactNode;
}> = ({src, imgW, imgH, stations, moveEnd, bg, children}) => {
  const frame = useCurrentFrame();

  // 显示尺寸:把图放大到"贴面"距离。两个下限:横向 2.6 倍画布宽(宽图),
  // 纵向 2.4 倍窗高(扁图——sample-docs 这类 2:1 图靠这条才够近)
  const config = useVideoConfig();
  const isWide = config.width > config.height;
  const k = Math.max(((isWide ? config.width * .62 : CANVAS.w) * 2.6) / imgW, ((isWide ? config.height - 240 : WIN.h) * 2.4) / imgH);
  const dispW = imgW * k;
  const dispH = imgH * k;

  // 钳制优先于对准:焦点靠图边时贴边不硬对窗心(退化情况:图太小就居中)
  const clampC = (v: number, len: number, margin: number) => {
    const lo = margin;
    const hi = len - margin;
    return hi <= lo ? len / 2 : Math.min(hi, Math.max(lo, v * len));
  };

  // ===== 时间线:起始短停 → 飞行(+中间站停留)→ 末站定格 =====
  const n = stations.length;
  const T = moveEnd;
  const dwell0 = Math.max(2, Math.round(T * 0.08));
  const dwellMid = Math.max(4, Math.round(T * 0.12));
  const flight = Math.max(8, Math.round((T - dwell0 - Math.max(0, n - 2) * dwellMid) / (n - 1)));

  // 站点关键帧(焦点 + 倾角,不含中点——中点关键帧会让 bezier 在半途缓停)
  const times: number[] = [];
  const vcx: number[] = [];
  const vcy: number[] = [];
  const vrx: number[] = [];
  const vry: number[] = [];
  const vrz: number[] = [];
  // 缩放关键帧另建一套:飞行中段轻微抬升(0.93),站上落回 1
  const sTimes: number[] = [];
  const sVals: number[] = [];

  const camOf = (i: number) => (i === n - 1 ? GRAZE_HERO_CAM : GRAZE_TOUR_CAMS[i % GRAZE_TOUR_CAMS.length]);
  const pushKey = (t: number, i: number) => {
    const tt = times.length ? Math.max(times[times.length - 1] + 1, Math.round(t)) : Math.round(t);
    const cam = camOf(i);
    times.push(tt);
    vcx.push(clampC(stations[i].x, dispW, GRAZE_MARGIN.x));
    vcy.push(clampC(stations[i].y, dispH, GRAZE_MARGIN.y));
    vrx.push(cam.rx);
    vry.push(cam.ry);
    vrz.push(cam.rz);
  };
  const pushScale = (t: number, v: number) => {
    const tt = sTimes.length ? Math.max(sTimes[sTimes.length - 1] + 1, Math.round(t)) : Math.round(t);
    sTimes.push(tt);
    sVals.push(v);
  };

  pushKey(0, 0);
  pushKey(dwell0, 0);
  pushScale(0, 1);
  pushScale(dwell0, 1);
  let cursor = dwell0;
  for (let leg = 0; leg < n - 1; leg++) {
    pushScale(cursor + flight / 2, 0.93); // 飞行中段相机轻微抬离表面
    cursor += flight;
    pushKey(cursor, leg + 1);
    pushScale(cursor, 1);
    if (leg + 1 < n - 1) {
      cursor += dwellMid;
      pushKey(cursor, leg + 1);
      pushScale(cursor, 1);
    }
  }

  const opt = {easing: easeGraze, extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
  const pose: GrazeCamPose = {
    cx: interpolate(frame, times, vcx, opt),
    cy: interpolate(frame, times, vcy, opt),
    rx: interpolate(frame, times, vrx, opt),
    ry: interpolate(frame, times, vry, opt),
    rz: interpolate(frame, times, vrz, opt),
    s: interpolate(frame, sTimes, sVals, opt),
  };

  // 同一舞台渲两层做浅景深(参考实现的双 Stage 做法)。焦点恒在窗心附近,mask 固定即可
  const stage = (
    <AbsoluteFill style={{perspective: 1000, perspectiveOrigin: '50% 45%'}}>
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: 0,
          height: 0,
          transformStyle: 'preserve-3d',
          transform: `scale(${pose.s}) rotateX(${pose.rx}deg) rotateY(${pose.ry}deg) rotateZ(${pose.rz}deg)`,
        }}
      >
        <div style={{position: 'absolute', transform: `translate3d(${dispW / 2 - pose.cx}px, ${dispH / 2 - pose.cy}px, 0)`}}>
          <div style={{position: 'relative', transform: 'translate(-50%, -50%)', width: dispW, height: dispH}}>
            {/* 源图像素坐标系(scale k 包裹层):children 和 KenBurns 的 overlay 同一约定 */}
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: imgW,
                height: imgH,
                transformOrigin: '0 0',
                transform: `scale(${k})`,
              }}
            >
              <Img
                src={/^(https?:|data:|blob:|\/)/.test(src) ? src : staticFile(src)}
                style={{position: 'absolute', left: 0, top: 0, width: imgW, height: imgH}}
              />
              {children}
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );

  const dofMask =
    'radial-gradient(ellipse 58% 52% at 50% 46%, transparent 34%, rgba(0,0,0,0.85) 72%, black 92%)';

  return (
    <AbsoluteFill style={{backgroundColor: bg}}>
      {stage}
      {/* 浅景深:焦点带外整体模糊(全清晰会读成平面滚动,贴面体感靠这层) */}
      <AbsoluteFill
        style={{
          filter: 'blur(15px) brightness(0.92)',
          WebkitMaskImage: dofMask,
          maskImage: dofMask,
        }}
      >
        {stage}
      </AbsoluteFill>
      {/* 远端压暗/雾化:rx>0 时远处在窗口上方,渐变到底色;兼作平面远边的穿帮保险 */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(180deg, ${bg} 0%, ${alpha(bg, 0)} 24%, ${alpha(bg, 0)} 80%, ${alpha(bg, 0.55)} 100%)`,
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  );
};

/** 批注墨色:auto = 荧光笔用黄、其余用笔红;accent 才走皮肤令牌(墨色是戏中物,见 AnnotationMark 头注) */
const resolveInk = (
  ink: 'auto' | 'red' | 'yellow' | 'accent',
  markStyle: AnnotationMarkStyle,
  accent: string,
): string | undefined => {
  if (ink === 'red') return ANNOTATION_INK.red;
  if (ink === 'yellow') return ANNOTATION_INK.yellow;
  if (ink === 'accent') return alpha(accent, markStyle === 'marker' ? 0.5 : 0.92);
  return undefined; // auto:交给组件按样式选默认
};

const Inner: React.FC<PresetScreenPushProps> = ({durationSeconds, variant, slots, tune}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const landscape = width > height;
  const CANVAS = {w: landscape ? width * .62 : 1080, h: landscape ? height : 1920};
  const WIN = landscape ? {top: 100, h: height - 240} : {top: 380, h: 1020};
  const windowLeft = landscape ? width - CANVAS.w - 80 : 0;
  const {P, T, pad} = useBaseline();
  const tuneFont = TUNE_FONTS[tune?.font ?? 'skin'];
  const tuneScale = tune?.scale ?? 1;

  const moveKey = variant?.move ?? 'push';
  const isGraze = moveKey === 'graze';
  const m = MOVES[isGraze ? 'push' : moveKey]; // graze 走独立分支,这里只为保住旧档位的取值路径
  const fx = Math.min(1, Math.max(0, slots.focusX ?? 0.5));
  const fy = Math.min(1, Math.max(0, slots.focusY ?? 0.5));
  const imgW = Math.max(1, slots.imgW);
  const imgH = Math.max(1, slots.imgH);

  // pan 模式:焦点在水平方向扫过,起止各偏 spread 的一半
  const startX = (m.spread ? Math.max(0, fx - m.spread / 2) : fx) * imgW;
  const endX = (m.spread ? Math.min(1, fx + m.spread / 2) : fx) * imgW;

  const dur = durationSeconds * fps;

  // ===== graze 巡览站点:focus 起,依次 focus2、focus3(给几站走几站)=====
  // 一站都没给时"绕 focus 本身做一段低掠慢移":从焦点斜下方一小段外起飞,末站仍是 focus
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  const stations: {x: number; y: number}[] = [{x: fx, y: fy}];
  if (slots.focus2X != null && slots.focus2Y != null) {
    stations.push({x: clamp01(slots.focus2X), y: clamp01(slots.focus2Y)});
  }
  if (slots.focus3X != null && slots.focus3Y != null) {
    stations.push({x: clamp01(slots.focus3X), y: clamp01(slots.focus3Y)});
  }
  if (stations.length === 1) {
    stations.unshift({x: clamp01(fx - 0.12), y: clamp01(fy + 0.06)});
  }
  const heroStation = stations[stations.length - 1];

  // ===== 批注:与运镜**同步**画(用户点名要的,2026-08-19)=====
  // 第一版让镜头停稳(70%)才下笔,读起来是"先移动、后勾选"两段式,拖节奏。
  // 笔迹挂在图像坐标系里跟着镜头走,边推边画完全成立;26% 起笔(截图已看清楚)、
  // 约 46% 画完,推镜 78% 定格时批注早已在场。static 镜同一套时序。
  // graze 例外:批注只在**末站停留段**画(飞行途中画了也读不到),默认框也挪到末站坐标
  const markStyle = variant?.mark ?? 'underline';
  const hasMark = markStyle !== 'none' && slots.markW != null;
  const markDelay = isGraze ? Math.round(dur * MOVE_END_RATIO) + Math.round(dur * 0.02) : Math.round(dur * 0.26);
  const markDur = isGraze
    ? Math.max(10, Math.min(40, Math.round(dur * 0.14)))
    : Math.max(12, Math.min(50, Math.round(dur * 0.2)));
  const markW = (slots.markW ?? 0) * imgW;
  const markH = (slots.markH ?? 0.05) * imgH;
  const markDefault = isGraze ? heroStation : {x: fx, y: fy};
  const markBox = {
    x: (slots.markX ?? markDefault.x) * imgW - markW / 2,
    y: (slots.markY ?? markDefault.y) * imgH - markH / 2,
    w: markW,
    h: markH,
  };

  const capIn = interpolate(frame, [dur * 0.18, dur * 0.42], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ENTER,
  });

  return (
    <EditorScene style={{backgroundColor: P.bg, overflow: 'hidden', fontFamily: tuneFont}}>
      <Backdrop />
      {slots.eyebrow ? <Eyebrow text={slots.eyebrow} top={landscape ? 120 : 220} /> : null}

      {/* 窗口外框:一条极细的 accent 线,把截图和底分开。
          没有它,深色截图会和深色底糊成一片,读不出"这是一块引用进来的东西" */}
      <div
        style={{
          position: 'absolute',
          left: windowLeft,
          top: WIN.top,
          width: CANVAS.w,
          height: WIN.h,
          overflow: 'hidden',
          borderTop: `1.5px solid ${alpha(P.accent, 0.5)}`,
          borderBottom: `1.5px solid ${alpha(P.accent, 0.5)}`,
        }}
      >
        {isGraze ? (
          <GrazeWindow
            src={slots.image.includes('/') ? slots.image : `screens/${slots.image}`}
            imgW={imgW}
            imgH={imgH}
            stations={stations}
            moveEnd={Math.round(dur * MOVE_END_RATIO)}
            bg={P.bg}
          >
            {hasMark ? (
              <AnnotationMark
                box={markBox}
                markStyle={markStyle}
                color={resolveInk(variant?.ink ?? 'auto', markStyle, P.accent)}
                delay={markDelay}
                dur={markDur}
              />
            ) : null}
          </GrazeWindow>
        ) : (
          <KenBurns
            // v4:expand-presets 会把 image 槽改写成 `assets/<名字>`(已拷进 build/public/assets/),
            // 而这里原来无条件补 `screens/` 前缀,拼出 screens/assets/x.png → staticFile 404,
            // 且报错只在浏览器控制台里,画面是一片空底。含路径分隔符的值一律视为 public/ 下的
            // 完整相对路径原样使用;裸文件名才补 screens/(控制台上传流程仍走 public/screens/)。
            src={slots.image.includes('/') ? slots.image : `screens/${slots.image}`}
            imgW={imgW}
            imgH={imgH}
            windowW={CANVAS.w}
            windowH={WIN.h}
            focusStart={{x: startX, y: fy * imgH}}
            focusEnd={{x: endX, y: fy * imgH}}
            scaleStart={m.s0 * (CANVAS.w / imgW)}
            scaleEnd={m.s1 * (CANVAS.w / imgW)}
            moveEnd={Math.round(dur * MOVE_END_RATIO)}
          >
            {hasMark ? (
              <AnnotationMark
                box={markBox}
                markStyle={markStyle}
                color={resolveInk(variant?.ink ?? 'auto', markStyle, P.accent)}
                delay={markDelay}
                dur={markDur}
              />
            ) : null}
          </KenBurns>
        )}
      </div>

      {/* 来源角标:压在窗口右下内侧,全程可见 */}
      {slots.credit ? (
        <EditableText as="div" part="credit"
          style={{
            position: 'absolute',
            right: landscape ? 114 : 34,
            top: WIN.top + WIN.h - 46,
            ...textStyle(T, 'caption'),
            fontSize: 22,
            color: alpha(P.ink, 0.72),
            background: alpha(P.bg, 0.55),
            padding: '3px 10px',
            borderRadius: 5,
          }}
        >
          {slots.credit}
        </EditableText>
      ) : null}

      {slots.caption ? (
        <EditableText as="div" part="caption"
          style={{
            position: 'absolute',
            left: pad,
            right: landscape ? undefined : pad,
            width: landscape ? windowLeft - pad - 60 : undefined,
            top: landscape ? height * .34 : WIN.top + WIN.h + 88,
            ...textStyle(T, 'h2'),
            fontSize: landscape ? Math.round(54 * tuneScale) : Math.round(
              fitFontSize(slots.caption, {fontSize: 62, maxWidthPx: landscape ? windowLeft - pad - 60 : 936, shrinkFloorPx: 40}) * tuneScale,
            ),
            color: P.ink,
            lineHeight: 1.35,
            opacity: capIn,
            transform: `translateY(${(tune?.y ?? 0) + 20 * (1 - capIn)}px)`,
          }}
        >
          {slots.caption.split('\n').map((l, i) => (
            <React.Fragment key={l}>
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

// 不自带 Provider:无 Provider 时 useBaseline 落到默认皮肤;StyleBible 比稿时可用 Provider 覆盖
export const PresetScreenPush: React.FC<PresetScreenPushProps> = (props) => (
  <TuneSkin tune={props.tune}>
    <Inner {...props} />
  </TuneSkin>
);
