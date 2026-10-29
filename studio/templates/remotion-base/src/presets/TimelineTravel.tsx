import {EditableText, EditorScene} from '../editor/preset-editing';
// presets/TimelineTravel.tsx —— 时间轴横移 preset(docs/presets/timeline-travel/preset.json)
//
// 复刻来源:src/shotcraft/TimelineTravel.tsx(video-shotcraft 逐帧验证版,合成 ScTimelineTravel,1920×1080/160f)
// 配方卡:docs/catalog/recipes-external/data/timeline-travel.md
//
// 这一式的本体是**速度本身在讲「发展快」,急停在讲「现在最重要」**。
// 相机沿一条水平刻度轴缓起 → 冲刺 → 急刹,每掠过一格,那一站的卡片从轴上弹立;
// 末刻度急停后推近,静止读结论。把顺序打乱画面立刻不成立——这是它和 bullet-run 的分界。
//
// ── 与 demo(1920×1080 横版、灰阶占位卡)的换算,1080×1920 竖版重标定 ───────────
// - 轴 y:700/1080(64.8%)→ 1080/1920(56.3%)。竖版把画面切成「轴上=卡片、轴下=刻度名」
//   两条带;轴再压低,推近(1.28×)时卡片顶会顶到眉题,再抬高刻度名就压到结论句。
// - 刻度间距:demo 1400px = 0.73 屏宽 → 竖版 880px = 0.81 屏宽。**不是等比缩**:
//   竖版屏宽只有 1080,按 0.73 屏宽取会让相邻卡(680 宽)几乎贴在一起,掠过时糊成一条。
// - 卡片:360×240(0.19 屏宽)→ 680×(253/328)(0.63 屏宽,高度按正文 1/2 行算)。
//   竖版同屏能看清的卡更少,每张必须**独立可读**,而不是靠"一排卡"堆气势。680 是推近后的
//   上限:680×1.28 = 870,居中后左右各余 105px,仍在 pad 72 的安全区内(再宽就出血)。
//   卡高是算出来的不是写死的——写死高度 + 一行短句 = 一张半空的卡,读作"这里本来该有东西"。
// - 卡里装的是**真实中文一句话**(demo 是灰条骨架)。刻度名(v1.0/今天)移到轴下方,
//   88px display;卡内正文 52px body。1.69 的字号比 = 主次立得住(刻度名是节奏,正文是内容),
//   而 52px 在 1080 宽上是"缩到 320px 缩略图仍认得出有字"的量,42px 就已经偏小了。
// - 行程随 stops 数变(3–5 站),不写死 4 站;travel 时长也随站数变,见下面时间表。
//
// ── 与 demo 的刻意偏差(每条都有原因,别"顺手"改回去)────────────────────────────
// 1. **首站的卡在 f0 就起弹**(demo 是 popFrame-6 = f6)。首站不是掠过来的,是出发点;
//    竖版静置段那 0.47s 如果只有一条空轴,首帧墨量撑不住(frame-audit 实测 ink 会掉到个位数)。
//    其余站照配方卡走"相机到达前 6f 起弹"。
// 2. **加了远景视差竖线层**(0.35× 速率,alpha 0.095)。demo 靠 1920 宽画面里同时出现的
//    次刻度点给速度参照;竖版一屏只装得下 6 个次刻度,光靠它们速度感不够,
//    而且竖版上下各有 400px 空场。视差层同时解决这两件事——它仍然只动 translateX。
// 3. **走过的轨道染成 accent**(demo 全程同色)。这是"已经走了多远"的第二信号,
//    也是这一式主要的强调色面积来源(卡片是第一来源)。
// 4. **卡片颜色按站序走明度阶梯**(demo 四张卡同色)。同一类东西的不同状态用明度阶梯编码
//    (docs/color.md),越接近"今天"越亮——顺序本身被画出来了,不只靠位置暗示。
// 5. **未到站的卡平躺在轨道上**(demo 是凭空出现)。竖版一屏只装得下一张多卡,
//    掠过 v3.0 到"今天"之间那 20 帧右半屏会空掉;让下一张卡先躺在轴上,既补住那段空,
//    又提前告诉观众"还有几站"(StepFlow 的「未走段不能省」同一条道理)。它仍然是
//    从刻度线上立起来的,语义没变。
// 6. **不叠 CameraMotionBlur**。配方卡说"快到卡片糊时可叠",但竖版的硬约束是
//    "至少末两张卡能读";速度已经按 demo 的屏宽/帧标定过(≈2.8%屏宽/帧),不糊,
//    这时候叠方向模糊只会拿可读性换一个没人要求的效果。
//
// ── 颜色零 hex ──────────────────────────────────────────────────────────────
// 卡片 = 从皮肤 accentHue 派生的 oklch 明度阶梯;轨道/刻度/文字 = P.* 令牌;
// 唯一的字面量是阴影的 alpha('#000000', …) —— 与 baseline.tsx / CubeNav 同一惯例
// (纯黑投影不带色相,写成令牌反而会被皮肤染色)。
//
// ── 坑(别拆)───────────────────────────────────────────────────────────────
// - **变速曲线是命门**:输入断点 [0,0.15,0.88,1] → 输出 [0,0.055,0.9,1],段内 inOut(quad)。
//   缓起 15% 只走 5.5% 距离、中段 73% 时间吃掉 84.5% 距离、末 12% 时间只剩 10% 距离 = 急刹。
//   **改成匀速就是廉价 PPT,中段拉慢就没有旅行感**。
// - **次刻度小点删不得**。它是速度的参照物;只留主刻度的话相机在动但观众感觉不到快。
// - **弹立提前量 6f 不是随手取的**:到了才弹,观众已经掠过去了;早太多读作预告。
//   由 camXAt 反查到达帧再前移(不是按站号均分帧),所以变速曲线一改,弹立时机自动跟着变。
// - **末段静止预算前置**。demo 首版只有 25f 静止不达标;这里先扣掉 HOLD_MIN(1.05s = 31f)
//   再把剩下的给 travel,短时长下压缩的是行程时间不是静止时间。
// - **世界层只动 translateX,推近层只动 scale**,两层分开。合在一起写会让推近把
//   translateX 一起放大,末刻度停不准。
// - 弹簧只有一个名额(preset.json springAccents: 1):卡片弹立。damping 11 明显过冲,
//   以底边为轴 scaleY 立起,刻度名的点亮、卡下的 accent 立杆都由**同一根**弹簧驱动。
// - **平躺→立起必须是一条连续曲线**(scaleY 从 CARD_FLAT 长到 1),不是两个分支。
//   写成 `up ? 立起 : 平躺` 会在 pop 那一帧闪断成「13% → 0% → 重新长起来」,
//   看起来像卡片被删掉又重画(2026-08-26 f55 实帧抓到)。
// - **卡面内容必须是卡 div 的子元素**,跟着一起被压扁再回弹(demo 同款)。单独放一层
//   只跟 scaleX,弹立中段会看到文字和 accent 条悬在压扁的卡外面,像两个不相干的东西。
//
// ── 时序(绝对秒,timing is frozen;默认 5.5s / 4 站 = 165 帧)────────────────
//   0.00–0.47   静置:空轴 + 首站卡从轨道上立起(相机不动)
//   0.47–3.92   行程:缓起 → 中段冲刺 → 末 12% 急刹;每到一格前 6f 那站的卡弹立
//   3.92–4.25   急停后推近末刻度 1 → 1.28(out cubic),末刻度名转 accent
//   4.02–4.47   结论句底部上浮淡入
//   4.25–5.50   完全静止(37 帧 ≥ 配方卡要求的 30 帧);durationSeconds 的伸缩全落这里
//   时长不够 nominal 时**压缩行程不压缩静止**(travelScale),末段静止保底 HOLD_MIN。
import React from 'react';
import {AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {Backdrop, Foreground, alpha, textStyle, useBaseline} from '../style/baseline';
import {oklch} from '../lib/color';
import {estimateTextWidth, fitFontSize} from '../style/fit';
import {TuneSkin} from '../style/tune';
import {CALM} from '../lib/anim';
import {TUNE_FONTS} from './KeyConcept';

export type PresetTimelineTravelProps = {
  durationSeconds: number;
  variant?: Record<string, never>;
  slots: {stops: string[]; title?: string; caption?: string};
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

// —— 几何(1080×1920 竖版直接标定;换算理由见文件头)
const CANVAS = {w: 1080, h: 1920};
const AXIS_Y = 1080; // 轴的世界 y(= 屏幕 y,世界层不做纵向位移)
const TICK_GAP = 880; // 主刻度间距(世界坐标)= 0.81 屏宽
const FIRST_X = 540; // 首刻度的世界 x:等于半屏宽,于是 camX=0 时它正好居中
const CARD_W = 680;
const CARD_PAD = 44;
const CARD_INNER = CARD_W - CARD_PAD * 2; // 592
const CARD_LIFT = 54; // 卡底边到轴的距离(中间是 accent 立杆)
/** 卡高 = 固定行距(上下留白 + accent 条 + 底线)+ 正文行数 × 行高。卡片不留空,空卡读作没做完 */
const CARD_CHROME_H = 178;
/** 没弹起来之前:卡平躺**在轨道上**(scaleY 13% 且 translateY 回 CARD_LIFT,贴着轴线),
 *  观众能看见"前面还有几站"。这是 StepFlow「脊线未走段不能省」的同一条道理,
 *  但仍然是从刻度线上立起来,语义没变。**别把 translateY 去掉**——不贴轴的话它读作
 *  一根悬在半空的横条,和时间轴没关系(2026-08-26 f110 实帧确认) */
const CARD_FLAT = 0.13;
const MINOR_DIV = 5; // 每格切 5 个次刻度
const FAR_GAP = 340; // 远景视差竖线间距(世界坐标)
const FAR_RATE = 0.35; // 远景层速率(相对世界层)
const LEAD = 6; // 弹立提前帧(配方卡标定)
const ZOOM_TO = 1.28;

// —— 时间表(绝对秒,timing is frozen)
// 伸缩落在末段静止;只有 duration 短到装不下 nominal 行程时,才等比压缩 travel(见 travelScale)
const T_STILL = 0.47; // 静置:空轴 + 首站卡起立
const TRAVEL_BASE = 0.9; // 行程的起步/刹车开销
const TRAVEL_PER_GAP = 0.85; // 每多一格加的行程时间(3 站 2.6s / 4 站 3.45s / 5 站 4.3s)
const T_ZOOM = 0.33; // 急停后推近(10f)
const HOLD_MIN = 1.05; // 末段静止保底(31f > 配方卡要求的 30f)
const T_CAP_DELAY = 0.1; // 急停后多久开始淡入结论句
const T_CAP_DUR = 0.45;

// 声明档字号(与 preset.json 的 slots.stops 同口径:fontSize 88 / noteRatio 0.59)
const HEAD_DECL = 88;
const NOTE_DECL = Math.round(HEAD_DECL * 0.59); // 52
const HEAD_MAX_W = 540; // = preset.json stops.fit.maxWidthPx
const HEAD_FLOOR = 40;
const NOTE_FLOOR = 30;
/** 小注在卡里是**会折行的**:按 2 行预算量宽(留 8% 保险),与展开器 maxWidthPx×noteLines 同口径 */
const NOTE_BUDGET = CARD_INNER * 1.84;

const Inner: React.FC<PresetTimelineTravelProps> = ({durationSeconds, slots, tune}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const landscape = width > height;
  const CANVAS = {w: landscape ? width : 1080, h: landscape ? height : 1920};
  const AXIS_Y = landscape ? height * .64 : 1080;
  const FIRST_X = landscape ? width / 2 : 540;
  const {P, T, pad} = useBaseline();
  const tuneFont = TUNE_FONTS[tune?.font ?? 'skin'];
  const ts = tune?.scale ?? 1;
  const tx = tune?.x ?? 0;
  const ty = tune?.y ?? 0;
  const light = P.mode === 'light';

  // —— 槽位:一行一站,`刻度名 | 一句话`(分隔符按 preset.json 的 ' | ' 书写,这里按 '|' 宽松切分)
  const stops = (slots.stops ?? [])
    .filter((s) => String(s).trim() !== '')
    .slice(0, 5)
    .map((s) => {
      const [head, ...rest] = String(s).split('|');
      return {head: head.trim(), note: rest.join('|').trim()};
    });
  const N = Math.max(1, stops.length);
  const total = (N - 1) * TICK_GAP; // 需要位移的世界距离

  // —— 时间线:先扣静置/推近/静止,剩下的才是行程(末段静止预算前置,见文件头坑位)
  const travelNominal = TRAVEL_BASE + (N - 1) * TRAVEL_PER_GAP;
  const travelScale = Math.min(1, Math.max(0.35, (durationSeconds - T_STILL - T_ZOOM - HOLD_MIN) / travelNominal));
  const travelStart = Math.round(T_STILL * fps);
  const travelEnd = travelStart + Math.max(2, Math.round(travelNominal * travelScale * fps));
  const zoomEnd = travelEnd + Math.round(T_ZOOM * fps);

  // 相机 X:缓起 → 中段冲刺 → 末 12% 急刹。**断点是这一式的命门,别改**(文件头)
  const camXAt = (f: number): number => {
    const t = interpolate(f, [travelStart, travelEnd], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    const eased = interpolate(t, [0, 0.15, 0.88, 1], [0, 0.055, 0.9, 1], {
      easing: Easing.inOut(Easing.quad),
    });
    return eased * total;
  };
  const camX = camXAt(frame);

  // 每站的起弹帧:由 camXAt 反查相机到达该刻度的帧,再提前 LEAD 帧。
  // 首站是出发点不是掠过来的 → f0 就起弹(与 demo 的刻意偏差 1)
  const popOf = (i: number): number => {
    if (i === 0) return 0;
    const targetX = i * TICK_GAP;
    for (let f = travelStart; f <= travelEnd; f += 1) {
      if (camXAt(f) >= targetX) return Math.max(0, f - LEAD);
    }
    return Math.max(0, travelEnd - LEAD);
  };

  // —— 排版:全表统一字号(逐条各自 fit 会大小不一,时间轴立刻读作排版坏了)
  const headSize = Math.min(
    ...stops.map((s) =>
      // 不传 letterSpacingEm:展开器(tools/lib/preset.mjs)量宽时也不传,
      // 两边口径必须一样——否则会出现"展开器放行、组件 throw"的红灯
      fitFontSize(s.head, {fontSize: HEAD_DECL, maxWidthPx: HEAD_MAX_W, shrinkFloorPx: HEAD_FLOOR}),
    ),
  );
  const noteSizes = stops
    .filter((s) => s.note !== '')
    .map((s) => fitFontSize(s.note, {fontSize: NOTE_DECL, maxWidthPx: NOTE_BUDGET, shrinkFloorPx: NOTE_FLOOR}));
  const noteSize = Math.min(NOTE_DECL, ...noteSizes);
  const noteLineH = Math.round(noteSize * 1.45);
  // 卡高:按**最长的那条**要几行算一次,全表同高(逐卡各自高会让掠过时的天际线乱跳)
  const noteLines = Math.max(
    1,
    ...stops
      .filter((s) => s.note !== '')
      .map((s) => Math.min(2, Math.ceil(estimateTextWidth(s.note, noteSize) / (CARD_INNER * 0.92)))),
  );
  const cardH = CARD_CHROME_H + noteLines * noteLineH;

  const titleSize = slots.title
    ? fitFontSize(slots.title, {fontSize: 42, maxWidthPx: 820, shrinkFloorPx: 28})
    : 0;
  const capLines = slots.caption ? slots.caption.split('\n') : [];
  const capSize = capLines.length
    ? Math.min(...capLines.map((l) => fitFontSize(l, {fontSize: 44, maxWidthPx: 888, shrinkFloorPx: 32})))
    : 0;

  // —— 推近:急停帧起 10f,1 → 1.28,out cubic。原点钉在轴上,推近时轴不动、卡片长大
  const zoom = interpolate(frame, [travelEnd, zoomEnd], [1, ZOOM_TO], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const capIn = interpolate(
    frame,
    [travelEnd + T_CAP_DELAY * fps, travelEnd + (T_CAP_DELAY + T_CAP_DUR) * fps],
    [0, 1],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: CALM},
  );

  const worldW = total + FIRST_X + CANVAS.w + 540;
  const minorCount = Math.ceil(worldW / (TICK_GAP / MINOR_DIV));
  const farCount = Math.ceil((total * FAR_RATE + CANVAS.w * 2) / FAR_GAP);

  return (
    <EditorScene style={{backgroundColor: P.bg, overflow: 'hidden'}}>
      <Backdrop />

      {/* 远景视差竖线(0.35×):速度参照 + 填住竖版上下的空场。仍然只动 translateX */}
      <AbsoluteFill style={{overflow: 'hidden'}}>
        <div style={{position: 'absolute', inset: 0, transform: `translateX(${-camX * FAR_RATE}px)`}}>
          {Array.from({length: farCount}, (_, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: i * FAR_GAP - CANVAS.w * 0.5,
                top: 0,
                width: 2,
                height: CANVAS.h,
                background: alpha(P.ink, light ? 0.1 : 0.095),
              }}
            />
          ))}
        </div>
      </AbsoluteFill>

      {/* 舞台:tune 的位移/缩放只作用于世界(轴 + 卡 + 刻度名),眉题与结论句不跟着走 */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          transform: `translate(${tx}px, ${ty}px) scale(${ts})`,
          transformOrigin: `${CANVAS.w / 2}px ${AXIS_Y}px`,
        }}
      >
        {/* 推近层:只动 scale,原点钉在轴上 */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transform: `scale(${zoom})`,
            transformOrigin: `50% ${((AXIS_Y / CANVAS.h) * 100).toFixed(2)}%`,
          }}
        >
          {/* 世界层:唯一横移的容器 */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: worldW,
              height: CANVAS.h,
              transform: `translateX(${-camX}px)`,
            }}
          >
            {/* 轨道底:让轴有厚度,不是一根发丝 */}
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: AXIS_Y - 92,
                width: worldW,
                height: 184,
                background: `linear-gradient(180deg, transparent 0%, ${alpha(P.surface, light ? 0.7 : 0.9)} 34%, ${alpha(
                  P.surface,
                  light ? 0.7 : 0.9,
                )} 66%, transparent 100%)`,
              }}
            />
            {/* 次刻度小点:速度的参照物(删掉就感觉不到快) */}
            {Array.from({length: minorCount}, (_, i) => {
              const x = FIRST_X - TICK_GAP + (i * TICK_GAP) / MINOR_DIV;
              if (i % MINOR_DIV === 0) return null; // 主刻度位置留给主刻度自己
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    left: x - 2,
                    top: AXIS_Y - 15,
                    width: 4,
                    height: 30,
                    borderRadius: 2,
                    background: alpha(P.inkMuted, 0.5),
                  }}
                />
              );
            })}
            {/* 主轴线 */}
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: AXIS_Y - 4,
                width: worldW,
                height: 8,
                borderRadius: 4,
                background: alpha(P.line, light ? 1 : 0.95),
              }}
            />
            {/* 走过的那一段染成 accent:「已经走了多远」的第二信号(偏差 3)。
                尾端向左淡出:①"越久远越淡"是真的在说事;②不淡的话它会把整个左半屏
                刷成实心强调色,frame-audit 的左右平衡直接报警(实测 leftShare 71%) */}
            <div
              style={{
                position: 'absolute',
                left: FIRST_X,
                top: AXIS_Y - 4,
                width: Math.max(0, camX),
                height: 8,
                borderRadius: 4,
                background: `linear-gradient(90deg, ${alpha(P.accent, 0)} 0%, ${alpha(P.accent, 0.3)} 26%, ${P.accent} 66%, ${P.accent} 100%)`,
              }}
            />

            {stops.map((stop, i) => {
              const x = FIRST_X + i * TICK_GAP;
              const pop = popOf(i);
              const s = spring({
                frame: frame - pop,
                fps,
                config: {damping: 11, stiffness: 160, mass: 0.9}, // 明显过冲(唯一弹簧名额)
                durationInFrames: 26,
              });
              // 弹簧进度。**未起弹时是 0,不是"不渲染"**:卡从平躺态(CARD_FLAT)连续长到 1,
              // 两个状态是同一条曲线的两端。写成 up ? 立起 : 平躺 两个分支会在 pop 那一帧
              // 出现「平躺 13% → 0% → 重新长起来」的闪断(2026-08-26 f55 实帧抓到)
              const rise = frame >= pop ? s : 0;
              const sc = Math.min(1, rise);
              const isLast = i === N - 1;
              const arrived = isLast && frame >= travelEnd;
              // 站序明度阶梯:越接近"今天"越亮(偏差 4)
              const p = N > 1 ? i / (N - 1) : 1;
              const cardTop = light
                ? oklch(0.975 - 0.02 * p, 0.014 + 0.02 * p, P.accentHue)
                : oklch(0.245 + 0.055 * p, 0.05 + 0.035 * p, P.accentHue);
              const cardBot = light
                ? oklch(0.93 - 0.02 * p, 0.01 + 0.014 * p, P.accentHue)
                : oklch(0.185 + 0.035 * p, 0.035 + 0.025 * p, P.accentHue - 8);
              const cardEdge = alpha(oklch(light ? 0.62 : 0.8, 0.09, P.accentHue), 0.24 + 0.3 * p);
              // 没写小注的站只有刻度 + 刻度名,不渲空卡(空卡读作"这里本来该有东西")
              const hasCard = stop.note !== '';
              const bodyIn = Math.min(1, Math.max(0, (rise - 0.25) * 2.4));
              const cardSy = CARD_FLAT + (1 - CARD_FLAT) * rise;
              const cardSx = 0.62 + 0.38 * rise;

              return (
                <React.Fragment key={`${stop.head}-${i}`}>
                  {/* 刻度竖线 */}
                  <div
                    style={{
                      position: 'absolute',
                      left: x - 4,
                      top: AXIS_Y - 40,
                      width: 8,
                      height: 80,
                      borderRadius: 4,
                      background: arrived ? P.accent : alpha(P.ink, 0.45 + 0.55 * sc),
                    }}
                  />
                  {/* 刻度名:轴下方 88px display,是这一式的节奏(v1.0 → v2.0 → 今天) */}
                  <EditableText as="div" part={`stop-${i}-head`}
                    style={{
                      position: 'absolute',
                      left: x - 280,
                      top: AXIS_Y + 58,
                      width: 560,
                      textAlign: 'center',
                      ...textStyle(T, 'h1'),
                      ...(tuneFont ? {fontFamily: tuneFont} : {}),
                      fontSize: headSize,
                      lineHeight: 1.1,
                      color: arrived ? P.accent : alpha(P.ink, 0.46 + 0.54 * sc),
                    }}
                  >
                    {stop.head}
                  </EditableText>

                  {hasCard ? (
                    <>
                      {/* accent 立杆:卡是从轴上「长」出来的,不是浮在上面 */}
                      <div
                        style={{
                          position: 'absolute',
                          left: x - 3,
                          top: AXIS_Y - CARD_LIFT,
                          width: 6,
                          height: CARD_LIFT,
                          transform: `scaleY(${sc})`,
                          transformOrigin: '50% 100%',
                          background: P.accent,
                          borderRadius: 3,
                        }}
                      />
                      {/* 卡片:未到站时平躺在轨道上,到站前 6f 以底边为轴 scaleY 弹立(带过冲)。
                          **卡面内容必须是这个 div 的子元素**——跟着一起被压扁再回弹(demo 同款)。
                          2026-08-26 实帧教训:内容单独放一层只跟 scaleX,弹立中段会看到
                          文字和 accent 条**悬在压扁的卡外面**,像两个东西。 */}
                      <div
                        style={{
                          position: 'absolute',
                          left: x - CARD_W / 2,
                          top: AXIS_Y - CARD_LIFT - cardH,
                          width: CARD_W,
                          height: cardH,
                          transform: `translateY(${CARD_LIFT * (1 - sc)}px) scaleY(${cardSy}) scaleX(${cardSx})`,
                          transformOrigin: '50% 100%',
                          borderRadius: 22,
                          overflow: 'hidden',
                          background: `linear-gradient(158deg, ${cardTop} 0%, ${cardBot} 100%)`,
                          boxShadow: `inset 0 0 0 2px ${cardEdge}, 0 34px 90px ${alpha('#000000', light ? 0.16 : 0.5)}`,
                          padding: CARD_PAD,
                          boxSizing: 'border-box',
                        }}
                      >
                        {/* 平躺态的强调色实底:压到 13% 高度后卡自己的深色渐变和描边都看不见了,
                            不铺这层等于什么都没画。立起来时淡出,交给卡本身的渐变 */}
                        <div
                          style={{
                            position: 'absolute',
                            inset: 0,
                            background: alpha(P.accent, 0.46),
                            opacity: 1 - Math.min(1, sc * 2.2),
                          }}
                        />
                        <div style={{width: 96, height: 8, borderRadius: 4, background: P.accent, opacity: bodyIn}} />
                        <EditableText as="div" part={`stop-${i}-note`}
                          style={{
                            marginTop: 40,
                            width: CARD_INNER,
                            ...textStyle(T, 'body'),
                            ...(tuneFont ? {fontFamily: tuneFont} : {}),
                            fontSize: noteSize,
                            lineHeight: 1.45,
                            color: P.ink,
                            opacity: bodyIn,
                          }}
                        >
                          {stop.note}
                        </EditableText>
                        <div
                          style={{
                            position: 'absolute',
                            left: CARD_PAD,
                            bottom: CARD_PAD,
                            width: CARD_INNER,
                            height: 2,
                            background: alpha(P.ink, light ? 0.12 : 0.16),
                            opacity: bodyIn,
                          }}
                        />
                      </div>
                    </>
                  ) : null}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>

      {/* 眉题:全程在场,左上角落款位。不进推近层 */}
      {slots.title ? (
        <div style={{position: 'absolute', top: landscape ? 70 : 196, left: pad, display: 'flex', alignItems: 'center', gap: 16}}>
          <div style={{width: 52, height: 6, background: P.accent, borderRadius: 3}} />
          <EditableText as="div" part="title"
            style={{
              ...textStyle(T, 'label'),
              ...(tuneFont ? {fontFamily: tuneFont} : {}),
              fontSize: titleSize,
              color: P.inkSecondary,
            }}
          >
            {slots.title}
          </EditableText>
        </div>
      ) : null}

      {/* 结论句:急停之后才淡入。急停在讲「现在最重要」,这句是那句"最重要"的落点 */}
      {capLines.length ? (
        <EditableText as="div" part="caption"
          style={{
            position: 'absolute',
            top: landscape ? height * .84 : 1440,
            left: 96,
            right: 96,
            textAlign: 'center',
            ...textStyle(T, 'body'),
            ...(tuneFont ? {fontFamily: tuneFont} : {}),
            fontSize: capSize,
            lineHeight: 1.5,
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

export const PresetTimelineTravel: React.FC<PresetTimelineTravelProps> = (props) => (
  <TuneSkin tune={props.tune}>
    <Inner {...props} />
  </TuneSkin>
);
