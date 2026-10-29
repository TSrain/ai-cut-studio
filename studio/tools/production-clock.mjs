#!/usr/bin/env node
// tools/production-clock.mjs — 活跃 60 分钟生产时钟的 CLI
//
// 规格 §3 / §12.2 / §12.3。语义与阈值全部来自 tools/lib/production-clock.mjs,
// 这一层只负责:读 build-log.json → 校验新事件的顺序 → **追加**写回 → 打印
// 活跃分钟数与当前 gate。
//
// 用法:
//   node tools/production-clock.mjs <命令> --project <项目目录> [--note "文字"]
//   node tools/production-clock.mjs status --project <项目目录>
//
// 命令: start | pause-selection | resume-selection | checkpoint | finish | status
//
// 退出码: 0 = 成功; 1 = 事件顺序非法 / 日志损坏; 2 = 参数错
//
// **关于确定性**:这里用 `Date.now()` 是正确的——它记录的是真实墙钟时间,
// 不是渲染逻辑。项目硬规则里"禁止 Date.now()"针对的是 useCurrentFrame() 推导的
// 画面代码。反过来,lib 里的两个纯函数**绝不许**取墙钟,时间一律传参,否则
// 测试不可复现、事后复盘也没法重算。
//
// **追加,不是覆写**:build-log.json 的 events 是 append-only 的。中途崩溃、
// 换会话、并行 worker 各自打点都靠它,任何一次覆写都会把前面的时间账抹掉。

import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {
  activeMilliseconds,
  productionGate,
  lastCheckpoint,
  GATE_ACTIONS,
  CHECKPOINT_MINUTES,
} from './lib/production-clock.mjs';

const COMMANDS = ['start', 'pause-selection', 'resume-selection', 'checkpoint', 'finish', 'status'];

const usage = () => {
  console.error('用法: node tools/production-clock.mjs <命令> --project <项目目录> [--note "文字"]');
  console.error(`命令: ${COMMANDS.join(' | ')}`);
};

// —— 参数 ——
const argv = process.argv.slice(2);
let command = null;
let project = null;
let note = '';
let logPath = null;

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--project') project = argv[++i];
  else if (arg.startsWith('--project=')) project = arg.slice('--project='.length);
  else if (arg === '--note') note = argv[++i];
  else if (arg.startsWith('--note=')) note = arg.slice('--note='.length);
  else if (arg === '--log') logPath = argv[++i];
  else if (arg.startsWith('--log=')) logPath = arg.slice('--log='.length);
  else if (arg === '-h' || arg === '--help') { usage(); process.exit(0); }
  else if (arg.startsWith('-')) { console.error(`未知选项: ${arg}`); usage(); process.exit(2); }
  else if (command === null) command = arg;
  else { console.error(`多余的参数: ${arg}`); usage(); process.exit(2); }
}

if (command === null) { usage(); process.exit(2); }
if (!COMMANDS.includes(command)) {
  console.error(`未知命令: ${command}`);
  usage();
  process.exit(2);
}
if (!logPath) {
  if (!project) { console.error('缺少 --project <项目目录>'); usage(); process.exit(2); }
  logPath = join(project, 'build-log.json');
}

// —— 读现有日志 ——
let log = {events: []};
if (existsSync(logPath)) {
  let raw;
  try {
    raw = readFileSync(logPath, 'utf8');
  } catch (error) {
    console.error(`读不了 ${logPath}: ${error.message}`);
    process.exit(1);
  }
  if (raw.trim() !== '') {
    try {
      log = JSON.parse(raw);
    } catch (error) {
      console.error(`${logPath} 不是合法 JSON,拒绝覆写(先手工修): ${error.message}`);
      process.exit(1);
    }
  }
  if (log === null || typeof log !== 'object' || Array.isArray(log)) {
    console.error(`${logPath} 的顶层不是对象,拒绝覆写`);
    process.exit(1);
  }
  if (log.events === undefined) log.events = [];
  if (!Array.isArray(log.events)) {
    console.error(`${logPath} 的 events 不是数组,拒绝覆写`);
    process.exit(1);
  }
}

const now = Date.now(); // 墙钟:这是这个工具存在的意义,不是确定性违规

// —— status:只读,不落盘 ——
const report = (events, at) => {
  const ms = activeMilliseconds(events, at);
  const minutes = ms / 60_000;
  const gate = productionGate(ms);
  const passed = lastCheckpoint(ms);
  const next = CHECKPOINT_MINUTES.find((m) => m * 60_000 > ms);
  console.log(`活跃时长: ${minutes.toFixed(1)} 分钟 (${ms} ms)`);
  console.log(`当前 gate: ${gate}`);
  console.log(`动作: ${GATE_ACTIONS[gate]}`);
  console.log(`检查点: 已过 ${passed} 分钟${next === undefined ? '(已超过 60 分钟参考预算)' : `,下一个 ${next} 分钟`}`);
  console.log(`事件数: ${events.length}`);

};

if (command === 'status') {
  try {
    report(log.events, now);
  } catch (error) {
    console.error(`日志里的事件顺序有问题: ${error.message}`);
    process.exit(1);
  }
  process.exit(0);
}

// —— 追加事件:先在候选序列上校验顺序,通过了才写盘 ——
const event = {type: command, at: now, note};
const candidate = [...log.events, event];

let ms;
try {
  ms = activeMilliseconds(candidate, now);
} catch (error) {
  console.error(`拒绝写入 ${command}: ${error.message}`);
  process.exit(1);
}

log.events = candidate;
log.updatedAt = now;
if (command === 'start') log.startedAt = now;
if (command === 'finish') log.finishedAt = now;
log.activeMs = ms;
log.gate = productionGate(ms);

mkdirSync(dirname(logPath), {recursive: true});
writeFileSync(logPath, `${JSON.stringify(log, null, 2)}\n`);

console.log(`已追加事件: ${command}${note ? ` — ${note}` : ''} → ${logPath}`);
report(log.events, now);
