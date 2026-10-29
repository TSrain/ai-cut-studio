import type {CaptionScript} from './CaptionLayer';

/**
 * 参考脚本 —— 从原片逐帧拆出来的 ground truth。
 *
 * 用途:把「渲染保真度」和「分句保真度」分开验证。
 * 这份脚本的分句、角色、动效、时间全部照抄原片,所以拿它渲出来的结果
 * 和原片的差异 = **纯渲染器的差异**,不掺分句算法的锅。
 * 第二步做自动分句时,再拿「自动脚本 vs 这份」量第二个差异。
 *
 * 时间来自 SRT + 1fps 抽帧,关键处用 10fps 微观窗口校到 ±0.05s。
 *
 * 两处**有意的偏离**(本次范围是「只要字幕层」):
 *   1. 5.95–7.75s 与 72.7–76.4s 原片是整屏排版图(内容/产品/服务 三角 + 箭头),
 *      这里退化成普通字幕行。整屏图属于「整屏排版镜」,不在字幕层范围内。
 *   2. 44.5s 原片左侧有竖排「IP/账号」侧标,同理省略。
 * 对比报告里这三处要单独标出来,不能算进渲染器的误差。
 */
export const REFERENCE_SCRIPT: CaptionScript = {
  durationSeconds: 89.5,
  blocks: [
    {in: 0.00, out: 1.06, lines: [{role: 'narration', in: 0.00, enter: 'cut', runs: [{t: '我马上就要开播了'}]}]},
    {in: 1.06, out: 2.00, lines: [{role: 'narration', in: 1.06, enter: 'whip', runs: [{t: '要讲一套'}]}]},
    {in: 2.00, out: 3.35, lines: [
      {role: 'narration', in: 2.00, enter: 'whip', runs: [{t: '很多人'}]},
      {role: 'narration', in: 2.00, enter: 'cut', runs: [{t: '都没听说过的'}, {t: '系统', c: 'amber', in: 2.80}]},
    ]},
    {in: 3.35, out: 4.90, lines: [{role: 'emphasis', in: 3.35, enter: 'pop', runs: [{t: '信任成交系统', c: 'amber'}]}]},
    {in: 4.90, out: 5.95, lines: [{role: 'narration', in: 4.90, enter: 'whip', runs: [{t: '它能让你的'}]}]},
    // ↓ 原片此处是整屏三角图,字幕层版本退化成两行
    {in: 5.95, out: 7.75, lines: [
      {role: 'term', in: 5.95, enter: 'pop', runs: [{t: '内容 · 产品 · 服务', c: 'amber'}]},
      {role: 'narration', in: 7.00, enter: 'cut', runs: [{t: '形成一个闭环'}]},
    ]},
    {in: 8.10, out: 9.55, lines: [
      {role: 'narration', in: 8.10, enter: 'whip', runs: [{t: '最后让'}, {t: '客户', c: 'amber'}]},
      {role: 'term', in: 9.00, enter: 'pop', runs: [{t: '主动找你买单', c: 'amber'}]},
    ]},
    {in: 9.55, out: 10.90, lines: [{role: 'narration', in: 9.55, enter: 'whip', runs: [{t: '你有没有想过'}]}]},
    {in: 10.90, out: 11.90, lines: [{role: 'narration', in: 10.90, enter: 'cut', runs: [{t: '为什么有的IP'}]}]},
    {in: 11.90, out: 12.90, lines: [{role: 'narration', in: 11.90, enter: 'cut', runs: [{t: '只要一发短视频'}]}]},
    {in: 12.90, out: 14.75, lines: [{role: 'narration', in: 12.90, enter: 'cut', runs: [{t: '客户就会主动上门问方案'}]}]},
    {in: 14.75, out: 17.30, lines: [{role: 'narration', in: 14.75, enter: 'whip', runs: [{t: '把你的整个成交流程'}]}]},
    {in: 17.30, out: 18.10, lines: [{role: 'narration', in: 17.30, enter: 'cut', runs: [{t: '接下来'}]}]},
    {in: 18.10, out: 19.35, lines: [{role: 'narration', in: 18.10, enter: 'cut', runs: [{t: '我说的这些理想状态'}]}]},
    // ── 19.35–19.55 清空 0.2 秒:段落标点 ──
    {in: 19.55, out: 21.70, lines: [
      {role: 'label', in: 19.55, enter: 'whip', runs: [{t: '第一个状态'}]},
      {role: 'term', in: 20.85, enter: 'pop', runs: [{t: '咨询式成交', c: 'amber'}]},
    ]},
    {in: 21.70, out: 23.95, lines: [{role: 'narration', in: 21.70, enter: 'whip', runs: [{t: '从此不再过来听'}, {t: '推销', c: 'amber'}]}]},
    {in: 23.95, out: 25.00, lines: [{role: 'narration', in: 23.95, enter: 'cut', runs: [{t: '而是来向你'}, {t: '求解', c: 'amber'}]}]},
    {in: 25.00, out: 25.90, lines: [{role: 'narration', in: 25.00, enter: 'cut', runs: [{t: '你拥有'}]}]},
    {in: 25.90, out: 27.15, lines: [{role: 'emphasis', in: 25.90, enter: 'pop', runs: [{t: '绝对的主导权', c: 'amber'}]}]},
    {in: 27.30, out: 29.45, lines: [
      {role: 'label', in: 27.30, enter: 'whip', runs: [{t: '第二个状态'}]},
      {role: 'term', in: 28.90, enter: 'pop', runs: [{t: '阶梯式成交', c: 'amber'}]},
    ]},
    {in: 29.45, out: 31.40, lines: [{role: 'narration', in: 29.45, enter: 'cut', runs: [{t: '你有不同价位的'}]}]},
    {in: 31.40, out: 32.90, lines: [{role: 'narration', in: 31.40, enter: 'cut', runs: [{t: '就像一辆公交车'}]}]},
    {in: 32.90, out: 34.20, lines: [{role: 'narration', in: 32.90, enter: 'cut', runs: [{t: '总能让客户先上车'}]}]},
    // ── 34.20–34.45 清空 ──
    {in: 34.45, out: 36.75, lines: [
      {role: 'label', in: 34.45, enter: 'whip', runs: [{t: '第三个状态'}]},
      {role: 'term', in: 35.90, enter: 'pop', runs: [{t: '内容及销售', c: 'amber'}]},
    ]},
    {in: 36.75, out: 38.70, lines: [
      {role: 'narration', in: 36.75, enter: 'whip', runs: [{t: '你真正有效的'}], center: 0.44},
      {role: 'term', in: 37.90, enter: 'pop', runs: [{t: '销售动作', c: 'amber'}], center: 0.58},
    ]},
    {in: 38.70, out: 39.90, lines: [{role: 'narration', in: 38.70, enter: 'cut', runs: [{t: '会在客户联系你之前'}]}]},
    {in: 39.90, out: 40.90, lines: [{role: 'narration', in: 39.90, enter: 'cut', runs: [{t: '就已经完成了'}]}]},
    {in: 40.90, out: 42.10, lines: [{role: 'number', in: 40.90, enter: 'pop', runs: [{t: '80%', c: 'amber'}]}]},
    {in: 42.10, out: 44.25, lines: [
      {role: 'label', in: 42.10, enter: 'whip', runs: [{t: '第四个状态'}]},
      {role: 'term', in: 43.40, enter: 'pop', runs: [{t: '口碑自传播', c: 'amber'}]},
    ]},
    // ── 44.25–44.50 清空 ──(原片此处还有竖排「IP/账号」侧标,字幕层版本省略)
    {in: 44.90, out: 46.90, lines: [
      {role: 'narration', in: 44.90, enter: 'whip', runs: [{t: '成为你'}], center: 0.44},
      {role: 'term', in: 45.90, enter: 'pop', runs: [{t: '最好的销售员', c: 'amber'}], center: 0.57},
    ]},
    {in: 46.90, out: 48.00, lines: [{role: 'narration', in: 46.90, enter: 'cut', runs: [{t: '而且是'}, {t: '免费', c: 'amber'}, {t: '的'}]}]},
    {in: 48.00, out: 50.40, lines: [
      {role: 'label', in: 48.00, enter: 'whip', runs: [{t: '第五个状态'}]},
      {role: 'term', in: 49.50, enter: 'pop', runs: [{t: '高价值成交', c: 'amber'}]},
    ]},
    // 连续句子换行 → 两行都居中(不走对角错位)
    {in: 50.40, out: 52.70, lines: [
      {role: 'narration', in: 50.40, enter: 'whip', runs: [{t: '因为'}, {t: '你的账号', c: 'amber'}], center: 0.50},
      {role: 'narration', in: 51.30, enter: 'cut', runs: [{t: '有很多'}, {t: '短视频铺垫', c: 'amber'}], center: 0.50},
    ]},
    {in: 52.70, out: 56.60, lines: [
      {role: 'narration', in: 52.70, enter: 'whip', runs: [{t: '会更容易成交'}], center: 0.44},
      {role: 'term', in: 54.60, enter: 'pop', runs: [{t: '高客单  高利润', c: 'amber'}], center: 0.52},
      {role: 'narration', in: 55.80, enter: 'cut', runs: [{t: '服务和产品'}], center: 0.60},
    ]},
    {in: 56.60, out: 59.30, lines: [
      {role: 'label', in: 56.60, enter: 'whip', runs: [{t: '第六个状态'}]},
      {role: 'term', in: 57.90, enter: 'pop', runs: [{t: '关系式成交', c: 'amber'}]},
    ]},
    // 全片唯一一次重残影:实测退场后掉到 48% 平住 1.3 秒再瞬间归零。
    // 其余转场都是干净切走——第一版把这一处当通用规则,结果留痕满屏。
    {in: 59.30, out: 61.70, ghost: 0.48, lines: [
      {role: 'narration', in: 59.30, enter: 'whip', runs: [{t: '你和客户的关系'}], center: 0.44},
      {role: 'narration', in: 60.70, enter: 'cut', runs: [{t: '也从此可以超越'}], center: 0.58},
    ]},
    {in: 61.70, out: 62.90, lines: [{role: 'emphasis', in: 61.70, enter: 'write', runs: [{t: '单纯的买卖关系', c: 'amber'}]}]},
    {in: 62.90, out: 63.90, lines: [{role: 'narration', in: 62.90, enter: 'cut', runs: [{t: '复购和转介绍'}]}]},
    {in: 63.90, out: 65.70, lines: [{role: 'narration', in: 63.90, enter: 'cut', runs: [{t: '当然就会源源不断'}]}]},
    {in: 65.70, out: 67.00, lines: [{role: 'narration', in: 65.70, enter: 'whip', runs: [{t: '想要实现这一切'}]}]},
    {in: 67.00, out: 68.00, lines: [{role: 'narration', in: 67.00, enter: 'cut', runs: [{t: '其实你需要的'}]}]},
    {in: 68.00, out: 71.40, lines: [
      {role: 'narration', in: 68.00, enter: 'whip', runs: [{t: '是以'}, {t: 'IP', c: 'amber', in: 68.80}, {t: '为核心的', in: 68.80}], center: 0.44},
      {role: 'term', in: 69.90, enter: 'pop', runs: [{t: '信任成交系统', c: 'amber'}], center: 0.57},
    ]},
    {in: 71.40, out: 72.70, lines: [{role: 'narration', in: 71.40, enter: 'cut', runs: [{t: '在这个系统里面'}]}]},
    // ↓ 原片此处是 3.8 秒纯黑排版卡,字幕层版本退化成两行
    {in: 72.70, out: 76.40, lines: [
      {role: 'term', in: 72.70, enter: 'pop', runs: [{t: '内容 · 产品 · 服务', c: 'amber'}]},
      {role: 'narration', in: 74.90, enter: 'cut', runs: [{t: '形成一个完美的闭环'}]},
    ]},
    {in: 76.40, out: 78.00, lines: [{role: 'narration', in: 76.40, enter: 'whip', runs: [{t: '我马上就要开播了'}]}]},
    {in: 78.00, out: 80.20, lines: [{role: 'narration', in: 78.00, enter: 'cut', runs: [{t: '就要带大家来画一下'}]}]},
    {in: 80.20, out: 82.30, lines: [{role: 'narration', in: 80.20, enter: 'cut', runs: [{t: '信任成交系统的流程图'}]}]},
    {in: 82.30, out: 84.50, lines: [
      {role: 'narration', in: 82.30, enter: 'whip', runs: [{t: '我会把'}, {t: '每个环节', c: 'amber'}], center: 0.44},
      {role: 'narration', in: 83.70, enter: 'cut', runs: [{t: '都给你讲透'}], center: 0.60},
    ]},
    {in: 84.50, out: 85.60, lines: [{role: 'narration', in: 84.50, enter: 'whip', runs: [{t: '如果你真的'}]}]},
    {in: 85.60, out: 86.90, lines: [{role: 'narration', in: 85.60, enter: 'cut', runs: [{t: '想让自己的成交'}]}]},
    {in: 86.90, out: 87.50, lines: [{role: 'narration', in: 86.90, enter: 'cut', runs: [{t: '变得丝滑'}]}]},
    {in: 87.50, out: 89.30, lines: [{role: 'narration', in: 87.50, enter: 'cut', runs: [{t: '我们'}, {t: '直播间', c: 'amber'}, {t: '不见不散'}]}]},
  ],
};
