# 外部镜头配方索引(video-shotcraft)

**这是索引层,不是本地层。** 这里的 152 张卡 / 209 式**没有一张能直接进生产镜头**——
它们没有本项目的实现代码、没有经过竖屏重排、`verified` 无从谈起。
它们的用途只有一个:**挑**。在控制台「镜头配方」区浏览,挑中了再本地化。

## 两层的分工

| 层 | 在哪 | 进 dispatch 吗 | 能进生产镜头吗 |
|---|---|---|---|
| **索引层**(本目录,152 卡 / 209 式) | `docs/catalog/recipes-external.json` + 本目录的卡全文 | ❌ 不进,**不占 route-knowledge 的 token 预算** | ❌ 不能 |
| **本地层**(`docs/recipes/`) | 登记进 `docs/catalog/components.json`(`kind:"recipe"`) | ✅ 进 Recipe shortlist | ✅ 能 |

为什么必须分两层:dispatch 的 shortlist 按标签重合度排序取前 10,
152 条外部卡涌进去会把信噪比冲垮(现在 74 条算前 10 已经够呛)。
索引层解决「看得见、挑得到」,本地层解决「用得上、可验收」,两件事不能混。

## 本地化一张卡要做什么

1. 读本目录的卡全文(意图 / 动效核心 / 参数表 / 已知坑);
2. **按竖屏重排** —— 原卡是 1920×1080 产品页语境,版心、字号阶梯、安全区都要重算;
3. 在 `templates/remotion-base/` 写实现,或用现有组件组合出来;
4. 写 `docs/recipes/<category>/<name>.md`(格式见 `docs/recipes/README.md`);
5. 登记进 `docs/catalog/components.json`,`kind:"recipe"`,带 `params` / `pitfalls`(棘轮强制);
6. 渲缩略图 → **亲眼看图** → 翻 `verified`。

⚠️ **不要整包移植。** `camera/` `interaction/` 里大量是网页/终端 UI 镜头,
在没有页面采集链路(`UPGRADE-PLAN.md` 条目 G)之前根本无从实现。
直接可用的集中在 `typography`(25)/ `effects`(17)/ `rhythm`(11)/ `data`(11)。

## 来源与授权

- 上游:https://github.com/Vincentwei1021/video-shotcraft ,**Apache License 2.0**。
- 本目录是上游 `references/shots/` 的原样副本 + `gallery/api/library.json`;
  缩略图取自上游 `gallery/media/poster/`(209 式里只有 64 式有 poster,其余在索引里 `poster: null`)。
- 动态样片 mp4 **不在上游 git 里**(走 GitHub release),所以本地也没有;
  索引里的 `gallery` 字段深链到在线画廊看动图。
- 上游卡片记录的是**从零重新实现的动效技法**(时序 / 缓动 / 编排),不含任何第三方影片素材;
  本项目本地化时同样只取手法,不取画面。
