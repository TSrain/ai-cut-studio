import {defaultMediaProps} from './media-layout.mjs';
import {PIP_DEFAULTS} from './source-pip.mjs';
import {PRESET_COMPOSITIONS} from '../presets';
import {GENERATED_PRESET_CATALOG} from './preset-catalog.generated';
import {EDITABLE_PRESET_PARTS} from './preset-parts';
import type {EditorAsset, EditorAssetId, EditorDocument, EditorInstance} from './types';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const registry = new Map(PRESET_COMPOSITIONS.map((preset) => [preset.id, preset]));
const editableParts = (id: string) => id === 'chapter-navigation' ? [{id: 'title', label: '总览标题'}, {id: 'currentTitle', label: '当前章节标题'}, {id: 'item-N', label: '章节条目'}, {id: 'panel', label: '承托面板'}] : EDITABLE_PRESET_PARTS[id] ?? [];
const outputMode = (output: Record<string, unknown>): EditorAsset['exportBackground'] => 'alphaWhen' in output ? {mode: 'conditional', ...output.alphaWhen as {variantKey: string; value: string}} : {mode: 'opaque'};

const presetAssets: EditorAsset[] = GENERATED_PRESET_CATALOG.map((metadata) => {
  const preset = registry.get(metadata.compositionId);
  if (!preset) throw new Error(`Editor catalog composition is not registered: ${metadata.compositionId}`);
  const defaultProps = clone(preset.defaultProps) as Record<string, any>;
  if (metadata.id === 'number-beat') {
    defaultProps.variant = {...defaultProps.variant, layout: 'side', align: 'left', bg: 'transparent', celebrate: 'none'};
    defaultProps.elements = {number: {}, unit: {}, label: {}};
  }
  if (metadata.id === 'pill-stack') {
    defaultProps.preview = false;
    defaultProps.elements = {title: {}, 'item-0': {}, 'item-1': {}, 'item-2': {}};
  }
  const editorOverlay = metadata.id === 'number-beat';
  const tuneFields = ['scale', 'x', 'y'].filter((key) => Object.hasOwn(defaultProps.tune ?? {}, key)).map((key) => `tune.${key}`);
  return {...metadata, defaultProps, parts: editableParts(metadata.id), fields: [...Object.keys(metadata.slots).map((key) => `slots.${key}`), ...Object.keys(metadata.variants).map((key) => `variant.${key}`), ...tuneFields], slotDescriptors: metadata.slots, variantDescriptors: metadata.variants, exportBackground: editorOverlay ? {mode: 'transparent'} : outputMode(metadata.output)};
});

const chapterAsset: EditorAsset = {id: 'chapter-progress', name: '章节进度', compositionId: 'EditorChapterProgress', version: 1, status: 'editor', description: '按全片时间显示章节位置与当前进度。', thumbnail: null, canvas: ['any'], duration: {min: 0, max: Number.MAX_SAFE_INTEGER, default: 0}, slots: {}, variants: {}, slotDescriptors: {}, variantDescriptors: {}, exportBackground: {mode: 'transparent'}, defaultProps: {chapters: [], thickness: 8, showLabels: true, gap: 6, completedColor: '#697386', activeColor: '#f2a93b', futureColor: '#303746', variant: {align: 'left', bg: 'transparent'}, tune: {x: 0, y: 0, scale: 1}, elements: {bar: {}}}, parts: [{id: 'bar', label: '进度条'}], fields: ['thickness', 'gap', 'showLabels', 'completedColor', 'activeColor', 'futureColor']};

const pipAsset: EditorAsset = {id:'source-pip', name:'主轨同步小窗', compositionId:'EditorSourcePip', version:1,status:'editor',description:'默认同步主轨，也可指定独立视频或图片；支持多个小窗叠放、自由裁切与进出场。',thumbnail:null,canvas:['any'],duration:{min:0.1,max:3600,default:6},slots:{},variants:{},slotDescriptors:{},variantDescriptors:{},exportBackground:{mode:'transparent'},defaultProps:{...PIP_DEFAULTS},parts:[],fields:[]};
const mediaAssets:EditorAsset[] = (['media-stack','media-split'] as const).map(id=>({id,name:id==='media-stack'?'截图堆叠':'素材分屏',compositionId:id==='media-stack'?'EditorMediaStack':'EditorMediaSplit',version:1,status:'editor',description:id==='media-stack'?'1–9 张真实截图或视频，可逐项裁切、错峰入场与排列。':'1–4 段依次从全屏进入分屏、交替替换；保留普通双分屏。',thumbnail:null,canvas:['any'],duration:{min:.1,max:3600,default:6},slots:{},variants:{},slotDescriptors:{},variantDescriptors:{},exportBackground:{mode:'opaque'},defaultProps:defaultMediaProps(id),parts:[],fields:[]}));
export const EDITOR_ASSETS: EditorAsset[] = [...mediaAssets, pipAsset, chapterAsset, ...presetAssets];
export const EDITOR_ASSET_BY_ID = new Map(EDITOR_ASSETS.map((asset) => [asset.id, asset]));
const nextDocumentId = (document: EditorDocument) => { const used = new Set(document.instances.map((instance) => instance.id)); let suffix = 1; while (used.has(`asset-${suffix}`)) suffix++; return `asset-${suffix}`; };

export const makeEditorInstance = (assetId: string, document: EditorDocument, startFrame = 0): EditorInstance => {
  const asset = EDITOR_ASSET_BY_ID.get(assetId as EditorAssetId);
  if (!asset) throw new Error(`Unknown editor asset: ${assetId}`);
  const lastFrame = Math.max(0, document.canvas.durationFrames - 1);
  const requestedStart = Math.max(0, Math.min(Math.round(startFrame), lastFrame));
  const start = assetId === 'chapter-progress' ? 0 : requestedStart;
  const preferredFrames = Math.round(asset.duration.default * document.canvas.fps.num / document.canvas.fps.den);
  const defaultDuration = assetId === 'chapter-progress' ? document.canvas.durationFrames : preferredFrames;
  const durationFrames = Math.max(1, Math.min(defaultDuration, document.canvas.durationFrames - start));
  const props: any = clone(asset.defaultProps);
  if (assetId === 'chapter-progress') { const end = document.canvas.durationFrames; const count = Math.min(3, end); props.chapters = Array.from({length: count}, (_, index) => ({id: `chapter-${index + 1}`, title: `章节 ${index + 1}（待导入字幕）`, startFrame: Math.floor(index * end / count), endFrame: Math.floor((index + 1) * end / count), sourceCueIds: []})); }
  props.canvas = `${document.canvas.width}x${document.canvas.height}`;
  props.durationSeconds = durationFrames * document.canvas.fps.den / document.canvas.fps.num;
  return {id: nextDocumentId(document), assetId: asset.id as EditorAssetId, assetVersion: asset.version, startFrame: start, durationFrames, zIndex: document.instances.reduce((max, item) => Math.max(max, item.zIndex), -1) + 1, props};
};
