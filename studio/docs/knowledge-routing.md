# Knowledge Routing(标签化知识路由)

**问题**:知识库越写越多,但一个 shot worker 的注意力是有限的。把 `docs/` 全塞进 dispatch,worker 会读不完、
读了也分不清哪条压哪条;把外部 skill 的完整源码粘进去更糟——几万字里真正管这一镜的可能只有两段。

**做法**:知识分三层(依据 `docs/superpowers/specs/2026-08-01-visual-first-dual-engine-design.md` §11):

| 层 | 内容 | 加载方式 |
|---|---|---|
| 1. Always-on contract | `docs/visual-first.md` | 每镜必载,唯一 `always: true` 的条目 |
| 2. Tagged recipes | 规则文档、profile、外部 skill | 按 `engine` + `tags` 路由,**每镜最多 4 条** |
| 3. Executable examples | 组件目录、Registry block、通过渲染的 recipe | 给**路径/id**,worker 自己去读;不复制源码进提示词 |

优先级链(与 `docs/visual-first.md` 一致,冲突时上面赢):

```text
选中 Styleframe / visual-contract.json
> 技术正确性硬门槛
> 当前 visual-first profile
> 镜头 recipe
> 外部 skill 通用建议
> 旧项目经验
```

## 用法

```bash
node tools/route-knowledge.mjs <remotion|hyperframes|hybrid> <逗号分隔tags>
```

一行一个资源,第一行永远是 `docs/visual-first.md`。把输出**原样**写进 `shots/shot-<NNN>/dispatch.md`
的「Knowledge」段。示例:

```bash
$ node tools/route-knowledge.mjs hyperframes ui,shader
docs/visual-first.md
skill:hyperframes-core
skill:hyperframes-animation
skill:hyperframes-keyframes
skill:hyperframes-registry
```

`skill:<name>` 是**逻辑 id**,不是路径——同一个 skill 在不同机器上可能来自用户级 skill、
项目 `.devin/skills/` 或插件目录。worker 按名字调用即可。
manifest 里不写绝对路径,换台机器不会失效。

### 硬规则

- **上限 4 条动态资源**,由 `knowledge-manifest.json` 的 `maxDynamic` 控制。想让某条更容易被选中,
  调它的 `priority`,**不要调上限**——上限就是这套机制的全部意义。
- **token 预算与条数上限叠加**:每条 entry 声明 `estimatedTokens`(文档按字节量/3 估,CJK 为主;skill 按
  入口文档+一份参考估),manifest 顶层 `maxContextTokens` 是动态资源的总预算。装包按 priority 顺序:
  装不下的**跳过**、继续试更小的,所以一份大文档不会把后面装得下的小 recipe 全挤掉。
  新增/大改文档后要顺手更新它的 `estimatedTokens`,不然预算就是摆设。
  **预算 2026-08-10 从 10000 抬到 12000**:实测在 10000 下,`data,chart,type` 镜装到
  `remotion-markup + typography.md + data-cinematic` 就用掉 9200,`color.md`(3700)和
  `visual-language.md`(2100)双双落选——**审美层每次都被实现层挤掉,而 `maxDynamic` 从未真正生效**,
  条数上限形同虚设、真正在裁的是一个偏紧的 token 数。抬到 12000 后 4 条上限重新成为约束项。
- **`exclusiveKinds` 管互斥类别**:manifest 顶层声明(当前 `["profile", "blueprint"]`),同一 `kind` 最多进一条,
  priority 高的赢。起因是风格卡按标签路由,`layout,brand,type` 的镜会同时匹配 `brand-energy` 和 `visual-max`,
  两份卡的密度/留白阈值不同,worker 拿到互相打架的两套数字。
  `blueprint` 出于同一理由列入:两份蓝图会给出互斥的分相结构与帧号,worker 没法同时照两份搭。
  ⚠️ 路由器看不到合同,只能保证"最多一条";**真正的准源是合同的 `profile` 字段**,
  路由来的风格卡与合同不一致时**以合同为准**。
- **`requiredTags` 管强专用资源**:声明了它的 entry,镜头 tags 必须**全部包含**才路由(普通 `tags` 是任一重合即候选)。
  例:`skill:remotion-captions` 带 type/audio 标签时曾被路由进一堆无字幕镜头,每镜白吃 ~3k tokens;
  现在它声明 `requiredTags: ["caption"]`,只有明确标了 caption 的镜才加载。**带字幕的镜头必须显式打 `caption` 标签**,
  漏打的后果从「多读一份 skill」变成了「该读的没读」——写 storyboard 时把这个标签当硬字段填。
- **`hybrid` 引擎取两个引擎的并集**,再按 priority 截到 4 条。它不放宽到 8 条:hybrid 镜的复杂度已经很高,
  给 worker 八份文档等于没给。
- **禁止把外部 skill 的完整源码粘进 dispatch。** dispatch 里只出现资源标识符 + 这一镜为什么需要它(一行)。
- 排序确定性:`priority` 降序,同分按 `id` 字典序。同一组输入永远得到同一份清单。

## 标签词汇表

和组件目录(`docs/catalog/components.json`)用**同一套维度**,否则两套路由对不上——
worker 拿到的知识标签和它去目录里查组件的标签必须能互相翻译:

```text
data  chart  ui  screenshot  shader  3d  kinetic  type  transition  overlay
texture  brand  logo  code  device  map  layout  background  caption  audio
render  media
```

外加一个 `core`,只给 always-on 合同用。

## 条目字段

| 字段 | 含义 |
|---|---|
| `id` | 稳定标识,排序打平时用它 |
| `kind` | `contract` / `protocol` / `rule` / `profile` / `blueprint` / `registry` / `gate` / `skill` |
| `resource` | `docs/...` 相对路径,或 `skill:<name>` 逻辑 id |
| `engines` | `["both"]` / `["remotion"]` / `["hyperframes"]`;`hybrid` 查询会同时匹配后两者 |
| `tags` | 上表词汇,取交集即命中 |
| `priority` | 数值越大越先被选;超过 4 条时决定谁被截掉 |
| `always` | 只有 `docs/visual-first.md` 是 `true` |

priority 的分层意图:

| 区间 | 谁 |
|---|---|
| 100 | always-on 合同 |
| 96 | 组件目录——**写任何新镜头前先查它**,所以几乎每次都占一个名额 |
| 86–92 | 与该 tag 直接对应的执行知识(引擎 skill、typography) |
| 76–85 | profile、色彩、定位协议、视觉语言、Styleframe 协议、素材 |
| 65–74 | 通用规则(hybrid 桥接、运动词汇表、design-principles) |
| ≤55 | 阶段性/门禁文档(engine-routing 在派发前已经用过、quality-checklist 在交付时才跑) |

`docs/design-principles.md` 被压到 65:按新优先级链,它不再拥有压过 VisualContract 的审美权重,
它真正不可让步的部分(确定性、输出规格、可读性)已经上提进 `docs/visual-first.md` 第 2 层。

## 故意不收录的文档

**三张旧风格卡:`docs/styles/bold-shorts.md`、`docs/styles/consulting.md`、`docs/styles/minimal-tech.md`。**

它们属于 visual-first 改造之前的体系,且与现行规则**直接冲突**——不是措辞老旧,是数值打架:

| 旧风格卡 | 冲突条款 | 现行规则 |
|---|---|---|
| `consulting.md` | 缓动「禁用弹跳」 | 每镜允许 1–3 个受控强调弹簧 |
| `minimal-tech.md` | 强调面积「压到 5% 以下」 | 强调面积默认 10%–35% |
| `minimal-tech.md` | 「全程禁用弹跳」 | 同上 |
| `bold-shorts.md` | 同属旧体系(单弹簧、三色上限、单焦点) | 1–3 个弹簧;一主两辅;一主焦点 + 两次级锚点 |

处理是**最小且可逆的**:三个文件正文一字未改,只在顶部加了 deprecation 头点名哪几条已被取代;
manifest 不收录它们,因此**它们不会被路由到任何镜头**。保留文件是为了读旧项目和追溯 `memory/taste.md`
里的具名手法。新项目从 `visual-max` / `editorial-luxe` / `brand-energy` / `data-cinematic` 里选。

**`docs/tech-routing.md`** 也不收录:它现在是一张索引表,内容被 `docs/engine-routing.md`(镜头级引擎判定)
和 `docs/agent-runbook.md` 的 skill 路由表覆盖。收录它只会消耗一个名额去指向另一张目录。

**`docs/component-catalog.md`**(散文版组件说明)不收录。

**`docs/catalog/components.json`(46 条全表)也不再收录**——2026-08-05 移出 manifest。
它匹配几乎所有标签、priority 96,等于每一镜都固定吃掉一个动态名额去指向一张 6600 tokens 的全表,
而一镜真正用得上的通常不到 10 条。现在改由 `tools/build-dispatch-manifest.mjs` 按镜头标签算出
**重合度最高的 10 条**,直接内联进 `dispatch.md` 的「Component shortlist」段(约 1200 tokens),
并注明"不够用时才去读全表"。于是每镜省下约 5400 tokens,**同时空出来的那个名额还能多路由一条真正相关的知识**。
换算逻辑与排序规则见 `tools/lib/component-catalog.mjs` 的 `shortlistComponents`。

## 加新条目时

1. 从上面的词汇表里选 tags,**不要发明新维度**——新维度要同时进组件目录才有意义。
2. 定 `priority` 时先想清楚:它该在哪一镜挤掉谁?挤不掉任何东西的条目等于没加。
3. 加完跑一遍存在性检查,路由到不存在的资源是**静默失效**:

```bash
node -e 'const fs=require("fs");for(const e of JSON.parse(fs.readFileSync("docs/knowledge-manifest.json","utf8")).entries){if(e.resource.startsWith("skill:"))continue;if(!fs.existsSync(e.resource))console.log("MISSING",e.resource)}'
node --test tools/tests/knowledge-router.test.mjs
```
