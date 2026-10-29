# Preset 候选登记簿(模式识别用,每批收尾必写)

> 作用:让"同构画面出现第二次"**跨批次**也能被发现,自动触发建模板——用户永远不需要主动来说
> "把这个固化成模板"。机制写在 `.devin/skills/motion-broll/SKILL.md` 沉淀步。
>
> 规则:
> 1. 每批收尾,给**每个 custom 镜**(preset 镜不用)写一行"模式签名":动词化一句话 + 标签,
>    先通读本表判断是否与已有签名同构(同构 = 换一条内容这个画面结构还成立且长得一样)。
> 2. **首次出现** → 追加一行,状态 `seen-once`。
> 3. **第二次出现(本批内 ≥2 镜同构,或与本表既有签名同构)** → **当场自动建 draft preset**
>    (组件 + docs/presets/<id>/preset.json + PRESET.md + StyleBible 页 + 重跑 build-preset-menu),
>    状态改 `drafted:<preset-id>`,交付报告附一行「新提名模板 X,下批自动试用」。**不等用户请求。**
> 4. draft preset 在下一批被实际用过且样张过目后转 verified,状态改 `promoted`。

| 日期 | 批次 | 模式签名(动词化一句话) | 标签 | 状态 |
|---|---|---|---|---|
| 2026-08-06 | (系统预置,来自历史统计) | 卡片群涌入→吸入去重→收拢压缩→重排入网格 | card,layout,kinetic | **drafted:card-swarm**(2026-08-12 建。三拍骨架取自 Shot6 精简结论;新修正:settle 与 cull 重叠,原先等吸入结束再聚拢会出现空窗死帧) |
| 2026-08-06 | (系统预置) | 静态截图裁窗推近,焦点 A→B,边缘钳制 | screenshot,camera | **drafted:screen-push**(2026-08-12 建。补的是整镜层:窗口尺寸/眉题/说明句/来源角标/78% 定格。同批修掉 KenBurns 含斜杠 src 绕过 staticFile 的 bug) |
| 2026-08-06 | (系统预置) | 列表逐条上滚,个别行 accent 描边强调 | type,layout | **drafted:bullet-run**(2026-08-14 建。b-roll 最高频也最容易做成 PPT 的一种;四条反 PPT 措施见 PRESET.md。构图上左对齐列表天生左压——实测左半占墨 72%——用通栏底板 + 右上角 NN/MM 计数把重量拉回右侧) |
| 2026-08-06 | (系统预置) | 透明贴纸 chip 叠人物出镜画面,单次弹入 | overlay,type | seen-once(历史 2 次,StickerChip 组件已有——下次出现即 preset 化) |
| 2026-08-16 | (按能力缺口补齐) | 多阶段流水线逐段推进,每阶段一个标签 + 焦点逐段转移 | layout,diagram,flow | **drafted:step-flow**(2026-08-16 建。规格直接取自 SC-0025 Shot5/Shot6 两次手搓后写下的可复用结论;与 bullet-run 的分界是**有向性**,判据「把步骤顺序打乱画面还成立吗」) |
| 2026-08-16 | (按能力缺口补齐) | 折线/柱按时间方向画出 + 结论句当主角 | data,chart | **drafted:trend-chart**(2026-08-16 建。能力报告判信息类为核心甜区,而此前八个模板一张图表都没有。图元全部复用已 verified 的 ChartStage,不手搓) |
| 2026-08-20 | broll-SC-DSH01-final(第二波) | 静态截图推近+标注,但 scale/定格时刻自由标定(近方形大图整表定场 0.60 起步;标注落定即全停) | screenshot,camera | seen-once(shot-003a/006b 两镜同批同构,但同构对象是**既有 preset screen-push 的时序自由化**,不是新画面结构——正路不是再建一个 preset,而是给 screen-push 增槽:①scaleStart/scaleEnd(或按源图长宽比自动求「整图入窗」起步)②freezeAt(运镜+标注同帧定格档)。下次再有截图镜因这两条降级,就地给 screen-push 升版本加槽,不建新模板) |
