# 生产计时与预算复盘

本文件记录批次、活跃时间和参考预算；时间不决定作品质量、不自动冻结范围或改写批准表达。

来源:规格 `docs/superpowers/specs/2026-08-01-visual-first-dual-engine-design.md` §3 支持边界与服务等级、§12.2 调度时间表、§12.3 的旧熔断已由用户 2026-10-12 取消。预算提示的**唯一实现**在 `tools/lib/production-clock.mjs`,查询与打点用 `tools/production-clock.mjs`。文档和代码不一致时以代码为准,并回来改文档。

---

## 1. 受支持批次的边界

一个"受支持批次"必须同时满足:

- **总时长 ≤ 30 秒,或镜头数 ≤ 6 个**;
- **默认画布 1080×1920、30fps**;其他尺寸必须是偶数边并由 brief 明确指定;
- **单镜通常 3–15 秒**;
- **最多一个主音轨**,默认不合成音轨;
- 外部素材可以下载、截取、缓存,但**耗时不可控的高成本生成任务单独记录预算成本**(例如付费 AI 视频生成)。

超出边界的项目**拆成多个批次**。所有批次共享同一份 VisualContract 和相邻批次的 continuity anchors——拆批次是拆工作量,不是拆视觉一致性。

60分钟用于估计工作量和发现瓶颈，不是强制交付期限。

---

## 2. 活跃时间与暂停语义

**60 分钟计的是活跃生产时间,不是墙上时间。**

- 计时从 `start`(读取需求)开始;
- 三个 Styleframe 呈现给用户后打 `pause-selection`,**等用户选择的这段时间不计入活跃时长**;
- 用户选定后打 `resume-selection`,继续累加;
- `finish` 之后活跃时长冻结,不再增长;
- `checkpoint` 只是打点,不改变计时状态。

为什么必须排除选择等待:那段时间系统没有在干活。把它算进去,会误计系统工作成本——那样的指标既不反映系统能力,也会诱导跳过用户决策点。

**事件是 append-only 的**,全部落在项目的 `build-log.json`(`{type, at, note}`)。CLI 只追加不覆写:中途崩溃、换会话、多个 worker 分别打点都靠这份日志重建时间账。

**非法顺序一律拒绝并退出码 1**:未 `start` 就 `pause-selection` / `checkpoint` / `finish`,重复 `start`,连续两次 `pause-selection`,没有对应 pause 的 `resume-selection`,重复 `finish`,`finish` 之后再打任何事件,以及时间戳倒流。

```bash
node tools/production-clock.mjs start            --project projects/<name> --note "读取需求"
node tools/production-clock.mjs pause-selection  --project projects/<name> --note "三张 Styleframe 已呈现"
node tools/production-clock.mjs resume-selection --project projects/<name> --note "用户选了 B"
node tools/production-clock.mjs checkpoint       --project projects/<name> --note "全镜 draft 完成"
node tools/production-clock.mjs finish           --project projects/<name>
node tools/production-clock.mjs status           --project projects/<name>   # 只读,不落盘
```

---

## 3. 0–60 分钟完整时间表

| 活跃时间 | 阶段 | 退出条件 |
|---|---|---|
| 0–6 分钟 | brief / 粗分镜 / 候选合同 | 三个 styleframe-worker 收到完整 dispatch |
| 6–15 分钟 | 三个 Styleframe 并行 | 三张**真实 PNG** 可供选择 |
| *用户等待* | **暂停计时** | 用户选中,或非交互任务自动选择 |
| 15–20 分钟 | 冻结 VisualContract / 引擎路由 / 连续锚点 | 合同校验通过 |
| 20–40 分钟 | shot worker 并行构建 | 每镜有首中尾关键帧和 draft |
| 40–48 分钟 | 视觉与连续审查 / 必要修复 | 真实播放与技术验收通过，未通过明确缺口 |
| 48–56 分钟 | 正式渲染 / 规范化 / 拼接 | `final.mp4` 生成 |
| 56–60 分钟 | 抽帧 / 时长 / 资源校验 | 所有硬门槛通过 |

检查点(活跃分钟):**6、15、20、30、40、45、50、56、60**。

---

## 4. 并发上限

- 并发上限由 harness 决定。**不得因为并发上限减少镜头范围**——超出并发数时按波次处理,而不是砍镜头。
- **浏览器正式渲染队列默认并发 2**,内存不足时降为 1。
- 并行 agent 的完成标准是**目标文件存在并通过校验**,不是 agent 口头声称完成。

---

## 5. 预算提示

`productionGate` 名称保留兼容，返回的是提示状态，不是熔断门禁：

| 活跃时间 | 状态 | 提示 |
|---|---|---|
| <15分钟 | `on-track` | 按批准方案推进，记录实际成本 |
| ≥15分钟 | `progress-advisory` | 复核进度、瓶颈与剩余成本 |
| ≥60分钟 | `budget-advisory` | 记录预算变化，继续必要制作和修复 |

不按计时自动选模板、换引擎、冻结范围、禁止依赖、停止画面修改或判生产失败。

## 6. 渲染失败与修复

先定位具体错误，再修复并重试；不设固定尝试次数。引擎、实现或资源调整必须保留批准表达，不能因为超时、失败次数或一轮修复自动降低质量。无法继续时交付当前草稿、缺口与下一步，明确未验收范围，不称完成。

## 7. 真实计时

保留 append-only 日志与合法事件序列校验。实际成本和瓶颈用于下一次估算，不能粉饰计时；预算与作品验收分别报告。
