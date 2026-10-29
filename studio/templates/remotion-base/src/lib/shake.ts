// 震屏:撞停那一下的重量感来源。
//
// **必须是确定性的**——任意一帧要能独立算出来(design-principles §9),
// 所以不能用 Math.random(),只能用从帧号哈希出来的伪随机。
// 这也不只是合规问题:不确定的震屏意味着重渲两次画面不同,抽帧自查就失去意义。
//
// 手感三条(踩过才写得出来):
//   1. **必须衰减**。等幅震动读作"画面在抖"(像渲染故障),衰减才读作"撞了一下"。
//   2. **别超过 12px @1080**。再大就成了地震,而撞停要的是重量不是灾难。
//   3. **只动位置,不动缩放**。缩放抖会让文字边缘糊,而且读起来像镜头没对上焦。

/** mulberry32:小、快、确定。种子相同必得同一串数。 */
const rand = (seed: number) => {
  let t = seed + 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export type ShakeOptions = {
  /** 撞击发生在第几帧。 */
  at: number;
  /** 衰减到几乎不动需要多少帧。12–18 最像一次撞击;>24 会读成手持晃动。 */
  dur?: number;
  /** 峰值位移(px @1080 基准)。8–12 是重击,4–6 是轻碰。 */
  amplitude?: number;
  /** 种子。同屏多个震源要给不同值,否则它们会同步抖,读起来像整块画布在动。 */
  seed?: number;
};

/** 返回该帧的位移 {x, y}(px)。撞击之前和衰减之后都是 0。 */
export const shakeAt = (frame: number, opts: ShakeOptions): {x: number; y: number} => {
  const {at, dur = 14, amplitude = 10, seed = 1} = opts;
  const t = frame - at;
  if (t < 0 || t >= dur) return {x: 0, y: 0};
  // 指数衰减而不是线性:撞击的能量是前几帧几乎全部释放掉的
  const decay = Math.exp(-3.2 * (t / dur));
  const a = amplitude * decay;
  return {
    x: (rand(seed * 7919 + frame * 31) * 2 - 1) * a,
    y: (rand(seed * 104729 + frame * 17) * 2 - 1) * a * 0.7, // 竖向给小一点,横向抖更像撞击
  };
};

/** 直接给 CSS transform 用。 */
export const shakeTransform = (frame: number, opts: ShakeOptions): string => {
  const {x, y} = shakeAt(frame, opts);
  return x || y ? `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)` : 'translate(0px, 0px)';
};
