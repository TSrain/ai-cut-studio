import {SceneBackgroundPreview} from './editor/SceneBackground';
import React from 'react';
import {Composition, Folder} from 'remotion';
import {DataExplainer} from './demo/DataExplainer';
import {MaterialLab} from './demo/MaterialLab';
import {LibrarySample} from './demo/LibrarySample';
import {CatalogThumb} from './demo/CatalogThumb';
import {ComponentGallery} from './demo/ComponentGallery';
import {ContrastDemo} from './demo/ContrastDemo';
import {KenBurnsDemo} from './demo/KenBurnsDemo';
import {AssetLoop, assetLoopSchema} from './demo/AssetLoop';
import {TypeSpecimen} from './demo/TypeSpecimen';
import {HybridSmoke} from './demo/HybridSmoke';
import {VisualCatalog} from './demo/VisualCatalog';
import {LottieCatalog} from './demo/LottieCatalog';
import {LottieInScene} from './demo/LottieInScene';
import {OverlayDemo} from './demo/OverlayDemo';
import {StyleBible} from './demo/StyleBible';
import {MetaphorProbe} from './demo/MetaphorProbe';
import {PRESET_COMPOSITIONS} from './presets';
import {SHOTCRAFT_REPLICAS} from './shotcraft';
import {EditorComposition} from './editor/EditorComposition';

export const Root: React.FC = () => {
  return (
    <>
      <Composition
        id="NameWallPreview"
        component={SceneBackgroundPreview}
        width={1920} height={1080} fps={30} durationInFrames={300}
        defaultProps={{background:{type:'wall-a'}}}
      />
      <Composition
        id="EditorComposition"
        component={EditorComposition}
        durationInFrames={150}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{document: {schemaVersion: 1, id: 'editor-preview', name: '编辑预览', revision: 0, canvas: {width: 1080, height: 1920, fps: {num: 30, den: 1}, durationFrames: 150}, source: null, styleReference: {contractPath: null, styleframePath: null, allowedOverrides: {}}, instances: []}, renderMode: 'layer'}}
        calculateMetadata={({props}) => ({width: props.document.canvas.width, height: props.document.canvas.height, fps: props.document.canvas.fps.num / props.document.canvas.fps.den, durationInFrames: props.renderDurationFrames ?? props.document.canvas.durationFrames})}
      />
      {/* 口播 preset(参数化整镜):时长由 props.durationSeconds 决定,渲染命令形如
          npx remotion still/render Preset<Name> --props=<props.json>。定义见 docs/presets/

          **用 <Folder> 分组是有意的**:Studio 侧栏默认把所有合成平铺成一长串英文 id,
          用户打开后既不知道该找哪个、也不知道它叫什么名字,只能从第一个挨个点。
          分组之后模板全部收在「口播模板」下,其余样张/样品册收在「样张与工具」下。
          控制台的「在 Studio 里调这个」还会直接深链到 /<compositionId>,落地即选中。 */}
      <Folder name="口播模板">
        {PRESET_COMPOSITIONS.map((preset) => (
        <Composition
          key={preset.id}
          id={preset.id}
          component={preset.component}
          schema={preset.schema as never}
          durationInFrames={Math.round(preset.defaultProps.durationSeconds * 30)}
          fps={30}
          width={1080}
          height={1920}
          // schema 已被 as never 抹掉类型,defaultProps 也就推不出来了(注册表是异构的,
          // 一个数组装七种 props,本来就没有共同类型)。真正的校验在 zod schema 与
          // tools/lib/preset.mjs 那两处,不靠这里的 TS 泛型。
          defaultProps={preset.defaultProps as never}
            // canvas 是 props 不是注册项:同一个 preset 横竖两档共用一个合成 id,
            // 组件里用 useVideoConfig() 拿真实宽高排版。只认 preset.json 声明过的
            // 画幅格式("WxH"),解析不出就落回竖版——渲染别因为一个错字符串崩掉
            calculateMetadata={({props}) => {
              const p = props as {durationSeconds?: number; canvas?: string};
              const m = /^(\d+)x(\d+)$/.exec(p.canvas ?? '');
              return {
                durationInFrames: Math.round((p.durationSeconds ?? 3) * 30),
                ...(m ? {width: Number(m[1]), height: Number(m[2])} : {}),
              };
            }}
          />
        ))}
      </Folder>
      <Folder name="样品册与样张">
        <Composition
          id="DataExplainer"
          component={DataExplainer}
          durationInFrames={240}
          fps={30}
          width={1920}
          height={1080}
        />
        <Composition
          id="MaterialLab"
          component={MaterialLab}
          durationInFrames={240}
          fps={30}
          width={1920}
          height={1080}
        />
        {/* 素材库样品球:控制台里每个 HDRI / PBR 材质的缩略图都由它渲。
            只由 tools/build-library-previews.mjs 调用(--props 指定素材),不进出片流程 */}
        <Composition
          id="LibrarySample"
          component={LibrarySample}
          durationInFrames={1}
          fps={30}
          width={960}
          height={540}
          defaultProps={{hdri: 'hdri/studio_small_08_2k.hdr', maps: null}}
        />
        {/* 排版配色样张:改了 lib/fonts.ts 或 lib/color.ts 就渲它 */}
        <Composition
          id="TypeSpecimen"
          component={TypeSpecimen}
          durationInFrames={90}
          fps={30}
          width={1080}
          height={1920}
        />
        {/* 组件样品册:改了 src/components/ 就渲这三个看一眼。
            两页:f100=原样品页,f250=批注笔迹页(AnnotationMark) */}
        <Composition
          id="ComponentGallery"
          component={ComponentGallery}
          durationInFrames={300}
          fps={30}
          width={1080}
          height={1920}
        />
        {/* 视觉组件样品册:18 个原生组件分六页(每页 30 帧),改了 src/components/visual/ 就渲它。
            抽帧:for f in 15 45 75 105 135 165; do npx remotion still VisualCatalog --frame=$f review/visual-catalog-$f.png; done */}
        <Composition
          id="VisualCatalog"
          component={VisualCatalog}
          durationInFrames={180}
          fps={30}
          width={1080}
          height={1920}
        />
        {/* 目录缩略图渲染器:一次一个组件,产出 thumbnails/remotion/<id>.png。
            `npx remotion still CatalogThumb --props='{"id":"ken-burns"}' out.png`
            批量走 `node tools/build-catalog-thumbs.mjs`(缺哪张渲哪张)。 */}
        <Composition
          id="CatalogThumb"
          component={CatalogThumb}
          durationInFrames={120}
          fps={30}
          width={1080}
          height={1920}
          defaultProps={{id: 'ken-burns'}}
        />
        {/* Lottie 图标样品册:24 个外来动效重着色后分两页(每页 60 帧)。
            改了 public/lottie/ 或 LottieClip.tsx 就渲它:
            npx remotion still LottieCatalog --frame=40 review/lottie-a.png */}
        <Composition
          id="LottieCatalog"
          component={LottieCatalog}
          durationInFrames={180}
          fps={30}
          width={1080}
          height={1920}
        />
        {/* Lottie 场景用法样张:四种摆位(锚点/度量/判据/主体),每页 90 帧。
            抽帧:for f in 80 170 260 350; do npx remotion still LottieInScene --frame=$f review/scene-$f.png; done */}
        <Composition
          id="LottieInScene"
          component={LottieInScene}
          durationInFrames={360}
          fps={30}
          width={1080}
          height={1920}
        />
        {/* 前景叠加层对照样张:改了 FilmGrain / Vignette / ShimmerSweep 就渲它
            npx remotion still OverlayDemo --frame=70 review/overlay.png */}
        <Composition
          id="OverlayDemo"
          component={OverlayDemo}
          durationInFrames={120}
          fps={30}
          width={1080}
          height={1920}
        />
      </Folder>
      {/* video-shotcraft 效果复刻(验证用,对照 scratchpad 参考 mp4;不进出片流程) */}
      <Folder name="Shotcraft复刻">
        {SHOTCRAFT_REPLICAS.map((r) => (
          <Composition
            key={r.id}
            id={r.id}
            component={r.component}
            durationInFrames={r.duration}
            fps={30}
            width={1920}
            height={1080}
          />
        ))}
      </Folder>
      <Folder name="皮肤与演示">
        {/* 概念隐喻镜的探路草图。用户点头就改写成 presets/,摇头就连同文件一起删 */}
        <Composition
          id="MetaphorProbe"
          component={MetaphorProbe}
          durationInFrames={180}
          fps={30}
          width={1080}
          height={1920}
        />
        {/* 皮肤样张册:皮肤/preset 变了就渲它;--props='{"skin":"ember|slate|paper"}' 切候选皮肤。
            每页 30 帧:f15=退让镜,f45=关键概念卡 */}
        <Composition
          id="StyleBible"
          component={StyleBible}
          durationInFrames={PRESET_COMPOSITIONS.length * 30}
          fps={30}
          width={1080}
          height={1920}
          defaultProps={{skin: 'abyss' as const}}
        />
        <Composition
          id="ContrastDemo"
          component={ContrastDemo}
          durationInFrames={105}
          fps={30}
          width={1080}
          height={1920}
        />
        <Composition
          id="KenBurnsDemo"
          component={KenBurnsDemo}
          durationInFrames={210}
          fps={30}
          width={1080}
          height={1920}
        />
        {/* 资产面板的循环预览片。--props='{"group":"text","variant":"slam"}'
            批量渲染走 node tools/build-asset-previews.mjs,产物进 assets/previews/ */}
        <Composition
          id="AssetLoop"
          component={AssetLoop}
          schema={assetLoopSchema}
          durationInFrames={75}
          fps={30}
          width={960}
          height={540}
          defaultProps={{group: 'text' as const, variant: 'mask'}}
        />
        {/* 双引擎桥接烟雾镜头:背景来自 HyperFrames(public/hybrid-bg.mp4),文字由 Remotion 叠。
            150 帧 = 5.0s,必须与 templates/hyperframes-base 的时长一致(见 docs/hybrid-bridge.md)。
            跑 tools/smoke-dual-engine.sh 会重新生成背景并渲这一镜。 */}
        <Composition
          id="HybridSmoke"
          component={HybridSmoke}
          durationInFrames={150}
          fps={30}
          width={1080}
          height={1920}
        />
      </Folder>
    </>
  );
};
