# Package 自动检索、下载与剪辑 BGM v1

Package 规则唯一准源：../workflow/docs/complete-package-contract.md（本文件不重复）。

本文件定义 BGM 检索、下载、剪辑提案与原生应用的专项技术规范。

## 选曲先扩大比较范围

全文先按 bgm-plan-contract 的六类收益与理解成本决定 music/silence。不是每段必须铺乐。按需要形成音乐 brief：用途、脉冲、旋律存在感、配器密度、频谱/人声竞争、变化幅度、可用乐句与收尾、片长、剪辑成本，再用中英文组合查询。不要只搜“思考型音乐”。

每轮有音乐需求时至少实际检索三个独立来源、两类来源；通常以 4–6 个来源、约 12–20 首去重候选为起点，视匹配情况扩展，不为凑数虚构搜索/曲目。不同域名的转载同一作者曲目不算独立供给。按曲目原始来源去重，searchAudit.providerId 写真实原始供给者（转载保持原 providerId）；region 写 domestic/overseas。业务门按域名归组与 providerId 去重，两区域均需实际检索/失败记录。至少考虑国内渠道与海外渠道；国内无匹配/访问失败也写实际记录，不能默认略过。最终可用一首贯穿多个同作用段，来源广不等于片中歌曲多。

来源地图是开放入口，不是固定白名单或授权保证：

- 综合/素材库：Pixabay、Mixkit、YouTube 官方 Audio Library、国内爱给等；逐曲读取许可和获取条件。
- 开放授权/聚合发现：Free Music Archive、ccMixter、Chosic 等，追到作者或许可页核实。
- 独立作者：不同作曲家的官方目录，不能永远只用 Kevin MacLeod / Scott Buckley 两位。
- 用户已明确拥有的商用库/本地授权资产可加入比较；没有账号或购买授权的好曲目可以列为候选缺口，不能静默付款。

来源依据（2026-10-20 查询，执行时重新确认）：[YouTube 音频库说明](https://support.google.com/youtube/answer/3376882?hl=en)、[Pixabay 许可](https://pixabay.com/service/license-summary/)、[Mixkit 音乐许可](https://mixkit.co/license/modal/musicFree/)、[FMA 视频使用说明](https://freemusicarchive.org/FAQ_For_Videos)、[Chosic 说明](https://www.chosic.com/free-music-policy/)、[爱给商用说明](https://www.aigei.com/faq/doc/1.html)。这些来源有不同授权条件，不将“免费下载”当作任意平台商用许可。

推荐排序依据为内容匹配、人声可懂度、连续体验、可剪辑性、获取/署名成本；每个 music 段 `recommendationIds` 按本段偏好排序。保留跨来源候选与落选原因，不以可下载方便代替音乐适配。优先下载第一名；不可获取/授权不适合时记录原因，按序尝试下一名。没有可用候选时留空并记缺口，不强塞旧曲。

## 支线文件与执行合同

支线只写自己的输出目录，不调用活动工程 API。proposal 原有 sections / recommendations / items:[] 不变，`items` 仍不是视觉素材。新增 `execution`：

```json
{
  "version": 1,
  "searchAudit": [{"url":"https://source.example/music","category":"library","providerId":"实际原始曲库/作者身份","region":"domestic","queries":["稀疏 旁白 器乐","minimal pulse narration"],"candidateIds":["r1"],"reason":"搜索结果与比较/未匹配/访问失败原因"}],
  "assets": [{"recommendationId":"r1","path":"/absolute/branch/assets/music.wav","sha256":"实际SHA256"}],
  "downloadAttempts": [{"recommendationId":"r1","status":"downloaded","reason":"官方直链可用，许可适用本次视频"}],
  "edits": [{"shotIds":["s1","s2"],"assetId":"r1","sourceInSeconds":8.2,"startOffsetSeconds":0,"endOffsetSeconds":0.3,"volume":0.03,"fadeInSeconds":0.18,"fadeOutSeconds":0.4,"fadeInCurve":"smooth","fadeOutCurve":"smooth","method":"同曲延续，结论前停乐，让人声收束"}],
  "gaps": []
}
```

所有已用 recommendation 增加 `licenseEvidence`（查证到的适用范围）、`attributionRequired` 布尔值、`credit` 完整署名文本（无需署名时可空）、`licenseStatus:verified`、`licenseUrl`。尚未下载的候选可保留未知许可，但不能自动应用。

写候选 JSON（id/title/artist/url/downloadUrl/licenseStatus/licenseUrl/licenseEvidence/attributionRequired/credit），调用仓库绝对路径：

```sh
python3 ../workflow/tools/bgm_acquire.py acquire --candidate /absolute/branch/candidate.json --out-dir /absolute/branch/assets
```

工具下载实际音频、探测/完整解码、SHA、输出 acquisition JSON；把实际文件、候选/来源证据与 acquisition JSON 纳入 result.files/SHA。不得伪造下载成功。网页/登录/付费/失效直链记录失败，再尝试下一名；不绕过访问限制。

`edits` 描述实际能实现的编辑，不只写手法名字：

- shotIds 必须属于 music，按真实时间连续；跨留白不可合并。可独立写多个 edit，对同一可配乐区间允许重叠，宿主分配音轨。
- 工程起止由当前 shot.timing.ranges 算出；startOffsetSeconds/endOffsetSeconds 只向区间内部缩，不把音乐伸入留白或延长成片。分离 ranges 要拆语义/编辑，不凭空猜全片秒数。
- sourceInSeconds 是曲目内起点。无需循环时绝不偷偷循环；曲目不够长应换选段/曲目或明确预先制作具有证据的派生音频。
- 相邻同曲同作用优先合并 edit、保持源乐句连续，别每个计划段重启。自然收尾选实际源尾段；乐句切换基于真实听验，未听不能编造拍点/调性。提前铺入、尾音桥可通过同一可配乐区间的两个 edit 重叠实现。反向尾音/分轨换层须真实制作文件并保留源文件、处理记录和许可，不能只写 method 就宣称实现。
- 淡化曲线 linear/smooth/equalPower 与时长由场景决定，不固定2秒。硬切需处理波形点击，短淡化可以只是消点击；不要把它误报乐句剪辑已听审。
- volume 为线性增益。实际量测当前口播与选用音乐片段，先以音乐比口播约低16–22 dB为数值起点再听审；不是固定0.03适用所有素材。原生准备器实测选用音乐与映射后的原声，按 underVoiceDb（默认18，可在12–30范围提出）计算保守增益并记录 mixEvidence；volume 仅在没有原声时作为提案增益。不通过“静音音频”假称应用。

业务门复查文件 SHA/解码/源时长、排名回退理由、真实段范围和留白，输出 kind=bgm 的原生队列操作。宿主唯一写入者保存计划、音频与应用元数据，经CAS保存回读；实际片段独立可编辑，支持曲内选段、淡入淡出与曲线。来源/署名跟随实际资产保存。已有手调、删除、锁定或跨轮旧 BGM 不被覆盖；保护状态与未执行缺口分别记录。

## 完成状态

有音乐需求但未下载/未应用只能 partial；已保存才能称入轨。全文合理留白可零音频，但须逐段审查。保存、完整解码、数值混音检查、真实听审、用户采用分开；未听始终标待听审。
