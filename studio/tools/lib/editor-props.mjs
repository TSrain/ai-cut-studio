import {validateSceneBackground} from '../../templates/remotion-base/src/editor/scene-background.mjs';
import {isMediaAsset,validateMediaProps} from '../../templates/remotion-base/src/editor/media-layout.mjs';
import {PIP_MOTIONS} from '../../templates/remotion-base/src/editor/source-pip.mjs';
import { validateChapters } from "./editor-store.mjs";
import {presetCatalogById} from './preset-catalog.mjs';
import {existsSync, readFileSync, realpathSync} from 'node:fs';
import {isAbsolute, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const presets = presetCatalogById();
const DEFAULT_PUBLIC_ROOT = resolve(fileURLToPath(new URL('../../templates/remotion-base/public', import.meta.url)));
const GENERATED_SCHEMAS = fileURLToPath(new URL('./editor-preset-schemas.generated.json', import.meta.url));
const readSchemas = () => JSON.parse(readFileSync(GENERATED_SCHEMAS, 'utf8'));
const fail = (message) => {
  throw new Error(message);
};
const str = (v, label) => {
  if (typeof v !== "string") fail(label + "必须是文字");
};
const num = (v, label, min, max) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max)
    fail(label + "超出范围");
};
const schemaValue = (value, schema, label, {required = true} = {}) => {
  if (value === undefined) { if (required) fail(`${label}不能为空`); return; }
  if (schema.anyOf) {
    if (!schema.anyOf.some((candidate) => { try { schemaValue(value, candidate, label); return true; } catch { return false; } })) fail(`${label}不是支持的值`);
    return;
  }
  if (schema.const !== undefined && value !== schema.const) fail(`${label}不是支持的值`);
  if (schema.enum && !schema.enum.includes(value)) fail(`${label}不是支持的选项`);
  if (schema.type === 'string' && typeof value !== 'string') fail(`${label}必须是文字`);
  if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (schema.type === 'integer' && !Number.isInteger(value))) fail(`${label}必须是${schema.type === 'integer' ? '整数' : '数字'}`);
    if (schema.minimum !== undefined && value < schema.minimum) fail(`${label}不能小于 ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) fail(`${label}不能大于 ${schema.maximum}`);
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) fail(`${label}必须是列表`);
    if (schema.minItems !== undefined && value.length < schema.minItems) fail(`${label}至少需要 ${schema.minItems} 项`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(`${label}最多允许 ${schema.maxItems} 项`);
    value.forEach((item, index) => schemaValue(item, schema.items ?? {}, `${label}第 ${index + 1} 项`));
  }
};
const validateSchemaSection = (value, schema, label, {enforceRequired = false} = {}) => {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}格式无效`);
  const properties = schema?.properties ?? {};
  if (schema?.additionalProperties === false) for (const key of Object.keys(value)) if (!properties[key]) fail(`${label}包含不支持的字段：${key}`);
  for (const [key, fieldSchema] of Object.entries(properties)) schemaValue(value[key], fieldSchema, `${label}.${key}`, {required: enforceRequired && (schema.required ?? []).includes(key) && fieldSchema.default === undefined});
};
const materialPath = (value, descriptor, publicRoot, label, requireAssets) => {
  if (typeof value !== 'string' || !value.trim()) return;
  if (isAbsolute(value) || value.includes('\0')) fail(`${label}必须是 public 内的相对路径`);
  const clean = value.replaceAll('\\', '/');
  if (clean.split('/').some((part) => part === '..' || part === '')) fail(`${label}必须是安全的相对路径`);
  const rel = clean.includes('/') ? clean : `${descriptor.assetDir ? `${descriptor.assetDir}/` : ''}${clean}`;
  const target = resolve(publicRoot, rel);
  const escaped = relative(resolve(publicRoot), target);
  if (escaped === '..' || escaped.startsWith(`..${sep}`) || isAbsolute(escaped)) fail(`${label}超出 public 素材目录`);
  if (!requireAssets) return;
  if (!existsSync(target)) fail(`${label}素材不存在：public/${rel}`);
  const actual = realpathSync(target); const realRel = relative(realpathSync(publicRoot), actual);
  if (realRel === '..' || realRel.startsWith(`..${sep}`) || isAbsolute(realRel)) fail(`${label}素材通过符号链接离开 public 目录`);
};
export function validateEditorProps(instance, durationFrames, {requireAssets = false, publicRoot = DEFAULT_PUBLIC_ROOT, fps} = {}) {
  const p = instance.props;
  if(requireAssets&&instance.assetId==='behind-title'&&p.presenterLayer!=='behind')fail('人物身后大字尚未完成抠像，请先准备人物前景');
  validateSceneBackground(p.sceneBackground);
  if(instance.assetId === "chapter-navigation" && p.slots && (!Number.isInteger(p.slots.activeIndex) || p.slots.activeIndex < 0 || p.slots.activeIndex >= p.slots.items?.length)) fail("当前章节必须在章节列表范围内");
  if(p.editorBackground !== undefined && !["original","transparent"].includes(p.editorBackground)) fail("背景模式无效");
  if(isMediaAsset(instance.assetId)) {
    validateMediaProps(instance.assetId,p,{durationSeconds:fps ? (instance.sourceDurationFrames??instance.durationFrames)/fps : p.durationSeconds,requireAssets,fps});
    for(const item of p.items) if(item.media) materialPath(item.media.publicPath,{},publicRoot,'组合素材',requireAssets);
    return;
  }
  if(instance.assetId==='media-stage') {
    const s=p.slots??{};
    if(typeof s.title!=='string'||!s.title.trim()||/[\r\n]/.test(s.title)) fail('请输入一行非空标题');
    if(requireAssets&&!s.image&&!s.clip) fail('标题素材展示缺少图片或视频');
    if(s.clip&&(!Number.isFinite(s.srcDur)||s.srcDur<=0)) fail('请重新导入视频以取得真实时长');
    if(s.clip&&(s.startSeconds??0)>=s.srcDur) fail('视频起点必须小于素材时长');
  }
  const preset = presets.get(instance.assetId);
  if (!['chapter-progress','source-pip'].includes(instance.assetId) && !preset) fail(`未知模板：${instance.assetId}`);
  if (instance.assetId === 'source-pip') {
    for(const key of ['offsetX','offsetY']) if(p[key] !== undefined) num(p[key],key,-32768,32768);
    if(p.sourceMode !== undefined && !['main','media'].includes(p.sourceMode)) fail('小窗画面来源无效');
    if(requireAssets && p.sourceMode === 'media' && p.media == null) fail('独立小窗缺少素材');
    if(p.media != null) {
      const m=p.media;
      if(!m || !['video','image'].includes(m.kind)) fail('小窗素材类型无效');
      if(typeof m.publicPath !== 'string' || !m.publicPath) fail('小窗素材路径不能为空');
      materialPath(m.publicPath,{},publicRoot,'小窗素材',requireAssets);
      num(m.width,'素材宽度',1,32768);num(m.height,'素材高度',1,32768);
      if(m.kind==='video') {
        num(m.durationSeconds,'素材时长',.001,86400);
        num(m.startSeconds??0,'素材起点',0,m.durationSeconds-.001);
      }
    }
    for (const [key,min,max] of [['size' ,10,300],['x',0,100],['y',0,100],['cropX',0,100],['cropY',0,100],['radius',0,300],['borderWidth',0,80],['shadow',0,100],['transitionSeconds',0,2]]) if(p[key] !== undefined) num(p[key],key,min,max);
    if(p.entrance !== undefined && ![...PIP_MOTIONS,'shrink'].includes(p.entrance)) fail('小窗入场方式无效');
    if(p.exit !== undefined && ![...PIP_MOTIONS,'expand'].includes(p.exit)) fail('小窗退场方式无效');
    if (p.crop !== undefined) {
      if (!p.crop || typeof p.crop !== 'object') fail('裁切区域格式无效');
      for (const k of ['x','y']) num(p.crop[k],`裁切 ${k}`,0,1);
      for (const k of ['width','height']) num(p.crop[k],`裁切 ${k}`,.05,1);
      num(p.crop.sourceAspect,'原视频比例',.01,100);
      if(p.crop.x+p.crop.width>1.000001 || p.crop.y+p.crop.height>1.000001) fail('裁切区域超出原视频');
    }
    if(p.borderColor !== undefined && !/^#[0-9a-f]{6}$/i.test(p.borderColor)) fail('小窗边框颜色无效');
  }
  if (instance.assetId === "number-beat") {
    if (!p.slots) fail("数字资产缺少内容");
    num(p.slots.value, "数值", -1e12, 1e12);
    str(p.slots.label, "说明");
    if (p.slots.prefix !== undefined) str(p.slots.prefix, "前缀");
    if (p.slots.suffix !== undefined) str(p.slots.suffix, "单位");
    if (p.variant?.layout === "side" && p.variant?.celebrate === "confetti")
      fail("透明侧边数字不支持纸屑，请使用原整镜数字模板");
  } else if (instance.assetId === "pill-stack") {
    if (
      !Array.isArray(p.slots?.items) ||
      !p.slots.items.length ||
      p.slots.items.length > 20
    )
      fail("标签应包含 1–20 项");
    p.slots.items.forEach((t) => str(t, "标签"));
    if (p.slots.title !== undefined) str(p.slots.title, "标题");
  } else if (instance.assetId === "chapter-progress") {
    validateChapters(p.chapters, { durationFrames });
    if (p.thickness !== undefined) num(p.thickness, "进度条厚度", 1, 200);
    if (p.gap !== undefined) num(p.gap, "章节间距", 0, 200);
    for (const span of p.hiddenIntervals ?? []) {
      num(span.startFrame, "隐藏开始帧", 0, durationFrames - 1);
      num(span.endFrame, "隐藏结束帧", span.startFrame + 1, durationFrames);
    }
  }
  if (preset) {
    if (instance.assetId === 'recede' && p.slots?.emphasisRanges !== undefined) {
      const ranges = p.slots.emphasisRanges;
      if (!Array.isArray(ranges) || ranges.some(r => !Number.isInteger(r?.start) || !Number.isInteger(r?.end) || r.start < 0 || r.end <= r.start || r.end > String(p.slots.line ?? '').length)) fail('退让镜放大范围超出文字边界');
    }
    if (!p.slots || typeof p.slots !== 'object' || Array.isArray(p.slots)) fail(`${preset.name}缺少内容槽位`);
    for (const [key, descriptor] of Object.entries(preset.slots ?? {})) {
      const value = p.slots[key];
      if (descriptor.required && (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0))) {
        const material = descriptor.type === 'image' ? '图片素材' : descriptor.type === 'video' ? '视频素材' : '内容';
        fail(`${preset.name}缺少${descriptor.label ?? key}${material === '内容' ? '' : `（${material}必须先放入本地 public/${descriptor.assetDir ?? ''}）`}`);
      }
      if (value === undefined || value === null) continue;
      if (['text', 'image', 'video'].includes(descriptor.type)) str(value, descriptor.label ?? key);
      if (descriptor.type === 'number') num(value, descriptor.label ?? key, -1e12, 1e12);
      if (descriptor.type === 'list') {
        if (!Array.isArray(value)) fail(`${descriptor.label ?? key}必须是列表`);
        const min = descriptor.minItems ?? (descriptor.required ? 1 : 0);
        const max = descriptor.maxItems ?? 1000;
        if (value.length < min || value.length > max) fail(`${descriptor.label ?? key}应包含 ${min}–${max} 项`);
        value.forEach((item) => str(item, descriptor.label ?? key));
      }
      if (descriptor.type === 'image' || descriptor.type === 'video') materialPath(value, descriptor, publicRoot, `${preset.name}.${descriptor.label ?? key}`, requireAssets);
    }
    for (const [key, descriptor] of Object.entries(preset.variants ?? {})) {
      const value = p.variant?.[key] ?? descriptor.default;
      if (value !== undefined && descriptor.type === 'enum' && !descriptor.values?.includes(value)) fail(`${descriptor.label ?? key}不是支持的选项`);
    }
    const schema = readSchemas()[preset.compositionId];
    if (!schema) fail(`${preset.name}缺少生成的参数 schema`);
    validateSchemaSection(p.slots, schema.properties?.slots, `${preset.name}.内容`, {enforceRequired: true});
    // number-beat has editor-only side/align/bg variants; validate documented keys without rejecting those adapter keys.
    const variantSchema = schema.properties?.variant;
    if (variantSchema) validateSchemaSection(p.variant, instance.assetId === 'number-beat' ? {...variantSchema, additionalProperties: true} : variantSchema, `${preset.name}.变体`);
  }
  if (p.tune?.scale !== undefined) num(p.tune.scale, "整体缩放", 0.1, 3);
  if (p.tune?.x !== undefined) num(p.tune.x, "整体横向位置", -8192, 8192);
  if (p.tune?.y !== undefined) num(p.tune.y, "整体纵向位置", -8192, 8192);
  for (const style of Object.values(p.elements ?? {})) {
    if (!style || typeof style !== "object" || Array.isArray(style))
      fail("小项样式格式无效");
    for (const [key, value] of Object.entries(style)) {
      if (
        ["fontFamily", "textAlign", "color", "backgroundColor"].includes(key)
      ) {
        str(value, key);
        continue;
      }
      const bounds = {
        fontSize: [1, 500],
        fontWeight: [100, 900],
        lineHeight: [0.5, 3],
        letterSpacing: [-10, 80],
        width: [20, 4096],
        x: [-8192, 8192],
        y: [-8192, 8192],
        opacity: [0, 1],
        padding: [0, 200],
        borderRadius: [0, 200],
      }[key];
      if (!bounds) fail("不支持的小项参数：" + key);
      num(value, key, ...bounds);
    }
  }
  return instance;
}
