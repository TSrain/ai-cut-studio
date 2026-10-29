// 视觉原语库。**写任何新镜头之前先查 docs/component-catalog.md,
// 默认动作是复用 + 调参,不是手搓。**
//
// 追加新组件时:一行一个 export,按组件名字母序插入,值导出与类型导出相邻。
// 不要合并成一个大对象——那样 tree-shaking 失效,diff 也会互相打架。

export {BackgroundSystem, mulberry32} from './BackgroundSystem';
export type {BackgroundSystemProps, BackgroundVariant} from './BackgroundSystem';

export {ChartStage} from './ChartStage';
export type {ChartStageProps, ChartSeries, ChartMark, ChartPointLabel} from './ChartStage';

export {ConnectionMap, layoutAt} from './ConnectionMap';
export type {ConnectionMapProps, MapNode, MapEdge} from './ConnectionMap';

export {DeviceMockup} from './DeviceMockup';
export type {DeviceMockupProps, DeviceKind, DeviceLabel} from './DeviceMockup';

export {FilmGrain} from './FilmGrain';
export type {FilmGrainProps} from './FilmGrain';

export {HeroFrame} from './HeroFrame';
export type {HeroFrameProps} from './HeroFrame';

export {ImageCollage} from './ImageCollage';
export type {ImageCollageProps, CollageItem} from './ImageCollage';

export {KineticText} from './KineticText';
export type {KineticTextProps, KineticMode} from './KineticText';

export {LogoCloud} from './LogoCloud';
export type {LogoCloudProps, LogoItem} from './LogoCloud';

export {MetadataRail} from './MetadataRail';
export type {MetadataRailProps, MetadataItem} from './MetadataRail';

export {MetricCluster} from './MetricCluster';
export type {MetricClusterProps, Metric} from './MetricCluster';

export {NodeChip} from './NodeChip';
export type {NodeChipProps} from './NodeChip';

export {ScreenshotStage} from './ScreenshotStage';
export type {ScreenshotStageProps, ScreenshotCrop, ScreenshotFocus} from './ScreenshotStage';

export {ShimmerSweep} from './ShimmerSweep';
export type {ShimmerSweepProps} from './ShimmerSweep';

export {StageLayers} from './StageLayers';
export type {StageLayersProps, StageSafeArea} from './StageLayers';

export {StateToggle} from './StateToggle';
export type {StateToggleProps} from './StateToggle';

export {StatusStrip} from './StatusStrip';
export type {StatusStripProps} from './StatusStrip';

export {SurfacePanel, panelSurface, PANEL_SHEEN} from './SurfacePanel';
export type {SurfacePanelProps, PanelMaterial} from './SurfacePanel';

export {ThreeStage} from './ThreeStage';
export type {
  ThreeStageProps,
  ThreeCameraPose,
  ThreeCameraSpec,
  ThreeLightRig,
  ThreeEnvironment,
} from './ThreeStage';

export {TransitionBridge} from './TransitionBridge';
export type {TransitionBridgeProps, BridgeAnchor, BridgeAnchorKind} from './TransitionBridge';

export {Vignette} from './Vignette';
export type {VignetteProps} from './Vignette';

export {PageCam} from './PageCam';
export type {PageCamKey} from './PageCam';

export {DepthCam} from './DepthCam';
export type {DepthCamKey, DepthLayer} from './DepthCam';
