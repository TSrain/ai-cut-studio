import React, {useEffect, useMemo, useState} from 'react';
import {
  cancelRender,
  continueRender,
  delayRender,
  Sequence,
  staticFile,
  useVideoConfig,
} from 'remotion';
import {Lottie, type LottieAnimationData} from '@remotion/lottie';

// 外来 Lottie 动效的统一入口:重着色成本项目的颜色令牌 + 把原生时长重映射到本镜需要的长度。
//
// 存在理由:插片里"图标微动"这类东西手搓不划算(一个勾的绘制+回弹要调十几个关键帧),
// 但直接播下载来的 Lottie 会带进两个问题,这个组件就是来解决这两个的:
//
// 1. **外来配色污染画面**。Lottie 里的颜色是烘死在 JSON 里的(默认纯黑),
//    直接播等于在你的合同调色板上贴了一块离板颜色,frame-audit 的"离板颜色"项会直接判失败。
//    → recolor() 把所有描边/填充改写成传进来的令牌色。
//
// 2. **原生时长跟镜头时长没有任何关系**。useAnimations 这批是给鼠标 hover 做的微交互,
//    `discard` 只有 5 帧(0.17 秒)、`schedule` 8 帧、`like/rate/save/locked` 10 帧——
//    裸播就是一闪而过,观众根本没看见。另外 `up`/`down` 是 60fps 而其余是 30fps。
//    → 一律用 playbackRate = 原生总帧数 / 目标帧数 重映射。**注意分母不是合成帧率**:
//      @remotion/lottie 内部是拿 `compFrame * playbackRate` 直接当 Lottie 帧号用的
//      (见 dist 里的 getLottieFrame),所以按 Lottie 自己的 fr 换算才对,
//      写成除以 fps 会让 60fps 的那两个正好慢一半。
//
// 不循环时 @remotion/lottie 会 `Math.min(frame, total-1)` 钳在末帧,
// 所以图标播完会**停住而不是消失**,插片里不用额外补 hold。
//
// 用法: <LottieClip name="risk" size={140} color={p.ink} durationInFrames={45} />

/** public/lottie/ 下的图标,名字是语义不是上游文件名。新增文件后在 ICON_META 里补一项。 */
export type LottieIconName =
  | 'confirm'
  | 'exclude'
  | 'discard'
  | 'approve'
  | 'risk'
  | 'alert'
  | 'question'
  | 'waiting'
  | 'loop'
  | 'signal'
  | 'tune'
  | 'up'
  | 'down'
  | 'next'
  | 'search'
  | 'explore'
  | 'reveal'
  | 'save'
  | 'spread'
  | 'schedule'
  | 'locked'
  | 'revise'
  | 'rate'
  | 'like';

type IconMeta = {
  /** 这个图标"播完停住"时表达什么。挑元素按这句话挑,不是按图形挑 */
  means: string;
  /**
   * 默认倒放。**这是这批素材最大的坑**:它们原本是 UI 上的 toggle 微交互
   * (铃铛↔静音、眼睛↔闭眼、开锁↔上锁、放大镜↔叉),动画是"从 A 变到 B",
   * 而 @remotion/lottie 不循环时钳在末帧 → 画面最后停在 B。
   * 对这几个来说 B 恰好是语义的**反面**:`locked` 正放播完是开锁、`reveal` 播完是闭眼、
   * `alert` 播完是静音。倒放才停在正确的状态上。
   * 踩过一次才发现,因为静态预览图看的是首帧,首帧是对的。
   */
  reverse?: boolean;
  /**
   * 默认循环。两种情况需要:
   * ① 状态型(等待/波动)本来就没有终点;
   * ② **穿越型**——箭头画进来再擦出去,末帧本身是空的。不循环就会钳在空画面上,
   *    格子里什么都没有(`up`/`down`/`signal` 第一版就是这么变成空格子的)。
   */
  loop?: boolean;
  /**
   * 描边粗细补偿倍数,默认 1。
   * 这批素材虽然线宽都写着 2,但图形在 32 画布里画的大小不一样,
   * 于是并排摆放时 `risk`/`question`/`loop` 明显比 `confirm` 细、看起来发灰,
   * 像两套图标混用。这个倍数把它们拉齐——外来素材不统一是常态,在组件层补,不要在镜头里补。
   */
  weight?: number;
};

/**
 * 每个图标的语义与默认播放方式。**默认值就是对的**,`<LottieClip name="locked" />`
 * 直接用即可;需要反过来表达(比如要"解锁"而不是"上锁")时再显式传 reverse。
 */
export const ICON_META: Record<LottieIconName, IconMeta> = {
  // —— 判断与结论 ——
  confirm: {means: '通过 / 结论落定'},
  exclude: {means: '排除 / 否掉'}, // 加号转叉,正放末帧是叉 ✓
  discard: {means: '淘汰 / 弃用'},
  approve: {means: '认可 / 推荐'},
  // —— 风险与提示 ——
  risk: {means: '风险 / 代价', weight: 1.4},
  alert: {means: '提醒 / 推送', reverse: true}, // 正放末帧是"静音铃铛"
  question: {means: '疑问 / 待解', weight: 1.4},
  // —— 过程与状态 ——
  waiting: {means: '等待 / 停滞', loop: true},
  loop: {means: '循环 / 持续 / 复利', loop: true, weight: 1.4},
  signal: {means: '波动 / 活跃度', loop: true}, // 穿越型:画完会擦掉,必须循环
  tune: {means: '调参 / 配置'},
  // —— 方向与趋势 ——
  // up / down 是 60fps 的穿越型动画(箭头飞过后消失),必须循环,否则钳在空帧
  up: {means: '上升 / 增长', loop: true},
  down: {means: '下降 / 衰减', loop: true},
  next: {means: '下一步 / 演进'},
  // —— 检索与发现 ——
  search: {means: '检索 / 找', reverse: true}, // 正放末帧是叉,会和 exclude 撞脸
  explore: {means: '探索 / 方向'},
  reveal: {means: '可见 / 揭示', reverse: true}, // 正放末帧是闭眼
  // —— 留存与分发 ——
  save: {means: '收藏 / 留存'},
  spread: {means: '扩散 / 传播'},
  schedule: {means: '时间 / 周期'},
  locked: {means: '锁定 / 私密', reverse: true}, // 正放末帧是开锁
  revise: {means: '修改 / 迭代'},
  // —— 评价 ——
  rate: {means: '评分 / 质量'},
  like: {means: '喜欢 / 偏好'},
};

/** '#rrggbb' → Lottie 的 [r,g,b,a],通道 0–1。Lottie 不认 hex。 */
const hexToLottieColor = (hex: string): [number, number, number, number] => {
  const h = hex.replace('#', '').trim();
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  const n = parseInt(full.slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
};

/**
 * 深拷贝并改写 Lottie JSON 里的所有颜色。
 *
 * Lottie 的形状项里,`ty:'st'` 是描边、`ty:'fl'` 是填充,颜色都在 `.c.k`。
 * 这批图标全是静态色(`.c.a === 0`,k 是一个 [r,g,b,a]);
 * 万一遇到带关键帧的颜色(`.c.a === 1`,k 是一串关键帧对象),这里跳过不动——
 * 与其改错不如让它保持原样、在样品册里被眼睛抓到。
 */
const recolor = (
  data: LottieAnimationData,
  strokeColor: string,
  fillColor: string,
  strokeWeight: number,
): LottieAnimationData => {
  const stroke = hexToLottieColor(strokeColor);
  const fill = hexToLottieColor(fillColor);

  // 描边宽度既可能是常数(`{a:0, k:2}`),也可能带关键帧(`{a:1, k:[{s:[1]},{s:[2]}]}`,
  // `question` 的问号末尾就有一次加粗)。两种都要乘,只处理常数会让带动画的那条漏掉。
  const scaleWidth = (w: Record<string, unknown>): Record<string, unknown> => {
    if (strokeWeight === 1) return w;
    if (typeof w.k === 'number') return {...w, k: w.k * strokeWeight};
    if (Array.isArray(w.k)) {
      return {
        ...w,
        k: w.k.map((kf) => {
          const f = kf as Record<string, unknown>;
          return Array.isArray(f.s)
            ? {...f, s: (f.s as number[]).map((v) => v * strokeWeight)}
            : f;
        }),
      };
    }
    return w;
  };

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node === null || typeof node !== 'object') return node;

    const obj = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) out[key] = walk(obj[key]);

    if ((out.ty === 'st' || out.ty === 'fl') && out.c && typeof out.c === 'object') {
      const c = out.c as Record<string, unknown>;
      if (c.a === 0 && Array.isArray(c.k)) {
        out.c = {...c, k: out.ty === 'st' ? stroke : fill};
      }
    }
    if (out.ty === 'st' && out.w && typeof out.w === 'object') {
      out.w = scaleWidth(out.w as Record<string, unknown>);
    }
    return out;
  };

  return walk(data) as LottieAnimationData;
};

export const LottieClip: React.FC<{
  name: LottieIconName;
  /** 显示边长 px。原生 32×32 是矢量,放大不糊。插片里 100–200 最稳 */
  size: number;
  /** 描边色。传令牌(p.ink / p.accent),不要手写 hex */
  color: string;
  /**
   * 填充色。只有 confirm / approve / save / rate / like 这几个有填充区域;
   * 省略时跟随 color。想做"描边中性 + 填充强调"的双色,就单独给这个。
   */
  fillColor?: string;
  /**
   * 把原生动画重映射到这么多帧。**默认 45(1.5 秒)**,不是原生时长——
   * 原生时长对插片没有参考价值(见文件头第 2 条)。
   */
  durationInFrames?: number;
  /** 循环播放。省略时用 ICON_META 的默认值(状态型的才循环) */
  loop?: boolean;
  /** 倒放。省略时用 ICON_META 的默认值——toggle 型图标默认已经是对的,别乱覆盖 */
  reverse?: boolean;
  /** 描边粗细倍数。省略时用 ICON_META 的补偿值,已经拉齐过,一般不用传 */
  weight?: number;
  /** 入场延迟帧数,用于和文字错峰 */
  delay?: number;
  style?: React.CSSProperties;
}> = ({
  name,
  size,
  color,
  fillColor,
  durationInFrames = 45,
  loop,
  reverse,
  weight,
  delay = 0,
  style,
}) => {
  const meta = ICON_META[name];
  const effectiveLoop = loop ?? meta.loop ?? false;
  const effectiveReverse = reverse ?? meta.reverse ?? false;
  const {durationInFrames: compDuration} = useVideoConfig();
  const [raw, setRaw] = useState<LottieAnimationData | null>(null);
  const [handle] = useState(() => delayRender(`lottie:${name}`));

  useEffect(() => {
    let alive = true;
    fetch(staticFile(`lottie/${name}.json`))
      .then((res) => {
        if (!res.ok) throw new Error(`public/lottie/${name}.json 取不到 (${res.status})`);
        return res.json();
      })
      .then((json: LottieAnimationData) => {
        if (!alive) return;
        setRaw(json);
        continueRender(handle);
      })
      .catch((err) => cancelRender(err));
    return () => {
      alive = false;
    };
  }, [handle, name]);

  const effectiveWeight = weight ?? meta.weight ?? 1;
  const data = useMemo(
    () => (raw ? recolor(raw, color, fillColor ?? color, effectiveWeight) : null),
    [raw, color, fillColor, effectiveWeight],
  );

  // 原生总帧数用 op-ip,按 Lottie 自己的帧率计;playbackRate 的分母是目标帧数,不是 fps。
  const playbackRate = useMemo(() => {
    if (!raw) return 1;
    const total = (raw.op as number) - ((raw.ip as number) ?? 0);
    if (!total || durationInFrames <= 0) return 1;
    return total / durationInFrames;
  }, [raw, durationInFrames]);

  if (!data) return null;

  return (
    <Sequence from={delay} durationInFrames={Math.max(1, compDuration - delay)} layout="none">
      <Lottie
        animationData={data}
        loop={effectiveLoop}
        direction={effectiveReverse ? 'backward' : 'forward'}
        playbackRate={playbackRate}
        style={{width: size, height: size, ...style}}
      />
    </Sequence>
  );
};
