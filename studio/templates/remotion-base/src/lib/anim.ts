import {Easing, interpolate} from 'remotion';

// 三条标准缓动:入场用 ENTER,出场用 EXIT,同屏移动用 MOVE。
// 位移永不使用线性缓动;线性只允许出现在匀速循环和进度条上。
export const ENTER = Easing.bezier(0.16, 1, 0.3, 1);
export const EXIT = Easing.bezier(0.7, 0, 0.84, 0);
export const MOVE = Easing.bezier(0.65, 0, 0.35, 1);

// frame → [0,1] 进度,delay/dur 单位为帧,两端钳制
export const progress = (
  frame: number,
  delay: number,
  dur: number,
  easing: (t: number) => number = ENTER,
) =>
  interpolate(frame, [delay, delay + dur], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing,
  });

// 列表交错入场:30fps 下 gap=2 帧 ≈ 67ms,落在 40–80ms 推荐区间
export const staggerDelay = (index: number, base: number, gap = 2) =>
  base + index * gap;

/**
 * CALM —— 大元素落位的缓动。
 *
 * ENTER(0.16,1,0.3,1)前 30% 就跑完 80% 的距离,很"精神"。放在一句 80px 的大标题上
 * 就变成"甩"进来,而这一版的观感要的是稳。CALM 把冲刺摊平,末段还剩一点余量,
 * 读作"停稳"而不是"急刹"。小元素(标签、序号)照旧用 ENTER,它们本来就该轻快。
 *
 * 2026-08-15 用户原话「动画过于着急」。
 */
export const CALM = Easing.bezier(0.22, 0.65, 0.24, 1);

/**
 * 一拍的默认长度(秒)。
 *
 * 各 preset 的入场时长过去各写各的(0.22s / 0.5s …),于是"急"这件事没有一个
 * 能一起调的旋钮。BEAT 是那个旋钮:大元素落位 = BEAT,小元素 = BEAT × 0.6。
 * 30fps 下 0.9s = 27 帧 —— 慢到能看清它是怎么停下来的。
 */
export const BEAT = 0.9;
