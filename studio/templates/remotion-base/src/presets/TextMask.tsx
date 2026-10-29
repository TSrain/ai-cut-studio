import {EditableText, EditorScene} from '../editor/preset-editing';
// presets/TextMask.tsx —— 字形遮罩开场 preset(docs/presets/text-mask/preset.json)
//
// 复刻来源:src/shotcraft/TextAsMask.tsx(video-shotcraft 逐帧验证版,1920×1080)
// 配方卡:docs/catalog/recipes-external/opening/text-as-mask.md
//
// 手法本体(丢了哪一条都不再是这一式):
//   **字是门,产品在门里**。字形静止、内容在笔画里匀速流动,"窗外有世界"的错觉
//   全靠这个反差;末段字形自己胀开溢出画幅,画面接管全屏 —— 一条镜头说完
//   "从品牌词走进产品"。字号/字重就是视口口径:细字重 = 把产品塞进门缝。
//
// ============ 与 demo 的换算与刻意偏差(每条都有原因,别顺手改回去)============
//
// ① **遮罩不走 CSS mask-image 的 SVG data-URI,整块改成行内 <svg>。**
//    demo 把字写进 `url("data:image/svg+xml,<svg><text>SCALE</text></svg>")`。
//    这条路在本项目**会静默失败**:SVG 作为图片被引用时在独立文档里栅格化,
//    拿不到页面用 FontFace 注册的字体(lib/fonts.ts 加载的思源黑/得意黑/新晰黑
//    全部够不着),中文会回退成系统字体甚至豆腐块,**而且不报错**。
//    行内 <svg> 属于当前文档,FontFace 对它生效 —— 图片走 <image>、遮罩走同一棵
//    树里的 <mask><text>,字体从 TUNE_FONTS 取。
//
// ② **不需要"内容层 1/S 反向补偿"。** demo 必须补偿,是因为 CSS mask-image 绑在
//    元素自己的 transform 上:放大遮罩 = 放大元素 = 连内容一起放大。SVG 的 <mask>
//    是独立坐标系里的一棵子树,**遮罩几何与被遮内容几何天生解耦** —— 放大写在
//    <mask> 里的 <g transform> 上,内容一动不动。配方卡守的那条命门(产品不许跟着
//    字胀成 N 倍)在这条路线上是结构性成立的,不是靠一个反向 transform 撑着。
//    → 推论:**别把放大 transform 挪到 <g mask="…"> 上**,那等于把 demo 的坑搬回来。
//
// ③ **放大倍率 26 → 7,且改成几何(指数)插值。** 26 是 1920×1080 + 拉丁字母的值。
//    竖版里字带中心在 (540,920),字半高 230,要盖住到画幅底边(距原点 1000)只需
//    ≈4.4 倍;7 倍是留足余量(字边残影必须彻底出画)之后的取值 —— 再大只是把爆发
//    浪费在观众已经看不见的地方。更要紧的是插值方式:线性 1→26 在 endT=0.08 时就
//    已经 3 倍了,"字形胀开"这件事观众只看得到前 8%;改成 S = N^endT 之后缩放速率
//    恒定(每秒固定 e 倍数),字形能被读到 endT≈0.35(实测第 103 帧仍是完整字形),
//    手法本体才立得住。**改 MASK_SCALE 前先想清楚是不是真的想改爆发速度。**
//
// ④ **放大原点不再手推,改成"字形自己吞掉字腔"。** 见下面「放大原点策略」整段。
//
// ⑤ **漂移轴随素材长边自动选。** demo 是 16:9 仪表盘横漂;竖版的典型素材是长页截图,
//    横向没有余量、纵向余量巨大,所以按 cover 之后哪个轴的富余多就漂哪个轴
//    (配方卡:"漂移方向选画面信息密的轴")。长页 → 纵向滚,读作"页面在字里滚"。
//
// ⑥ **遮罩字族硬性走 archivo 栈(Archivo VF + 思源黑 VF),不跟皮肤 kit。**
//    当前皮肤 abyss 的 kit 是 minimal(西文 Inter + 中文霞鹜新晰黑,weightCap 500,
//    中文只有 400 一档)。新晰黑 400 在 460px 下笔画宽约 25px —— 那不是门,是门缝。
//    遮罩这个槽位的**功能要求就是最大墨量**,所以默认字族取 TUNE_FONTS.archivo:
//    这一栈两边都是可变字体、都有**真** 900 字重,请求 900 不是合成粗体。
//    tune.font 仍可覆盖;配上 fontSynthesis:'none',落到单字重中文字(得意黑/文楷/
//    思源宋)时老老实实渲 400,不伪造。caption 照旧走皮肤 kit,皮肤识别没丢。
//
// ============ 放大原点策略(**换文案的人先读这段**)============
//
// demo 把 transform-origin 手推到字母 L 的竖笔 61.5% 处,并在配方卡里写明
// "换词/换字体后 origin 必失效"。中文字形和拉丁字母完全不同,一个字一个样,
// **任何手推的百分比在换文案后都是错的**,而错的后果很硬:原点落进字腔(口/回/日
// 的空心)时,放大后铺满全屏的是**底色**,不是产品画面。
//
// 本 preset 不手推原点,改成让原点**必然**落在实心笔画内:
//   - 原点 = 整个词的包围盒中心(与文案无关的几何量,永远算得出);
//   - 放大的同时给 <text> 加一条同色描边(stroke-width 0 → 0.55em,em 指字号,
//     窗口 endT 0.30–0.62),**字腔与字间缝在放大到 3 倍之前被自己的笔画吞掉**,
//     词融成一整块实心;
//   - 包围盒中心落在一块实心里 —— 与用什么字、几个字、字腔多大都无关。
// 0.55em 是按 CJK 里字腔最大的那批字(口、回、日、田)倒算的:它们的内腔宽度
// 约 0.55em,描边每侧 0.275em 才闭得上。
//
// 两个窗口边界都是**调出来的,不是猜的**(用 title:"回口田" 这个最坏文案实渲验证:
// 三个字全是大字腔,而且正中那个字腔正压在原点上):
//   - 膨胀开始太早(第一版 0.05)→ 字腔还没长大就被填死,字形在 endT 0.35 就糊成
//     一坨,连带整块提前铺满全屏,接管段后 2/3 变成一动不动的死时间;
//   - 膨胀开始太晚(试过 0.50)→ 字腔在 endT≈0.5 时长到约 670px,画面正中挂一块
//     深色方块,那就是配方卡说的"透出底色"。
// **改 DILATE_WINDOW 一定要拿"回口田"重渲 endT 0.25/0.35/0.45 三帧**,别拿两个字
// 的短词验证 —— 短词的包围盒中心通常落在字间缝上,缝很窄,看不出问题。
//
// 换文案后必看的两帧:默认 5s 档的**第 104 帧**(endT≈0.28,字腔应在收口)和
// **第 111 帧**(endT≈0.55,应已铺满、画面里不许还有深色方块)。
//
// ============ 其他坑 ============
// - **接管保险不许省**:另叠一个共享同一内容变换的无遮罩全屏层,endT 0.50–0.90 淡入。
//   纯 mask 放大在字缝处会留深底残余,而两层内容变换完全相同,交叉淡入看不出接缝。
// - **<image> 不是 Remotion 的 <Img>,渲染器不会替你等它加载**。用 delayRender 手工
//   预载(useImagePreloaded),少了它首帧可能画在图片到位之前 —— 抽帧自查和成片不一致。
// - **末段真静止 ≥20 帧**(STILL=0.8s=24 帧),接管完成帧内容归位到 cover 居中 + zoom 1.0,
//   也就是标准构图;时长伸缩只吃漂移窗口和末段静止,enter 相位是绝对秒。
//
// ============ 选图硬判据(**给 image 之前先读这段**)============
//
// 这一式对素材挑食,而且失败方式是**静默的**——工程照跑,画面直接不成立。三条硬判据:
//   ① **门里必须和门外拉开明度**。暗皮肤(P.bg L0.17)下门里内容要明显更亮,亮皮肤
//      (P.bg L0.98)下要明显更暗。**暗色截图配暗皮肤 = 字直接消失**(实测 sample-screen.png
//      的暗底纽结、catalog/ui-dashboard.svg 的暗色线框:笔画里比背景还暗,「片」整个不见了)。
//   ② **笔画里必须有结构**(边、条、卡、色块),而不是一块平色。460px 字号的笔画宽约
//      40–60px,图元节距要落在这个量级;大片留白、大片纯色、纯渐变在笔画里都退化成
//      "有颜色的字"——**实测 Remotion 落地页的长截图,漂移窗口正好落在一条留白带上,
//      「出片」读成纯白色的字,笔画里只剩一面国旗和半行灰字,窗口感为零**。
//   ③ **看的是那一条带,不是整张图**。漂移窗口只覆盖源图的一条窄带(1080×1920 画布、
//      CONTENT_ZOOM=1.5、5s 档实测:整支片子累计只透出源图坐标里 ~400px 高的一段),
//      页面别处再好看也进不了画面。**给图之前先量一下那条带上是什么**。
// 三条里有一条不满足就别硬凑:**省掉 image 走骨架流**(它是可控的,每次都成立),
// 或者换 screen-push——那一式是让人看清截图的,不是拿截图当质感的。
//
// ============ 骨架流(不填 image 时)============
//
// - **它不是"骨架屏",是一个产品界面**,判据见 SkeletonPage 上方整段:笔画里要同时
//   看得到 ≥3 种图元。第一版是稀疏的大卡片墙,在笔画里只截得到一块平色。
// - **图元尺度按笔画宽度标定**,不按"版面好不好看"标定(表格行 54 / 图表柱 36 / 迷你柱 29 骨架 px)。
// - **两套明度阶梯整体翻转**:暗皮肤门里是亮色 UI,亮皮肤门里是暗色 UI。照抄"越亮越好"
//   会让亮皮肤下的字形化在纸上(第一版 card L0.985 vs paper 底 L0.98)。
// - **英雄面板摆在页面纵向正中**:接管完成帧是 cover 居中裁切,正中放什么末帧就落在什么上。
// - **上半带不能留白**:只有柱状图时柱顶以上是一片平色,f0 的笔画里就只有一块灰;
//   KPI 条与趋势折线就是补这一段的。
// - 确定性:一切从 useCurrentFrame 推导,伪随机走 seed 式 rand;零 hex,颜色全部
//   来自 useBaseline() 的 P.* / alpha() / oklch();弹簧名额 0(这一式靠单段 bezier)。
//
// ============ 时序表(绝对秒;elastic = 时长伸缩落在这里)============
//   0.00–0.55  hold      字与门建立,内容在笔画里静止;caption 0.25s 起上浮淡入 0.4s
//   0.55–T     drift     内容匀速漂移 3.0px/帧(**elastic**:时长伸缩全落这里)
//   takeover='full'(T = 时长 − 1.8s,默认 5s 档 T=3.2s / 第 96 帧):
//     T–T+1.0  takeover  遮罩 S=7^endT 指数放大 + 笔画膨胀吞字腔;内容归位(漂移→0、
//                        zoom 1.50→1.00);无遮罩全屏层 endT 0.50–0.90 淡入;caption 淡出
//     末 0.8s  still     全屏产品静止 24 帧(接管完成帧 = cover 居中 = 标准构图)
//   takeover='hold'(没有接管段,它有自己的收束):
//     …–末0.8s  decel    漂移 outCubic 减速 0.9s 停住
//     末 0.8s  still     字内静止 24 帧,caption 留场(**不是"把末段砍掉"**)
import React, {useEffect, useId, useState} from 'react';
import {
  AbsoluteFill,
  continueRender,
  delayRender,
  Easing,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {useBaseline, Backdrop, Foreground, textStyle, alpha} from '../style/baseline';
import {oklch} from '../lib/color';
import {fitFontSize} from '../style/fit';
import {TuneSkin} from '../style/tune';
import {ENTER} from '../lib/anim';
import {TUNE_FONTS} from './KeyConcept';

export type PresetTextMaskProps = {
  durationSeconds: number;
  variant?: {takeover?: 'full' | 'hold'};
  slots: {title: string; image?: string; imgW?: number; imgH?: number; caption?: string};
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

const CANVAS = {w: 1080, h: 1920};
/** 词带中心。居中略偏上:底部留给 caption,视觉重心也才不塌 */
const WORD_CY = 920;
/** 遮罩字号档(fit 与 docs/presets/text-mask/preset.json 的 title.fit 同步) */
const TITLE_FIT = {fontSize: 460, maxWidthPx: 940, shrinkFloorPx: 180, letterSpacingEm: -0.03};
/** CJK/拉丁通用:视觉中心在基线上方约 0.37em(思源黑 ascent .88 / descent .12) */
const BASELINE_RATIO = 0.37;

// —— 时序(绝对秒)
const HOLD = 0.55; // 建立"字是门"
const TAKE = 1.0; // 接管段(full)
const DECEL = 0.9; // 漂移减速段(hold)
const STILL = 0.8; // 末段真静止(24 帧 ≥ 配方卡的 20 帧)
const DRIFT_MIN = 0.6; // 漂移窗口保底(极短时长时优先保它)

// —— 手法参数
const DRIFT_PXF = 3.0; // 匀速漂移速度(px/帧;配方卡 ~2.75px/f @1920 长边)
const MASK_SCALE = 7; // 末端遮罩放大倍率,几何插值 S = MASK_SCALE^endT(偏差 ③)
const DILATE_EM = 0.55; // 笔画膨胀上限(em):闭合任何 CJK 字腔与字间缝(见「放大原点策略」)
const DILATE_WINDOW = [0.3, 0.62] as const; // 膨胀窗口(endT):早了字形提前糊成一坨,晚了字腔blob太大,见偏差 ④
const CONTENT_ZOOM = 1.5; // 字内内容的取景余量(门里要看得清是什么),接管时归位到 1.0
const TAKE_EASE = Easing.bezier(0.4, 0, 0.2, 1); // 配方卡指定的单段 bezier
const outCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/** seed 式伪随机:同种子跨帧/跨渲染恒定(骨架流用) */
const rand = (s: number) => {
  const x = Math.sin(s * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const CLAMP = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

/** 与 ScreenPush / PhoneRipple 同一套路径约定:含 / 视为 public 完整相对路径,裸文件名补 screens/ */
const resolveSrc = (image: string): string => {
  const rel = image.includes('/') ? image : `screens/${image}`;
  return /^(https?:|data:|blob:|\/)/.test(rel) ? rel : staticFile(rel);
};

/**
 * SVG <image> 不是 Remotion 的 <Img>,渲染器不会等它。手工挂一个 delayRender,
 * 图片解码完才放行 —— 否则首帧可能画在图片到位之前(而且只在部分帧上出现,极难查)。
 * src 在一次渲染里是常量,所以 handle 用惰性 useState 建一次即可;Studio 里改 props
 * 换图不会重新挂 handle(那是编辑期,画面会在图片到位后自动重画)。
 */
const useImagePreloaded = (src: string | null): void => {
  const [handle] = useState<number | null>(() =>
    src === null ? null : delayRender(`[text-mask] 载入遮罩内容图 ${src}`),
  );
  useEffect(() => {
    if (handle === null || src === null) return;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      continueRender(handle);
    };
    const img = new Image();
    img.onload = finish;
    img.onerror = finish;
    img.src = src;
    return finish;
  }, [handle, src]);
};

// ---------------------------------------------------------------------------
// 没给截图时的抽象产品界面(SVG 版,与 PhoneRipple 的骨架流同一母题)
//
// **这不是"骨架屏",是一个产品界面。** 第一版是稀疏的大卡片墙:460px 字号的笔画
// (宽约 40–60 屏幕 px)截到的只有一块平色,字读作"蓝色的字",不是"门里有个界面"。
// **判据:渲 f60,笔画里要同时看得到 ≥3 种图元**(面板底 + 分隔线/分栏 + 强调色柱或芯片)。
//
// 尺度按**笔画宽度**标定,不按"版面好不好看"标定:
//   内容取景 CONTENT_ZOOM=1.5 → 1 骨架 px = 1.5 屏幕 px;笔画宽 ~50 屏幕 px ≈ 33 骨架 px。
//   → 图元节距必须落在 26–74 骨架 px(表格行 54 / 图表柱 36 / 迷你柱 29 / 右栏行 74):
//     更大 → 在笔画里退化成平色(就是第一版的病);更小 → 视频压缩后糊成噪点。
// 漂移期真正透出来的只有一条窄带:**整支片子累计也只有骨架 y 1403–1801、x 180–900**
// (5s 档实测)。所以密度必须**整页均匀**,不能只在某一处堆一块好版面;
// 而接管完成帧(cover 居中、zoom 1.0)看到的是 y 690–2610 的全幅,英雄面板因此仍钉在页心。
// ---------------------------------------------------------------------------

const SKEL = {w: 1080, h: 3300};
const RAIL_W = 120; // 左导航栏:漂移期在画外,接管完成帧才露出来 —— 末帧才像"一个应用"
const MAIN_X = 148;
const MAIN_W = 892;
/** 英雄面板顶边:650 高,块心 1655 ≈ 页心 1650(末帧是 cover 居中裁切,正中放什么就定格在什么上) */
const HERO_Y = 1330;
const ROW_H = 54; // 表格行节距(= 81 屏幕 px):竖笔画一次能吃到 1 行 + 分隔线

const SkeletonPage: React.FC<{uid: string}> = ({uid}) => {
  const {P, skin} = useBaseline();
  const dark = P.mode === 'dark';
  const nc = skin.neutralChroma * 1.6;
  const ac = skin.accentChroma ?? 0.16;
  /** 门里是**一块亮着的屏**,所以中性阶梯在 OKLCH 里另起一整套,
   *  不复用 P.surface / P.surfaceRaised —— 它们与 P.bg 只差 0.05 明度,在笔画里就是深灰。 */
  const n = (L: number) => oklch(L, nc, P.hue);
  /** 界面自己的强调色要**离卡片底两档**:暗皮肤的 P.accent 是 L0.72,与亮卡片 L0.74
   *  几乎同明度,在笔画里只剩"糊成一片的蓝"。 */
  const a = (L: number, m = 1) => oklch(L, ac * m, P.accentHue);
  /**
   * **两套阶梯是整体翻转的,这是物理约束不是配色偏好。**
   * 这一式成立的条件只有一条:门里必须和门外拉开明度。
   *   暗皮肤(P.bg L0.17)→ 门里是一块**亮色 UI**(卡片 L0.74 + 深色文字条);
   *   亮皮肤(P.bg L0.98)→ 门里必须是一块**暗色 UI**(卡片 L0.38 + 浅色文字条)。
   * 第一版亮皮肤照抄了暗皮肤的"越亮越好"(卡片 L0.985 vs 纸底 L0.98),字形直接化在纸上,
   * 只剩几根散落的柱子。**加皮肤时先看 mode,再决定这一栏往哪个方向走。**
   */
  const L = dark
    ? {page: 0.46, rail: 0.56, card: 0.74, head: 0.66, row: 0.685, line: 0.57, inkS: 0.26, inkM: 0.4, inkW: 0.52}
    : {page: 0.3, rail: 0.24, card: 0.4, head: 0.33, row: 0.355, line: 0.5, inkS: 0.94, inkM: 0.8, inkW: 0.66};
  const s = {
    page: n(L.page),
    rail: n(L.rail),
    card: n(L.card),
    head: n(L.head),
    row: n(L.row),
    line: n(L.line),
    inkS: n(L.inkS),
    inkM: n(L.inkM),
    inkW: n(L.inkW),
    acc: a(dark ? 0.55 : 0.62),
    accMid: a(dark ? 0.68 : 0.74, 0.85),
    accTint: a(dark ? 0.86 : 0.3, dark ? 0.45 : 0.8),
  };

  // —— 版面模块(纯函数,不做成组件:避免每帧重挂载,也省一层 props 管道)

  /** 指标卡三连:图标 + 大数 + 涨跌芯片 + 9 根迷你柱(节距 29,横笔画横穿时是一排条纹) */
  const statRow = (y: number, seed: number) =>
    [0, 1, 2].map((i) => {
      const x = MAIN_X + i * 304;
      const r = rand(seed + i);
      return (
        <g key={`st${seed}-${i}`}>
          <rect x={x} y={y} width={284} height={244} rx={22} fill={s.card} />
          <rect x={x + 24} y={y + 24} width={34} height={34} rx={10} fill={i === 0 ? s.acc : s.accMid} />
          <rect x={x + 70} y={y + 33} width={96 + Math.round(r * 56)} height={14} rx={7} fill={s.inkW} />
          <rect x={x + 24} y={y + 84} width={128 + Math.round(r * 64)} height={38} rx={8} fill={s.inkS} />
          <rect x={x + 24} y={y + 140} width={88} height={26} rx={13} fill={s.accTint} />
          <rect x={x + 38} y={y + 150} width={54} height={8} rx={4} fill={s.acc} />
          {Array.from({length: 9}, (_, b) => {
            const h = 16 + Math.round(rand(seed * 7 + i * 11 + b) * 44);
            return (
              <rect
                key={b}
                x={x + 24 + b * 29}
                y={y + 220 - h}
                width={17}
                height={h}
                rx={4}
                fill={b % 3 === 0 ? s.acc : s.inkW}
              />
            );
          })}
        </g>
      );
    });

  /** 数据表:表头 + rows 行(节距 54,隔行底色 + 每行分隔线 + 头像 + 名字条 + 状态芯片 + 数值条) */
  const tablePanel = (y: number, rows: number, seed: number) => {
    const h = 60 + rows * ROW_H + 16;
    return (
      <g key={`tb${seed}`}>
        <rect x={MAIN_X} y={y} width={MAIN_W} height={h} rx={22} fill={s.card} />
        <rect x={MAIN_X} y={y} width={MAIN_W} height={60} rx={22} fill={s.head} />
        <rect x={MAIN_X} y={y + 34} width={MAIN_W} height={26} fill={s.head} />
        <rect x={MAIN_X} y={y + 58} width={MAIN_W} height={2} fill={s.line} />
        {[0, 1, 2, 3].map((c) => (
          <rect key={c} x={MAIN_X + 32 + c * 212} y={y + 22} width={78} height={14} rx={7} fill={s.inkM} />
        ))}
        {Array.from({length: rows}, (_, r) => {
          const ry = y + 60 + r * ROW_H;
          const w1 = 108 + Math.round(rand(seed + r) * 152);
          const on = rand(seed * 3 + r + 30) > 0.5;
          return (
            <g key={r}>
              {r % 2 === 1 ? (
                <rect x={MAIN_X + 2} y={ry} width={MAIN_W - 4} height={ROW_H} fill={s.row} />
              ) : null}
              <rect x={MAIN_X + 20} y={ry + ROW_H - 2} width={MAIN_W - 40} height={2} fill={s.line} />
              <circle cx={MAIN_X + 46} cy={ry + 27} r={13} fill={on ? s.acc : s.inkW} />
              <rect x={MAIN_X + 76} y={ry + 20} width={w1} height={14} rx={7} fill={s.inkS} />
              <rect x={MAIN_X + 452} y={ry + 21} width={92} height={12} rx={6} fill={s.inkW} />
              <rect x={MAIN_X + 596} y={ry + 14} width={96} height={26} rx={13} fill={on ? s.accTint : s.line} />
              <rect x={MAIN_X + 612} y={ry + 23} width={64} height={8} rx={4} fill={on ? s.acc : s.inkM} />
              <rect x={MAIN_X + 740} y={ry + 20} width={112} height={14} rx={7} fill={s.inkM} />
            </g>
          );
        })}
      </g>
    );
  };

  /** 卡片三连:缩略图(渐变)+ 两行文字条 + 底部作者行 */
  const cardGrid = (y: number, seed: number) =>
    [0, 1, 2].map((i) => {
      const x = MAIN_X + i * 304;
      const r = rand(seed + i * 5);
      return (
        <g key={`cg${seed}-${i}`}>
          <rect x={x} y={y} width={284} height={296} rx={22} fill={s.card} />
          <rect
            x={x + 22}
            y={y + 22}
            width={240}
            height={116}
            rx={14}
            fill={`url(#${uid}-thumb)`}
            opacity={0.45 + r * 0.5}
          />
          <rect x={x + 22} y={y + 156} width={168 + Math.round(r * 68)} height={16} rx={8} fill={s.inkS} />
          <rect x={x + 22} y={y + 186} width={112 + Math.round(rand(seed + i + 9) * 96)} height={14} rx={7} fill={s.inkW} />
          <rect x={x + 22} y={y + 222} width={240} height={2} fill={s.line} />
          <circle cx={x + 36} cy={y + 254} r={14} fill={s.accMid} />
          <rect x={x + 60} y={y + 246} width={96} height={14} rx={7} fill={s.inkM} />
          <rect x={x + 186} y={y + 242} width={76} height={24} rx={12} fill={s.accTint} />
        </g>
      );
    });

  /** 过滤条:一排芯片 —— 节距 118,横笔画横穿时是"按钮排",不是一块平色 */
  const filterStrip = (y: number, seed: number) => (
    <g key={`fs${seed}`}>
      <rect x={MAIN_X} y={y} width={MAIN_W} height={96} rx={22} fill={s.card} />
      {Array.from({length: 6}, (_, i) => {
        const on = i === 1;
        return (
          <g key={i}>
            <rect x={MAIN_X + 28 + i * 118} y={y + 30} width={102} height={36} rx={18} fill={on ? s.acc : s.head} />
            <rect x={MAIN_X + 46 + i * 118} y={y + 42} width={66} height={12} rx={6} fill={on ? s.card : s.inkM} />
          </g>
        );
      })}
      <rect x={MAIN_X + MAIN_W - 148} y={y + 30} width={120} height={36} rx={18} fill={s.accTint} />
      <rect x={MAIN_X + MAIN_W - 128} y={y + 42} width={80} height={12} rx={6} fill={s.acc} />
    </g>
  );

  /** 英雄面板:标题栏 + KPI 条 + 左侧柱状图(16 根,节距 36 + 3 网格线 + 一条趋势折线)
   *  + 右侧列表(节距 74)+ 图例。
   *  这块要单独为"整支片子的漂移窗口(骨架 y 1403–1801)"负责:**上半带不能留白** ——
   *  只有柱状图时,柱顶以上是一片平色,f0 的笔画里就只有一块灰。KPI 条(1418–1494)
   *  和趋势折线(1500–1630)就是补这一段的。 */
  const heroPanel = () => {
    const bx = MAIN_X + 28; // 图表左边界 176
    const base = HERO_Y + 500; // 柱基线 1830
    const listX = MAIN_X + 616; // 右栏 764
    const trend = Array.from({length: 8}, (_, i) => ({
      x: bx + 34 + i * 78,
      y: HERO_Y + 200 + Math.round(rand(i * 5 + 13) * 118),
    }));
    return (
      <g key="hero">
        <rect x={MAIN_X} y={HERO_Y} width={MAIN_W} height={650} rx={26} fill={s.card} />
        {/* 标题栏 */}
        <rect x={MAIN_X} y={HERO_Y} width={MAIN_W} height={78} rx={26} fill={s.head} />
        <rect x={MAIN_X} y={HERO_Y + 50} width={MAIN_W} height={28} fill={s.head} />
        <rect x={MAIN_X} y={HERO_Y + 76} width={MAIN_W} height={2} fill={s.line} />
        <rect x={MAIN_X + 24} y={HERO_Y + 20} width={38} height={38} rx={10} fill={s.acc} />
        <rect x={MAIN_X + 76} y={HERO_Y + 29} width={210} height={20} rx={10} fill={s.inkS} />
        <rect x={MAIN_X + MAIN_W - 210} y={HERO_Y + 26} width={84} height={26} rx={13} fill={s.accTint} />
        <rect x={MAIN_X + MAIN_W - 112} y={HERO_Y + 26} width={84} height={26} rx={13} fill={s.line} />
        {/* 左:KPI 条(补上半带) */}
        {[0, 1, 2, 3].map((i) => {
          const x = bx + i * 142;
          return (
            <g key={`k${i}`}>
              <rect x={x} y={HERO_Y + 88} width={128} height={76} rx={12} fill={s.row} />
              <rect x={x + 14} y={HERO_Y + 102} width={54 + Math.round(rand(i + 3) * 34)} height={16} rx={8} fill={s.inkS} />
              <rect x={x + 14} y={HERO_Y + 128} width={44} height={10} rx={5} fill={s.inkW} />
              {Array.from({length: 5}, (_, b) => {
                const h = 8 + Math.round(rand(i * 9 + b) * 20);
                return (
                  <rect key={b} x={x + 66 + b * 13} y={HERO_Y + 148 - h} width={9} height={h} rx={3}
                    fill={b === 4 ? s.acc : s.inkW} />
                );
              })}
            </g>
          );
        })}
        {/* 左:柱状图 */}
        {[0, 1, 2].map((g) => (
          <rect key={g} x={bx} y={HERO_Y + 230 + g * 90} width={562} height={2} fill={s.line} />
        ))}
        {Array.from({length: 16}, (_, i) => {
          const h = 104 + Math.round(rand(i * 3 + 1) * 226);
          const fill = i % 5 === 2 ? s.acc : i % 2 === 0 ? `url(#${uid}-bar)` : s.inkW;
          return (
            <g key={i}>
              <rect x={bx + i * 36} y={base - h} width={22} height={h} rx={5} fill={fill} />
              <rect x={bx + i * 36} y={base + 16} width={22} height={10} rx={5} fill={s.line} />
            </g>
          );
        })}
        <rect x={bx} y={base} width={562} height={3} fill={s.inkM} />
        {/* 趋势折线:横跨图表上半段,给"柱顶以上"那一片平色一个可读的图元 */}
        <polyline
          points={trend.map((pt) => `${pt.x},${pt.y}`).join(' ')}
          fill="none"
          stroke={s.acc}
          strokeWidth={7}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {trend.map((pt, i) => (
          <circle key={`tp${i}`} cx={pt.x} cy={pt.y} r={10} fill={s.card} stroke={s.acc} strokeWidth={6} />
        ))}
        {/* 竖分栏线 */}
        <rect x={MAIN_X + 592} y={HERO_Y + 96} width={2} height={520} fill={s.line} />
        {/* 右:列表 */}
        {Array.from({length: 6}, (_, r) => {
          const ry = HERO_Y + 88 + r * 74;
          const on = rand(r + 61) > 0.45;
          return (
            <g key={`l${r}`}>
              <rect x={listX} y={ry} width={248} height={62} rx={14} fill={s.row} />
              <circle cx={listX + 30} cy={ry + 31} r={13} fill={on ? s.acc : s.inkW} />
              <rect x={listX + 54} y={ry + 16} width={70 + Math.round(rand(r + 7) * 56)} height={12} rx={6} fill={s.inkS} />
              <rect x={listX + 54} y={ry + 38} width={54 + Math.round(rand(r + 19) * 40)} height={10} rx={5} fill={s.inkW} />
              <rect x={listX + 196} y={ry + 22} width={40} height={18} rx={9} fill={on ? s.accTint : s.line} />
            </g>
          );
        })}
        {/* 图例 */}
        {[0, 1, 2, 3].map((i) => (
          <g key={`lg${i}`}>
            <circle cx={bx + 10 + i * 148} cy={HERO_Y + 592} r={9} fill={i === 0 ? s.acc : i === 1 ? s.accMid : s.inkW} />
            <rect x={bx + 26 + i * 148} y={HERO_Y + 585} width={92} height={13} rx={6} fill={s.inkM} />
          </g>
        ))}
      </g>
    );
  };

  return (
    <>
      <defs>
        <linearGradient id={`${uid}-thumb`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={s.acc} />
          <stop offset="100%" stopColor={s.accTint} />
        </linearGradient>
        <linearGradient id={`${uid}-bar`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={s.accMid} />
          <stop offset="100%" stopColor={s.acc} />
        </linearGradient>
      </defs>
      <rect x={0} y={0} width={SKEL.w} height={SKEL.h} fill={s.page} />
      {/* 左导航栏:整页贯通(末帧看到的是页心那一段,只在顶部摆几个项等于末帧一片空) */}
      <rect x={0} y={0} width={RAIL_W} height={SKEL.h} fill={s.rail} />
      <rect x={RAIL_W - 2} y={0} width={2} height={SKEL.h} fill={s.line} />
      {Array.from({length: 43}, (_, i) => {
        const y = 140 + i * 74;
        const on = i % 7 === 3;
        return (
          <g key={`nv${i}`}>
            {on ? <rect x={16} y={y - 8} width={88} height={44} rx={12} fill={s.accTint} /> : null}
            <rect x={28} y={y} width={26} height={26} rx={8} fill={on ? s.acc : s.inkW} />
            <rect x={64} y={y + 7} width={34} height={12} rx={6} fill={s.inkM} />
          </g>
        );
      })}
      {/* 顶栏 */}
      <rect x={0} y={0} width={SKEL.w} height={104} fill={s.head} />
      <rect x={0} y={102} width={SKEL.w} height={2} fill={s.line} />
      <rect x={38} y={32} width={40} height={40} rx={12} fill={s.acc} />
      {[0, 1, 2].map((i) => (
        <rect key={`tn${i}`} x={MAIN_X + i * 118} y={44} width={90} height={16} rx={8} fill={s.inkM} />
      ))}
      <rect x={SKEL.w - 366} y={34} width={240} height={38} rx={19} fill={s.card} />
      <rect x={SKEL.w - 344} y={46} width={120} height={14} rx={7} fill={s.inkW} />
      <circle cx={SKEL.w - 66} cy={53} r={22} fill={s.accMid} />
      {/* 版面:整页均匀密排 —— 漂移窗口落在哪一段都得有东西可看 */}
      {statRow(132, 1)}
      {tablePanel(406, 6, 2)}
      {cardGrid(836, 3)}
      {filterStrip(1162, 4)}
      {heroPanel()}
      {tablePanel(2020, 7, 5)}
      {cardGrid(2504, 6)}
      {statRow(2830, 7)}
      {tablePanel(3104, 2, 8)}
    </>
  );
};

// ---------------------------------------------------------------------------

const Inner: React.FC<PresetTextMaskProps> = ({durationSeconds, variant, slots, tune}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const landscape = width > height;
  const {P, T, pad} = useBaseline();
  const CANVAS = {w: landscape ? width : 1080, h: landscape ? height : 1920};
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');

  const src = slots.image ? resolveSrc(slots.image) : null;
  useImagePreloaded(src);

  const isFull = (variant?.takeover ?? 'full') === 'full';
  const dur = Math.round(durationSeconds * fps);
  const fHold = HOLD * fps;
  const fStill = STILL * fps;

  // —— 时间线:enter 相位绝对秒,伸缩落在漂移窗口(与 hold 档的末段静止)
  const fTakeStart = isFull
    ? Math.max(fHold + DRIFT_MIN * fps, dur - (TAKE + STILL) * fps)
    : dur; // hold 档没有接管段
  const fStop = isFull ? fTakeStart : Math.max(fHold + DRIFT_MIN * fps, dur - fStill);
  const fDecel = Math.max(fHold + DRIFT_MIN * fps * 0.5, fStop - DECEL * fps);

  const endT = isFull
    ? interpolate(frame, [fTakeStart, fTakeStart + TAKE * fps], [0, 1], {...CLAMP, easing: TAKE_EASE})
    : 0;

  // —— 遮罩字:字号走确定性 shrink-to-fit;字族见文件头偏差 ⑥
  const titleSize = Math.round(fitFontSize(slots.title, {...TITLE_FIT, ...(landscape ? {fontSize: 330, maxWidthPx: width - 240} : {})}) * (tune?.scale ?? 1));
  const maskFamily = tune?.font && tune.font !== 'skin' ? TUNE_FONTS[tune.font] : TUNE_FONTS.archivo;
  const cx = CANVAS.w / 2 + (tune?.x ?? 0);
  const cy = (landscape ? height * .46 : WORD_CY) + (tune?.y ?? 0);
  const textProps = {
    x: cx,
    y: cy + titleSize * BASELINE_RATIO,
    textAnchor: 'middle' as const,
    fontFamily: maskFamily,
    fontSize: titleSize,
    // 900 不是伪造:archivo 栈两边(Archivo VF / 思源黑 VF)都有真 900 字重轴。
    // 落到单字重中文字族(得意黑/文楷/思源宋)时由 fontSynthesis:'none' 兜住,老实渲 400。
    fontWeight: 900,
    letterSpacing: TITLE_FIT.letterSpacingEm * titleSize,
    style: {fontSynthesis: 'none'} as React.CSSProperties,
  };

  // —— 放大 + 笔画膨胀(见「放大原点策略」)
  const maskS = Math.pow(MASK_SCALE, endT);
  const dilate = interpolate(endT, [DILATE_WINDOW[0], DILATE_WINDOW[1]], [0, DILATE_EM * titleSize], CLAMP);
  const cover = interpolate(endT, [0.5, 0.9], [0, 1], CLAMP);

  // —— 内容层:cover 铺满 + 取景余量,漂移轴取余量大的那一根
  const srcW = src ? Math.max(1, slots.imgW ?? CANVAS.w) : SKEL.w;
  const srcH = src ? Math.max(1, slots.imgH ?? CANVAS.h) : SKEL.h;
  const zoom = isFull ? interpolate(endT, [0, 1], [CONTENT_ZOOM, 1]) : CONTENT_ZOOM;
  const kBase = Math.max(CANVAS.w / srcW, CANVAS.h / srcH);
  const k = kBase * zoom;
  const slackX = Math.max(0, srcW * k - CANVAS.w);
  const slackY = Math.max(0, srcH * k - CANVAS.h);
  // 漂移距离按**漂移期**的取景(zoom 恒定)算一次,不随接管期的 zoom 回落而变
  const kDrift = kBase * CONTENT_ZOOM;
  const driftFrames = Math.max(1, fStop - fHold);
  const axisY = srcH * kDrift - CANVAS.h >= srcW * kDrift - CANVAS.w;
  const room = Math.max(0, (axisY ? srcH * kDrift - CANVAS.h : srcW * kDrift - CANVAS.w));
  const dist = Math.min(DRIFT_PXF * driftFrames, room);

  let off: number;
  if (isFull) {
    const uni = interpolate(frame, [fHold, fTakeStart], [0, 1], CLAMP);
    off = dist * (0.5 - uni) * (1 - endT); // 接管期归位到 0
  } else {
    const uni = interpolate(frame, [fHold, fDecel], [0, 1], CLAMP);
    const tail = outCubic(interpolate(frame, [fDecel, fStop], [0, 1], CLAMP));
    off = dist * (0.5 - 0.72 * uni - 0.28 * tail);
  }
  const tx = -slackX / 2 + (axisY ? 0 : off);
  const ty = -slackY / 2 + (axisY ? off : 0);

  const content = (
    <g transform={`translate(${tx} ${ty}) scale(${k})`}>
      {src ? (
        <image href={src} x={0} y={0} width={srcW} height={srcH} preserveAspectRatio="none" />
      ) : (
        <SkeletonPage uid={uid} />
      )}
    </g>
  );

  // —— caption:入场上浮,full 档在接管起点前一拍淡出,hold 档留场
  const capIn = interpolate(frame, [0.25 * fps, 0.65 * fps], [0, 1], {...CLAMP, easing: ENTER});
  const capOut = isFull
    ? interpolate(frame, [fTakeStart - 0.1 * fps, fTakeStart + 0.35 * fps], [1, 0], CLAMP)
    : 1;
  const capSize = slots.caption
    ? Math.round(fitFontSize(slots.caption, {fontSize: 40, maxWidthPx: landscape ? width - 240 : 820, shrinkFloorPx: 26}) * (tune?.scale ?? 1))
    : 0;

  return (
    <EditorScene style={{backgroundColor: P.bg, overflow: 'hidden'}}>
      <Backdrop />
      <svg
        width={CANVAS.w}
        height={CANVAS.h}
        viewBox={`0 0 ${CANVAS.w} ${CANVAS.h}`}
        style={{position: 'absolute', left: 0, top: 0}}
      >
        <defs>
          {/* 遮罩:放大 + 笔画膨胀写在这里,被遮内容一动不动(文件头偏差 ②) */}
          <mask id={`${uid}-m`} maskUnits="userSpaceOnUse" x={0} y={0} width={CANVAS.w} height={CANVAS.h}>
            <g transform={`translate(${cx} ${cy}) scale(${maskS}) translate(${-cx} ${-cy})`}>
              <EditableText as="text" part="title"
                {...textProps}
                fill="#ffffff"
                stroke="#ffffff"
                strokeWidth={dilate}
                strokeLinejoin="round"
                paintOrder="stroke"
              >
                {slots.title}
              </EditableText>
            </g>
          </mask>
          <g id={`${uid}-c`}>{content}</g>
        </defs>
        {/* 门里的世界 */}
        <g mask={`url(#${uid}-m)`}>
          <use href={`#${uid}-c`} />
        </g>
        {/* 门框:一条极细的轮廓,内容偏暗时字形仍读得出;接管一起手就撤 */}
        <EditableText as="text" part="title"
          {...textProps}
          fill="none"
          stroke={alpha(P.ink, 0.26)}
          strokeWidth={2.5}
          opacity={interpolate(endT, [0, 0.16], [1, 0], CLAMP)}
        >
          {slots.title}
        </EditableText>
        {/* 接管保险:同一内容变换的无遮罩全屏层,交叉淡入看不出接缝 */}
        {isFull && cover > 0 ? (
          <g opacity={cover}>
            <use href={`#${uid}-c`} />
          </g>
        ) : null}
      </svg>
      {slots.caption ? (
        <EditableText as="div" part="caption"
          style={{
            position: 'absolute',
            left: pad,
            right: pad,
            top: landscape ? height * .83 : 1660,
            textAlign: 'center',
            ...textStyle(T, 'label'),
            fontSize: capSize,
            color: alpha(P.ink, 0.78),
            opacity: capIn * capOut,
            transform: `translateY(${18 * (1 - capIn)}px)`,
          }}
        >
          {slots.caption}
        </EditableText>
      ) : null}
      <Foreground />
    </EditorScene>
  );
};

export const PresetTextMask: React.FC<PresetTextMaskProps> = (props) => (
  <TuneSkin tune={props.tune}>
    <Inner {...props} />
  </TuneSkin>
);
