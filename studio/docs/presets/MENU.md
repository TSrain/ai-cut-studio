# 口播 Preset 能力菜单(脚本生成,不手改)

> semantic-template-v1：先全文语义，再全文模板表现力复审，覆盖概念/强调/结论/转折/并列等机会；本分支无模板审批。PRESET.md与组件是实际能力依据，不能只按复杂机制判断；下文旧审批措辞只适用legacy合同。

> 生成器:`node tools/build-preset-menu.mjs` · 来源:docs/presets/*/preset.json · 共 28 个
> 用法(上游 /package、motion-broll):**先设计对象、起始→变化→结束与口播锚点，再现读本文件**(不缓存不摘抄),逐镜比较语义关系、对象结构、构图、运动、节奏与风格;
> 先以最佳效果推荐路线；模板能满足时同步给方案。已选原生模板才写 `preset: {id, version}` + 真实文案槽，不以候选存在自动切换路线。
> 模板/定制比较写可保留表达、缺失动作、定制收益与负担、推荐及风险，合并原审批；用户无需提供参考片，agent 按需研究。
> 槽位适配仅是技术条件；模板同等最好可推荐复用，定制有效果收益则说明收益。已批准 custom 保持原路线，不因重匹配覆盖；不强制定制，也不冒充 verified。
>
> 每镜的匹配结论必须落进合同(四个字段,`validate-contract.mjs --require-preset-matching` 会拦):
> `presetCandidates`(比较过谁)/ `selectedPreset`(实际选了谁,custom/未选定写 null)/ `matchReason`(六项表达为何完整匹配)/
> `unmatchedReason`(本次未选原生模板的原因,可有合适候选)。`presetCandidates` 只表示比较，不代表选择；模板对照预览的 `presetAlternatives` 仅写独立候选合同,
> 各带真实文案渲预览，可与定制候选同步展示；正式合同按用户所选路线冻结，存在候选不免除定制设计。
>
> 已选原生 verified preset 复用技术快车道:槽位校验 → Preset Preview(0.4 时刻真实文案帧,整批拼一张接触印张)
> → 输出成功 → 分辨率/时长/编码/音轨。**用户确认印张之前不渲完整视频。**
> 全部交付镜仍须本次连续播放、内容/节奏/可读性/衔接检查，overlay 查看真实口播合成；verified 和评分不代替观看。
> keyframes-only 不渲 MP4，明确动态未验收；时限/修复轮数不授权自动降质，未达标交草稿与缺口。

## aspect-embed · 尺寸镶嵌 · v1 · ⚠️ draft(不走快车道)

![aspect-embed](../catalog/thumbnails/remotion/preset-aspect-embed.png)

- 时长:3–20s(默认 5s)· 画布 1920x1080/1080x1920
- 动效性格:deliberate,弹簧名额 0
- 原生组件:`templates/remotion-base/src/presets/AspectEmbed.tsx`；准备条件和实际动作读同目录 PRESET.md。
- 槽位:
  - `clip`(video,必填) — build/public/footage/ 下的本地视频文件名(确定性条款:素材必须先落地)。控制台装载素材时自动探测尺寸时长填进 srcW/srcH/srcDur
  - `srcW`(数字,可选) — 素材真实像素宽,由装载时 ffprobe 自动填;ratio=auto 用它推嵌入画幅
  - `srcH`(数字,可选) — 素材真实像素高,自动填
  - `srcDur`(数字,可选) — 素材时长,自动填;比镜头时长短时组件用它做无缝循环,不填且素材偏短会渲到末尾定格
  - `title`(文字,必填) — 视频旁边的大标题,按回车折行(≤3 行);逐行估宽取最小字号统一整块
  - `sub`(文字,可选) — 标题上方带强调色小条的一行小字,可省
- 档位:
  - `ratio`:"auto" / "9:16" / "1:1" / "4:5" / "16:9"(默认 "auto") — 视频卡片的宽高比;素材与之不符时 objectFit:cover 裁切
  - `side`:"left" / "right"(默认 "left") — 横画布的左右布局开关
  - `textFx`:"rise" / "cascade" / "typewriter"(默认 "rise") — 标题的入场动画档位
  - `sound`:"off" / "keep"(默认 "off") — 嵌入视频的音轨开关
- 合同写法:
```json
{
  "id": "shot-NNN",
  "preset": {
    "id": "aspect-embed",
    "version": 1
  },
  "presetProps": {
    "durationSeconds": 5,
    "slots": {
      "…": "…"
    }
  }
}
```

## behind-title · 人物身后大字 · v1 · ⚠️ draft(不走快车道)

![behind-title](../catalog/thumbnails/remotion/preset-behind-title.png)

- 时长:0.1–60s(默认 3s)· 画布 1920x1080/1080x1920
- 原生动作:文字快速放大进入人物身后 → 文字收缩淡出，人物和底片保持连续
- 表达能力:本机自动抠像，巨型粗体文字在人物身后快速出入；可调字体、大小与位置。
- 原生组件:`templates/remotion-base/src/presets/BehindTitle.tsx`；准备条件和实际动作读同目录 PRESET.md。
- 槽位:
  - `title`(文字,必填)
  - `fontFamily`(文字,必填)
  - `fontSizeRatio`(数字,必填)
  - `positionX`(数字,必填)
  - `positionY`(数字,必填)
  - `color`(文字,必填)
  - `enterFx`(枚举,必填)
  - `exitFx`(枚举,必填)
  - `enterSeconds`(数字,必填)
  - `exitSeconds`(数字,必填)
- 档位:
  - `bg`:"transparent"(默认 "transparent")
- 合同写法:
```json
{
  "id": "shot-NNN",
  "preset": {
    "id": "behind-title",
    "version": 1
  },
  "presetProps": {
    "durationSeconds": 3,
    "slots": {
      "…": "…"
    }
  }
}
```

## brand-open · 品牌开场卡 · v1

![brand-open](../catalog/thumbnails/remotion/preset-brand-open.png)

- 时长:2.5–5s(默认 3.5s)· 画布 1080x1920
- 动效性格:ceremonial,弹簧名额 0
- 原生组件:`templates/remotion-base/src/presets/BrandOpen.tsx`；准备条件和实际动作读同目录 PRESET.md。
- 槽位:
  - `wordmark`(文字,必填) — 字标本体。letterspace:按空格/换行拆行,逐行独立估宽后取最小字号(160 起,缩至 54 硬失败);ink:单行凸版戳印(150 起,缩至 60 硬失败)。估宽用组件内的品牌专用系数(大写 0.68em/字),不走 fit.ts 的正文均值
  - `tagline`(文字,可选) — 副标语,可省。letterspace:0.3em 宽字距上浮淡入;ink:等宽字体打字机逐字打出 + 方块光标
- 档位:
  - `style`:"letterspace" / "ink"(默认 "letterspace") — 两种开场语义:letterspace 是「整体显形」(全字符并行,一次成型),ink 是「逐字落定」(先定位后戳印,有工序感)。不是同一手法的深浅档,选错读作换了个品牌调性
- 合同写法:
```json
{
  "id": "shot-NNN",
  "preset": {
    "id": "brand-open",
    "version": 1
  },
  "presetProps": {
    "durationSeconds": 3.5,
    "slots": {
      "…": "…"
    }
  }
}
```

## bullet-run · 列点推进 · v2 · ⚠️ draft(不走快车道)

![bullet-run](../catalog/thumbnails/remotion/preset-bullet-run.png)

- 时长:4–12s(默认 7s)· 画布 1080x1920
- 动效性格:calm,弹簧名额 0
- 原生组件:`templates/remotion-base/src/presets/BulletRun.tsx`；准备条件和实际动作读同目录 PRESET.md。
- 槽位:
  - `items`(列表,必填) — 列表条目。每项可用 ` | ` 分成主句与小注。全表统一字号(取所有主句 fit 的最小值),条数多时基准字号自动降档
  - `title`(文字,可选) — 标题句,第 0 帧即在场
  - `eyebrow`(文字,可选) — 顶部眉题,可省
- 档位:
  - `flow`:"walk" / "stack"(默认 "walk") — walk:当前条 accent 高亮,其余降为可读灰;stack:逐条出现且全部保持同等亮度
  - `marker`:"none" / "number" / "dot" / "check"(默认 "none") — 默认 none —— 一根 accent 竖条已经标出了当前条,再加序号就是同一件事说两遍
- 合同写法:
```json
{
  "id": "shot-NNN",
  "preset": {
    "id": "bullet-run",
    "version": 2
  },
  "presetProps": {
    "durationSeconds": 7,
    "slots": {
      "…": "…"
    }
  }
}
```

## card-showcase · 卡片列阵 · v1

![card-showcase](../catalog/thumbnails/remotion/preset-card-showcase.png)

- 时长:4–8s(默认 6s)· 画布 1080x1920
- 动效性格:deliberate,弹簧名额 1
- 原生组件:`templates/remotion-base/src/presets/CardShowcase.tsx`；准备条件和实际动作读同目录 PRESET.md。
- 槽位:
  - `cards`(列表,必填) — 卡面内容,每条 `标题 | 小注`。卡序号自动编号(01、02…);卡色按卡序落在 accentHue±16°/张 的邻近色相环上,永远读作一家人。carousel 标题 42px,fan 压到 36px(翼侧只露一条)
  - `caption`(文字,可选) — 底部结论句(top 1560),可省。与卡阵版位互不侵入;tune 的 x/y/scale 只挪卡阵,caption 有自己的版位
- 档位:
  - `mode`:"fan" / "carousel"(默认 "carousel") — carousel:每张卡轮流正对镜头,观众能逐个读完 —— 卡多、标题长时选它。fan:一摞牌展开,量感优先,翼侧卡只露一条(标题超过 3 字会被邻卡压住尾字),4–5 张时每张标题才完整可读
- 合同写法:
```json
{
  "id": "shot-NNN",
  "preset": {
    "id": "card-showcase",
    "version": 1
  },
  "presetProps": {
    "durationSeconds": 6,
    "slots": {
      "…": "…"
    }
  }
}
```

## card-swarm · 卡片群收束 · v1 · ⚠️ draft(不走快车道)

![card-swarm](../catalog/thumbnails/remotion/preset-card-swarm.png)

- 时长:3–8s(默认 5s)· 画布 1080x1920
- 动效性格:deliberate,弹簧名额 0
- 原生组件:`templates/remotion-base/src/presets/CardSwarm.tsx`；准备条件和实际动作读同目录 PRESET.md。
- 槽位:
  - `total`(数字,必填) — 网格总卡数,决定「多」的量感。超过 48 会小到读不出是卡片
  - `keep`(数字,必填) — 幸存卡数,必须小于 total。留存卡由 layout() 均匀撒开,不随机挑
  - `eyebrow`(文字,可选) — 顶部眉题,可省
  - `keepLabel`(文字,可选) — 留存卡群的标签,跟着收束一起出现,可省
  - `caption`(文字,可选) — 底部结论句,可省
- 档位:
  - `mode`:"dedup" / "filter"(默认 "dedup") — 中间那拍的语义:dedup 吸入合并 / filter 变暗滑出。要更细的分阶段请走 custom 镜
  - `cols`:4 / 5 / 6(默认 5) — 网格列数,卡片尺寸随它自动算
- 合同写法:
```json
{
  "id": "shot-NNN",
  "preset": {
    "id": "card-swarm",
    "version": 1
  },
  "presetProps": {
    "durationSeconds": 5,
    "slots": {
      "…": "…"
    }
  }
}
```

## chapter-navigation · 章节导航卡 · v1 · ⚠️ draft(不走快车道)

![chapter-navigation](../catalog/thumbnails/remotion/preset-chapter-navigation.png)

- 时长:2–30s(默认 6s)· 画布 1080x1920/1920x1080
- 动效性格:calm,弹簧名额 0
- 表达能力:从 SC-0030 D 实片提炼：固定灰显章节列表，总览标题淡变为当前章节，当前行高亮。
- 原生组件:`templates/remotion-base/src/editor/ChapterNavigation.tsx`；准备条件和实际动作读同目录 PRESET.md。
- 槽位:
  - `title`(文字,可选) — 入场显示的总览；省略时按章节数量生成。
  - `items`(列表,必填) — 固定位置的章节名称，每行一条，1–8条。
  - `activeIndex`(数字,必填) — 0代表第一章；必须小于章节数量。
  - `activateAt`(数字,必填) — 相对本实例起点，标题与当前行在此刻开始切换。
- 档位:
  - `align`:"left" / "right"(默认 "left") — 标签列贴画面哪一侧。反正是 alpha 层,用户在剪映里还能整体挪,这里选个大致方向躲开人脸即可
  - `bg`:"transparent" / "scene"(默认 "transparent") — transparent=双通道 overlay,叠在用户实拍上;scene=带皮肤背景的独立插片
- 合同写法:
```json
{
  "id": "shot-NNN",
  "preset": {
    "id": "chapter-navigation",
    "version": 1
  },
  "presetProps": {
    "durationSeconds": 6,
    "slots": {
      "…": "…"
    }
  }
}
```

## contrast-pair · 左右对照 · v2

![contrast-pair](../catalog/thumbnails/remotion/preset-contrast-pair.png)

- 时长:2.5–6s(默认 3.5s)· 画布 1080x1920
- 动效性格:deliberate,弹簧名额 0
- 原生组件:`templates/remotion-base/src/presets/ContrastPair.tsx`；准备条件和实际动作读同目录 PRESET.md。
- 槽位:
  - `leftLabel`(文字,必填) — 左侧(不值得/旧方式)的标签
  - `leftText`(文字,必填) — 左侧主句,\n 折行
  - `rightLabel`(文字,必填) — 右侧(值得/新方式)的标签
  - `rightText`(文字,必填) — 右侧主句,\n 折行
  - `eyebrow`(文字,可选) — 顶部眉题,可省。v2 起没有兜底文案
- 档位:
  - `symbol`:"≠" / "→" / "VS"(默认 "≠") — 中缝符号:≠ 否定对照 / → 演进 / VS 对抗
- 合同写法:
```json
{
  "id": "shot-NNN",
  "preset": {
    "id": "contrast-pair",
    "version": 2
  },
  "presetProps": {
    "durationSeconds": 3.5,
    "slots": {
      "…": "…"
    }
  }
}
```

## cube-nav · 立方体导航 · v1

![cube-nav](../catalog/thumbnails/remotion/preset-cube-nav.png)

- 时长:4–8s(默认 6.5s)· 画布 1080x1920
- 动效性格:deliberate,弹簧名额 0
- 原生组件:`templates/remotion-base/src/presets/CubeNav.tsx`；准备条件和实际动作读同目录 PRESET.md。
- 槽位:
  - `faces`(列表,必填) — 立方体各面的标题。前 4 个贴侧环(相机绕 Y 逐面转),第 5 个贴顶面、第 6 个贴底面;不足 6 个的剩余面退成中性素面(骨架条,不抢戏)。面色按面序落在 accentHue+{0,±28,±56,+84}° 上——「我在哪一面」的第一识别信号
  - `caption`(文字,可选) — 底部结论句(top 1560),可省。第 0.25s 就淡入并全程在场——它是这一镜的旁白,不是收尾
- 合同写法:
```json
{
  "id": "shot-NNN",
  "preset": {
    "id": "cube-nav",
    "version": 1
  },
  "presetProps": {
    "durationSeconds": 6.5,
    "slots": {
      "…": "…"
    }
  }
}
```

## doc-typewriter · 文档自书写 · v1

![doc-typewriter](../catalog/thumbnails/remotion/preset-doc-typewriter.png)

- 时长:3.5–8s(默认 5s)· 画布 1080x1920
- 动效性格:steady,弹簧名额 1
- 原生组件:`templates/remotion-base/src/presets/DocTypewriter.tsx`；准备条件和实际动作读同目录 PRESET.md。
- 槽位:
  - `docTitle`(文字,必填) — 文档首行大标题,衬线感;相机开场特写的焦点
  - `meta`(文字,可选) — 标题下的弱字元信息(日期/来源/人数),可省
  - `lines`(列表,必填) — 逐行内容,行语法:`## ` 前缀=小标题;`- ` 前缀=列点;`@` 开头=成员名小标(擦出后补强调色底纹);其余=正文段。每行单行不折行,超宽自动缩字
  - `kicker`(文字,可选) — 屏幕顶部的等宽大写小字,盖章式戳入,可省
- 档位:
  - `history`:"show" / "none"(默认 "show") — show=卡下方历史带 4 条骨架条目逐条落入(表意「之前还有几期」);none=只有文档卡,降档不影响书写词汇
- 合同写法:
```json
{
  "id": "shot-NNN",
  "preset": {
    "id": "doc-typewriter",
    "version": 1
  },
  "presetProps": {
    "durationSeconds": 5,
    "slots": {
      "…": "…"
    }
  }
}
```

## flying-words · 关键词隧道 · v1

![flying-words](../catalog/thumbnails/remotion/preset-flying-words.png)

- 时长:4–8s(默认 6s)· 画布 1080x1920
- 动效性格:propulsive,弹簧名额 1
- 原生组件:`templates/remotion-base/src/presets/FlyingWordsShot.tsx`；准备条件和实际动作读同目录 PRESET.md。
- 槽位:
  - `words`(列表,必填) — 隧道里飞过的关键词。字号在 52–92 之间按词序伪随机错开(全同号读作贴图);超宽词自动缩字号。少于 6 个隧道会显空,多于 24 个观众只看见糊团
  - `finale`(文字,可选) — 收尾定格句,可省。存在时占用片尾 2.1s 作为 finale 相位(词退散 + 句推近 + 锚点线),是本镜的英雄帧
- 合同写法:
```json
{
  "id": "shot-NNN",
  "preset": {
    "id": "flying-words",
    "version": 1
  },
  "presetProps": {
    "durationSeconds": 6,
    "slots": {
      "…": "…"
    }
  }
}
```

## glass-pill · 玻璃胶囊打字 · v1

![glass-pill](../catalog/thumbnails/remotion/preset-glass-pill.png)

- 时长:1.5–4s(默认 2.5s)· 画布 1080x1920
- 动效性格:quiet,弹簧名额 1
- 原生组件:`templates/remotion-base/src/presets/GlassPill.tsx`；准备条件和实际动作读同目录 PRESET.md。
- 槽位:
  - `text`(文字,必填) — 胶囊内逐字打出的一句话。单行:先缩字号,缩到 30px 仍超宽则硬失败;胶囊定宽由估宽推导
  - `caption`(文字,可选) — 胶囊下方居中的一行小字说明,可省
- 档位:
  - `icon`:"mic" / "search" / "sparkle"(默认 "mic") — 胶囊右端的内联 SVG 图标,决定这条输入框的语义
- 合同写法:
```json
{
  "id": "shot-NNN",
  "preset": {
    "id": "glass-pill",
    "version": 1
  },
  "presetProps": {
    "durationSeconds": 2.5,
    "slots": {
      "…": "…"
    }
  }
}
```

## key-concept · 关键概念强调卡 · v2

![key-concept](../catalog/thumbnails/remotion/preset-key-concept.png)

- 时长:2.5–6s(默认 3.5s)· 画布 1080x1920
- 动效性格:confident,弹簧名额 1
- 原生组件:`templates/remotion-base/src/presets/KeyConcept.tsx`；准备条件和实际动作读同目录 PRESET.md。
- 槽位:
  - `term`(文字,必填) — 关键概念本词,支持 \n 手动折行(如「上下文\n工程」)
  - `en`(文字,可选) — 西文小标(概念的英文名),可省
  - `sentence`(文字,可选) — 一句解释,支持 \n 折行,可省
  - `highlight`(文字,可选) — sentence 里要上记号笔色带的子串;必须逐字出现在 sentence 中,否则不高亮
  - `eyebrow`(文字,可选) — 顶部眉题,可省。v2 起没有兜底文案
- 合同写法:
```json
{
  "id": "shot-NNN",
  "preset": {
    "id": "key-concept",
    "version": 2
  },
  "presetProps": {
    "durationSeconds": 3.5,
    "slots": {
      "…": "…"
    }
  }
}
```

## media-stage · 标题素材展示 · v1 · ⚠️ draft(不走快车道)

![media-stage](../catalog/thumbnails/remotion/preset-media-stage.png)

- 时长:1–3600s(默认 6s)· 画布 1920x1080/1080x1920
- 动效性格:calm,弹簧名额 0
- 表达能力:姓名背景墙承托一张图片或一段视频，短标题带设计字体与入场动画。
- 原生组件:`templates/remotion-base/src/presets/MediaStage.tsx`；准备条件和实际动作读同目录 PRESET.md。
- 槽位:
  - `title`(文字,必填) — 一行短标题，最多36字，自动缩小长标题；入场后保持静止
  - `image`(图片,可选) — 选择图片会替换已有视频
  - `clip`(video,可选) — 选择视频会替换已有图片
  - `imgW`(数字,可选) — 导入素材后自动探测
  - `imgH`(数字,可选) — 导入素材后自动探测
  - `srcW`(数字,可选) — 导入素材后自动探测
  - `srcH`(数字,可选) — 导入素材后自动探测
  - `srcDur`(数字,可选) — 导入素材后自动探测
  - `startSeconds`(数字,可选) — 从原视频的此时刻开始播放
  - `mediaScale`(数字,可选) — 1为适配展示区，支持0.4–1.2倍
  - `radius`(数字,可选) — 0为直角，单位为1920画布像素
- 档位:
  - `titleFace`:"smiley" / "serif" / "bold"(默认 "smiley") — 得意黑 / 编辑感宋体 / 粗黑体
  - `titleFx`:"stagger" / "reveal" / "tracking"(默认 "stagger") — 逐字错峰上浮 / 整体揭示 / 字距收拢
  - `fit`:"contain" / "cover"(默认 "contain") — 完整展示或铺满裁切；指定比例时有效
  - `ratio`:"auto" / "16:9" / "9:16" / "1:1"(默认 "auto") — auto 保持原图比例，横竖素材均可
  - `videoEnd`:"freeze" / "loop"(默认 "freeze") — 末帧停留或从选定起点循环
  - `sound`:"off" / "keep"(默认 "off") — 默认静音，避免与口播叠加
- 合同写法:
```json
{
  "id": "shot-NNN",
  "preset": {
    "id": "media-stage",
    "version": 1
  },
  "presetProps": {
    "durationSeconds": 6,
    "slots": {
      "…": "…"
    }
  }
}
```

## number-beat · 数字强调 · v3

![number-beat](../catalog/thumbnails/remotion/preset-number-beat.png)

- 时长:2.5–5s(默认 3s)· 画布 1080x1920
- 动效性格:confident,弹簧名额 1
- 原生组件:`templates/remotion-base/src/presets/NumberBeat.tsx`；准备条件和实际动作读同目录 PRESET.md。
- 槽位:
  - `value`(数字,必填) — 要强调的数字(纯数值,千分位由组件加)。facts.mode=exact 时来源写 assets.md
  - `prefix`(文字,可选) — 前缀,如 $ / ¥ / ×
  - `suffix`(文字,可选) — 后缀,如 万 / % / 倍
  - `label`(文字,必填) — 数字下方的一句话说明,\n 折行
  - `eyebrow`(文字,可选) — 顶部眉题,可省。v2 起没有兜底文案
- 档位:
  - `celebrate`:"none" / "confetti"(默认 "none") — confetti 源自 shotcraft counter-confetti 的融合:52 片纸屑分两簇从数字两端爆出,重力弧线 + 自转 + 着地前淡出,色相收在 accentHue 邻近带内(不是彩虹)。数字共用原有的 landSpring 名额补一次约 1.04 的轻 punch,不开第二个弹簧。默认 none 与 v2 逐帧一致
- 合同写法:
```json
{
  "id": "shot-NNN",
  "preset": {
    "id": "number-beat",
    "version": 3
  },
  "presetProps": {
    "durationSeconds": 3,
    "slots": {
      "…": "…"
    }
  }
}
```

## phone-ripple · 波纹手机芯片 · v1

![phone-ripple](../catalog/thumbnails/remotion/preset-phone-ripple.png)

- 时长:4–8s(默认 5.6s)· 画布 1080x1920
- 动效性格:calm,弹簧名额 1
- 原生组件:`templates/remotion-base/src/presets/PhoneRipple.tsx`；准备条件和实际动作读同目录 PRESET.md。
- 槽位:
  - `chips`(列表,必填) — 两侧的功能芯片(白色亮面,暗皮肤下是画面高光点)。左起交替、纵向错落(确定性抖动 ±18px,不排成直线)。每个 4–6 字最稳,超过 210px 自动缩字
  - `screenshot`(图片,可选) — 屏内滚动的产品截图,可省。含 / 视为 public/ 完整相对路径,裸文件名自动补 screens/(与 screen-push 同一套约定)。**内容总高必须大于滚动距离 + 屏高**,否则滚到底露白 —— 组件已按 min(可滚上限, 1.15 屏高) 做了双保险
  - `imgW`(数字,可选) — 源图真实像素宽,用于按屏宽等比缩放并算滚动距离
  - `imgH`(数字,可选) — 源图真实像素高
  - `caption`(文字,可选) — 底部结论句(top 1600),可省。锚在底部安全区,tune 的 x/y 挪波纹+手机+芯片整组时它不跟着走
- 合同写法:
```json
{
  "id": "shot-NNN",
  "preset": {
    "id": "phone-ripple",
    "version": 1
  },
  "presetProps": {
    "durationSeconds": 5.6,
    "slots": {
      "…": "…"
    }
  }
}
```

## pill-stack · 胶囊标签堆叠层 · v1 · ⚠️ draft(不走快车道)

![pill-stack](../catalog/thumbnails/remotion/preset-pill-stack.png)

- 时长:2–12s(默认 4.5s)· 画布 1080x1920/1920x1080
- 动效性格:calm,弹簧名额 0
- 原生组件:`templates/remotion-base/src/presets/PillStack.tsx`；准备条件和实际动作读同目录 PRESET.md。
- 槽位:
  - `items`(列表,必填) — 每条一个白胶囊。可写「标签文字 | 出现秒数」精确卡口播的点(如「简单可持续 | 1.2」);不写秒数就从 0.4s 起每 0.9s 接力一条。竖线后的秒数不上画面
  - `title`(文字,可选) — 标签列上方的一行小字(白色带投影),可省
- 档位:
  - `align`:"left" / "right"(默认 "left") — 标签列贴画面哪一侧。反正是 alpha 层,用户在剪映里还能整体挪,这里选个大致方向躲开人脸即可
  - `bg`:"transparent" / "scene"(默认 "transparent") — transparent=双通道 overlay,叠在用户实拍上;scene=带皮肤背景的独立插片
- 合同写法:
```json
{
  "id": "shot-NNN",
  "preset": {
    "id": "pill-stack",
    "version": 1
  },
  "presetProps": {
    "durationSeconds": 4.5,
    "slots": {
      "…": "…"
    }
  }
}
```

## quote-card · 引用卡 · v1

![quote-card](../catalog/thumbnails/remotion/preset-quote-card.png)

- 时长:3–6s(默认 4s)· 画布 1080x1920
- 动效性格:restrained,弹簧名额 0
- 原生组件:`templates/remotion-base/src/presets/QuoteCardShot.tsx`；准备条件和实际动作读同目录 PRESET.md。
- 槽位:
  - `quote`(文字,必填) — 原句逐字上屏,用 \n 自行断行;不缩字,装不下就减行
  - `source`(文字,可选) — 来源行:人名 · 出处 · 年份
  - `note`(文字,可选) — 作者换算/推断小字条
  - `noteTag`(文字,可选) — 小字条的胶囊标签,默认「作者换算」
- 档位:
  - `tone`:"warm" / "cool"(默认 "warm") — 色温档:cool 用于信任/官方背书语境,只换色温不换几何
- 合同写法:
```json
{
  "id": "shot-NNN",
  "preset": {
    "id": "quote-card",
    "version": 1
  },
  "presetProps": {
    "durationSeconds": 4,
    "slots": {
      "…": "…"
    }
  }
}
```

## recede · 退让镜 · v2

![recede](../catalog/thumbnails/remotion/preset-recede.png)

- 时长:2–5s(默认 3s)· 画布 1080x1920
- 动效性格:restrained,弹簧名额 0
- 原生组件:`templates/remotion-base/src/presets/Recede.tsx`；准备条件和实际动作读同目录 PRESET.md。
- 槽位:
  - `line`(文字,必填) — 整屏唯一一块字,自动折行(最多 3 行,约 14–18 个中文字)。整块同一字族,不许中西文手动拆段拼贴;要指定断行位置可以写 \n
  - `hero`(文字,可选) — line 里要放大成主焦点的那一段,必须逐字出现在 line 中(如 line=「知识，是人类最慢的生产资料」时 hero=「最慢」)。命中的部分放大 1.6 倍并给满墨色,其余降一档字号与墨色。省略 = 整句一个字号、全是主焦点(等同 v1)
  - `emphasisRanges`(ranges,可选) — UTF-16 起止位置数组，可标记多处；空数组表示全部普通，省略则兼容旧 hero。
  - `fontSize`(数字,可选) — 普通字号，可在编辑器中调整。
  - `emphasisRatio`(数字,可选) — 放大倍数，可在编辑器中调整。
  - `enterSeconds`(数字,可选) — 出场时长，可在编辑器中调整。
  - `exitSeconds`(数字,可选) — 退场时长，可在编辑器中调整。
  - `enterFx`(枚举,可选) — 新模板默认无；缺省保留旧模板动画。
  - `exitFx`(枚举,可选) — 新模板默认无；缺省保留旧模板动画。
- 档位:
  - `level`:1 / 2 / 3 / 4(默认 2) — 亮度档,1 最亮 → 4 全片最暗;同一批多镜退让时逐级递减。锚点细线的墨色跟着一起退
- 合同写法:
```json
{
  "id": "shot-NNN",
  "preset": {
    "id": "recede",
    "version": 2
  },
  "presetProps": {
    "durationSeconds": 3,
    "slots": {
      "…": "…"
    }
  }
}
```

## screen-push · 截图推近·关键标注 · v6 · ⚠️ draft(不走快车道)

![screen-push](../catalog/thumbnails/remotion/preset-screen-push.png)

- 时长:2.5–10s(默认 4s)· 画布 1080x1920
- 动效性格:deliberate,弹簧名额 0
- 原生组件:`templates/remotion-base/src/presets/ScreenPush.tsx`；准备条件和实际动作读同目录 PRESET.md。
- 槽位:
  - `image`(图片,必填) — public/screens/ 下的文件名。必须是本地文件——渲染期不许联网取图
  - `imgW`(数字,必填) — 源图真实像素宽。填错会让推镜焦点整体偏移
  - `imgH`(数字,必填) — 源图真实像素高
  - `focusX`(数字,可选) — 归一化焦点 X(0–1)。必须走 docs/locate-protocol.md 的网格法取值
  - `focusY`(数字,可选) — 归一化焦点 Y(0–1)
  - `markW`(数字,可选) — 批注框归一化宽度。缺省 = 不画批注;要不要画由它决定,画成什么样由 mark 变体决定
  - `markH`(数字,可选) — 批注框归一化高度,默认 0.05
  - `markX`(数字,可选) — 批注框归一化中心 X,默认取 focusX
  - `markY`(数字,可选) — 批注框归一化中心 Y,默认取 focusY
  - `eyebrow`(文字,可选) — 顶部眉题,可省
  - `caption`(文字,可选) — 底部说明句,可省
  - `credit`(文字,可选) — 来源署名,烧进画面全程可见。第三方素材建议必填
  - `focus2X`(数字,可选) — graze 巡览第 2 站的归一化横坐标,可省
  - `focus2Y`(数字,可选) — graze 巡览第 2 站的归一化纵坐标,可省
  - `focus3X`(数字,可选) — graze 巡览第 3 站的归一化横坐标,可省
  - `focus3Y`(数字,可选) — graze 巡览第 3 站的归一化纵坐标,可省
- 档位:
  - `move`:"push" / "pull" / "pan" / "static" / "graze"(默认 "push") — 四种镜头语言,全部由起止焦点+起止缩放表达,不是四段代码。static = 无运镜,批注承担全部动作 graze:低掠贴面巡览 —— 相机以 12–20° 倾角贴着截图飞,依次经过 focus / focus2 / focus3,每站短暂停留,末站定格为英雄帧;浅景深 + 远端雾化,批注只在末站画。
  - `mark`:"underline" / "marker" / "circle" / "box" / "none"(默认 "underline") — 批注样式。真正的开关是 markW 槽位(缺省不画);荧光笔在深色截图上不成立,深底用红笔系
  - `ink`:"auto" / "red" / "yellow" / "accent"(默认 "auto") — 批注墨色。墨色是戏中物(纸上笔迹),不占合同 palette 的强调色名额
- 合同写法:
```json
{
  "id": "shot-NNN",
  "preset": {
    "id": "screen-push",
    "version": 6
  },
  "presetProps": {
    "durationSeconds": 4,
    "slots": {
      "…": "…"
    }
  }
}
```

## segmented-thumb · 分段开关特写 · v1

![segmented-thumb](../catalog/thumbnails/remotion/preset-segmented-thumb.png)

- 时长:2.5–5s(默认 3.7s)· 画布 1080x1920
- 动效性格:precise,弹簧名额 1
- 原生组件:`templates/remotion-base/src/presets/SegmentedThumb.tsx`；准备条件和实际动作读同目录 PRESET.md。
- 槽位:
  - `leftLabel`(文字,必填) — 左段标签,二选一里的一项。2–4 个中文字最稳
  - `rightLabel`(文字,必填) — 右段标签,二选一里的另一项。2–4 个中文字最稳
  - `caption`(文字,可选) — 滑块落位后底部淡入的一句话,可省
- 档位:
  - `land`:"left" / "right"(默认 "right") — 滑块最终落在哪一段。right=从左段滑到右段(默认),left=镜像
- 合同写法:
```json
{
  "id": "shot-NNN",
  "preset": {
    "id": "segmented-thumb",
    "version": 1
  },
  "presetProps": {
    "durationSeconds": 3.7,
    "slots": {
      "…": "…"
    }
  }
}
```

## space-steps · 空间步进 · v1

![space-steps](../catalog/thumbnails/remotion/preset-space-steps.png)

- 时长:5–10s(默认 7s)· 画布 1080x1920
- 动效性格:deliberate,弹簧名额 0
- 原生组件:`templates/remotion-base/src/presets/SpaceSteps.tsx`；准备条件和实际动作读同目录 PRESET.md。
- 槽位:
  - `steps`(列表,必填) — 散布在 3D 空间各处的站点卡。每站有自己的位置与姿态,相机取其逆飞去对齐
  - `overview`(文字,可选) — OVERVIEW 站的标题(这一镜的英雄帧),可省
  - `caption`(文字,可选) — 底部结论句,可省
- 档位:
  - `spin`:"on" / "off"(默认 "on") — 第 3 站是否用 rz90° 画框侧躺(相机跟着把它转正)。on = 记忆点,一支片只用一次;off = 只用位移与 ry,给信息密的文案让路
- 合同写法:
```json
{
  "id": "shot-NNN",
  "preset": {
    "id": "space-steps",
    "version": 1
  },
  "presetProps": {
    "durationSeconds": 7,
    "slots": {
      "…": "…"
    }
  }
}
```

## step-flow · 流程推进 · v1 · ⚠️ draft(不走快车道)

![step-flow](../catalog/thumbnails/remotion/preset-step-flow.png)

- 时长:5–16s(默认 9s)· 画布 1080x1920
- 动效性格:calm,弹簧名额 0
- 原生组件:`templates/remotion-base/src/presets/StepFlow.tsx`；准备条件和实际动作读同目录 PRESET.md。
- 槽位:
  - `steps`(列表,必填) — 流程步骤。每项可用 ` | ` 分成步骤名与说明句;**说明句一次只显示当前步那一条**
  - `title`(文字,可选) — 题目,可省
  - `eyebrow`(文字,可选) — 顶部眉题,可省。没有兜底文案
- 档位:
  - `emphasis`:"focus" / "even"(默认 "focus") — focus:当前步字号放大到 1.8 倍;even:全部同字号,只有亮度差
  - `marker`:"number" / "dot"(默认 "number") — 脊线左侧的步骤号。等宽数字,01 与 10 左边缘不抖
- 合同写法:
```json
{
  "id": "shot-NNN",
  "preset": {
    "id": "step-flow",
    "version": 1
  },
  "presetProps": {
    "durationSeconds": 9,
    "slots": {
      "…": "…"
    }
  }
}
```

## text-mask · 字形遮罩开场 · v1

![text-mask](../catalog/thumbnails/remotion/preset-text-mask.png)

- 时长:3.5–6s(默认 5s)· 画布 1080x1920
- 动效性格:deliberate,弹簧名额 0
- 原生组件:`templates/remotion-base/src/presets/TextMask.tsx`；准备条件和实际动作读同目录 PRESET.md。
- 槽位:
  - `title`(文字,必填) — 遮罩字。笔画就是视口——字数多或字重轻等于把画面塞进门缝。字族固定走 Archivo VF + 思源黑 VF 的 900 字重(遮罩要的是最大墨量),不跟皮肤 kit;tune.font 可覆盖
  - `image`(图片,可选) — 笔画里流动的产品画面,可省(preset 样例就省着)。选图硬判据见 PRESET.md「选图硬判据」:门里必须与门外拉开明度(暗皮肤下要更亮)、笔画里必须有结构而不是平色、只有源图的一条窄带会透出来。含 / 视为 public/ 完整相对路径,裸文件名自动补 screens/(与 screen-push 同一套约定)
  - `imgW`(数字,可选) — 源图真实像素宽,用于按画幅铺满并算漂移距离
  - `imgH`(数字,可选) — 源图真实像素高
  - `caption`(文字,可选) — 底部小注,撤场时淡出,可省
- 档位:
  - `takeover`:"full" / "hold"(默认 "full") — full = 末段字形胀开、画面接管全屏(当章节转场,下一镜直接接画面);hold = 全程留在字内,末段静止(当独立开场卡)
- 合同写法:
```json
{
  "id": "shot-NNN",
  "preset": {
    "id": "text-mask",
    "version": 1
  },
  "presetProps": {
    "durationSeconds": 5,
    "slots": {
      "…": "…"
    }
  }
}
```

## timeline-travel · 时间轴横移 · v1

![timeline-travel](../catalog/thumbnails/remotion/preset-timeline-travel.png)

- 时长:4–8s(默认 5.5s)· 画布 1080x1920
- 动效性格:kinetic,弹簧名额 1
- 原生组件:`templates/remotion-base/src/presets/TimelineTravel.tsx`；准备条件和实际动作读同目录 PRESET.md。
- 槽位:
  - `stops`(列表,必填) — 时间轴上的主刻度。相机加速掠过,每到一格卡片从刻度线上弹立。刻度名印在轴下方(88px),那一句话印在卡里(52px);不写竖线后半段的站只有刻度和名字,不渲空卡
  - `title`(文字,可选) — 顶部眉题,全程在场,可省
  - `caption`(文字,可选) — 末段急停后淡入的结论句,可省
- 合同写法:
```json
{
  "id": "shot-NNN",
  "preset": {
    "id": "timeline-travel",
    "version": 1
  },
  "presetProps": {
    "durationSeconds": 5.5,
    "slots": {
      "…": "…"
    }
  }
}
```

## title-reveal · 标题入场卡 · v1

![title-reveal](../catalog/thumbnails/remotion/preset-title-reveal.png)

- 时长:2.5–6s(默认 3.8s)· 画布 1080x1920
- 动效性格:confident,弹簧名额 1
- 原生组件:`templates/remotion-base/src/presets/TitleReveal.tsx`；准备条件和实际动作读同目录 PRESET.md。
- 槽位:
  - `title`(文字,必填) — 主标题,单行 shrink-to-fit。brace 档要给两只括号留 ~2.6em,可容纳字数比另两档少约 2 个汉字(组件按 shrinkFloor 56 单独收缩)
  - `subtitle`(文字,可选) — 标题下方的一行小字,可省。blur 档它与标题错峰重叠入场;marker/brace 档在标题落定后淡入
  - `accent`(文字,可选) — title 里要强调的子串:marker 档在它下面划马克笔,brace 档只括它(pre/post 被推出);blur 档让它独立成一个入场词段。必须逐字出现在 title 中,否则 marker 整行不划、brace 括整行
- 档位:
  - `style`:"blur" / "marker" / "brace"(默认 "blur") — 入场手法:blur=逐词虚焦浮出(低能量默认,专业不抢戏)/ marker=落定后马克笔在 accent 下扫一笔(手写感强调)/ brace=花括号弹开拉幕(代码语感,技术产品语境)
- 合同写法:
```json
{
  "id": "shot-NNN",
  "preset": {
    "id": "title-reveal",
    "version": 1
  },
  "presetProps": {
    "durationSeconds": 3.8,
    "slots": {
      "…": "…"
    }
  }
}
```

## trend-chart · 趋势图表 · v1 · ⚠️ draft(不走快车道)

![trend-chart](../catalog/thumbnails/remotion/preset-trend-chart.png)

- 时长:4–14s(默认 8s)· 画布 1080x1920
- 动效性格:calm,弹簧名额 0
- 原生组件:`templates/remotion-base/src/presets/TrendChart.tsx`；准备条件和实际动作读同目录 PRESET.md。
- 槽位:
  - `headline`(文字,必填) — 主角。口播档图表「最大字号承担当前节拍的信息,图表只负责作证」
  - `values`(文字,必填) — 逗号分隔的数值序列。**示意数据必须在合同里写 facts.mode: illustrative**
  - `seriesName`(文字,必填) — 系列名。chart-rules §3:身份靠直接标签承载,颜色只做次级编码
  - `xLabels`(文字,可选) — x 轴刻度。数量与 values 不一致时整个不画(补空串会让人以为那格没数据)
  - `unit`(文字,可选) — 数值单位,拼在刻度与端点标签后面
  - `note`(文字,可选) — 底部注解句,可省
  - `source`(文字,可选) — 来源角标,可省但演示数据强烈建议写
  - `eyebrow`(文字,可选) — 顶部眉题,可省。没有兜底文案
- 档位:
  - `mark`:"line" / "area" / "bar"(默认 "line") — chart-rules §1 选形:连续变化用折线,柱图会被读成几个独立类别
  - `yScale`:"zero" / "tight"(默认 "zero") — chart-rules §2 硬门槛:柱图无论选什么都被组件短路成 zero;折线选 tight 时强制画断轴符号
- 合同写法:
```json
{
  "id": "shot-NNN",
  "preset": {
    "id": "trend-chart",
    "version": 1
  },
  "presetProps": {
    "durationSeconds": 8,
    "slots": {
      "…": "…"
    }
  }
}
```

## word-cascade · 逐词飞入动字 · v1 · ⚠️ draft(不走快车道)

![word-cascade](../catalog/thumbnails/remotion/preset-word-cascade.png)

- 时长:2.5–14s(默认 6s)· 画布 1080x1920/1920x1080
- 动效性格:lively,弹簧名额 0
- 原生组件:`templates/remotion-base/src/presets/WordCascade.tsx`；准备条件和实际动作读同目录 PRESET.md。
- 槽位:
  - `lines`(列表,必填) — cascade:每行一句,依次飞入换场;qa:第一行是问题(进胶囊),其余行是答案。**用空格控制词的分组**(飞入以词为单位),没分组的长中文自动按 2 字切块。单句 ≤8 个词,超长先缩字号,缩到 30px 硬失败
- 档位:
  - `mode`:"cascade" / "qa"(默认 "cascade") — cascade=句子依次组装换场;qa=问题胶囊+答案散点显影(引用观众提问→给要点)
  - `bg`:"aurora" / "scene" / "transparent"(默认 "aurora") — aurora 是 Lindsey 原片的光感(色相跟 skin.accentHue);transparent 时文字带软影,可叠实拍
- 合同写法:
```json
{
  "id": "shot-NNN",
  "preset": {
    "id": "word-cascade",
    "version": 1
  },
  "presetProps": {
    "durationSeconds": 6,
    "slots": {
      "…": "…"
    }
  }
}
```

