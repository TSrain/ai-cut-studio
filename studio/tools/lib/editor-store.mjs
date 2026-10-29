import {validateRoughcut} from '../editor/roughcut-model.mjs';
import {normalizePlan,reconcilePlan,currentPlanMarkdown} from './production-plan-model.mjs';
import {artifactRootDefault,atomicJson,atomicText,withProjectLock,validateProjectRoot,canonicalPath,indexedPath,snapshotReferences,restoreReferences,migrateDirectory} from './production-plan-storage.mjs';
import {validateCaptionTrack} from '../../templates/remotion-base/src/editor/captions.mjs';
import {validateShotPlan} from './aroll-shot-plan.mjs';
import { createHash } from 'node:crypto';
import {
  existsSync,
  statSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {presetCatalogById} from './preset-catalog.mjs';

const ASSET_IDS = new Set(['media-stack', 'media-split', 'source-pip', 'chapter-progress', ...presetCatalogById().keys()]);
const DEFAULT_ROOT = join(process.cwd(), 'workspace', 'editor-projects');

function fail(message) {
  throw new Error(`Invalid editor document: ${message}`);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function integer(value, label, { min = 0, positive = false } = {}) {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || (positive && value === 0)) {
    fail(`${label} must be ${positive ? 'a positive' : 'a non-negative'} finite integer`);
  }
}

function text(value, label, { empty = false } = {}) {
  if (typeof value !== 'string' || (!empty && value.trim() === '')) fail(`${label} must be a non-empty string`);
}

function safeId(value) {
  text(value, 'id');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) || value === '.' || value === '..') fail('id contains unsafe characters');
}

function safeRelativePath(value, label) {
  text(value, label);
  if (isAbsolute(value) || value.includes('\0')) fail(`${label} must be a safe relative path`);
  const parts = value.replaceAll('\\', '/').split('/');
  if (parts.some((part) => part === '..' || part === '')) fail(`${label} must be a safe relative path`);
}

function validateJson(value, label, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`${label} contains an invalid finite number`);
    return;
  }
  if (typeof value !== 'object' || seen.has(value)) fail(`${label} must contain JSON values only`);
  seen.add(value);
  if (Array.isArray(value)) {
    const indexKeys = Array.from({ length: value.length }, (_, index) => String(index));
    if (indexKeys.some((key) => !Object.hasOwn(value, key))) fail(`${label} must be a dense JSON array`);
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== indexKeys.length + 1 || ownKeys.some((key) => key !== 'length' && !indexKeys.includes(key))) {
      fail(`${label} must not have extra array properties`);
    }
    indexKeys.forEach((key, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail(`${label} must contain enumerable data properties only`);
      validateJson(descriptor.value, `${label}[${index}]`, seen);
    });
  } else {
    if (!isPlainObject(value)) fail(`${label} must contain plain JSON objects only`);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') fail(`${label} must contain string JSON properties only`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor.enumerable) fail(`${label} must contain enumerable JSON properties only`);
      if (!Object.hasOwn(descriptor, 'value')) fail(`${label} must contain data properties only`);
      validateJson(descriptor.value, `${label}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function ensureInside(rootDir, relativePath, label) {
  safeRelativePath(relativePath, label);
  const root = resolve(rootDir);
  const target = resolve(root, relativePath);
  const rel = relative(root, target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) fail(`${label} escapes its root`);
  return target;
}

export function validateDocument(document, { expectedAssetSourceHash } = {}) {
  if (!isPlainObject(document)) fail('document must be an object');
  if (document.schemaVersion !== 1) fail('schemaVersion must be 1');
  safeId(document.id);
  text(document.name, 'name');
  integer(document.revision, 'revision');

  if(document.roughcut!==undefined){validateJson(document.roughcut,'roughcut');validateRoughcut(document.roughcut);}
  if(document.productionPlan!==undefined) normalizePlan(document.productionPlan);
  if(document.projectBinding!==undefined){validateJson(document.projectBinding,'projectBinding');if(document.projectBinding.projectId!==document.id||document.projectBinding.version!==1||!isAbsolute(document.projectBinding.projectRoot))fail('invalid project binding');}
  const canvas = document.canvas;
  if (!isPlainObject(canvas) || !isPlainObject(canvas.fps)) fail('canvas and canvas.fps are required');
  integer(canvas.width, 'canvas.width', { positive: true });
  integer(canvas.height, 'canvas.height', { positive: true });
  integer(canvas.durationFrames, 'canvas.durationFrames', { positive: true });
  integer(canvas.fps.num, 'canvas.fps.num', { positive: true });
  integer(canvas.fps.den, 'canvas.fps.den', { positive: true });
  if(document.productionPlan)for(const shot of normalizePlan(document.productionPlan).shots)for(const range of shot.timing.ranges)if(range.startFrame+range.durationFrames>canvas.durationFrames)fail('plan range exceeds timeline');

  if (document.source !== null) {
    if (!isPlainObject(document.source)) fail('source must be null or an object');
    safeRelativePath(document.source.path, 'source.path');
    if(document.source.locked!==undefined && typeof document.source.locked!=='boolean') fail('source locked must be boolean');
    if(document.source.volume!==undefined&&(!Number.isFinite(document.source.volume)||document.source.volume<0||document.source.volume>2))fail('source volume must be 0..2');
    if(document.source.muted!==undefined&&typeof document.source.muted!=='boolean')fail('source muted must be boolean');
    integer(document.source.startFrame, 'source.startFrame');
    if (document.source.cameraPlan) {
      validateJson(document.source.cameraPlan, 'source.cameraPlan');
      const report=validateShotPlan(document.source.cameraPlan,{duration:document.source.clips!==undefined ? document.source.cameraPlan.duration : canvas.durationFrames*canvas.fps.den/canvas.fps.num});
      if(report.errors.length) fail(report.errors.join('; '));
    }
    if (document.source.durationFrames !== undefined) integer(document.source.durationFrames, 'source.durationFrames', {positive:true});
    if (document.source.clips !== undefined) {
      if (!Array.isArray(document.source.clips)) fail('source.clips must be an array');
      const clipIds=new Set(); let end=0;
      for (const clip of [...document.source.clips].sort((a,b)=>a.startFrame-b.startFrame)) {
        if (!isPlainObject(clip)) fail('source clip must be an object');
        safeId(clip.id); if(clipIds.has(clip.id)) fail('duplicate source clip id'); clipIds.add(clip.id);
        integer(clip.startFrame,'source clip startFrame'); integer(clip.durationFrames,'source clip durationFrames',{positive:true}); integer(clip.sourceInFrame,'source clip sourceInFrame');
        if(clip.startFrame<end || clip.startFrame+clip.durationFrames>canvas.durationFrames) fail('source clip overlaps or exceeds timeline');
        if(clip.sourceInFrame+clip.durationFrames>(document.source.durationFrames ?? document.source.startFrame+canvas.durationFrames)) fail('source clip exceeds media duration');
        if(clip.name!==undefined) text(clip.name,'source clip name');
        end=clip.startFrame+clip.durationFrames;
      }
    }
  }

  if(document.timelineVersion!==undefined && document.timelineVersion!==2) fail('timelineVersion must be 2');
  const trackIds=new Set();
  if(document.tracks!==undefined) {
    if(!Array.isArray(document.tracks)) fail('tracks must be an array');
    for(const track of document.tracks) {
      if(!isPlainObject(track)) fail('track must be an object');
      safeId(track.id); text(track.name,'track name');
      if(trackIds.has(track.id)) fail('duplicate track id'); trackIds.add(track.id);
      if(track.disabled!==undefined&&typeof track.disabled!=='boolean')fail('track disabled must be boolean');
      if(track.locked!==undefined && typeof track.locked!=='boolean') fail('track locked must be boolean');
      if(track.autoPlacement!==undefined){const a=track.autoPlacement;
        if(!isPlainObject(a)||a.kind!=='automatic-visual-v1')fail('track autoPlacement invalid');
        integer(a.createdIndex,'automatic track original index');text(a.originalName,'automatic track original name');
      }
    }
  }
  if(document.markers!==undefined){if(!Array.isArray(document.markers))fail('markers must be an array');const ids=new Set();for(const m of document.markers){if(!isPlainObject(m))fail('marker must be an object');safeId(m.id);if(ids.has(m.id))fail('duplicate marker');ids.add(m.id);text(m.name,'marker name');integer(m.frame,'marker frame');if(m.frame>=canvas.durationFrames)fail('marker exceeds timeline');}}
  const audioTracks=new Set();
  if(document.audioTracks!==undefined){
    if(!Array.isArray(document.audioTracks))fail('audioTracks must be an array');
    for(const t of document.audioTracks){if(!isPlainObject(t))fail('audio track must be an object');safeId(t.id);text(t.name,'audio track name');if(audioTracks.has(t.id))fail('duplicate audio track');audioTracks.add(t.id);for(const k of ['locked','disabled'])if(t[k]!==undefined&&typeof t[k]!=='boolean')fail('audio track flag must be boolean');}
  }
  if(document.audioClips!==undefined){
    if(!Array.isArray(document.audioClips))fail('audioClips must be an array');
    const ids=new Set(),ends=new Map();
    for(const c of [...document.audioClips].sort((a,b)=>a.startFrame-b.startFrame)){
      if(!isPlainObject(c))fail('audio clip must be an object');safeId(c.id);if(ids.has(c.id))fail('duplicate audio clip');ids.add(c.id);text(c.name,'audio name');safeRelativePath(c.path,'audio path');if(c.publicPath!==undefined)safeRelativePath(c.publicPath,'audio publicPath');safeId(c.trackId);if(!audioTracks.has(c.trackId))fail('unknown audio trackId');if(c.groupId!==undefined)safeId(c.groupId);
      for(const k of ['startFrame','sourceInFrame','fadeInFrames','fadeOutFrames'])integer(c[k],`audio ${k}`);
      for(const k of ['durationFrames','sourceDurationFrames'])integer(c[k],`audio ${k}`,{positive:true});
      for(const key of ['fadeInCurve','fadeOutCurve'])if(c[key]!==undefined&&!['linear','smooth','equalPower'].includes(c[key]))fail('invalid audio fade curve');
      if(c.envelopeOffsetFrames!==undefined)integer(c.envelopeOffsetFrames,'audio envelopeOffsetFrames');
      if(c.envelopeDurationFrames!==undefined)integer(c.envelopeDurationFrames,'audio envelopeDurationFrames',{positive:true});
      if(!Number.isFinite(c.volume)||c.volume<0||c.volume>2)fail('audio volume must be 0..2');if(c.muted!==undefined&&typeof c.muted!=='boolean')fail('audio muted must be boolean');
      if(c.sourceInFrame+c.durationFrames>c.sourceDurationFrames||c.startFrame+c.durationFrames>canvas.durationFrames)fail('audio exceeds duration');
      if(c.startFrame<(ends.get(c.trackId)??0))fail('audio overlaps');ends.set(c.trackId,c.startFrame+c.durationFrames);
    }
  }
  if(document.cover!==undefined){
    const c=document.cover;
    if(!isPlainObject(c)||!/^editor-covers\/[a-f0-9]{64}\.png$/.test(c.publicPath)||!['3:4','4:3'].includes(c.ratio))fail('invalid cover');
    safeId(c.runId);safeId(c.groupId);text(c.title,'cover title');
  }
  if(document.source?.displaySize){integer(document.source.displaySize.width,'source display width',{positive:true});integer(document.source.displaySize.height,'source display height',{positive:true});}
  if(document.captions!==undefined){validateJson(document.captions,'captions');validateCaptionTrack(document.captions,{durationFrames:canvas.durationFrames});}
  const style = document.styleReference;
  if (!isPlainObject(style)) fail('styleReference is required');
  for (const key of ['contractPath', 'styleframePath']) {
    if (style[key] !== null) safeRelativePath(style[key], `styleReference.${key}`);
  }
  if (!isPlainObject(style.allowedOverrides)) fail('styleReference.allowedOverrides must be an object');
  validateJson(style.allowedOverrides, 'styleReference.allowedOverrides');

  if (!Array.isArray(document.instances)) fail('instances must be an array');
  const ids = new Set();
  for (const instance of document.instances) {
    if (!isPlainObject(instance)) fail('each instance must be an object');
    safeId(instance.id);
    if (ids.has(instance.id)) fail(`duplicate instance id: ${instance.id}`);
    ids.add(instance.id);
    if (!ASSET_IDS.has(instance.assetId)) fail(`unsupported assetId: ${instance.assetId}`);
    if (typeof instance.assetVersion === 'string') text(instance.assetVersion, `instances.${instance.id}.assetVersion`);
    else integer(instance.assetVersion, `instances.${instance.id}.assetVersion`, { positive: true });
    integer(instance.startFrame, `instances.${instance.id}.startFrame`);
    integer(instance.durationFrames, `instances.${instance.id}.durationFrames`, { positive: true });
    if (instance.startFrame + instance.durationFrames > canvas.durationFrames) fail(`instance ${instance.id} exceeds timeline duration`);
    if(instance.disabled!==undefined&&typeof instance.disabled!=='boolean')fail('instance disabled must be boolean');
    if(instance.groupId!==undefined)safeId(instance.groupId);
    if(instance.name!==undefined) text(instance.name,'instance name');
    if(instance.trackId!==undefined) {safeId(instance.trackId); if(document.tracks && !trackIds.has(instance.trackId)) fail('unknown instance trackId');}
    if(instance.autoPlacement!==undefined){const a=instance.autoPlacement;
      if(!isPlainObject(a)||a.kind!=='automatic-visual-v1')fail('instance autoPlacement invalid');
      safeId(a.instanceId);safeId(a.trackId);
    }
    if(instance.sourceOffsetFrames!==undefined) integer(instance.sourceOffsetFrames,'instance sourceOffsetFrames');
    if(instance.sourceDurationFrames!==undefined) integer(instance.sourceDurationFrames,'instance sourceDurationFrames',{positive:true});
    if((instance.sourceOffsetFrames??0)+instance.durationFrames>(instance.sourceDurationFrames??instance.durationFrames)) fail('instance exceeds original duration');
    if (!Number.isFinite(instance.zIndex) || !Number.isInteger(instance.zIndex)) fail(`instances.${instance.id}.zIndex must be a finite integer`);
    if (!isPlainObject(instance.props)) fail(`instances.${instance.id}.props must be an object`);
    validateJson(instance.props, `instances.${instance.id}.props`);
  }

  if (document.assetSourceHash !== undefined) {
    if (typeof document.assetSourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(document.assetSourceHash)) fail('assetSourceHash must be a SHA-256 hex digest');
  }
  if (expectedAssetSourceHash !== undefined && document.assetSourceHash !== expectedAssetSourceHash) {
    throw new Error('Asset source hash mismatch: render snapshot is stale');
  }
  return document;
}

export function createDocument(input = {}) {
  const document = {
    schemaVersion: 1,
    ...(input.productionPlan===undefined?{}:{productionPlan:normalizePlan(input.productionPlan)}),
    ...(input.projectBinding===undefined?{}:{projectBinding:input.projectBinding.projectId===input.id?input.projectBinding:{...input.projectBinding,projectId:input.id,projectRoot:join(dirname(input.projectBinding.projectRoot),`project-${input.id}`)}}),
    ...(input.timelineVersion === undefined ? {} : {timelineVersion:input.timelineVersion}),
    ...(input.tracks === undefined ? {} : {tracks:input.tracks}),
    ...(input.audioTracks === undefined ? {} : {audioTracks:input.audioTracks}),
    ...(input.audioClips === undefined ? {} : {audioClips:input.audioClips}),
    ...(input.markers === undefined ? {} : {markers:input.markers}),
    id: input.id,
    name: input.name,
    revision: input.revision ?? 0,
    canvas: input.canvas,
    source: input.source ?? null,
    ...(input.cover === undefined ? {} : {cover:input.cover}),
    ...(input.roughcut === undefined ? {} : {roughcut:input.roughcut}),
    styleReference: input.styleReference ?? { contractPath: null, styleframePath: null, allowedOverrides: {} },
    instances: input.instances ?? [],
    ...(input.captions === undefined ? {} : {captions:input.captions}),
    ...(input.assetSourceHash === undefined ? {} : { assetSourceHash: input.assetSourceHash }),
  };
  return validateDocument(document);
}

function documentPath(rootDir, id) {
  safeId(id);
  return join(resolve(rootDir), id, 'document.json');
}

function ensureRealPathInside(rootDir, target, label) {
  const root = realpathSync(rootDir);
  const actual = realpathSync(target);
  const rel = relative(root, actual);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) fail(`${label} escapes its root through a symlink`);
}

export function hashAssetSources(paths, sourceRoot = process.cwd()) {
  if (!Array.isArray(paths)) throw new Error('assetSourcePaths must be an array');
  const hash = createHash('sha256');
  for (const path of [...paths].sort()) {
    const target = ensureInside(sourceRoot, path, 'asset source path');
    ensureRealPathInside(sourceRoot, target, 'asset source path');
    hash.update(path.replaceAll('\\', '/'));
    hash.update('\0');
    hash.update(readFileSync(target));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function retainHistorySnapshot(path, document) {
  try {
    writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, { flag: 'wx' });
    return;
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
  let historical;
  try {
    historical = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`History snapshot conflict at revision ${document.revision}: existing snapshot is invalid`);
  }
  if (JSON.stringify(historical) !== JSON.stringify(document)) {
    throw new Error(`History snapshot conflict at revision ${document.revision}: existing snapshot differs`);
  }
}

export function resolveDocumentPath(
  id,
  { rootDir = DEFAULT_ROOT, ...options } = {},
) {
  return indexedPath(rootDir, id, options);
}

export function saveDocument(document, options = {}) {
  const {
    rootDir = DEFAULT_ROOT,
    expectedRevision = document?.revision,
    assetSourcePaths = [],
    assetSourceRoot = process.cwd(),
    expectedAssetSourceHash,
    artifactRoot = artifactRootDefault(),
  } = options;
  validateDocument(document);
  integer(expectedRevision, "expectedRevision");
  return withProjectLock(rootDir, document.id, () => {
    const oldPath = indexedPath(rootDir, document.id, { artifactRoot });
    let current = existsSync(oldPath)
      ? JSON.parse(readFileSync(oldPath, "utf8"))
      : null;
    if (!current && document.projectBinding) {
      validateProjectRoot(document.projectBinding.projectRoot, {
        artifactRoot,
      });
      const recoveryPath = canonicalPath(document.projectBinding);
      if (existsSync(recoveryPath)) {
        const recovered = JSON.parse(readFileSync(recoveryPath, "utf8"));
        if (
          recovered.id !== document.id ||
          recovered.projectBinding?.projectId !== document.id
        )
          throw new Error("Relocated project identity mismatch");
        current = recovered;
        restoreReferences(dirname(recoveryPath), { assetSourceRoot, rootDir });
      }
    }

    const actualRevision = current?.revision ?? 0;
    if (
      actualRevision !== expectedRevision ||
      document.revision !== expectedRevision
    ) {
      const e = new Error(
        `Revision conflict: expected ${expectedRevision}, found ${actualRevision}`,
      );
      e.document = current;
      e.status = 409;
      throw e;
    }
    const assetSourceHash = hashAssetSources(assetSourcePaths, assetSourceRoot);
    if (
      expectedAssetSourceHash !== undefined &&
      assetSourceHash !== expectedAssetSourceHash
    )
      throw new Error(
        "Asset source hash mismatch: source changed since render snapshot",
      );
    let saved = reconcilePlan({
      ...document,
      revision: actualRevision + 1,
      assetSourceHash,
    });
    if (saved.productionPlan && current?.productionPlan) {
      const dismissed = new Set(saved.productionPlan.dismissedResultIds);
      // Independent manifest deliveries have no shot binding. Keep their delete
      // intent beside the existing bound-media markers so fresh jobs cannot restore them.
      for (const instance of current.instances ?? []) {
        const resultId = (instance.props?.deliveryIdentity?.resultId ?? instance.props?.footageIdentity?.resultId);
        if (resultId && !saved.instances.some((item) => item.id === instance.id)) dismissed.add(resultId);
      }
      for (const shot of current.productionPlan.shots ?? [])
        for (const binding of shot.bindings ?? [])
          if (
            binding.resultId &&
            !saved.instances.some((i) => i.id === binding.instanceId)
          )
            dismissed.add(binding.resultId);
      for (const rid of current.productionPlan.dismissedResultIds ?? [])
        if (
          !saved.instances.some((instance) => (instance.props?.deliveryIdentity?.resultId ?? instance.props?.footageIdentity?.resultId) === rid) &&
          !saved.productionPlan.shots.some((s) =>
            s.bindings.some(
              (b) =>
                b.resultId === rid &&
                saved.instances.some((i) => i.id === b.instanceId),
            ),
          )
        )
          dismissed.add(rid);
      saved.productionPlan.dismissedResultIds = [...dismissed];
    }
    let path = oldPath;
    if (saved.productionPlan || saved.projectBinding) {
      const binding = saved.projectBinding ?? {
        version: 1,
        projectId: saved.id,
        projectRoot: join(artifactRoot, `project-${saved.id}`),
      };
      validateProjectRoot(binding.projectRoot, { artifactRoot });
      saved = { ...saved, projectBinding: binding };
      path = canonicalPath(binding);
      if (
        current?.projectBinding &&
        current.projectBinding.projectRoot !== binding.projectRoot
      )
        migrateDirectory(dirname(oldPath), dirname(path));
    }
    validateDocument(saved);
    mkdirSync(dirname(path), { recursive: true });
    if (!saved.projectBinding)
      ensureRealPathInside(rootDir, dirname(path), "document path");
    else
      ensureRealPathInside(
        saved.projectBinding.projectRoot,
        dirname(path),
        "canonical document path",
      );
    if (current) {
      const historyPath = join(
        dirname(path),
        saved.projectBinding ? "历史" : "history",
        `${current.revision}.json`,
      );
      mkdirSync(dirname(historyPath), { recursive: true });
      retainHistorySnapshot(historyPath, current);
    }
    if (saved.projectBinding) {
      snapshotReferences(saved, dirname(path), { assetSourceRoot, rootDir });
      saved.projectBinding = {
        ...saved.projectBinding,
        recovery: JSON.parse(
          readFileSync(join(dirname(path), "media-recovery.json"), "utf8"),
        ),
      };
      atomicText(
        join(dirname(path), "当前计划.md"),
        currentPlanMarkdown(saved),
      );
    }
    atomicJson(path, saved);
    if (saved.projectBinding) {
      mkdirSync(join(rootDir, saved.id), { recursive: true });
      ensureRealPathInside(rootDir, join(rootDir, saved.id), "project index");
      atomicJson(join(rootDir, saved.id, "project-index.json"), {
        version: 1,
        projectId: saved.id,
        projectRoot: saved.projectBinding.projectRoot,
        canonicalPath: path,
        assetSourceRoot,
      });
    }
    return saved;
  });
}

export function loadDocument(
  id,
  { rootDir = DEFAULT_ROOT, expectedAssetSourceHash, ...options } = {},
) {
  const path = indexedPath(rootDir, id, options);
  if (!existsSync(join(rootDir, id, "project-index.json")))
    ensureRealPathInside(rootDir, path, "document path");
  const document = JSON.parse(readFileSync(path, "utf8"));
  if (document.id !== id) throw new Error("Project identity mismatch");
  if (document.projectBinding) {
    const index = JSON.parse(
      readFileSync(join(rootDir, id, "project-index.json")),
    );
    restoreReferences(dirname(path), {
      assetSourceRoot: options.assetSourceRoot ?? index.assetSourceRoot,
      rootDir,
    });
  }
  return validateDocument(document, { expectedAssetSourceHash });
}

export function listDocuments({ rootDir = DEFAULT_ROOT, ...options } = {}) {
  if (!existsSync(rootDir)) return [];
  return readdirSync(rootDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        (existsSync(join(rootDir, entry.name, "document.json")) ||
          existsSync(join(rootDir, entry.name, "project-index.json"))),
    )
    .map((entry) => loadDocument(entry.name, { rootDir, ...options }))
    .map(({ id, name, revision, assetSourceHash }) => ({
      id,
      name,
      revision,
      assetSourceHash,
      updatedAt: statSync(
        indexedPath(rootDir, id, options),
      ).mtime.toISOString(),
    }))
    .sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
    );
}

function frameForMilliseconds(milliseconds, fps) {
  return Math.round((milliseconds * fps.num) / (fps.den * 1000));
}

function parseTimestamp(value) {
  const match = /^(\d{2,}):(\d{2}):(\d{2})[,.](\d{3})$/.exec(value);
  if (!match) throw new Error(`Invalid SRT timestamp: ${value}`);
  const [, hours, minutes, seconds, milliseconds] = match.map(Number);
  if (minutes > 59 || seconds > 59) throw new Error(`Invalid SRT timestamp: ${value}`);
  return (((hours * 60 + minutes) * 60 + seconds) * 1000) + milliseconds;
}

export function parseSrt(source, { fps, durationFrames }) {
  text(source, 'SRT source');
  integer(fps?.num, 'fps.num', { positive: true });
  integer(fps?.den, 'fps.den', { positive: true });
  integer(durationFrames, 'durationFrames', { positive: true });
  const blocks = source.replace(/\r/g, '').trim().split(/\n{2,}/);
  const cues = blocks.map((block) => {
    const lines = block.split('\n');
    if (lines.length < 3) throw new Error('Invalid SRT cue: id, timing and text are required');
    const id = lines.shift().trim();
    text(id, 'cue id');
    const timing = /^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/.exec(lines.shift().trim());
    if (!timing) throw new Error(`Invalid SRT timing for cue ${id}`);
    const startFrame = frameForMilliseconds(parseTimestamp(timing[1]), fps);
    const endFrame = frameForMilliseconds(parseTimestamp(timing[2]), fps);
    if (endFrame <= startFrame) throw new Error(`Invalid SRT timing for cue ${id}`);
    if (startFrame < 0 || endFrame > durationFrames) throw new Error(`SRT cue ${id} exceeds duration`);
    const cueText = lines.join('\n').trim();
    text(cueText, `cue ${id} text`);
    return { id, startFrame, endFrame, text: cueText };
  });
  const ids = new Set();
  for (let index = 0; index < cues.length; index += 1) {
    if (ids.has(cues[index].id)) throw new Error(`Duplicate SRT cue id: ${cues[index].id}`);
    ids.add(cues[index].id);
    if (index && cues[index].startFrame < cues[index - 1].startFrame) throw new Error('Invalid SRT cue order');
  }
  return cues;
}

export function validateChapters(chapters, { durationFrames, cues } = {}) {
  integer(durationFrames, 'durationFrames', { positive: true });
  if (!Array.isArray(chapters) || chapters.length === 0) throw new Error('Chapters must be a non-empty array');
  const chapterIds = new Set();
  const sourceIds = [];
  chapters.forEach((chapter, index) => {
    if (!isPlainObject(chapter)) throw new Error('Each chapter must be an object');
    safeId(chapter.id);
    if (chapterIds.has(chapter.id)) throw new Error(`Duplicate chapter id: ${chapter.id}`);
    chapterIds.add(chapter.id);
    text(chapter.title, 'chapter title');
    integer(chapter.startFrame, 'chapter.startFrame');
    integer(chapter.endFrame, 'chapter.endFrame', { positive: true });
    if (chapter.endFrame <= chapter.startFrame || chapter.endFrame > durationFrames) throw new Error('Chapter time is outside duration');
    if (index === 0 && chapter.startFrame !== 0) throw new Error('Chapters must cover the timeline from frame 0');
    if (index && chapters[index - 1].endFrame !== chapter.startFrame) throw new Error('Chapters must continuously cover the timeline');
    if (!Array.isArray(chapter.sourceCueIds) || (cues && chapter.sourceCueIds.length === 0)) throw new Error('Chapter sourceCueIds must be non-empty');
    chapter.sourceCueIds.forEach((id) => text(id, 'source cue id'));
    sourceIds.push(...chapter.sourceCueIds);
  });
  if (chapters.at(-1).endFrame !== durationFrames) throw new Error('Chapters must cover the full timeline');
  if (cues) {
    if (!Array.isArray(cues) || cues.length === 0) throw new Error('Source cues must be a non-empty array');
    cues.forEach((cue, index) => {
      text(cue?.id, 'source cue id');
      integer(cue.startFrame, 'source cue startFrame');
      integer(cue.endFrame, 'source cue endFrame', { positive: true });
      if (cue.endFrame <= cue.startFrame || cue.endFrame > durationFrames) throw new Error('Source cue timing is outside duration');
      if (index && cue.startFrame < cues[index - 1].startFrame) throw new Error('Source cue timing must be ordered');
    });
    const expected = cues.map((cue) => cue.id);
    if (sourceIds.length !== expected.length || sourceIds.some((id, index) => id !== expected[index])) {
      throw new Error('Chapter source cue ids must include every cue once and in order');
    }
    const cueById = new Map(cues.map((cue) => [cue.id, cue]));
    for (let index = 1; index < chapters.length; index += 1) {
      if (chapters[index].startFrame !== cueById.get(chapters[index].sourceCueIds[0]).startFrame) {
        throw new Error('Chapter boundary must use its first source cue timing');
      }
    }
  }
  return chapters;
}

export function mapChapterSummary(summary, cues, { durationFrames }) {
  if (!Array.isArray(summary) || summary.length === 0) throw new Error('Chapter summary must be a non-empty array');
  if (!Array.isArray(cues) || cues.length === 0) throw new Error('Source cues must be a non-empty array');
  const cueById = new Map(cues.map((cue) => [cue.id, cue]));
  const flattened = [];
  for (const item of summary) {
    if (!isPlainObject(item)) throw new Error('Each chapter summary must be an object');
    text(item.title, 'chapter title');
    if (!Array.isArray(item.sourceCueIds) || item.sourceCueIds.length === 0) throw new Error('Chapter source cue ids are required');
    flattened.push(...item.sourceCueIds);
  }
  const expected = cues.map((cue) => cue.id);
  if (flattened.length !== expected.length || flattened.some((id, index) => id !== expected[index]) || flattened.some((id) => !cueById.has(id))) {
    throw new Error('Chapter source cue ids must include every cue once and in order');
  }
  const chapters = summary.map((item, index) => ({
    id: `chapter-${index + 1}`,
    title: item.title.trim(),
    startFrame: index === 0 ? 0 : cueById.get(item.sourceCueIds[0]).startFrame,
    endFrame: index === summary.length - 1 ? durationFrames : cueById.get(summary[index + 1].sourceCueIds[0]).startFrame,
    sourceCueIds: [...item.sourceCueIds],
  }));
  return validateChapters(chapters, { durationFrames, cues });
}

export function buildChapterPrompt(cues, { fps, durationFrames }) {
  integer(fps?.num, 'fps.num', { positive: true });
  integer(fps?.den, 'fps.den', { positive: true });
  integer(durationFrames, 'durationFrames', { positive: true });
  if (!Array.isArray(cues) || cues.length === 0) throw new Error('Source cues must be a non-empty array');
  return [
    '请根据字幕语义划分章节。只返回 JSON 数组，每项格式为 {"title":"章节标题","sourceCueIds":["字幕ID"]}。',
    'sourceCueIds 必须按原顺序覆盖每个字幕 ID，不能重复，也不要遗漏；不要推测或改写时间。',
    `时间轴：${durationFrames} 帧，帧率 ${fps.num}/${fps.den} fps。`,
    '字幕：',
    ...cues.map((cue) => JSON.stringify(cue)),
  ].join('\n');
}
