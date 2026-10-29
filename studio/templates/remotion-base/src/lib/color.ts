// 配色引擎:在 OKLCH 感知均匀色彩空间里构造配色,输出 sRGB hex。
// 方法论见 docs/color.md。这里只放"怎么算",不放"为什么"。
//
// 为什么不用 hex 手写颜色:手写 hex 的明度不可控——#3987e5 和 #d55181 看着"一样深"
// 其实差 12 个感知明度点,拼在一起就是那种说不出哪儿不对的廉价感。
// OKLCH 的 L 是感知明度:L 相同 = 看着一样深,不论什么色相。
// 为什么不直接在 CSS 里写 oklch():three.js / canvas / ffmpeg 都不认,统一在这里算成 hex,全链路一种格式。

/* ---------- OKLCH → sRGB ---------- */

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const gamma = (c: number) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

// 返回线性到 sRGB 的三通道(未钳制,可能越界——越界即超出色域)
const oklchToRgbRaw = (L: number, C: number, H: number) => {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return [
    gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    gamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
};

const inGamut = (rgb: number[]) => rgb.every((c) => c >= -0.001 && c <= 1.001);

/**
 * OKLCH → '#rrggbb'。超出 sRGB 色域时**保持 L 和 H 不变、二分降 C**,
 * 而不是让浏览器去裁通道——裁通道会同时改色相和明度,一排颜色就不齐了。
 *
 * L 0–1 感知明度 / C 0–0.37 彩度 / H 0–360 色相。
 */
export const oklch = (L: number, C: number, H: number): string => {
  let lo = 0;
  let hi = C;
  let rgb = oklchToRgbRaw(L, C, H);
  if (!inGamut(rgb)) {
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToRgbRaw(L, mid, H))) lo = mid;
      else hi = mid;
    }
    rgb = oklchToRgbRaw(L, lo, H);
  }
  return (
    '#' +
    rgb
      .map((c) =>
        Math.round(clamp01(c) * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
};

/* ---------- 对比度校验 ---------- */

const srgbToLin = (c: number) =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

const luminance = (hex: string) => {
  const n = parseInt(hex.replace('#', ''), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(
    (v) => srgbToLin(v / 255),
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG 对比度 1–21。正文 ≥4.5,大字(≥这套令牌的 h2 及以上)≥3。 */
export const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/* ---------- 场景配色构造 ---------- */

export type SceneMode = 'dark' | 'light';

export type ScenePalette = {
  /** 画面底色。带色相的中性,不是纯黑/纯白 */
  bg: string;
  /** 比底色抬/压一档:卡片、面板、分组块 */
  surface: string;
  /** 再抬一档:浮起的元素、hover 态 */
  surfaceRaised: string;
  /** 发丝级分隔线 */
  line: string;
  /** 主文字 */
  ink: string;
  /** 次级文字:说明、副标题 */
  inkSecondary: string;
  /** 弱化文字:轴标签、注释、肌理性文本 */
  inkMuted: string;
  /** 强调色。全画面只有一个,占面积 ≤10% */
  accent: string;
  /** 强调色的低彩度版:描边、底纹、大面积铺(不用于文字) */
  accentSoft: string;
  /** 强调色铺底时用的可读文字色 */
  onAccent: string;
  mode: SceneMode;
  hue: number;
  accentHue: number;
};

/**
 * 造一套场景配色。**这是新项目定色的默认入口**,不要现场手写 hex。
 *
 * 核心是三件事(docs/color.md §2):
 * 1. 中性色带 4–10 点彩度、色相跟着强调色走 → 画面像"一整块调过的光",不是灰底上贴了个色块
 * 2. 明度阶梯在 OKLCH 里等差 → 层级永远拉得开,不会出现"两层看着一样深"
 * 3. 强调色只有一个色相 → 剩下的对比全靠明度做
 *
 * @param accentHue  强调色色相 0–360(蓝 250 / 青 195 / 绿 145 / 黄 85 / 橙 55 / 红 25 / 品红 350 / 紫 300)
 * @param mode       'dark' | 'light'
 * @param opts.neutralHue  中性色的染色色相,默认跟随 accentHue(想要中性更冷/更暖时才单独给)
 * @param opts.neutralChroma 中性色染色强度,默认 0.008。>0.02 会让"灰"读成"有颜色",除非风格卡要求
 * @param opts.accentChroma  强调色彩度,默认 0.16。深色画面上 0.14–0.19 最稳;>0.22 在视频压缩后会糊成色块
 */
export const scenePalette = (
  accentHue: number,
  mode: SceneMode = 'dark',
  opts: {
    neutralHue?: number;
    neutralChroma?: number;
    accentChroma?: number;
  } = {},
): ScenePalette => {
  const nH = opts.neutralHue ?? accentHue;
  const nC = opts.neutralChroma ?? 0.008;
  const aC = opts.accentChroma ?? 0.16;

  if (mode === 'dark') {
    return {
      bg: oklch(0.17, nC, nH),
      surface: oklch(0.22, nC * 1.2, nH),
      surfaceRaised: oklch(0.27, nC * 1.4, nH),
      line: oklch(0.33, nC * 1.6, nH),
      ink: oklch(0.97, nC * 0.6, nH),
      inkSecondary: oklch(0.78, nC * 1.5, nH),
      inkMuted: oklch(0.6, nC * 2, nH),
      accent: oklch(0.72, aC, accentHue),
      accentSoft: oklch(0.32, aC * 0.45, accentHue),
      onAccent: oklch(0.18, nC, nH),
      mode,
      hue: nH,
      accentHue,
    };
  }
  return {
    bg: oklch(0.98, nC * 0.7, nH),
    surface: oklch(0.95, nC, nH),
    surfaceRaised: oklch(1.0, 0, nH),
    line: oklch(0.88, nC * 1.6, nH),
    ink: oklch(0.22, nC * 1.2, nH),
    inkSecondary: oklch(0.44, nC * 1.6, nH),
    // 0.55 不是随手取的:0.62 时对 bg 只有 3.44 对比度,过不了正文的 4.5 线。
    // 想要"更弱的字"要缩字号,不能继续降明度(docs/color.md §6)
    inkMuted: oklch(0.55, nC * 2, nH),
    accent: oklch(0.55, aC, accentHue),
    accentSoft: oklch(0.9, aC * 0.35, accentHue),
    onAccent: oklch(0.99, 0, nH),
    mode,
    hue: nH,
    accentHue,
  };
};

/**
 * 单色相明度阶梯:同一个色相拉出 n 档等差明度,用于"同一类东西的不同状态/强弱"。
 * 典型用途:一组同类卡片按重要性分三档、热力图、分档着色。
 * **不要**拿它当分类系列色用——分类要的是色相差异,见 theme.seriesDark。
 */
export const ramp = (
  hue: number,
  steps: number,
  opts: {from?: number; to?: number; chroma?: number} = {},
) => {
  const from = opts.from ?? 0.25;
  const to = opts.to ?? 0.9;
  const c = opts.chroma ?? 0.09;
  return Array.from({length: steps}, (_, i) =>
    oklch(from + ((to - from) * i) / Math.max(1, steps - 1), c, hue),
  );
};

/** 同一颜色调明度:做 hover / 压暗 / 提亮,比 opacity 干净(不会透出底下的东西) */
export const shift = (
  L: number,
  C: number,
  H: number,
  dL: number,
) => oklch(clamp01(L + dL), C, H);

/** 十六进制 + alpha → rgba() 字符串。用于必须半透明的场合(叠在未知底片上的 chip) */
export const alpha = (hex: string, a: number) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};
