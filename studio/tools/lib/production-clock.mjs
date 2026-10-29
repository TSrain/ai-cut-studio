// tools/lib/production-clock.mjs — 活跃 60 分钟生产时钟的纯函数层
//
// 规格 §3:60 分钟是**活跃**生产计时——从读取需求开始;展示三个 Styleframe 后
// 暂停;用户选中后继续。等用户选 Styleframe 的时间**不计入**活跃时长,因为那段
// 时间系统没在干活,把它算进去就等于用户回消息慢一点就判生产失败。
//
// 活跃时长只用于预算与进度提示，不改变批准范围、表达或验收结果。
//
// **本文件里不许出现 `Date.now()`**——时间一律由调用方从参数传入。墙钟只属于
// CLI(tools/production-clock.mjs),纯函数必须可复现,否则测试和事后复盘都靠不住。

const MINUTE = 60_000;

/** 合法事件类型。checkpoint 只是打点,不改变计时状态。 */
export const EVENT_TYPES = ['start', 'pause-selection', 'resume-selection', 'checkpoint', 'finish'];

/**
 * 校验事件序列的顺序合法性。返回 null 表示合法,否则返回错误信息字符串。
 *
 * 规则:
 *   - 第一个事件必须是 start;start 只能出现一次;
 *   - pause-selection 必须在运行中(已 start、未 pause、未 finish);
 *   - resume-selection 必须在暂停中;
 *   - checkpoint / finish 必须已 start 且未 finish;
 *   - finish 只能出现一次,finish 之后不能再有任何事件。
 *
 * 时间戳必须单调不减——事件是追加写入的,倒流说明日志被人手改过。
 */
export const validateEventOrder = (events) => {
  if (!Array.isArray(events)) return 'events 必须是数组';

  let started = false;
  let paused = false;
  let finished = false;
  let lastAt = -Infinity;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (!event || typeof event !== 'object') return `事件 #${i} 不是对象`;
    if (!EVENT_TYPES.includes(event.type)) {
      return `事件 #${i} 的 type "${event.type}" 不合法(允许:${EVENT_TYPES.join(' / ')})`;
    }
    if (!Number.isFinite(event.at)) return `事件 #${i}(${event.type})缺少数值 at`;
    if (event.at < lastAt) {
      return `事件 #${i}(${event.type})的时间戳 ${event.at} 早于前一个事件 ${lastAt},日志时间倒流`;
    }
    lastAt = event.at;

    if (finished) return `finish 之后不允许再有事件,但 #${i} 是 ${event.type}`;

    switch (event.type) {
      case 'start':
        if (started) return `重复 start(事件 #${i}),一个项目只能开始一次`;
        started = true;
        break;
      case 'pause-selection':
        if (!started) return `未 start 就 pause-selection(事件 #${i})`;
        if (paused) return `已经处于暂停中,不能再次 pause-selection(事件 #${i})`;
        paused = true;
        break;
      case 'resume-selection':
        if (!started) return `未 start 就 resume-selection(事件 #${i})`;
        if (!paused) return `当前不在暂停中,resume-selection 无对应的 pause-selection(事件 #${i})`;
        paused = false;
        break;
      case 'checkpoint':
        if (!started) return `未 start 就 checkpoint(事件 #${i})`;
        break;
      case 'finish':
        if (!started) return `未 start 就 finish(事件 #${i})`;
        finished = true;
        break;
    }
  }
  return null;
};

/**
 * 累加活跃毫秒数。
 *
 * 语义:`start` 与 `resume-selection` 之后的区间计入;`pause-selection` 之后的
 * 区间**不计入**;遇到 `finish` 就停在那一刻(之后的 now 不再增长)。
 * 未 finish 且当前处于暂停中时,活跃时长冻结在最后一次 pause 的时刻。
 *
 * @param {{type: string, at: number}[]} events 追加序的事件表
 * @param {number} now 查询时刻(毫秒)。必须由调用方传入,函数内部绝不取墙钟。
 * @returns {number} 活跃毫秒数
 */
export const activeMilliseconds = (events, now) => {
  const problem = validateEventOrder(events);
  if (problem) throw new Error(`事件顺序非法:${problem}`);
  if (!Number.isFinite(now)) throw new TypeError('now 必须是数值毫秒时间戳');

  let active = 0;
  let runningSince = null; // 非 null 表示正在计时,值为该区间的起点

  for (const event of events) {
    if (event.type === 'start' || event.type === 'resume-selection') {
      if (runningSince === null) runningSince = event.at;
    } else if (event.type === 'pause-selection' || event.type === 'finish') {
      if (runningSince !== null) {
        active += event.at - runningSince;
        runningSince = null;
      }
      if (event.type === 'finish') return active; // finish 之后一律不再增长
    }
    // checkpoint 不改变计时状态
  }

  if (runningSince !== null) {
    // 仍在跑:补上从最后一个起点到 now 的这一段。now 早于起点时不倒扣。
    active += Math.max(0, now - runningSince);
  }
  return active;
};

/** 活跃时长 → 预算提示。函数名保留兼容，不再产生冻结或失败档位。 */
export const productionGate = (ms) => {
  if (ms >= 60 * MINUTE) return 'budget-advisory';
  if (ms >= 15 * MINUTE) return 'progress-advisory';
  return 'on-track';
};

export const GATE_ACTIONS = {
  'on-track': '按批准方案推进；计时用于记录实际成本。',
  'progress-advisory': '复核进度、瓶颈与剩余成本；按表达需要继续制作和修复。',
  'budget-advisory': '已超过参考预算，记录原因与新的预计成本；验收仍按真实效果和技术检查判断。',
};

/** 检查点(活跃分钟)。规格 §12.2 阶段边界 + §12.3 熔断点。 */
export const CHECKPOINT_MINUTES = [6, 15, 20, 30, 40, 45, 50, 56, 60];

/** 活跃毫秒 → 已越过的最后一个检查点分钟数(还没到 6 分钟时返回 0)。 */
export const lastCheckpoint = (ms) => {
  let last = 0;
  for (const minute of CHECKPOINT_MINUTES) {
    if (ms >= minute * MINUTE) last = minute;
  }
  return last;
};

export const activeMinutes = (ms) => ms / MINUTE;
