import {PresenterMaskPreload} from './PresenterPreviewMask';
import {PresenterMask} from './PresenterForeground';
import {validatePresenterLayer} from './presenter-layer.mjs';
import {CoverFrame} from './CoverFrame';
import {showCoverAtFrame} from './cover-frame.mjs';
import {AudioLayer} from './AudioLayer';
import {CaptionLayer} from './CaptionLayer';
import {SceneBackground} from './SceneBackground';
import {resolveSceneBackground} from './scene-background.mjs';
import {MediaComposition} from './MediaComposition';
import React from 'react';
import {AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig, useRemotionEnvironment} from 'remotion';
import {presetExit} from '../presets/preset-exit.mjs';
import {PresetExit} from '../presets/PresetExit';
import {PresetNumberBeat} from '../presets/NumberBeat';
import {PresetPillStack} from '../presets/PillStack';
import {PRESET_COMPOSITIONS} from '../presets';
import {ChapterProgress} from './ChapterProgress';
import {EDITOR_ASSET_BY_ID} from './assets';
import type {EditorCompositionProps, EditorInstance} from './types';
import {sortInstances} from './timing';
import {PresetEditingProvider} from './preset-editing';
import {RESPONSIVE_PRESET_IDS} from './preset-parts';
import {MediaPip} from './MediaPip';
import {SourcePip} from './SourcePip';
import {activePip} from './source-pip.mjs';
import {instanceTiming,semanticFrame} from './clip-time.mjs';
import {coversSource} from './source-occlusion.mjs';

const Asset: React.FC<{instance: EditorInstance; globalFrame: number|null; fps: number}> = ({instance, globalFrame, fps}) => {
  const canvas = useVideoConfig();
  const customBackground=resolveSceneBackground(instance.props);
  const common: Record<string, any> = {...instance.props,...(customBackground?{editorBackground:'transparent'}:{}), canvas: `${canvas.width}x${canvas.height}`, durationSeconds: instance.durationFrames / fps};
  if (common.editorBackground && common.variant && 'bg' in common.variant) common.variant = {...common.variant, bg: common.editorBackground === 'transparent' ? 'transparent' : common.variant.bg === 'transparent' ? 'scene' : common.variant.bg};
  if (['media-stack','media-split'].includes(instance.assetId)) return <MediaComposition instance={customBackground?{...instance,props:{...instance.props,editorBackground:'transparent'}}:instance}/>;
  if (instance.assetId === 'chapter-progress') return globalFrame===null?null:<ChapterProgress {...(common as React.ComponentProps<typeof ChapterProgress>)} globalFrame={globalFrame} />;
  if (instance.assetId === 'number-beat') return <PresetExit durationSeconds={common.durationSeconds}><PresetNumberBeat {...(common as React.ComponentProps<typeof PresetNumberBeat>)} /></PresetExit>;
  if (instance.assetId === 'pill-stack') return <PresetExit durationSeconds={common.durationSeconds}><PresetPillStack {...(common as React.ComponentProps<typeof PresetPillStack>)} /></PresetExit>;
  const metadata = EDITOR_ASSET_BY_ID.get(instance.assetId);
  const preset = PRESET_COMPOSITIONS.find((candidate) => candidate.id === metadata?.compositionId);
  if (!preset) throw new Error(`Missing preset component for editor asset: ${instance.assetId}`);
  const Component = preset.component;
  const savedTune = common.tune ?? {};
  const defaultTune = (preset.defaultProps.tune ?? {}) as Record<string, any>;
  const componentProps = {
    ...common,
    tune: {...savedTune, x: defaultTune.x ?? 0, y: defaultTune.y ?? 0, scale: defaultTune.scale ?? 1},
  };
  const supported = metadata?.canvas.map((size) => /^(\d+)x(\d+)$/.exec(size)).filter((size): size is RegExpExecArray => Boolean(size)) ?? [];
  const sameOrientation = supported.find((size) => (Number(size[1]) >= Number(size[2])) === (canvas.width >= canvas.height));
  const native = sameOrientation ?? supported[0];
  const responsive = RESPONSIVE_PRESET_IDS.has(instance.assetId);
  const width = responsive ? canvas.width : native ? Number(native[1]) : canvas.width;
  const height = responsive ? canvas.height : native ? Number(native[2]) : canvas.height;
  const fitScale = Math.min(canvas.width / width, canvas.height / height);
  const x = Number(savedTune.x ?? 0);
  const y = Number(savedTune.y ?? 0);
  const tuneScale = Number(savedTune.scale ?? 1);
  return <Sequence from={0} durationInFrames={instance.durationFrames} width={width} height={height} style={{position: 'absolute', left: '50%', top: '50%', width, height, transform: `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${fitScale * tuneScale})`, transformOrigin: 'center'}}><div data-editor-part="asset" style={{position: 'absolute', inset: 0}}><Component {...componentProps} /></div></Sequence>;
};

/** Include a custom scene background in the same exit; nested registry exits are idempotent. */
const PresenterOcclusion: React.FC<{document:EditorCompositionProps['document'];instance:EditorInstance;frame:number;children:React.ReactNode}>=({document,instance,frame,children})=>instance.props.presenterLayer==='behind'?<PresenterMask document={document} instance={instance} frame={frame}>{children}</PresenterMask>:<>{children}</>;

const InstanceExit: React.FC<{instance: EditorInstance; fps: number; children: React.ReactNode}> = ({instance, fps, children}) => {
  if(instance.assetId==='behind-title' || (instance.assetId==='recede' && instance.props.slots?.exitFx !== undefined))return <>{children}</>;
  const compositionId = EDITOR_ASSET_BY_ID.get(instance.assetId)?.compositionId;
  const isPreset = PRESET_COMPOSITIONS.some((preset) => preset.id === compositionId);
  return isPreset ? <PresetExit durationSeconds={instance.durationFrames / fps}>{children}</PresetExit> : <>{children}</>;
};

export const EditorComposition: React.FC<EditorCompositionProps> = ({document, renderMode, instanceId, rangeStartFrame = 0, onSelect, previewSource}) => {
  const frame = useCurrentFrame();
  const globalFrame = frame + rangeStartFrame;
  const fps = document.canvas.fps.num / document.canvas.fps.den;
  const selected = sortInstances(document.instances).filter((instance: EditorInstance) => (!instanceId || instance.id === instanceId) && !instance.disabled && !document.tracks?.find(t=>t.id===instance.trackId)?.disabled);
  const source = document.source?.publicPath ?? document.source?.path;
  const {isPlayer} = useRemotionEnvironment();
  // Video is a separate browser compositing surface. At fractional preview scales
  // its edge can bleed through an opaque scene despite identical DOM bounds.
  // Keep the video mounted for continuous audio; export rendering is unchanged.
  const pip = activePip(document.source, selected, globalFrame);
  const behind=selected.filter(i=>i.props.presenterLayer==='behind' && globalFrame>=i.startFrame && globalFrame<i.startFrame+i.durationFrames);
  for(const i of behind)validatePresenterLayer(document,i);
  if(behind.length && (renderMode!=='full'||pip))throw Error('人物背后层需要完整底片合成；请关闭重叠真人小窗并导出完整视频');
  const sourceCovered = isPlayer && selected.some((instance) => {
    if(instance.props.presenterLayer==='behind')return false;
    const asset = EDITOR_ASSET_BY_ID.get(instance.assetId);
    const isPreset = PRESET_COMPOSITIONS.some((preset) => preset.id === asset?.compositionId);
    const opacity = isPreset && !(instance.assetId === 'recede' && instance.props.slots?.exitFx !== undefined) ? presetExit(globalFrame - instance.startFrame + instanceTiming(instance).offset, fps, instanceTiming(instance).duration / fps).opacity : 1;
    return coversSource(instance, asset, RESPONSIVE_PRESET_IDS.has(instance.assetId), globalFrame, opacity);
  });
  return <AbsoluteFill style={{backgroundColor: renderMode === 'full' ? '#111318' : undefined}} onClick={(event) => {
    if (!onSelect) return;
    const target = (event.target as HTMLElement).closest('[data-editor-instance]');
    if (target) onSelect(target.getAttribute('data-editor-instance') ?? '', (event.target as HTMLElement).closest('[data-editor-part]')?.getAttribute('data-editor-part') ?? undefined);
  }}>
    {isPlayer&&<PresenterMaskPreload document={document} instances={selected} frame={globalFrame}/>}
    {renderMode==='full'?<AudioLayer document={document} rangeStartFrame={rangeStartFrame}/>:null}
    {source && (renderMode === 'full' || pip) ? <SourcePip document={document} previewSource={previewSource} instance={pip} rangeStartFrame={rangeStartFrame} muted={renderMode !== 'full'} hidden={!pip && !behind.length && (sourceCovered || !!(document.source as any)?.previewHidden)} /> : null}
    {selected.filter((instance) => instance.assetId !== 'source-pip').map((instance: EditorInstance) => <Sequence key={instance.id} from={instance.startFrame - rangeStartFrame} durationInFrames={instance.durationFrames} layout="absolute-fill" style={{zIndex: instance.zIndex*2}}><Sequence from={-instanceTiming(instance).offset} durationInFrames={instanceTiming(instance).duration} layout="none"><div data-editor-instance={instance.id} style={{position: 'absolute', inset: 0}}><PresenterOcclusion document={document} instance={instance} frame={globalFrame}><InstanceExit instance={{...instance,durationFrames:instanceTiming(instance).duration}} fps={fps}><SceneBackground props={instance.props} document={document} timelineStartFrame={instance.startFrame-instanceTiming(instance).offset} previewSource={previewSource}/><PresetEditingProvider elements={instance.props.elements} background={resolveSceneBackground(instance.props)?'transparent':instance.props.editorBackground}><Asset instance={{...instance,durationFrames:instanceTiming(instance).duration}} globalFrame={semanticFrame(document,instance,globalFrame)} fps={fps} /></PresetEditingProvider></InstanceExit></PresenterOcclusion></div></Sequence></Sequence>)}
    {selected.filter(i=>i.assetId==='source-pip').map(i=><Sequence key={`background-${i.id}`} from={i.startFrame-rangeStartFrame} durationInFrames={i.durationFrames} layout="absolute-fill" style={{zIndex:i.zIndex*2,pointerEvents:resolveSceneBackground(i.props)?'auto':'none'}}><div data-editor-instance={i.id} style={{position:'absolute',inset:0}}><SceneBackground props={i.props} document={document} timelineStartFrame={i.startFrame} previewSource={previewSource}/></div></Sequence>)}
    {selected.filter(i=>i.assetId==='source-pip' && i.id!==pip?.id).map(i=><Sequence key={i.id} from={i.startFrame-rangeStartFrame} durationInFrames={i.durationFrames} premountFor={Math.round(fps)} style={{zIndex:i.zIndex*2+1,pointerEvents:'none'}}>
      {i.props.sourceMode==='media'?<Sequence from={-instanceTiming(i).offset} durationInFrames={instanceTiming(i).duration} layout="none"><MediaPip instance={{...i,durationFrames:instanceTiming(i).duration}} hidden={globalFrame<i.startFrame}/></Sequence>:<SourcePip document={document} instance={i} rangeStartFrame={i.startFrame} hidden={globalFrame<i.startFrame} muted/>}
    </Sequence>)}
    <CaptionLayer track={document.captions} frame={globalFrame} width={document.canvas.width} height={document.canvas.height} renderMode={renderMode} interactive={isPlayer}/>
    {showCoverAtFrame(document,renderMode,globalFrame)&&<CoverFrame publicPath={document.cover!.publicPath}/>}
  </AbsoluteFill>;
};
