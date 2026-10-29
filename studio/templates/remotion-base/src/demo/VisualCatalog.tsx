import React from 'react';
import {AbsoluteFill, staticFile, useCurrentFrame} from 'remotion';
import {
  alpha,
  createTypography,
  scenePalette,
  textStyle,
  type ScenePalette,
  type TypographyContext,
  type TypographyKitName,
} from '../lib/theme';
import {progress as anim} from '../lib/anim';
import {SemanticIcon} from '../components/SemanticIcon';
import {
  BackgroundSystem,
  ChartStage,
  ConnectionMap,
  DeviceMockup,
  HeroFrame,
  ImageCollage,
  KineticText,
  LogoCloud,
  MetadataRail,
  MetricCluster,
  NodeChip,
  ScreenshotStage,
  StageLayers,
  StateToggle,
  StatusStrip,
  SurfacePanel,
  ThreeStage,
  TransitionBridge,
} from '../components/visual';

// 视觉组件样品册。**改了 src/components/visual/ 就渲这六页看一眼。**
//
// 这不是一个能直接用的镜头,是 18 个原生组件的验收样张:
//   - 六页按帧区间切(0–29 / 30–59 / 60–89 / 90–119 / 120–149 / 150–179),
//     每页只挂载自己那一页的组件 —— ThreeStage 的 WebGL 上下文因此只在 P6 存在;
//   - 每个组件旁边标注它在 `docs/catalog/components.json` 里的 id,便于逐条对照;
//   - 六页各用一套 typography kit(impact / tech-data / modern / human / editorial / impact),
//     顺便把五套 kit 的中文性格差异摆在一起看。
//
// **文案全部是真信息**(组件数、源码行数、工作流阶段、页码、色相),不是 Lorem——
// MetadataRail / MetricCluster 的注释里明令禁止编数字充数,样品册自己先守这条。
//
// 排版坐标约定:内容一律钉在 x ∈ [64, 1016]、y ∈ [88, 1810] 之内。
// StageLayers 的 `safeArea` 在这里**故意不开**:样品册的主体是自己绝对定位的,
// padding 和绝对定位坐标会打两遍架(见 StageLayers 顶部坑 4 的说明)。

const PAGE_LEN = 30;
const PAGE_COUNT = 6;
const W = 1080;
const H = 1920;
/** 内容左边界 / 内容宽度。比 safeVertical 的 96 略窄一档:样品册要塞下更多东西 */
const X = 64;
const CW = W - X * 2; // 952

/* ============ 样品册自用的小零件 ============ */

/** 组件 id 标签:和 docs/catalog/components.json 的 id 逐字一致,用来对照验收 */
const IdTag: React.FC<{
  typography: TypographyContext;
  palette: ScenePalette;
  id: string;
  note?: string;
}> = ({typography, palette, id, note}) => (
  <div style={{display: 'flex', alignItems: 'center', gap: 16, minWidth: 0}}>
    <span
      style={{
        ...textStyle(typography, 'caption'),
        fontFamily: typography.families.mono,
        color: palette.accent,
        background: alpha(palette.accent, 0.12),
        border: `1px solid ${alpha(palette.accent, 0.34)}`,
        borderRadius: 6,
        padding: '6px 14px',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {id}
    </span>
    {note ? (
      <span
        style={{
          ...textStyle(typography, 'caption'),
          color: palette.inkSecondary,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {note}
      </span>
    ) : null}
  </div>
);

/** 一行页眉:页码 + 页名 + 本页用的 kit。让人一眼知道这页在展示什么 */
const PageHeader: React.FC<{
  typography: TypographyContext;
  palette: ScenePalette;
  index: number;
  title: string;
  kit: TypographyKitName;
}> = ({typography, palette, index, title, kit}) => (
  <div style={{position: 'absolute', left: X, top: 88, width: CW}}>
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 24,
      }}
    >
      <span
        style={{
          ...textStyle(typography, 'label'),
          fontFamily: typography.families.mono,
          letterSpacing: '0.14em',
          color: palette.ink,
          whiteSpace: 'nowrap',
        }}
      >
        P{index} / {PAGE_COUNT} · {title}
      </span>
      <span
        style={{
          ...textStyle(typography, 'caption'),
          fontFamily: typography.families.mono,
          color: palette.inkMuted,
          whiteSpace: 'nowrap',
        }}
      >
        kit: {kit}
      </span>
    </div>
    <div
      style={{
        height: 2,
        marginTop: 14,
        background: `linear-gradient(90deg, ${palette.accent} 0%, ${alpha(palette.accent, 0)} 72%)`,
      }}
    />
  </div>
);

/** 一小段说明文字。样品册里用来解释「这个组件解决什么问题」 */
const Note: React.FC<{
  typography: TypographyContext;
  palette: ScenePalette;
  children: React.ReactNode;
  top: number;
  width?: number;
}> = ({typography, palette, children, top, width}) => (
  <div
    style={{
      position: 'absolute',
      left: X,
      top,
      width: width ?? CW,
      ...textStyle(typography, 'caption'),
      color: palette.inkSecondary,
      lineHeight: 1.62,
    }}
  >
    {children}
  </div>
);

/** 前景层:一层暗角。**不能用 BackgroundSystem 冒充前景**——它会铺一层不透明底场把主体盖光 */
const ForegroundVeil: React.FC = () => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      background:
        'radial-gradient(128% 82% at 50% 44%, rgba(0,0,0,0) 52%, rgba(0,0,0,0.34) 100%)',
    }}
  />
);

type PageProps = {local: number};

/* ============ P1 空间骨架 ============ */

const KIT_1: TypographyKitName = 'impact';
const T1 = createTypography(KIT_1);
const P1 = scenePalette(250, 'dark');

const LAYERS: {z: string; name: string; desc: string}[] = [
  {z: 'z0', name: '背景层 background', desc: '出血到画布边缘,永远不承载要读的信息'},
  {z: 'z1', name: '主体层 midground', desc: '焦点住在这里,唯一吃安全区的一层'},
  {z: 'z2', name: '前景层 foreground', desc: '颗粒 / 暗角 / 标注,不许压住主焦点文字'},
];

const Page1: React.FC<PageProps> = ({local}) => {
  const p = anim(local, 0, 14);
  return (
    <StageLayers
      background={
        <BackgroundSystem
          variant="ghost-type"
          typography={T1}
          text="组件"
          palette={P1}
          frame={local}
          intensity={0.85}
          seed={11}
          driftFrames={60}
        />
      }
      foreground={<ForegroundVeil />}
      midground={
        <>
          <PageHeader typography={T1} palette={P1} index={1} title="空间骨架" kit={KIT_1} />

          <div style={{position: 'absolute', left: X, top: 200, width: CW}}>
            <IdTag
              typography={T1}
              palette={P1}
              id="background-system"
              note="variant: ghost-type · seed 11 · 巨字当肌理"
            />
          </div>

          <div style={{position: 'absolute', left: X, top: 282, width: CW}}>
            <IdTag typography={T1} palette={P1} id="stage-layers" note="三层槽位,z 序是合同不是书写顺序" />
          </div>
          <div style={{position: 'absolute', left: X, top: 352, width: CW}}>
            {LAYERS.map((L, i) => {
              const t = anim(local, i * 2, 12);
              return (
                <div
                  key={L.z}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 22,
                    height: 78,
                    marginBottom: 12,
                    boxSizing: 'border-box',
                    padding: '0 24px',
                    borderRadius: 12,
                    background: alpha(P1.surfaceRaised, 0.72),
                    border: `1px solid ${alpha(P1.line, 0.9)}`,
                    boxShadow: '0 8px 22px rgba(0,0,0,0.4)',
                    opacity: t,
                    transform: `translateX(${(1 - t) * -18}px)`,
                  }}
                >
                  <span
                    style={{
                      ...textStyle(T1, 'label'),
                      fontFamily: T1.families.mono,
                      color: P1.accent,
                      width: 52,
                      flexShrink: 0,
                    }}
                  >
                    {L.z}
                  </span>
                  <span
                    style={{
                      ...textStyle(T1, 'label'),
                      color: P1.ink,
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                  >
                    {L.name}
                  </span>
                  <span
                    style={{
                      ...textStyle(T1, 'caption'),
                      color: P1.inkMuted,
                      marginLeft: 'auto',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {L.desc}
                  </span>
                </div>
              );
            })}
          </div>

          <div style={{position: 'absolute', left: X, top: 700, width: CW}}>
            <IdTag typography={T1} palette={P1} id="hero-frame" note="眉题 → 主标题 → 强调线 → 副标的编排" />
          </div>
          <div style={{position: 'absolute', left: X, top: 776, width: CW}}>
            <HeroFrame
              typography={T1}
              eyebrow="原生视觉组件 18 个"
              title={'视觉组件\n样品册'}
              subtitle={'六页样张展示全部 18 个原生组件,\n每个都标注 components.json 里的 id,\n便于逐条对照验收。'}
              accent={P1.accent}
              palette={P1}
              progress={p}
              titleStyle="h1"
            />
          </div>

          <Note typography={T1} palette={P1} top={1520}>
            P1 空间骨架 · P2 面板原语 · P3 数据与结构
            <br />
            P4 媒体与品牌 · P5 编辑版面 · P6 连接与三维
          </Note>
        </>
      }
    />
  );
};

/* ============ P2 面板原语 ============ */

const KIT_2: TypographyKitName = 'tech-data';
const T2 = createTypography(KIT_2);
const P2 = scenePalette(195, 'dark');

const MATERIALS = [
  {material: 'solid' as const, name: '实体 solid', desc: '底色 + 描边 + 投影'},
  {material: 'glass' as const, name: '玻璃 glass', desc: '内描边 + 背景模糊'},
  {material: 'metal' as const, name: '金属 metal', desc: '斜向渐变 + 内凹'},
];

const Page2: React.FC<PageProps> = ({local}) => {
  const p = anim(local, 0, 14);
  return (
    <StageLayers
      background={
        <BackgroundSystem
          variant="grid"
          palette={P2}
          frame={local}
          intensity={0.72}
          seed={23}
          driftFrames={60}
        />
      }
      foreground={<ForegroundVeil />}
      midground={
        <>
          <PageHeader typography={T2} palette={P2} index={2} title="面板原语" kit={KIT_2} />

          <div style={{position: 'absolute', left: X, top: 200}}>
            <IdTag typography={T2} palette={P2} id="surface-panel" note="material: solid / glass / metal" />
          </div>
          <div style={{position: 'absolute', left: X, top: 270, display: 'flex', gap: 32}}>
            {MATERIALS.map((m) => (
              <SurfacePanel
                key={m.material}
                width={296}
                height={216}
                material={m.material}
                raised
                accent={P2.accent}
              >
                <div style={{position: 'absolute', inset: 0, padding: 24, boxSizing: 'border-box'}}>
                  <div style={{...textStyle(T2, 'label'), color: P2.ink}}>{m.name}</div>
                  <div
                    style={{
                      ...textStyle(T2, 'caption'),
                      color: P2.inkSecondary,
                      marginTop: 12,
                      lineHeight: 1.55,
                    }}
                  >
                    {m.desc}
                  </div>
                </div>
              </SurfacePanel>
            ))}
          </div>

          <div style={{position: 'absolute', left: X, top: 548}}>
            <IdTag typography={T2} palette={P2} id="node-chip" note="图标 / 名称 / 型号 / 状态点,缺一件就塌回占位符" />
          </div>
          <div style={{position: 'absolute', left: X, top: 618, display: 'flex', gap: 32}}>
            <NodeChip
              typography={T2}
              label="素材入库"
              sublabel="ASSET-01"
              icon={<SemanticIcon name="doc" size={40} color={P2.accent} />}
              color={P2.accent}
              active={p}
              width={460}
            />
            <NodeChip
              typography={T2}
              label="渲帧自查"
              sublabel="REVIEW-02"
              icon={<SemanticIcon name="search" size={40} color={P2.ink} />}
              color={P2.ink}
              active={0}
              width={460}
            />
          </div>

          <div style={{position: 'absolute', left: X, top: 790}}>
            <IdTag typography={T2} palette={P2} id="state-toggle" note="位置连续、颜色跳变:同一件事的两个状态" />
          </div>
          <div style={{position: 'absolute', left: X, top: 862}}>
            <StateToggle
              typography={T2}
              fromLabel="手工"
              toLabel="全自动"
              fromColor={P2.inkSecondary}
              toColor={P2.accent}
              progress={p}
            />
          </div>

          <div style={{position: 'absolute', left: X, top: 972}}>
            <IdTag typography={T2} palette={P2} id="status-strip" note="分段才读成可数的离散步骤" />
          </div>
          <div style={{position: 'absolute', left: X, top: 1042, width: CW}}>
            <StatusStrip
              typography={T2}
              label="质量门禁"
              count="4 / 5"
              color={P2.accent}
              segments={5}
              progress={p * 0.8}
            />
          </div>

          <div style={{position: 'absolute', left: X, top: 1160}}>
            <SurfacePanel width={CW} height={440} material="glass" raised accent={P2.accent}>
              <div style={{position: 'absolute', inset: 0, padding: 36, boxSizing: 'border-box'}}>
                <div style={{...textStyle(T2, 'h2'), color: P2.ink, marginBottom: 24}}>
                  四个原语的共同底座
                </div>
                {[
                  '质感四件套:底色 + 描边 + 投影 + 高光',
                  '高光是独立层,且必须是第一个子节点',
                  '强调色只染描边和高光,不染填充',
                  'accent 必须是 hex,alpha() 不吃色名',
                ].map((line, i) => (
                  <div
                    key={i}
                    style={{
                      ...textStyle(T2, 'label'),
                      color: P2.inkSecondary,
                      display: 'flex',
                      gap: 14,
                      marginBottom: 16,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <span style={{color: P2.accent, fontFamily: T2.families.mono, flexShrink: 0}}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span>{line}</span>
                  </div>
                ))}
              </div>
            </SurfacePanel>
          </div>
        </>
      }
    />
  );
};

/* ============ P3 数据与结构 ============ */

const KIT_3: TypographyKitName = 'modern';
const T3 = createTypography(KIT_3);
const P3 = scenePalette(300, 'dark');

// 真实数据:本样品册六页各展示的组件数(3/4/3/3/3/2 = 18)
const PER_PAGE = [3, 4, 3, 3, 3, 2];

const Page3: React.FC<PageProps> = ({local}) => {
  const p = anim(local, 0, 14);
  return (
    <StageLayers
      background={
        <BackgroundSystem
          variant="aurora"
          palette={P3}
          frame={local}
          intensity={0.62}
          seed={41}
          driftFrames={60}
        />
      }
      foreground={<ForegroundVeil />}
      midground={
        <>
          <PageHeader typography={T3} palette={P3} index={3} title="数据与结构" kit={KIT_3} />

          <div style={{position: 'absolute', left: X, top: 200, width: 640}}>
            <IdTag typography={T3} palette={P3} id="metric-cluster" note="主指标 + 表格式对齐" />
          </div>
          <div style={{position: 'absolute', left: X, top: 272}}>
            <MetricCluster
              typography={T3}
              metrics={[
                {id: 'components', label: '原生视觉组件', value: '18', unit: '个'},
                {id: 'lines', label: '组件源码行数', value: '4,054', unit: '行'},
                {id: 'kits', label: '排版套装', value: '5', unit: '套'},
                {id: 'pages', label: '样品册页数', value: '6', unit: '页'},
              ]}
              progress={p}
              accent={P3.accent}
              palette={P3}
              layout="stack"
              heroSize="h1"
              width={620}
            />
          </div>

          <div style={{position: 'absolute', left: 760, top: 200, width: 256}}>
            <IdTag typography={T3} palette={P3} id="metadata-rail" />
          </div>
          <div style={{position: 'absolute', left: 760, top: 272, width: 256}}>
            <MetadataRail
              typography={T3}
              items={[
                {label: '页码', value: 'P3 / 6'},
                {label: '排版套装', value: 'modern'},
                {label: '强调色相', value: '300°'},
                {label: '画布', value: '1080x1920'},
              ]}
              side="right"
              progress={p}
              accent={P3.accent}
              palette={P3}
            />
          </div>

          <div style={{position: 'absolute', left: X, top: 830, width: CW}}>
            <IdTag typography={T3} palette={P3} id="chart-stage" note="单系列柱图 · 单轴 · 只标末点" />
          </div>
          <div style={{position: 'absolute', left: X, top: 900}}>
            <ChartStage
              typography={T3}
              series={[
                {id: 'per-page', name: '每页组件数', values: PER_PAGE, mark: 'bar'},
              ]}
              progress={p}
              palette={P3}
              width={CW}
              height={700}
              xLabels={['P1', 'P2', 'P3', 'P4', 'P5', 'P6']}
              yTicks={4}
              yDomain={[0, 5]}
              yFormat={(v) => String(Math.round(v))}
              title="每页展示的组件数"
            />
          </div>

          <Note typography={T3} palette={P3} top={1636}>
            数字全部来自本仓库实测:18 个组件文件共 4,054 行,六页展示数之和 = 18。
          </Note>
        </>
      }
    />
  );
};

/* ============ P4 媒体与品牌 ============ */

const KIT_4: TypographyKitName = 'human';
const T4 = createTypography(KIT_4);
const P4 = scenePalette(55, 'dark');

const LOGOS = [
  {src: staticFile('catalog/logo-01.svg'), name: '占位字标 01(横排 8:3)'},
  {src: staticFile('catalog/logo-02.svg'), name: '占位图标 02(方形 1:1)'},
  {src: staticFile('catalog/logo-03.svg'), name: '占位字标 03(横排 7:3)'},
  {src: staticFile('catalog/logo-04.svg'), name: '占位图标 04(方形 1:1)'},
  {src: staticFile('catalog/logo-05.svg'), name: '占位字标 05(横排 5:2)'},
  {src: staticFile('catalog/logo-06.svg'), name: '占位图标 06(方形 1:1)'},
];

const Page4: React.FC<PageProps> = ({local}) => {
  const p = anim(local, 0, 14);
  return (
    <StageLayers
      background={
        <BackgroundSystem
          variant="grain"
          palette={P4}
          frame={local}
          intensity={0.6}
          seed={57}
          driftFrames={60}
        />
      }
      foreground={<ForegroundVeil />}
      midground={
        <>
          <PageHeader typography={T4} palette={P4} index={4} title="媒体与品牌" kit={KIT_4} />

          <div style={{position: 'absolute', left: X, top: 200, display: 'flex', gap: 18}}>
            <IdTag typography={T4} palette={P4} id="device-mockup" />
            <IdTag typography={T4} palette={P4} id="screenshot-stage" />
          </div>
          <div style={{position: 'absolute', left: 100, top: 278}}>
            <DeviceMockup
              kind="browser"
              width={880}
              height={600}
              progress={p}
              color={P4.accent}
              label={{text: 'localhost:3000', typography: T4}}
            >
              <ScreenshotStage
                src={staticFile('catalog/ui-dashboard.svg')}
                width={860}
                height={512}
                crop={{x: 0.02, y: 0, width: 0.96, height: 0.92}}
                focus={{
                  x: 0.433,
                  y: 0.613,
                  zoom: 1.12,
                  box: {x: 0.167, y: 0.374, width: 0.531, height: 0.478},
                }}
                progress={p}
                frameStyle="none"
                accent={P4.accent}
                dim={0.45}
              />
            </DeviceMockup>
          </div>

          <div style={{position: 'absolute', left: X, top: 926, width: CW}}>
            <IdTag typography={T4} palette={P4} id="logo-cloud" note="grid 3 列 · 强调第 2 个 · 其余去色压暗" />
          </div>
          <div style={{position: 'absolute', left: X, top: 996}}>
            <LogoCloud
              items={LOGOS}
              progress={p}
              layout="grid"
              columns={3}
              emphasisIndex={1}
              width={CW}
              height={520}
              seed={7}
              accent={P4.accent}
            />
          </div>

          <Note typography={T4} palette={P4} top={1560}>
            占位素材:public/catalog/*.svg,纯几何 + 固定坐标,无外链、无随机数,
            <br />
            同一份文件在任何机器上光栅化结果一致——媒体类组件的确定性由素材本身保证。
          </Note>
        </>
      }
    />
  );
};

/* ============ P5 编辑版面 ============ */

const KIT_5: TypographyKitName = 'editorial';
const T5 = createTypography(KIT_5);
const P5 = scenePalette(25, 'dark');

// weight 直接决定卡片尺寸,而卡片可以越出组件边界(拼贴的出血感)。
// 这四个权重和下面那组 width/height/left/top 是**一起算出来的**:
// seed=5 下四张卡的包围盒 = x[155, 925] / y[313, 1110],
// 上不碰 image-collage 的 id 标签(底 ~236),下不碰 kinetic-text 的标签(顶 1170)。
// 改 seed 或 weight 就要重算这个包围盒——出血量是版面的一部分,不是随手参数。
const PHOTOS = [
  {src: staticFile('catalog/photo-01.svg'), name: '占位照片 01 地平线', weight: 0.25},
  {src: staticFile('catalog/photo-02.svg'), name: '占位照片 02 建筑', weight: 0.45},
  {src: staticFile('catalog/photo-03.svg'), name: '占位照片 03 近景', weight: 0.32},
  {src: staticFile('catalog/photo-04.svg'), name: '占位照片 04 斜线', weight: 0.4},
];

const Page5: React.FC<PageProps> = ({local}) => {
  const p = anim(local, 0, 14);
  // 转场桥单独走一条更慢的进度:静帧要停在"线还在飞"的中段才看得出它是什么
  const bridgeP = Math.min(1, local / 40);
  return (
    <StageLayers
      background={
        <BackgroundSystem
          variant="ghost-type"
          typography={T5}
          text="版面"
          palette={P5}
          frame={local}
          intensity={0.7}
          seed={19}
          driftFrames={60}
        />
      }
      foreground={
        <>
          <ForegroundVeil />
          <TransitionBridge
            fromAnchor={{kind: 'line', x: 0.12, y: 0.945, angle: -12, size: 0.34}}
            toAnchor={{kind: 'dot', x: 0.88, y: 0.945, size: 0.045}}
            progress={bridgeP}
            accent={P5.accent}
            width={W}
            height={H}
          />
        </>
      }
      midground={
        <>
          <PageHeader typography={T5} palette={P5} index={5} title="编辑版面" kit={KIT_5} />

          <div style={{position: 'absolute', left: X, top: 200, width: CW}}>
            <IdTag typography={T5} palette={P5} id="image-collage" note="layout: fan · seed 5 · 四张占位图" />
          </div>
          <div style={{position: 'absolute', left: 100, top: 390}}>
            <ImageCollage
              items={PHOTOS}
              progress={p}
              layout="fan"
              seed={5}
              width={880}
              height={640}
              accent={P5.accent}
            />
          </div>

          <div style={{position: 'absolute', left: X, top: 1170, width: CW}}>
            <IdTag typography={T5} palette={P5} id="kinetic-text" note="mode: mask · 左→右擦出,不是盖色块" />
          </div>
          <div style={{position: 'absolute', left: X, top: 1244, width: CW}}>
            <KineticText
              typography={T5}
              text={'先解决表达\n再解决动画'}
              mode="mask"
              progress={p}
              role="h1"
              palette={P5}
              align="left"
            />
          </div>

          <div style={{position: 'absolute', left: X, top: 1548, width: CW}}>
            <IdTag typography={T5} palette={P5} id="transition-bridge" note="line → dot · 归一化锚点" />
          </div>
          <Note typography={T5} palette={P5} top={1620}>
            转场桥在前景层(画面下缘那条强调色线),把上一镜的落点交接到下一镜的起点。
            <br />
            速度感靠中段拉长,不靠模糊——模糊在压缩后会糊成脏东西。
          </Note>
        </>
      }
    />
  );
};

/* ============ P6 连接与三维 ============ */

const KIT_6: TypographyKitName = 'impact';
const T6 = createTypography(KIT_6);
const P6 = scenePalette(145, 'dark');

const MAP_NODES = [
  {id: 'brief', label: '需求理解', sublabel: 'BRIEF', x: 240, y: 82, width: 372},
  {id: 'board', label: '分镜设计', sublabel: 'STORYBOARD', x: 712, y: 82, width: 372},
  {id: 'build', label: '模板实现', sublabel: 'BUILD', x: 240, y: 330, width: 372},
  {id: 'check', label: '渲帧自查', sublabel: 'REVIEW', x: 712, y: 330, width: 372},
  {id: 'ship', label: '导出交付', sublabel: 'DELIVERY', x: 476, y: 578, width: 372},
];

const MAP_ICONS: Record<string, React.ReactNode> = {
  brief: <SemanticIcon name="doc" size={40} color="#7fe0b0" />,
  board: <SemanticIcon name="filter" size={40} color="#7fe0b0" />,
  build: <SemanticIcon name="duplicate" size={40} color="#7fe0b0" />,
  check: <SemanticIcon name="search" size={40} color="#7fe0b0" />,
  ship: <SemanticIcon name="check" size={40} color="#7fe0b0" />,
};

/** 3D 舞台里的场景内容。**没有 useFrame**:要动的东西全从外面把帧派生值传进来 */
const StageContent: React.FC<{spin: number; accent: string; ink: string}> = ({
  spin,
  accent,
  ink,
}) => (
  <>
    <mesh rotation={[spin * 0.7, spin, 0]} position={[-1.5, 0.1, 0]}>
      <torusKnotGeometry args={[1.0, 0.33, 180, 40]} />
      <meshStandardMaterial color={accent} metalness={0.9} roughness={0.22} envMapIntensity={1.1} />
    </mesh>
    <mesh rotation={[spin * 1.1, -spin * 0.8, spin * 0.3]} position={[1.95, -0.3, 0.4]}>
      <icosahedronGeometry args={[1.05, 0]} />
      <meshStandardMaterial color={ink} metalness={1} roughness={0.16} envMapIntensity={1.25} />
    </mesh>
  </>
);

const Page6: React.FC<PageProps> = ({local}) => {
  const p = anim(local, 0, 14);
  // 数据包位置:不钳制,取小数部分循环。任意一帧独立可算,没有时钟
  const packetProgress = local / 26;
  const spin = p * Math.PI * 0.85;

  return (
    <StageLayers
      background={
        <BackgroundSystem
          variant="aurora"
          palette={P6}
          frame={local}
          intensity={0.75}
          seed={73}
          driftFrames={60}
        />
      }
      foreground={<ForegroundVeil />}
      midground={
        <>
          <PageHeader typography={T6} palette={P6} index={6} title="连接与三维" kit={KIT_6} />

          <div style={{position: 'absolute', left: X, top: 200, width: CW}}>
            <IdTag typography={T6} palette={P6} id="connection-map" note="5 节点 / 4 条边 · 坐标由调用方钉死" />
          </div>
          <div style={{position: 'absolute', left: X, top: 272}}>
            <ConnectionMap
              typography={T6}
              nodes={MAP_NODES.map((n) => ({...n, icon: MAP_ICONS[n.id]}))}
              edges={[
                {from: 'brief', to: 'board', curve: 46, packets: 2},
                {from: 'board', to: 'build', curve: -70, packets: 1},
                {from: 'build', to: 'check', curve: 46, packets: 2},
                {from: 'check', to: 'ship', curve: 40, packets: 1},
              ]}
              progress={p}
              packetProgress={packetProgress}
              accent={P6.accent}
              width={CW}
              height={700}
            />
          </div>

          <div style={{position: 'absolute', left: X, top: 1010, width: CW}}>
            <IdTag typography={T6} palette={P6} id="three-stage" note="camera / lights / environment 全走 props · HDRI 引本地文件" />
          </div>
          <div
            style={{
              position: 'absolute',
              left: X,
              top: 1082,
              width: CW,
              height: 560,
              borderRadius: 20,
              overflow: 'hidden',
              border: `1.5px solid ${alpha(P6.accent, 0.28)}`,
              boxShadow: '0 18px 48px rgba(0,0,0,0.5)',
            }}
          >
            <ThreeStage
              camera={{
                from: {position: [0, 0.5, 7.6], fov: 34},
                to: {position: [1.1, 0.9, 6.4], fov: 34},
              }}
              lights={{
                preset: 'studio',
                intensity: 0.55,
                keyColor: P6.ink,
                rimColor: P6.accent,
              }}
              environment={{
                hdri: staticFile('hdri/studio_small_08_2k.hdr'),
                backdrop: `radial-gradient(72% 60% at 40% 40%, ${alpha(P6.accentSoft, 0.85)} 0%, ${P6.bg} 78%)`,
              }}
              progress={p}
              width={CW}
              height={560}
            >
              <StageContent spin={spin} accent={P6.accent} ink={P6.ink} />
            </ThreeStage>
          </div>

          <Note typography={T6} palette={P6} top={1682}>
            相机位姿是 progress 的纯函数,场景里一个 useFrame 都没有——
            <br />
            R3F 的时钟是墙钟时间,离线渲染时同一帧两次渲染会得到不同画面。
          </Note>
        </>
      }
    />
  );
};

/* ============ 装订 ============ */

const PAGES: React.FC<PageProps>[] = [Page1, Page2, Page3, Page4, Page5, Page6];

export const VisualCatalog: React.FC = () => {
  const frame = useCurrentFrame();
  const index = Math.min(PAGE_COUNT - 1, Math.max(0, Math.floor(frame / PAGE_LEN)));
  const local = frame - index * PAGE_LEN;
  const Page = PAGES[index];
  // 只挂载当前页:ThreeStage 的 WebGL 上下文因此只在 P6 存在,其余五页零开销
  return (
    <AbsoluteFill style={{backgroundColor: '#0b0d10'}}>
      <Page local={local} />
    </AbsoluteFill>
  );
};
