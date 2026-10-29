# 网页采集与 2.5D 页面运镜

把任意网页变成动画素材:采集 → `layout.json` 给真实坐标 → `PageCam` 做 2.5D 运镜。

此前本项目**完全没有这条链路**(全项目 grep 不到 puppeteer/playwright)。
`docs/engine-routing.md` 把「网页截图/DOM 重构」判给 HyperFrames,但那只是路由,没有采集工具兜底。

## 三档能力(只有第一档零配置)

| 档 | 做什么 | 自动程度 |
|---|---|---|
| 1 | 给一个网址 → 全页 2x 截图 → 落进项目 `assets/` → `PageCam` 运镜 | ✅ **全自动零配置**,你只需要丢链接 |
| 2 | 元素抠图 + `layout.json`(每个元素在整页坐标系里的 `{x,y,w,h}`) | ⚠️ 半自动,要为该站写一次 CSS 选择器 |
| 3 | 交互后的状态(点开 tab / 展开菜单再截) | ⚠️ 要写一小段 `interact` |

```bash
# 档 1
node tools/capture-page.mjs --url https://example.com --out projects/<name>/assets/

# 档 2/3
node tools/capture-page.mjs --config capture.json --out projects/<name>/assets/
```

依赖装在 `tools/capture/`(独立 `package.json`)——**不装进 `templates/remotion-base`**,
那个目录每次 `cp -Rc` 会被整个克隆进每个项目,多一个依赖就多一份复制。
浏览器自动找本机 `~/Library/Caches/ms-playwright/` 里的 `chrome-headless-shell`,不另外下载。

## `layout.json` 是这条链路最值钱的产物

它是**页面空间协议**:每个元素在整页 CSS 坐标系里的真实 `{x,y,w,h}`。
有了它,卡片飞入、元素归位、推镜焦点全部用真实坐标,**不需要谁去猜位置**。

这条和 `docs/locate-protocol.md` 直接接壁——那份协议存在的理由就是
「不许目测坐标:目测平均误差 6.5%,网格法 2.3%」。
**对网页镜头,`layout.json` 把误差降到 0**(坐标是浏览器量的,不是看出来的),
四步网格定位法可以整个跳过。非网页素材(照片/长图)才继续走网格法。

用法上把它写进 `visual-contract.json` 的 `assets.layout` 字段引用,让 shot worker 直接读,
**不要让每个 worker 自己去翻文件**。

## 采集器替你处理的三件事

1. **关掉 cookie 同意横幅** —— 不关,截出来的每张图上都横着一条,而它和内容毫无关系。
   用文本匹配点按钮(选择器每家网站都不同,文本反而稳定);`--keep-banner` 可关闭这个行为。
2. **滚一遍全页** —— 懒加载图片不滚就截,截出来一堆占位灰块。
3. **静置等字体** —— `--wait` 默认 1200ms。中文 web 字体加载慢,截早了会看到回退字形。

处理不了的:登录墙、反爬。那两类要么换目标,要么你手动把页面存下来给我。

## PageCam:2.5D 页面相机

`templates/remotion-base/src/components/visual/PageCam.tsx`。
在整页截图上做平移/缩放 + 三轴倾斜 + 可选焦平面模糊。

**降级设计**:任何 key 都不声明 `rotX/rotY/rotZ/persp` 时,整个组件退化成纯平面 pan/zoom,
逐像素等同于不加 3D 的版本 —— 所以引入它不会改变任何已有平面镜头的行为。

参数表与坑见 `docs/catalog/components.json` 的 `page-cam` 条目(dispatch 的 shortlist 会自动带上)。
三条最要命的:

- **倾角低于 8° 渲出来和平面 pan/zoom 没区别。** 样张第一版首尾给 8°→−4°,
  取样帧正好插值到 2°,看着完全是平的。
- **`pageW/pageH` 要给 CSS 尺寸不是纹理像素。** 2x 图给 CSS 宽,浏览器才会用上那两倍像素;
  给错了 3D 透视下文字必糊 —— 发糊先查纹理分辨率链路,不要靠加锐化补救。
- **竖屏的 `persp` 要按短边推算**(默认已是短边 ×1.3)。横屏那套 1400 直接用在 1080 宽竖版上透视会过强。

## 合规

素材政策已明确允许网页截图,不因版权/来源阻塞视觉演示。
硬门槛只有一条:**截图必须下载进项目 `assets/` 并以本地路径参与渲染** ——
渲染期网络请求违反确定性条款(`docs/design-principles.md` §9)。采集器强制 `--out`,就是为了这条。
来源记进 `assets.md` 作为非阻塞元数据。
