# 视觉评分卡

规格 §13 的 100 分表落成一份**机器可校验的 JSON**。散文 review.md 继续写,但**门禁读的是这份 JSON**——
「整体不错,可以交付」这种句子拦不住任何东西,一个 5 分的排版藏在 92 分的总分里也看不出来。

```bash
node tools/validate-review.mjs projects/<name>/review.json   # 不过 → exit 1
```

## 1. 七个维度与权重

| 键 | 维度 | 权重 | 打分时具体看什么 |
|---|---|---:|---|
| `composition` | 构图、焦点和第一眼冲击 | 20 | 320px 缩略图上能不能一眼认出主焦点;主焦点是不是只有一个;有没有把信息全堆在一侧 |
| `typography` | 字体个性和排版层级 | 15 | 中文字形是不是合同 kit 的那套(**回退到默认字体直接 ≤4**);字号/字重/字距/行高是否配套;层级是否 ≥3 级 |
| `density` | 视觉密度、空间和细节 | 10 | 占屏率落在 profile 区间内;空间层数 ≥ `density.layerCount`;材质信号种类;客观证据见 `tools/check-density.sh` |
| `motion` | 动效节奏与镜头组织 | 15 | 每个运动有没有信息理由;缓动是不是标准曲线;弹簧数量在 `motion.springAccents` 名额内且不撞点;停留够不够读 |
| `distinctiveness` | 材质、色彩和独特性 | 10 | 换掉文案还认得出是这一支吗;签名元素在不在;有没有模板感。**版式变形(斜排/旋转/分屏/字符墙)必须能被观众感知到在表达什么** —— 同方向装饰和代码注释都不算证明;评审时做反事实删除测试:恢复普通排版后理解与情绪都不受损就该删掉(`docs/typography.md` §5.5) |
| `clarity` | 内容清晰度和事实正确性 | 20 | 只看一遍说不说得出结论;声明为事实的数字与来源逐项对得上 |
| `continuity` | 跨镜头连续性 | 10 | 焦点位置、配色材质、字体套装、运动方向、密度曲线跨镜是否连贯(来自 `continuity.json`) |

加权总分 = Σ(维度分 × 权重 ÷ 10),满分 100。

## 2. 四条门禁(彼此独立,任一不过即 FAIL)

1. **总分 ≥80** —— 挡「哪儿都平庸」;
2. **任一维度 ≥6** —— 挡「靠几个维度刷高总分,某一维塌了」。总分 92.5 也可能藏着一个 5 分的排版;
3. **英雄帧主观分 ≥8** —— 挡「平均不错但没有一帧能拿出去」;
4. **`technical` 五项全 `true`** —— 挡「好看但错了」。**缺项 ≠ 通过**:五个键必须都在,漏写一项也 FAIL。

## 3. JSON 格式

```json
{
  "shot": "shot-003",
  "frames": ["review/shot-003-start.png", "review/shot-003-mid.png", "review/shot-003-end.png"],
  "styleframe": "styleframes/sf-2.png",
  "scores": {
    "composition": 9, "typography": 8, "density": 8, "motion": 8,
    "distinctiveness": 8, "clarity": 9, "continuity": 8
  },
  "heroFrame": 8,
  "technical": {
    "contract": true,
    "output": true,
    "fonts": true,
    "assets": true,
    "thumbnail": true
  },
  "mismatches": [
    "sf-2 的标题占三分之一画幅,成片只占八分之一(review/shot-003-mid.png)",
    "尾帧右下角空了约 30% 面积,sf-2 那块是元数据轨",
    "强调色只出现在一处 12px 的线上,合同要求 10%–35% 面积"
  ],
  "repairs": [
    {"fix": "标题字号提到 sf-2 的量级(hero → 1.6×)", "dimension": "typography", "gain": 3},
    {"fix": "右下补元数据轨(单位/时间码/来源)", "dimension": "density", "gain": 2},
    {"fix": "强调色扩到主数据块的填充", "dimension": "distinctiveness", "gain": 2}
  ]
}
```

- `scores` 七个键必填,0–10 整数;缺一个或超范围 → 直接 FAIL(`total` 记 0)。
- `technical` 五个键含义:`contract` = `tools/validate-contract.mjs` 通过;`output` = `tools/validate-output.sh` 通过;
  `fonts` = 成片中文字形确实是合同 kit(不是默认回退);`assets` = 素材本地缓存、无远程引用;
  `thumbnail` = 320px 缩略图能认出主焦点。
- `mismatches` 0–3 条**具体且真实**的不符(带帧文件名和位置;合格镜可为 0 条,**不许为凑数造问题**),
  `repairs` 最多五条、按分数影响降序;**结论 FAIL 时 `repairs` 至少一条可直接动手的修复**。

## 4. 客观证据从哪来

评分是主观的,但它必须**站在客观证据上**。打分前先跑完:

```bash
tools/validate-output.sh <文件> --size WxH --fps 30 --duration S     # → technical.output
node tools/validate-contract.mjs projects/<name>/visual-contract.json # → technical.contract
tools/check-density.sh <文件> --contract projects/<name>/visual-contract.json   # → density 维度
node tools/lint-shot.mjs projects/<name>/build/src/shots --contract ...          # → density / typography / motion
```

**密度阈值不是普适数字**:`check-density.sh` 按合同 `density.occupancyMin`(或 profile)换算下限——
visual-max 60–85% / brand-energy 55–80% / data-cinematic 50–75% / editorial-luxe 40–65%。
低密度想被判为正当,唯一的说法是「选中的 Styleframe 就是这样」;
「时间不够」不是,「这个风格就该素」在没换 profile 的前提下也不是。

## 5. 谁来打分

- 逐镜像素评分:`docs/subagents/visual-reviewer.md`
- 跨镜边界检查:`docs/subagents/continuity-reviewer.md`(产出 `continuity.json`,喂给 `continuity` 维度)

两者都**只看画面**,不评审代码风格。分数低了改画面,不许引用旧规则替低分辩护。
