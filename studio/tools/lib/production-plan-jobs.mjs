import {applyPackageBgmExecution,assertBgmReconciliation} from './package-bgm-execution.mjs';
import {freezeProjectTranscript} from './package-edit-transcript.mjs';
import {reconcilePackageDocument, acceptedPackageCaptionDocument} from './package-edit-reconcile.mjs';
import {validateBranchOperation,enqueueBranchOperation,drainBranchOperations,branchValueHash} from './package-branch-application.mjs';
import {validateCaptionTrack} from '../../templates/remotion-base/src/editor/captions.mjs';
import {stageSoundDesign,mergeSoundDesign} from './editor-sound-design.mjs';
import {automaticAiVideoSlot,captureAiVideoReadSet,aiVideoReadSetMatches,aiVideoPlacementFits} from "./production-plan-ai-video-dependencies.mjs";
import {aiVideoCandidateFor,aiVideoIdentity,aiVideoSlotId} from "./production-plan-ai-video.mjs";
import {verifiedFileDigest} from "./verified-file-digest.mjs";
import {rm as removeCandidateFile} from "node:fs/promises";
import {assertReusableCandidate,downloadPublicMedia,inspectDownloadedMedia} from "./candidate-download.mjs";
import {safeMediaPath} from "./project-media.mjs";
import {validateShotRevision,applyShotRevision,revisionContext} from "./shot-revision.mjs";
import {appendAutomaticVisualTrack} from "./automatic-visual-tracks.mjs";
import { finalizeAnimationReceipt } from "./animation-package-receipt.mjs";
import { resolvePackageOrchestrationVersion } from "./package-orchestration-version.mjs";
import {
  verifyFootageResult,
  footageApplicationKey,
  footageMediaProps,
} from "./production-plan-footage.mjs";
import {projectSourceRange} from "../../templates/remotion-base/src/editor/clip-time.mjs";
import { pipFitSize } from "../../templates/remotion-base/src/editor/source-pip.mjs";
import { listProjectMedia, registerProjectMedia } from "./project-media.mjs";
import { spawn, execFileSync } from "node:child_process";
import {
  validateDeliveryManifest,
  verifyDeliveryResult,
  deliveryApplicationKey,
} from "./production-plan-delivery.mjs";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  createReadStream,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  copyFileSync,
  openSync,
  closeSync,
  realpathSync,
} from "node:fs";
import {
  join,
  dirname,
  resolve,
  relative,
  extname,
  isAbsolute,
} from "node:path";
import { homedir } from "node:os";
import { ROOT } from "./panel-scan.mjs";
import {
  loadDocument,
  saveDocument,
  resolveDocumentPath,
  validateDocument,
} from "./editor-store.mjs";
import {
  normalizePlan,
  changePlan,
  reconcilePlan,
  mergePlans,
  dependencyFingerprint,
  currentPlanMarkdown,
  validatePlanJson,
  planRanges,
} from "./production-plan-model.mjs";
import {
  atomicJson,
  archivedReference,
  archiveInput,
  registerInputArchives,
  atomicText,
  safeProjectId,
  withProjectLock,
  referencedPaths,
  validateProjectRoot,
} from "./production-plan-storage.mjs";
import { stageCompositionFile } from "./editor-compose-media.mjs";
import { validateEditorProps } from "./editor-props.mjs";
import {
  presetCatalogById,
  editorAssetBackgroundMode,
} from "./preset-catalog.mjs";
const terminal = new Set([
  "waiting_approval",
  "waiting_selection",
  "plan_only",
  "partial",
  "complete",
  "failed",
  "cancelled",
  "interrupted",
]);
const statuses = new Set(["queued", "running", "cancelling", ...terminal]);
const stamp = () => new Date().toISOString();
const hash = (value) => createHash("sha256").update(value).digest("hex");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const canonical = (value) =>
  JSON.stringify(value, (_, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
const contentDependency = (document, shotId) => {
  const dependency = JSON.parse(dependencyFingerprint(document, shotId));
  delete dependency.target;
  return JSON.stringify(dependency);
};
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const inside = (root, p) => {
  const r = relative(resolve(root), resolve(p));
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
};
function conflict(document, message = "Revision conflict") {
  const e = new Error(message);
  e.status = 409;
  e.document = document;
  return e;
}

/** One service per API process. All authority lives in canonical files; in-memory state only owns live children. */
export function createProductionPlanService(options = {}) {
  const root = options.root ?? process.cwd(),
    rootDir = options.rootDir ?? join(root, "workspace/editor-projects");
  const opts = {
    ...options,
    rootDir,
    assetSourceRoot: options.assetSourceRoot ?? root,
  };
  const jobIndex = join(rootDir, ".production-jobs"),
    children = new Map(),
    polls = new Map(),
    ingestions = new Map();
  let pumping = false,
    closed = false;
  const limit = Math.max(
    1,
    Math.min(
      4,
      Number(
        options.concurrency ?? process.env.PRODUCTION_PLAN_CONCURRENCY ?? 1,
      ) || 1,
    ),
  );
  const contentRoot =
    options.contentRoot ??
    process.env.CONTENT_WORKFLOW_ROOT ??
    resolve(ROOT, "../workflow");
  const doc = (id) => loadDocument(safeProjectId(id), opts);
  const internal = (id) => dirname(resolveDocumentPath(id, opts));
  const save = (value) => saveDocument(value, opts);
  const jobPath = (id) => {
    safeProjectId(id);
    const p = readJson(join(jobIndex, `${id}.json`));
    safeProjectId(p.projectId);
    const expected = join(internal(p.projectId), "任务", id, "job.json");
    return expected;
  };
  const getJob = (id) => {
    const path = jobPath(id),
      job = readJson(path),
      directory = dirname(path);
    return {
      ...job,
      originalDirectory: job.originalDirectory ?? dirname(job.snapshotPath),
      snapshotPath: join(directory, "snapshot.json"),
      outputDir: join(directory, "output"),
    };
  };
  const persist = (job) =>
    withProjectLock(jobIndex, job.id, () => {
      const path = jobPath(job.id),
        previous = readJson(path);
      if (
        ["cancelling", "cancelled"].includes(previous.status) &&
        job.status !== "cancelled"
      )
        job.status = previous.status;
      job.results = [
        ...job.results,
        ...previous.results.filter(
          (r) => !job.results.some((item) => item.id === r.id),
        ),
      ];
      job.updatedAt = stamp();
      atomicJson(path, job);
      return job;
    });

  const allJobs = () =>
    existsSync(jobIndex)
      ? readdirSync(jobIndex)
          .filter((f) => f.endsWith(".json"))
          .flatMap((f) => {
            try {
              return [getJob(f.slice(0, -5))];
            } catch {
              return [];
            }
          })
      : [];
  const packages = (projectId) =>
    join(
      doc(projectId).projectBinding?.projectRoot ??
        join(
          options.artifactRoot ??
            process.env.PRODUCTION_PLAN_ARTIFACT_ROOT ??
            resolve(ROOT, "../output"),
          `project-${projectId}`,
        ),
      ".制作资料",
      "package历史",
    );
  const jobs = (projectId) =>
    allJobs()
      .filter((j) => j.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  function read(projectId) {
    const document = doc(projectId),
      list = jobs(projectId);
    const p = normalizePlan(document.productionPlan),
      dir = document.projectBinding
        ? packages(projectId)
        : join(internal(projectId), "packages");
    for (const job of list) {
      // Expose frozen input identities for per-asset progress, including older jobs.
      if (job.kind === "recognize") {
        try {
          const input = snapshotFor(job);
          job.mediaIds = input.mediaIds ?? [];
          job.mediaPaths = input.mediaPaths ?? [];
        } catch {
          // A missing historical snapshot must not break the project read.
          job.mediaIds = [];
          job.mediaPaths = [];
        }
      }
      if (
        !job.results.some((result) =>
          ["delivery", "footage", "shot-revision"].includes(result.kind),
        )
      )
        continue;
      const snapshot = snapshotFor(job);
      for (const result of job.results.filter((result) =>
        ["delivery", "footage", "shot-revision"].includes(result.kind),
      )) {
        const state = currentResultState(result, job, snapshot, document);
        if (["applied", "ignored", "stale"].includes(state))
          result.state = state;
      }
    }
    for(const parent of list.filter(j=>j.executionJobId)){
      const child=list.find(j=>j.id===parent.executionJobId);if(!child)continue;
      parent.executionStatus=child.status;
      if(child.status==='complete'&&!child.results.some(r=>r.kind==='footage'&&r.footage?.placementId!==null&&r.state==='applied'&&document.instances.some(i=>i.props?.footageIdentity?.resultId===r.id))){parent.executionStatus='partial';parent.executionError='素材任务结束，但当前片段尚无已入轨的推荐素材';}
      if(child.error)parent.executionError=child.error;
    }
    for (const parent of list.filter((j) => j.footageJobId)) {
      const child = list.find((j) => j.parentJobId === parent.id);
      if (!child) continue;
      parent.footageJobId = child.id;
      parent.footageStatus = child.status;
      if (
        parent.animationStatus &&
        !["cancelled", "cancelling"].includes(parent.status)
      ) {
        parent.status =
          child.status === "complete" ? parent.animationStatus : "partial";
        parent.stage =
          child.status === "complete"
            ? "动画与真实素材分支已处理"
            : `动画分支已处理；真实素材：${child.stage}`;
      }
    }
    return {
      document,
      jobs: list,
      history: existsSync(dir)
        ? readdirSync(dir)
            .filter((f) => existsSync(join(dir, f, "manifest.json")))
            .map((f) => {
              const v = readJson(join(dir, f, "manifest.json"));
              return {
                id: v.id,
                createdAt: v.createdAt,
                path: join(dir, f, "manifest.json"),
              };
            })
        : [],
      pendingResults: list
        .flatMap((j) => j.results)
        .filter(
          (r) =>
            !["applied", "ignored"].includes(r.state) &&
            !p.dismissedResultIds.includes(r.id),
        ),
    };
  }
  function archivePackage(document, pkg) {
    if (!pkg) return;
    safeProjectId(pkg.id);
    const dir = join(packages(document.id), pkg.id),
      path = join(dir, "manifest.json");
    if (existsSync(path)) {
      const old = readJson(path);
      if (old.sourceHash !== hash(JSON.stringify(pkg)))
        throw new Error("Package history is immutable");
      return;
    }
    const version = {
      ...structuredClone(pkg),
      createdAt: stamp(),
      sourceHash: hash(JSON.stringify(pkg)),
    };
    mkdirSync(dir, { recursive: true });
    for (const [index, file] of (pkg.files ?? []).entries()) {
      const original = typeof file === "string" ? file : file.path;
      if (typeof original !== "string") continue;
      const source = resolve(root, original);
      if (!existsSync(source) || !statSync(source).isFile())
        throw new Error(`Package history file missing: ${original}`);
      const target = join(dir, `${index}${extname(source)}`);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(source, target);
      version.files ??= [];
      version.files[index] = {
        original,
        path: target,
        sha256: verifiedFileDigest(target),
      };
    }
    atomicJson(path, version);
  }
  function action({ projectId, revision, operation, operationId }) {
    validatePlanJson(operation);
    let current;
    try {
      current = doc(projectId);
    } catch (error) {
      if (operation.type !== "relocate" || error.code !== "ENOENT") throw error;
      validateProjectRoot(operation.projectRoot, opts);
      current = readJson(
        join(
          operation.projectRoot,
          ".制作资料",
          "剪辑工程",
          safeProjectId(projectId),
          "工程.json",
        ),
      );
      validateDocument(current);
      if (current.id !== projectId)
        throw new Error("Relocated project identity mismatch");
    }
    if (
      operationId &&
      current.productionPlan?.changes?.some((c) => c.id === operationId)
    )
      return {
        document: current,
        jobs: jobs(projectId),
        conflicts: current.productionPlan.conflicts,
      };
    if (operation.type === "approve" && operation.timing) {
      const files = operation.timing.files;
      if (
        operation.timing.status !== "approved" ||
        !Array.isArray(files) ||
        !files.length
      )
        throw new Error("Timing approval requires exact requested files");
      const requestJob = jobs(projectId).find((j) =>
        j.approvalRequests?.some(
          (r) => r.type === "timing" && same(r.files, files),
        ),
      );
      if (!requestJob)
        throw new Error("Timing approval does not match a pending request");
      for (const file of files)
        if (
          typeof file.path !== "string" ||
          !existsSync(file.path) ||
          verifiedFileDigest(file.path) !== file.sha256
        )
          throw new Error("Timing approval file changed");
      const snapshot = snapshotFor(requestJob);
      if (snapshot.document.source?.path !== current.source?.path)
        throw new Error("Timing approval source changed");
    }
    if (operation.type === "apply-results")
      throw new Error("Use applyResults for asynchronous media validation");
    if (operation.type === "bind-project" || operation.type === "relocate") {
      if (current.revision !== revision) throw conflict(current);
      const projectRoot =
        operation.projectRoot ??
        current.projectBinding?.projectRoot ??
        join(
          options.artifactRoot ??
            process.env.PRODUCTION_PLAN_ARTIFACT_ROOT ??
            resolve(ROOT, "../output"),
          operation.scriptId ?? `project-${current.id}`,
        );
      validateProjectRoot(projectRoot, opts);
      current = {
        ...current,
        productionPlan: normalizePlan(current.productionPlan),
        projectBinding: {
          version: 1,
          projectId: current.id,
          projectRoot,
          ...(operation.scriptId
            ? { scriptId: operation.scriptId }
            : current.projectBinding?.scriptId
              ? { scriptId: current.projectBinding.scriptId }
              : {}),
        },
      };
    } else if (
      current.revision !== revision ||
      (operation.type === "edit-shot" && operation.base)
    ) {
      if (operation.type === "edit-shot" && operation.base) {
        const p = normalizePlan(current.productionPlan),
          s = p.shots.find((s) => s.id === operation.shotId);
        if (!s) throw new Error("Unknown shot");
        const patch = {};
        for (const [field, value] of Object.entries(operation.patch ?? {})) {
          if (!["visualRequirement", "mediaDescription"].includes(field))
            throw new Error("Unknown editable field");
          if (!Object.hasOwn(operation.base, field)) throw conflict(current);
          if (same(s[field], operation.base[field]) || same(s[field], value))
            patch[field] = value;
          else
            p.conflicts.push({
              id: randomUUID(),
              shotId: s.id,
              field,
              base: operation.base[field],
              current: s[field],
              incoming: value,
            });
        }
        current = { ...current, productionPlan: p };
        if (Object.keys(patch).length)
          current = changePlan(current, {
            ...operation,
            patch,
            ...(operationId ? { operationId } : {}),
          });
      } else if (operation.type === "import-plan" && operation.basePlan)
        current = changePlan(current, {
          ...operation,
          ...(operationId ? { operationId } : {}),
        });
      else throw conflict(current);
    } else
      current = changePlan(current, {
        ...operation,
        ...(operationId ? { operationId } : {}),
      });
    if (operation.type === "import-plan" && operation.package)
      archivePackage(current, operation.package);
    const saved = save(current);
    return {
      document: saved,
      jobs: jobs(projectId),
      conflicts: saved.productionPlan?.conflicts ?? [],
    };
  }
  function targetFor(document, request) {
    if (!request.shotId) return undefined;
    const p = normalizePlan(document.productionPlan),
      shot = p.shots.find((s) => s.id === request.shotId);
    if (!shot || shot.cancelled) throw new Error("Unknown or cancelled shot");
    if (request.slotId && !shot.slots.some((s) => s.id === request.slotId) && !(request.aiVideoCandidateId && request.slotId===`ai-video-${request.aiVideoCandidateId}`))
      throw new Error("Unknown slot");
    if (request.instanceId) {
      if (
        !shot.bindings.some(
          (b) =>
            b.instanceId === request.instanceId &&
            (!request.slotId || b.slotId === request.slotId),
        )
      )
        throw new Error("Target instance is not bound to this shot/slot");
      const i = document.instances.find((i) => i.id === request.instanceId);
      if (!i) throw new Error("Target instance was deleted");
      return {
        instanceId: i.id,
        startFrame: i.startFrame,
        durationFrames: i.durationFrames,
      };
    }
    // Recognition associates another implementation with the semantic plan.
    // Only a caller-supplied instanceId above can choose an existing use.
    const bindings =
      ["recognize","revise","footage"].includes(request.kind)
        ? []
        : shot.bindings
            .filter(
              (b) =>
                b.status !== "removed" &&
                (!request.slotId || b.slotId === request.slotId),
            )
            .map((b) => document.instances.find((i) => i.id === b.instanceId))
            .filter(Boolean);
    const ranges = planRanges(document).filter(
      (r) =>
        r.shotId === shot.id &&
        (!request.rangeId || r.rangeId === request.rangeId),
    );
    if (request.rangeId) {
      if (ranges.length !== 1) throw new Error("Unknown target range");
      const r = ranges[0];
      return {
        rangeId: r.rangeId,
        startFrame: r.startFrame,
        durationFrames: r.durationFrames,
      };
    }
    if(request.kind==='recognize'&&request.aiVideoCandidateId&&!request.rangeId&&ranges.length>1)return undefined;
    if (bindings.length > 1 || (!bindings.length && ranges.length > 1))
      throw new Error(
        "Multiple uses require an explicit target instance or range",
      );
    if (bindings.length === 1)
      return {
        instanceId: bindings[0].id,
        startFrame: bindings[0].startFrame,
        durationFrames: bindings[0].durationFrames,
      };
    if (ranges.length === 1)
      return {
        rangeId: ranges[0].rangeId,
        startFrame: ranges[0].startFrame,
        durationFrames: ranges[0].durationFrames,
      };
    return undefined;
  }
  function inputPath(path) {
    if (typeof path !== "string" || !path || path.includes("\0"))
      throw new Error("Invalid input path");
    const absolute = resolve(root, path);
    if (!existsSync(absolute) || !statSync(absolute).isFile())
      throw new Error(`Input file missing: ${path}`);
    return absolute;
  }
  async function inputFile(absolute) {
    const stat = statSync(absolute),
      digest = createHash("sha256");
    for await (const chunk of createReadStream(absolute)) digest.update(chunk);
    const after = statSync(absolute);
    if (
      stat.size !== after.size ||
      stat.mtimeMs !== after.mtimeMs ||
      stat.ctimeMs !== after.ctimeMs
    )
      throw new Error(`Input file changed while hashing: ${absolute}`);
    return {
      path: absolute,
      ...(inside(root, absolute)
        ? { repositoryPath: relative(root, absolute) }
        : {}),
      sha256: digest.digest("hex"),
      bytes: stat.size,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
    };
  }
  async function createJob(request) {
    validatePlanJson(request);
    if(request.kind==='package')resolvePackageOrchestrationVersion(request.packageOrchestrationVersion);
    else if(request.packageOrchestrationVersion!==undefined)throw Error('Unsupported package orchestration version');
    if(request.packageExecution!==undefined&&(request.kind!=='package'||typeof request.packageExecution.streamingApply!=='boolean'||!['none','same-run','validated-project-artifacts'].includes(request.packageExecution.reusePolicy??'same-run')))throw Error('Invalid frozen package execution options');
    let resumedSnapshot;
    if (request.resumeJobId) {
      const previous = getJob(request.resumeJobId);
      if (
        previous.projectId !== request.projectId ||
        !terminal.has(previous.status)
      )
        throw new Error("Invalid resume job");
      const explicitResumeInstance=request.instanceId;
      const before = snapshotFor(previous);
      if(before.kind==='package'){
        resolvePackageOrchestrationVersion(before.packageOrchestrationVersion);
        if(request.packageExecution!==undefined&&!same(request.packageExecution,before.packageExecution))throw Error('Frozen package execution cannot change during resume');
      }
      resumedSnapshot = before;
      const resumedMediaPaths = (request.mediaPaths ?? before.mediaPaths)?.map(
        (path) => {
          const input = before.inputs?.find(
            (i) => i.path === resolve(before.repositoryRoot ?? root, path),
          );
          return input?.repositoryPath
            ? resolve(root, input.repositoryPath)
            : path;
        },
      );
      request = {
        ...Object.fromEntries(
          [
            "kind",
            "shotId",
            "slotId",
            "instanceId",
            "rangeId",
            "mediaIds",
            "mediaPaths",
            "deliveryManifestPath",
            "sourceSrtPath",
          "transcriptTimeBase",
          "transcriptProvenancePath",
            "audioPath",
            "candidateId",
          "aiVideoCandidateId",
          "aiVideoPromptVersion",
            "instructions",
            "scope",
            "packageOrchestrationVersion",
            "packageExecution",
          ]
            .filter((k) => before[k] !== undefined)
            .map((k) => [k, before[k]]),
        ),
        ...request,
        ...(resumedMediaPaths ? { mediaPaths: resumedMediaPaths } : {}),
      };
      if(previous.kind === "revise" && !previous.instanceId && explicitResumeInstance===undefined)delete request.instanceId;
    }
    if (
      !["package", "broll", "recognize", "align", "footage", "revise"].includes(
        request.kind,
      )
    )
      throw new Error("Unknown job kind");
    if(request.kind === "revise" && (!request.shotId || typeof request.instructions !== "string" || !request.instructions.trim())) throw new Error("revise requires shotId and nonempty instructions");
    let current = doc(request.projectId);
    if (current.revision !== request.revision) throw conflict(current);
    if (!request.shotId && request.kind === "broll" && !request.scope)
      request = { ...request, scope: { camera: false, sound: false } };
    if (!current.productionPlan || !current.projectBinding)
      current = save({
        ...current,
        productionPlan: normalizePlan(current.productionPlan),
      });
    let aiVideoCandidate,aiVideoCandidateIdentity;
    if(request.aiVideoCandidateId!==undefined||request.aiVideoPromptVersion!==undefined){
      if(request.kind!=='recognize'||!request.shotId||!request.aiVideoCandidateId||!Number.isInteger(request.aiVideoPromptVersion)||request.aiVideoPromptVersion<1||request.candidateId||request.instanceId||request.deliveryManifestPath)throw Error('AI video requires shot, candidate ID and prompt version; incompatible target');
      aiVideoCandidate=structuredClone(aiVideoCandidateFor(current,request));
      aiVideoCandidateIdentity=aiVideoIdentity(aiVideoCandidate);
      if(request.aiVideoCandidateIdentity!==undefined&&request.aiVideoCandidateIdentity!==aiVideoCandidateIdentity)throw Error("AI video prompt changed while waiting for upload or queue");
      const shot=current.productionPlan.shots.find(s=>s.id===request.shotId);
      if(request.slotId&&!shot.slots.some(s=>s.id===request.slotId)&&request.slotId!==aiVideoSlotId(aiVideoCandidate))throw Error('AI video target slot missing');
      if(!request.slotId)request={...request,slotId:aiVideoSlotId(aiVideoCandidate)};
      // The dedicated slot is staged in the immutable snapshot and saved only
      // alongside a verified media application. Existing animation slots stay intact.
    }
    if (request.kind === "recognize") {
      const references = request.mediaPaths ?? [];
      const jsons = references.filter(
        (path) => typeof path === "string" && /\.json$/i.test(path),
      );
      const siblings = [
        ...new Set(
          references
            .filter((path) => typeof path === "string")
            .map((path) =>
              join(dirname(resolve(root, path)), "animation-delivery.json"),
            ),
        ),
      ].filter(existsSync);
      const candidates = request.deliveryManifestPath
        ? [request.deliveryManifestPath]
        : jsons.length
          ? jsons
          : siblings;
      if (candidates.length > 1)
        throw new Error(
          "Multiple delivery manifests; select one explicit manifest",
        );
      if (candidates.length && !aiVideoCandidate)
        request = { ...request, deliveryManifestPath: candidates[0] };
    }
    const deliveryMode =
      request.kind === "recognize" && !!request.deliveryManifestPath;
    if (deliveryMode) {
      // A manifest defines independent project-time deliveries. Old UI targets
      // and transcription references never constrain or expand this operation.
      request = { ...request, scope: { camera: false, sound: false } };
      for (const field of [
        "shotId",
        "slotId",
        "instanceId",
        "rangeId",
        "candidateId",
        "sourceSrtPath",
          "transcriptTimeBase",
          "transcriptProvenancePath",
        "audioPath",
      ])
        delete request[field];
    }
    if (request.kind === "footage") {
      request = {
        ...request,
        scope: { ...request.scope, camera: false, sound: false },
      };
      for (const field of ["slotId", "candidateId"]) delete request[field];
      if(!request.shotId || request.scope?.footage !== true){delete request.shotId;delete request.instanceId;delete request.rangeId;}
    }
    if (request.kind !== "revise" && request.shotId && (request.scope?.camera || request.scope?.sound))
      throw new Error("Single shot scope cannot include full camera/sound");
    const target = deliveryMode ? undefined : targetFor(current, request);
    if((request.kind === "revise" || request.kind === "footage" && request.shotId) && !target) throw new Error("Revision requires aligned selected shot range");
    if (request.kind === "broll" && request.shotId && !target)
      throw new Error("Shot has no aligned target range");
    if (request.candidateId) {
      const shot = current.productionPlan.shots.find(
        (s) => s.id === request.shotId,
      );
      if (
        !shot?.candidates.some(
          (c) => c.id === request.candidateId && c.slotId === request.slotId,
        )
      )
        throw new Error("Candidate does not belong to selected slot");
    }
    const id =
        request.kind === "footage" &&
        request.parentJobId &&
        !request.resumeJobId
          ? `footage-${hash(request.parentJobId).slice(0, 24)}`
          : randomUUID(),
      directory = join(internal(current.id), "任务", id),
      outputDir = join(directory, "output");
    if (existsSync(join(jobIndex, `${id}.json`)))
      return { job: getJob(id), document: current };
    mkdirSync(outputDir, { recursive: true });
    const inputPaths = [];
    const knownSource = current.source?.path;
    let videoPath;
    if (knownSource) {
      videoPath = inputPath(knownSource);
      inputPaths.push(knownSource);
    }
    const sourceSrtPath = deliveryMode
      ? undefined
      : (request.sourceSrtPath ??
        current.productionPlan.sourceSrtPath ??
        current.source?.sourceSrtPath ??
        current.source?.cameraPlan?.sourceSrtPath);
    const planTranscriptMatches = !request.sourceSrtPath || request.sourceSrtPath === current.productionPlan.sourceSrtPath;
    const transcriptTimeBase = request.transcriptTimeBase ?? (planTranscriptMatches ? current.productionPlan.transcriptTimeBase : undefined);
    const transcriptProvenancePath = request.transcriptProvenancePath ?? (planTranscriptMatches ? current.productionPlan.transcriptProvenancePath : undefined);
    const audioPath = deliveryMode
      ? undefined
      : (request.audioPath ?? current.productionPlan.audioPath);
    const inputs = [],
      archives = [],
      resolvedAuxiliary = {};
    const projectDirectory = internal(current.id);
    const mediaPaths = [],
      deliveryFilePaths = [];
    let deliveryManifest, deliveryManifestPath, deliveryManifestSha256;
    if (request.deliveryManifestPath) {
      const manifestOriginal = resolve(root, request.deliveryManifestPath);
      deliveryManifest = validateDeliveryManifest(
        readJson(manifestOriginal),
        current.id,
      );
      request = {
        ...request,
        mediaPaths: deliveryManifest.files.map((entry) =>
          resolve(dirname(manifestOriginal), entry.file),
        ),
      };
    }
    for (const reference of request.mediaPaths ?? []) {
      if (
        typeof reference !== "string" ||
        !reference ||
        reference.includes("\0")
      )
        throw new Error("Invalid media input path");
      const original = resolve(root, reference);
      // Relative UI references belong to this repository. Preserve explicitly
      // supplied absolute CLI inputs, but never turn traversal into authorization.
      if (!isAbsolute(reference)) {
        if (
          !inside(root, original) ||
          (existsSync(original) &&
            !inside(realpathSync(root), realpathSync(original)))
        )
          throw new Error("Relative media input escapes repository");
        const imported = relative(root, original).match(
          /^templates\/remotion-base\/public\/editor-project-media\/([^/]+)\//,
        );
        if (imported && imported[1] !== current.id)
          throw new Error("Media input belongs to another project");
      }
      if (request.kind !== "recognize") {
        const absolute = inputPath(reference);
        inputPaths.push(absolute);
        if (!mediaPaths.includes(absolute)) mediaPaths.push(absolute);
        continue;
      }
      const pinned = resumedSnapshot?.inputs?.find(
        (input) => input.path === original,
      );
      const existing = archivedReference(
        reference,
        projectDirectory,
        pinned ? { expectedHash: pinned.sha256 } : {},
      );
      const readable = existsSync(original) ? original : existing?.path;
      if (!readable) throw new Error(`Input file missing: ${reference}`);
      const expectedHash =
        pinned?.sha256 ??
        (existing &&
        (!existsSync(original) || original === resolve(existing.path))
          ? existing.hash
          : undefined);
      const entry = await archiveInput(reference, readable, projectDirectory, {
        assetSourceRoot: root,
        ...(expectedHash ? { expectedHash } : {}),
      });
      archives.push(entry);
      if (!mediaPaths.includes(entry.path)) mediaPaths.push(entry.path);
      deliveryFilePaths.push(entry.path);
      if (!inputs.some((input) => input.path === entry.path)) {
        const stat = statSync(entry.path);
        inputs.push({
          path: entry.path,
          originalPath: original,
          sha256: entry.hash,
          bytes: stat.size,
          mtimeMs: stat.mtimeMs,
          ctimeMs: stat.ctimeMs,
        });
      }
    }
    if (deliveryManifest) {
      const staged = {
        ...deliveryManifest,
        files: deliveryManifest.files.map((entry, index) => ({
          ...entry,
          file: deliveryFilePaths[index],
        })),
      };
      deliveryManifestPath = join(directory, "animation-delivery.json");
      writeFileSync(
        deliveryManifestPath,
        JSON.stringify(staged, null, 2) + "\n",
        { flag: "wx" },
      );
      deliveryManifestSha256 = verifiedFileDigest(deliveryManifestPath);
      const stat = statSync(deliveryManifestPath);
      inputs.push({
        path: deliveryManifestPath,
        originalPath: resolve(root, request.deliveryManifestPath),
        sha256: deliveryManifestSha256,
        bytes: stat.size,
        mtimeMs: stat.mtimeMs,
        ctimeMs: stat.ctimeMs,
      });
    }
    for (const [field, reference] of Object.entries({
      sourceSrtPath,
      transcriptProvenancePath,
      audioPath,
    })) {
      if (!reference) continue;
      const original = resolve(root, reference);
      const pinned =
        resumedSnapshot?.[field] &&
        resolve(root, resumedSnapshot[field]) === original
          ? resumedSnapshot.inputs?.find(
              (input) => input.path === resumedSnapshot[field],
            )
          : undefined;
      const existing = archivedReference(
        reference,
        projectDirectory,
        pinned ? { expectedHash: pinned.sha256 } : {},
      );
      const readable = existsSync(original) ? original : existing?.path;
      if (!readable) throw new Error(`Input file missing: ${reference}`);
      const expectedHash =
        pinned?.sha256 ??
        (existing &&
        (!existsSync(original) || original === resolve(existing.path))
          ? existing.hash
          : undefined);
      const entry = await archiveInput(reference, readable, projectDirectory, {
        assetSourceRoot: root,
        ...(expectedHash ? { expectedHash } : {}),
      });
      archives.push(entry);
      const stat = statSync(entry.path);
      inputs.push({
        path: entry.path,
        originalPath: original,
        sha256: entry.hash,
        bytes: stat.size,
        mtimeMs: stat.mtimeMs,
        ctimeMs: stat.ctimeMs,
      });
      resolvedAuxiliary[field] = entry.path;
    }
    let footagePackage;
    if (["footage", "broll"].includes(request.kind)) {
      const upstream = request.kind === "footage" && request.shotId
        ? current.productionPlan.shots.find(s=>s.id===request.shotId)?.upstream?.footagePackage
        : current.productionPlan.upstream?.footagePackage;
      if (upstream) {
        footagePackage = structuredClone(upstream);
        for (const field of [
          "reviewPath",
          "summaryPath",
          "allCandidateManifestPath",
        ]) {
          const reference = upstream[field];
          if (typeof reference !== "string")
            throw new Error("Footage upstream package is incomplete");
          const original = resolve(root, reference),
            expectedHash =
              field === "reviewPath" ? upstream.reviewSha256 : undefined;
          const existing = archivedReference(
            reference,
            projectDirectory,
            expectedHash ? { expectedHash } : {},
          );
          const readable = existsSync(original) ? original : existing?.path;
          if (!readable)
            throw new Error(`Footage upstream file missing: ${reference}`);
          const entry = await archiveInput(
            reference,
            readable,
            projectDirectory,
            {
              assetSourceRoot: root,
              ...(expectedHash ? { expectedHash } : {}),
              ...(!existsSync(original) && !expectedHash && existing
                ? { expectedHash: existing.hash }
                : {}),
            },
          );
          archives.push(entry);
          const stat = statSync(entry.path);
          if (!inputs.some((i) => i.originalPath === original))
            inputs.push({
              path: entry.path,
              originalPath: original,
              sha256: entry.hash,
              bytes: stat.size,
              mtimeMs: stat.mtimeMs,
              ctimeMs: stat.ctimeMs,
            });
          footagePackage[field] = entry.path;
        }
      }
    }
    if(aiVideoCandidate){
      for(const reference of aiVideoCandidate.references){
        const original=resolve(root,reference.path);
        const existing=archivedReference(reference.path,projectDirectory,reference.sha256?{expectedHash:reference.sha256}:{});
        const readable=existsSync(original)?original:existing?.path;
        if(!readable)throw Error('AI video reference missing: '+reference.path);
        if(!/\.(png|jpe?g|webp|gif|avif)$/i.test(reference.path))throw Error('AI video reference must be an image');
        const entry=await archiveInput(reference.path,readable,projectDirectory,{assetSourceRoot:root,...(reference.sha256?{expectedHash:reference.sha256}:{})});
        reference.sha256=entry.hash;
        archives.push(entry);const stat=statSync(entry.path);
        if(!inputs.some(i=>i.path===entry.path))inputs.push({path:entry.path,originalPath:original,sha256:entry.hash,bytes:stat.size,mtimeMs:stat.mtimeMs,ctimeMs:stat.ctimeMs});
      }
    }
    for (const path of new Set(inputPaths.map(inputPath)))
      if (!inputs.some((i) => i.originalPath === path))
        inputs.push(await inputFile(path));
    if (deliveryManifest?.sourceVideoSha256) {
      const sourceInput = inputs.find(
        (input) => input.originalPath === videoPath || input.path === videoPath,
      );
      if (sourceInput?.sha256 !== deliveryManifest.sourceVideoSha256)
        throw new Error("Delivery manifest source video identity mismatch");
    }
    withProjectLock(rootDir, current.id, () => {
      const latest = doc(current.id);
      if (latest.revision !== current.revision)
        throw conflict(
          latest,
          "Revision conflict: project changed while hashing inputs",
        );
      registerInputArchives(archives, projectDirectory);
    });
    const revisionContextPaths={},revisionContextGaps=[];
    if(request.kind === "revise"){
      const refs={...current.productionPlan.upstream?.animationPackage,...current.productionPlan.upstream?.footagePackage};
      for(const key of ["analysisPath","summaryPath","finalSummaryPath","reviewPath","allCandidateManifestPath"]){
        const reference=refs[key];if(!reference)continue;
        const original=resolve(root,reference), existing=archivedReference(reference,projectDirectory);
        const readable=existsSync(original)?original:existing?.path;
        if(!readable){revisionContextGaps.push(`当前 package 上下文文件缺失：${key}`);continue;}
        const entry=await archiveInput(reference,readable,projectDirectory,{assetSourceRoot:root});
        archives.push(entry);const stat=statSync(entry.path);
        inputs.push({path:entry.path,originalPath:original,sha256:entry.hash,bytes:stat.size,mtimeMs:stat.mtimeMs,ctimeMs:stat.ctimeMs});
        revisionContextPaths[key]=entry.path;
      }
      withProjectLock(rootDir,current.id,()=>{const latest=doc(current.id);if(latest.revision!==current.revision)throw conflict(latest);registerInputArchives(archives,projectDirectory);});
    }
    const snapshot = {
      ...(request.kind === "revise"?{revisionContextPaths,revisionContextGaps}:{}),
      jobId: id,
      repositoryRoot: root,
      projectId: current.id,
      kind: request.kind,
      ...(request.kind === "footage"
        ? { workflowMode: "real-footage-v1" }
        : {}),
      ...(["package", "broll"].includes(request.kind)
        ? { footageBranchEnabled: true }
        : {}),
      document: structuredClone(current),
      ...Object.fromEntries(
        [
          "shotId",
          "slotId",
          "instanceId",
          "rangeId",
          "mediaIds",
          "mediaPaths",
          "deliveryManifestPath",
          "candidateId",
          "aiVideoCandidateId",
          "aiVideoPromptVersion",
          "script",
          "instructions",
          "scope",
          "resumeJobId",
          "parentJobId",
        ]
          .filter((k) => request[k] !== undefined)
          .map((k) => [k, request[k]]),
      ),
      ...(target
        ? {
            target,
            ...(target.instanceId ? { instanceId: target.instanceId } : {}),
            ...(target.rangeId ? { rangeId: target.rangeId } : {}),
          }
        : {}),
      ...(videoPath ? { videoPath } : {}),
      ...(deliveryManifestPath
        ? { deliveryManifestPath, deliveryManifestSha256 }
        : {}),
      ...(request.mediaPaths !== undefined ? { mediaPaths } : {}),
      ...resolvedAuxiliary,
      ...(transcriptTimeBase ? {transcriptTimeBase} : {}),
      inputs,
      requirementVersions: Object.fromEntries(
        current.productionPlan.shots.map((s) => [s.id, s.requirementVersion]),
      ),
      contentDependencies: Object.fromEntries(
        current.productionPlan.shots.map((s) => [
          s.id,
          contentDependency(current, s.id),
        ]),
      ),
      dependencies: Object.fromEntries(
        current.productionPlan.shots.map((s) => [
          s.id,
          dependencyFingerprint(
            current,
            s.id,
            s.id === request.shotId ? target : undefined,
          ),
        ]),
      ),
      approval: current.productionPlan.approvalRecord ?? {
        status: current.productionPlan.approval,
        requirementVersions: Object.fromEntries(
          current.productionPlan.shots
            .filter((s) => s.approval === "approved")
            .map((s) => [s.id, s.requirementVersion]),
        ),
      },
      apiBase:
        options.apiBase ??
        process.env.PRODUCTION_PLAN_API_BASE ??
        "http://127.0.0.1:4358",
      catalog: {
        project: listProjectMedia({
          ...options,
          root,
          projectId: current.id,
          scope: "project",
          contentRoot,
        }),
        shared: listProjectMedia({
          ...options,
          root,
          projectId: current.id,
          scope: "shared",
          contentRoot,
        }),
      },
      createdAt: stamp(),
    };
    if (footagePackage) {
      snapshot.footagePackage = footagePackage;
      const snapshotOwner=request.kind === "footage" && request.shotId ? snapshot.document.productionPlan.shots.find(s=>s.id===request.shotId) : snapshot.document.productionPlan;
      snapshotOwner.upstream = {
        ...snapshotOwner.upstream,
        footagePackage: structuredClone(footagePackage),
      };
    }
    if(aiVideoCandidate){
      snapshot.aiVideoReadSet=captureAiVideoReadSet(current,request);
      snapshot.aiVideoCandidate=aiVideoCandidate;
      snapshot.aiVideoCandidateIdentity=aiVideoCandidateIdentity;
      const shot=snapshot.document.productionPlan.shots.find(s=>s.id===request.shotId);
      shot.aiVideoCandidates=shot.aiVideoCandidates.map(c=>c.id===aiVideoCandidate.id?structuredClone(aiVideoCandidate):c);
      if(!shot.slots.some(s=>s.id===request.slotId))shot.slots.push(automaticAiVideoSlot(aiVideoCandidate,shot.requirementVersion));
    }
    if(request.kind==='footage' && snapshot.shotId) snapshot.footageScope=footageScope(snapshot);
    if(request.kind==='revise') snapshot.revisionContext=revisionContext(snapshot);
    if(request.kind==='package'){
      snapshot.scope={footage:true,aiVideo:true,...snapshot.scope,templates:false};
      snapshot.fullPackageVersion=1;
      snapshot.bgmPlanVersion=1;
      snapshot.packageOrchestrationVersion=resolvePackageOrchestrationVersion(request.packageOrchestrationVersion);
      if(!resumedSnapshot||resumedSnapshot.bgmExecutionVersion===1)snapshot.bgmExecutionVersion=1;
      snapshot.packageExecution=structuredClone(request.packageExecution??{streamingApply:true,reusePolicy:'same-run'});
      snapshot.editReconciliationVersion=1;
      snapshot.runId=request.runId??id;
    }
    return withProjectLock(jobIndex,id,()=>{
    if(existsSync(join(jobIndex,`${id}.json`)))return {job:getJob(id),document:current};
    const snapshotPath = join(directory, "snapshot.json");
    writeFileSync(snapshotPath,JSON.stringify(snapshot,null,2)+"\n",{flag:"wx"});
    const job = {
      id,
      projectId: current.id,
      kind: request.kind,
      ...Object.fromEntries(
        ["shotId", "slotId", "instanceId", "rangeId", "parentJobId", "aiVideoCandidateId", "aiVideoPromptVersion"]
          .filter((k) => request[k] !== undefined)
          .map((k) => [k, request[k]]),
      ),
      ...(request.kind === "recognize" ? {mediaIds: snapshot.mediaIds ?? [], mediaPaths: snapshot.mediaPaths ?? []} : {}),
      ...(request.kind==='package'?{fullPackageVersion:1,bgmPlanVersion:snapshot.bgmPlanVersion,...(snapshot.bgmExecutionVersion?{bgmExecutionVersion:snapshot.bgmExecutionVersion}:{}),packageOrchestrationVersion:snapshot.packageOrchestrationVersion,...(snapshot.packageExecution?{packageExecution:snapshot.packageExecution}:{}),runId:snapshot.runId}:{}),
      status: "queued",
      stage: "等待执行",
      processed: 0,
      ...(deliveryManifestPath ? { deliveryManifestPath } : {}),
      total: deliveryManifest
        ? deliveryManifest.files.length
        : request.shotId
          ? 1
          : current.productionPlan.shots.filter((s) => !s.cancelled).length,
      snapshotPath,
      outputDir,
      results: [],
      createdAt: stamp(),
      updatedAt: stamp(),
      snapshotHash: verifiedFileDigest(snapshotPath),
      ownerPid: null,
    };
    atomicJson(join(directory, "job.json"), job);
    atomicJson(join(jobIndex, `${id}.json`), { projectId: current.id });
    if (options.autoStart !== false) queueMicrotask(() => pump());
    return { job, document: current };
    });
  }
  function snapshotFor(job) {
    if (verifiedFileDigest(job.snapshotPath) !== job.snapshotHash)
      throw new Error("Immutable snapshot integrity mismatch");
    const snap = readJson(job.snapshotPath);
    if (snap.jobId !== job.id || snap.projectId !== job.projectId)
      throw new Error("Job snapshot identity mismatch");
    const directory = internal(job.projectId);
    const relocated = new Map();
    for (const input of snap.inputs ?? []) {
      const original = input.path;
      if (!existsSync(input.path))
        input.path =
          archivedReference(input.path, directory, {
            expectedHash: input.sha256,
          })?.path ?? input.path;
      relocated.set(original, input.path);
    }
    for (const key of ["sourceSrtPath", "transcriptProvenancePath", "audioPath"])
      if (snap[key]) snap[key] = relocated.get(snap[key]) ?? snap[key];
    if (snap.mediaPaths)
      snap.mediaPaths = snap.mediaPaths.map(
        (path) =>
          relocated.get(resolve(snap.repositoryRoot ?? root, path)) ?? path,
      );
    if (snap.document.projectBinding)
      snap.document.projectBinding.projectRoot = dirname(
        dirname(dirname(directory)),
      );
    return snap;
  }
  function validateResult(result, job, snapshot) {
    validatePlanJson(result);
    safeProjectId(result.id);
    if (result.jobId !== job.id || result.projectId !== job.projectId)
      throw new Error("Result project/job mismatch");
    if (
      ![
        "packageOperation",
        "shot-revision",
        "candidate",
        "media",
        "template",
        "plan",
        "match",
        "alignment",
        "delivery",
        "footage",
      ].includes(result.kind)
    )
      throw new Error("Invalid result kind");
    if(result.kind==='packageOperation'){
      if(snapshot.kind!=='package'||!result.operation)throw Error('Package operation requires frozen v2 task');
      resolvePackageOrchestrationVersion(snapshot.packageOrchestrationVersion);
      return;
    }
    if(snapshot.aiVideoCandidateId){
      if(!['match','media'].includes(result.kind)||result.shotId!==snapshot.shotId||result.aiVideoCandidateId!==snapshot.aiVideoCandidateId||result.aiVideoPromptVersion!==snapshot.aiVideoPromptVersion||result.requirementVersion!==snapshot.aiVideoCandidate.requirementVersion||result.candidateId||result.media?.editable)throw Error('AI video result identity does not match frozen candidate');
      const file=typeof result.media?.path==='string'?jobFile(job,result.media.path):'';
      if(!(snapshot.mediaPaths??[]).some(path=>resolve(root,path)===file))throw Error('AI video result must use its frozen uploaded media');
    }else if(result.aiVideoCandidateId!==undefined||result.aiVideoPromptVersion!==undefined)throw Error('AI video result requires a linked input snapshot');
    if(snapshot.kind === "footage" && snapshot.shotId && result.kind !== "footage") throw new Error("Scoped footage accepts only footage results");
    if (result.kind === "shot-revision") { validateShotRevision(result,snapshot); return; }
    if (result.kind === "footage") {
      const verified=verifyFootageResult(result, snapshot, job.outputDir);
      validateScopedFootage(snapshot,verified.review);
      return;
    }
    if (result.kind === "delivery") {
      verifyDeliveryResult(result, snapshot);
      return;
    }
    if (result.kind === "plan") {
      normalizePlan(result.plan);
      return;
    }
    if (snapshot.shotId && snapshot.shotId !== result.shotId)
      throw new Error("Result outside declared job shot");
    if (snapshot.slotId && result.slotId !== snapshot.slotId)
      throw new Error("Result outside declared slot");
    // Package publishes its plan first; native results can refer to those new
    // shots, so their authority is checked against the live plan at application.
    if (result.kind === "template") {
      if (
        !Number.isInteger(result.requirementVersion) ||
        result.requirementVersion < 1 ||
        typeof result.narration !== "string" ||
        typeof result.slotId !== "string"
      )
        throw new Error(
          "Template requires current requirement version, slot and narration",
        );
      return;
    }
    const shot = snapshot.document.productionPlan.shots.find(
      (s) => s.id === result.shotId,
    );
    if (!shot) throw new Error("Result shot missing from snapshot");
    if (result.slotId && !shot.slots.some((s) => s.id === result.slotId))
      throw new Error("Result slot missing from snapshot");
    if (result.candidate)
      normalizePlan({ shots: [{ ...shot, candidates: [result.candidate] }] });
  }
  function sourceMatches(snapshot,current){
    if(snapshot.kind!=='package'||snapshot.fullPackageVersion!==1)return same(snapshot.document.source,current.source);
    const before=structuredClone(snapshot.document.source),after=structuredClone(current.source);
    if(before)delete before.cameraPlan;if(after)delete after.cameraPlan;
    return same(before,after);
  }
  function currentResultState(result, job, snapshot, current) {
    const p = normalizePlan(current.productionPlan);
    if(result.kind==='packageOperation'){const marker=p.changes.find(c=>c.id===result.operation?.operationId&&c.type==='package-branch-application');if(marker){const changed=marker.fields?.some(f=>{let value=current;for(const k of f.path)value=value?.[k];if(value&&typeof value==='object'&&!Array.isArray(value)&&Array.isArray(value.changes))value={...value,changes:value.changes.filter(c=>c.type!=='package-branch-application')};return branchValueHash(value)!==f.sha256;});return changed?'ignored':'applied';}return 'ready';}
    if (p.dismissedResultIds.includes(result.id)) return "ignored";
    if (p.appliedResultIds.includes(result.id)) {
      if (["delivery", "footage"].includes(result.kind)) {
        if (result.kind === "footage" && result.footage.placementId === null)
          return "applied";
        const key =
          result.kind === "footage"
            ? footageApplicationKey(result)
            : deliveryApplicationKey(result);
        return current.instances.some(
          (instance) =>
            (instance.props?.deliveryIdentity?.applicationKey ??
              instance.props?.footageIdentity?.applicationKey) === key,
        )
          ? "applied"
          : "ignored";
      }
      return "applied";
    }
    if (result.kind === "plan") return "ready";
    if (result.kind === "footage") {
      if (!scopedFootageCurrent(job,snapshot,current)) return "stale";
      if (
        !sourceMatches(snapshot,current) ||
        !same(snapshot.document.canvas, current.canvas)
      )
        return "stale";
      try {
        verifyFootageResult(result, snapshot, job.outputDir);
        for (const input of snapshot.inputs ?? [])
          if (
            !existsSync(input.path) ||
            verifiedFileDigest(input.path) !== input.sha256
          )
            return "stale";
        return "ready";
      } catch {
        return "stale";
      }
    }
    if (result.kind === "delivery") {
      if (
        !sourceMatches(snapshot,current) ||
        !same(snapshot.document.canvas, current.canvas)
      )
        return "stale";
      try {
        verifyDeliveryResult(result, snapshot);
        const sourceInput = (snapshot.inputs ?? []).find(
          (input) =>
            input.originalPath === snapshot.videoPath ||
            input.path === snapshot.videoPath,
        );
        if (
          sourceInput &&
          (!existsSync(sourceInput.path) ||
            verifiedFileDigest(sourceInput.path) !== sourceInput.sha256)
        )
          return "stale";
        return "ready";
      } catch {
        return "stale";
      }
    }
    if (result.kind !== "candidate")
      for (const input of snapshot.inputs ?? []) {
        if (!existsSync(input.path)) return "stale";
        const stat = statSync(input.path);
        if (
          (stat.size !== input.bytes ||
            stat.mtimeMs !== input.mtimeMs ||
            stat.ctimeMs !== input.ctimeMs) &&
          verifiedFileDigest(input.path) !== input.sha256
        )
          return "stale";
      }
    if (result.kind === "shot-revision") { try {applyShotRevision(result,snapshot,current);return "ready";} catch {return "stale";} }
    const shot = p.shots.find((s) => s.id === result.shotId);
    if (
      !shot ||
      shot.cancelled ||
      (result.requirementVersion !== undefined &&
        result.requirementVersion !== shot.requirementVersion)
    )
      return "stale";
    if (result.kind === "template") {
      return shot.narration === result.narration &&
        shot.slots.some((slot) => slot.id === result.slotId) &&
        sourceMatches(snapshot,current) &&
        same(snapshot.document.canvas, current.canvas)
        ? "ready"
        : "stale";
    }
    if(snapshot.aiVideoCandidateId){
      try{
        const candidate=aiVideoCandidateFor(current,snapshot);
        if(aiVideoIdentity(candidate)!==snapshot.aiVideoCandidateIdentity||!aiVideoReadSetMatches(snapshot,current)||!aiVideoPlacementFits(current,result.shotId,result.target,snapshot.rangeId))return 'stale';
        for(const ref of snapshot.aiVideoCandidate.references){
          const original=resolve(root,ref.path);
          if(existsSync(original)&&verifiedFileDigest(original)!==ref.sha256)return 'stale';
        }
        const transcriptInput=snapshot.inputs.find(input=>input.path===snapshot.sourceSrtPath);
        const transcriptPath=snapshot.aiVideoReadSet.transcript.sourceSrtPath??transcriptInput?.originalPath;
        if(transcriptInput&&transcriptPath){const original=resolve(root,transcriptPath);if(existsSync(original)&&verifiedFileDigest(original)!==transcriptInput.sha256)return 'stale';}
        return 'ready';
      }catch{return 'stale';}
    }
    const target =
      snapshot.shotId === result.shotId ? snapshot.target : undefined;
    if (["candidate", "match"].includes(result.kind)) {
      if (
        (snapshot.contentDependencies?.[result.shotId] ??
          contentDependency(snapshot.document, result.shotId)) !==
        contentDependency(current, result.shotId)
      )
        return "stale";
    } else if (
      snapshot.dependencies[result.shotId] !==
      dependencyFingerprint(current, result.shotId, target)
    )
      return "stale";
    return "ready";
  }
  function jobFile(job, path) {
    const absolute = resolve(job.outputDir, path);
    if (existsSync(absolute)) return absolute;
    const original = join(
      job.originalDirectory ?? dirname(job.snapshotPath),
      "output",
    );
    if (inside(original, absolute)) {
      const moved = resolve(job.outputDir, relative(original, absolute));
      if (existsSync(moved)) return moved;
    }
    return absolute;
  }
  function evidenceReady(
    result,
    job,
    { contentConfirmed = false, requireHashes = false } = {},
  ) {
    if (result.kind === "footage") {
      try {
        verifyFootageResult(result, snapshotFor(job), job.outputDir);
        return true;
      } catch {
        return false;
      }
    }
    if (result.kind === "delivery") {
      if (result.technical?.passed !== true) return false;
      try {
        verifyDeliveryResult(result, snapshotFor(job));
        return true;
      } catch {
        return false;
      }
    }
    if(result.aiVideoCandidateId){
      requireHashes=true;contentConfirmed=false;
      if(!/^[a-f0-9]{64}$/.test(result.technical?.details?.sha256??''))return false;
    }
    if (
      (result.placementReview?.passed === false && !contentConfirmed) ||
      result.technical?.passed !== true ||
      (result.contentReview?.passed !== true && !contentConfirmed)
    )
      return false;
    const frames = result.contentReview?.frames ?? [],
      fileEvidence = result.contentReview?.evidence?.path;
    const records = [
      ...frames,
      ...(fileEvidence ? [result.contentReview.evidence] : []),
    ];
    return (
      records.length > 0 &&
      records.every((record) => {
        const path = typeof record === "string" ? record : record?.path;
        if (
          requireHashes &&
          (typeof record !== "object" ||
            !/^[a-f0-9]{64}$/.test(record?.sha256 ?? ""))
        )
          return false;
        if (typeof path !== "string") return false;
        const absolute = jobFile(job, path);
        if (!existsSync(absolute) || !statSync(absolute).isFile()) return false;
        return (
          typeof record === "string" ||
          !record.sha256 ||
          verifiedFileDigest(absolute) === record.sha256
        );
      })
    );
  }

  function confirmMediaContent(document, result, override) {
    const confirmation = override.contentConfirmation;
    if (!confirmation || confirmation.confirmed !== true)
      throw new Error("Explicit content confirmation is required");
    const shotId = override.shotId ?? result.shotId,
      slotId = override.slotId ?? result.slotId;
    const shot = document.productionPlan.shots.find((s) => s.id === shotId);
    if (
      !shot ||
      shot.cancelled ||
      !shot.slots.some((s) => s.id === slotId) ||
      confirmation.shotId !== shotId ||
      confirmation.slotId !== slotId
    )
      throw new Error("Content confirmation target changed");
    if (confirmation.requirementVersion !== shot.requirementVersion)
      throw new Error("Content confirmation requirement version changed");
    const mediaSha256 = result.technical?.details?.sha256;
    if (
      !/^[a-f0-9]{64}$/.test(mediaSha256 ?? "") ||
      confirmation.mediaSha256 !== mediaSha256
    )
      throw new Error("Content confirmation media hash identity changed");
    return {
      ...confirmation,
      source: "user",
      confirmedAt: stamp(),
      resultId: result.id,
      projectRevision: document.revision,
    };
  }
  async function prepareMedia(result, job) {
    if (!result.media?.path) throw new Error("Media result missing file");
    const file = jobFile(job, result.media.path);
    if (!existsSync(file)) throw new Error("Result media missing");
    if (
      result.technical?.details?.sha256 &&
      verifiedFileDigest(file) !== result.technical.details.sha256
    )
      throw new Error("Result media hash changed since verification");
    const kind = /\.(png|jpe?g|webp)$/i.test(file) ? "image" : "video";
    const meta = stageCompositionFile(
      { kind, path: file, startSeconds: result.media.sourceInSeconds ?? 0 },
      {
        root,
        base: job.outputDir,
        quality: kind === "video" && job.kind !== "recognize",
      },
    );
    if (
      result.technical?.details?.sha256 &&
      meta.sha256 !== result.technical.details.sha256
    )
      throw new Error("Staged media hash changed since verification");
    if (["delivery", "footage"].includes(result.kind)||result.aiVideoCandidateId) {
      // Decode every frame; a valid first frame cannot establish an intact delivery.
      execFileSync(
        "ffmpeg",
        [
          "-v",
          "error",
          "-xerror",
          "-i",
          file,
          "-map",
          "0:v:0",
          "-f",
          "null",
          "-",
        ],
        { timeout: 60000, maxBuffer: 2 * 1024 * 1024 },
      );
      if (result.kind === "delivery" && result.delivery.transparent) {
        if (!meta.hasAlpha)
          throw new Error("Transparent delivery requires actual Alpha");
        const alpha = execFileSync(
          "ffmpeg",
          [
            "-v",
            "error",
            "-xerror",
            ...(extname(file).toLowerCase() === ".webm"
              ? ["-c:v", "libvpx-vp9"]
              : []),
            "-i",
            file,
            "-vf",
            "format=rgba,alphaextract,signalstats,metadata=mode=print:file=-",
            "-f",
            "null",
            "-",
          ],
          { encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024 },
        );
        if (
          ![
            ...alpha.matchAll(/lavfi\.signalstats\.YMIN=(\d+(?:\.\d+)?)/g),
          ].some((match) => Number(match[1]) < 255)
        )
          throw new Error("Transparent delivery has no transparent pixels");
      } else meta.hasAlpha = false;
    }
    if(result.aiVideoCandidateId){if(meta.kind!=="video")throw Error("AI video requires an actual video file");if(Math.min(meta.width,meta.height)<720)throw Error("AI video actual short side must be at least 720px");meta.hasAlpha=false;meta.muted=true;}
    if (meta.kind === "video" && meta.hasAlpha) {
      const { ensureAlphaPreview } = await import("./alpha-media.mjs");
      Object.assign(
        meta,
        await ensureAlphaPreview(
          `templates/remotion-base/public/${meta.publicPath}`,
          { root },
        ),
      );
    }
    if (result.kind === "footage") {
      if (Math.min(meta.width, meta.height) < 720)
        throw new Error("Footage actual short side must be at least 720px");
      const { candidate } = verifyFootageResult(
        result,
        snapshotFor(job),
        job.outputDir,
      );
      if (candidate.kind && candidate.kind !== meta.kind)
        throw new Error("Footage actual media kind mismatch");
      if (
        meta.width !== candidate.width ||
        meta.height !== candidate.height ||
        (meta.kind === "video" &&
          Math.abs(meta.durationSeconds - candidate.durationSeconds) > 0.05)
      )
        throw new Error("Footage actual dimensions/duration mismatch");
      meta.hasAlpha = false;
      const archive = await archiveInput(
        `templates/remotion-base/public/${meta.publicPath}`,
        file,
        internal(job.projectId),
        { assetSourceRoot: root, expectedHash: candidate.sha256 },
      );
      Object.defineProperty(meta, "footageArchive", { value: archive });
    }
    return meta;
  }
  function appendTarget(
    document,
    shot,
    requested = {},
    { native = false, durationFrames } = {},
  ) {
    let ranges = planRanges(document).filter(
      (range) =>
        range.shotId === shot.id &&
        (!requested.rangeId || range.rangeId === requested.rangeId),
    );
    if (
      ranges.length > 1 &&
      Number.isInteger(requested.startFrame) &&
      Number.isInteger(requested.durationFrames)
    )
      ranges = ranges.filter(
        (range) =>
          requested.startFrame >= range.startFrame &&
          requested.startFrame + requested.durationFrames <=
            range.startFrame + range.durationFrames,
      );
    if (ranges.length !== 1)
      throw new Error("Select one current aligned plan range / 计划范围不明确");
    const range = ranges[0];
    const startFrame = requested.startFrame ?? range.startFrame;
    const length =
      requested.durationFrames ?? durationFrames ?? range.durationFrames;
    if (
      !Number.isInteger(startFrame) ||
      startFrame < 0 ||
      !Number.isInteger(length) ||
      length < 1 ||
      startFrame + length > document.canvas.durationFrames
    )
      throw new Error("Invalid target range / 目标范围超出工程");
    if (native) {
      if (
        !Number.isInteger(requested.startFrame) ||
        !Number.isInteger(requested.durationFrames) ||
        startFrame < range.startFrame ||
        startFrame + length > range.startFrame + range.durationFrames
      )
        throw new Error(
          "Template target must fit current plan range / 模板范围已变更",
        );
    } else if (
      startFrame >= range.startFrame + range.durationFrames ||
      startFrame + length <= range.startFrame
    )
      throw new Error("Media target does not overlap the current plan range");
    return { rangeId: range.rangeId, startFrame, durationFrames: length };
  }
  function applicationKey(shot, slotId, target, implementation) {
    // Explicitly restating a native transparent background is the same
    // implementation as its existing transparent variant, including old keys.
    if (implementation.template?.props?.editorBackground === "transparent" &&
        implementation.template.props.variant?.bg === "transparent") {
      implementation = structuredClone(implementation);
      delete implementation.template.props.editorBackground;
    }
    return hash(
      canonical({
        shotId: shot.id,
        slotId,
        requirementVersion: shot.requirementVersion,
        startFrame: target.startFrame,
        durationFrames: target.durationFrames,
        implementation,
      }),
    );
  }
  function applicationDuplicate(document, shot, key) {
    const binding = shot.bindings.find((item) => item.applicationKey === key);
    if (binding)
      return binding.status === "removed" ||
        binding.ignored ||
        !document.instances.some(
          (instance) => instance.id === binding.instanceId,
        ) ||
        document.productionPlan.dismissedResultIds.includes(binding.resultId)
        ? "ignored"
        : "applied";
    const dismissed = new Set(document.productionPlan.dismissedResultIds);
    if (
      jobs(document.id).some((job) =>
        job.results.some(
          (result) =>
            result.applicationKey === key &&
            (result.state === "ignored" || dismissed.has(result.id)),
        ),
      )
    )
      return "ignored";
    return undefined;
  }
  function markApplication(document, resultId, state = "applied") {
    const p = document.productionPlan;
    const field =
      state === "ignored" ? "dismissedResultIds" : "appliedResultIds";
    p[field] = [...new Set([...p[field], resultId])];
    p.revision++;
    return document;
  }
  function appendTrack(document, instance, label, automatic = false) {
    if (automatic) return appendAutomaticVisualTrack(document, instance);
    document.tracks ??= [];
    const id = `production-${hash(instance.id).slice(0, 20)}`;
    if (!document.tracks.some((track) => track.id === id))
      document.tracks.push({ id, name: label });
    instance.trackId = id;
  }
  function applyTemplate(current, result, override = {}, automatic = false) {
    const d = reconcilePlan(current),
      p = d.productionPlan;
    const shot = p.shots.find((item) => item.id === result.shotId);
    if (
      !shot ||
      shot.cancelled ||
      shot.requirementVersion !== result.requirementVersion ||
      shot.narration !== result.narration
    )
      throw new Error("Template requirement or narration changed");
    const slot = shot.slots.find((item) => item.id === result.slotId);
    if (!slot) throw new Error("Template target slot unavailable");
    if (result.technical?.passed !== true)
      throw new Error("Template lacks technical verification / 技术未通过");
    const preset = presetCatalogById().get(result.template?.id);
    if (!preset) throw new Error("Unknown registered preset / 未登记模板");
    const target = appendTarget(d, shot, result.target, { native: true });
    const instance = {
      id: `plan-${hash(result.id).slice(0, 20)}`,
      assetId: preset.id,
      assetVersion: 1,
      ...target,
      zIndex: Math.max(0, ...d.instances.map((item) => item.zIndex)) + 1,
      name: `${shot.title} · ${preset.name}`,
      props: structuredClone(result.template.props),
    };
    delete instance.rangeId;
    validateEditorProps(instance, d.canvas.durationFrames, {
      fps: d.canvas.fps.num / d.canvas.fps.den,
      requireAssets: true,
      publicRoot: join(root, "templates/remotion-base/public"),
    });
    if (
      (slot.presentationMode ?? shot.presentationMode) === "overlay" &&
      editorAssetBackgroundMode(instance.assetId, instance.props) !==
        "transparent"
    )
      throw new Error(
        "Overlay template requires transparent native props / 透明模板",
      );
    const key = applicationKey(shot, slot.id, target, {
      template: result.template,
    });
    const duplicate =
      !override.targetInstanceId && applicationDuplicate(d, shot, key);
    if (duplicate) return markApplication(d, result.id, duplicate);
    if (override.targetInstanceId) {
      const previous = d.instances.find(
        (item) => item.id === override.targetInstanceId,
      );
      if (
        !previous ||
        !shot.bindings.some(
          (binding) =>
            binding.instanceId === previous.id && binding.slotId === slot.id,
        )
      )
        throw new Error("Target instance not bound to slot");
      if (
        d.tracks?.some((track) => track.id === previous.trackId && track.locked)
      )
        throw new Error("Target track is locked");
      instance.id = previous.id;
      instance.zIndex = previous.zIndex;
      if (previous.trackId) instance.trackId = previous.trackId;
      d.instances = d.instances.map((item) =>
        item.id === previous.id ? instance : item,
      );
      shot.bindings = shot.bindings.filter(
        (binding) => binding.instanceId !== previous.id,
      );
    } else {
      appendTrack(d, instance, `${shot.title} · 模板 ${preset.name}`, automatic);
      d.instances.push(instance);
    }
    shot.bindings.push({
      id: `binding-${hash(result.id).slice(0, 20)}`,
      slotId: slot.id,
      instanceId: instance.id,
      requirementVersion: shot.requirementVersion,
      resultId: result.id,
      status: "current",
      confirmed: false,
      applicationKey: key,
      templateId: preset.id,
      startFrame: target.startFrame,
      durationFrames: target.durationFrames,
    });
    return markApplication(d, result.id);
  }
  function applyFootage(current, result, job, meta, automatic = false) {
    const snapshot = snapshotFor(job),
      { candidate, placement } = verifyFootageResult(
        result,
        snapshot,
        job.outputDir,
      );
    if (currentResultState(result, job, snapshot, current) === "stale")
      throw new Error("Footage project source/canvas identity changed");
    const d = structuredClone(current),
      key = footageApplicationKey(result),
      dismissed = new Set(d.productionPlan.dismissedResultIds);
    if (dismissed.has(result.id))
      return markApplication(d, result.id, "ignored");
    const prior = jobs(d.id)
      .flatMap((j) => j.results)
      .filter(
        (entry) =>
          entry.kind === "footage" &&
          entry.id !== result.id &&
          footageApplicationKey(entry) === key &&
          (entry.state === "applied" ||
            entry.state === "ignored" ||
            dismissed.has(entry.id) ||
            d.productionPlan.appliedResultIds.includes(entry.id)),
      );
    if (prior.length)
      return markApplication(
        d,
        result.id,
        !placement ||
          d.instances.some(
            (i) => i.props?.footageIdentity?.applicationKey === key,
          )
          ? "applied"
          : "ignored",
      );
    if (meta.footageArchive)
      registerInputArchives([meta.footageArchive], internal(d.id));
    registerProjectMedia(
      {
        ...meta,
        path: `templates/remotion-base/public/${meta.publicPath}`,
        name: candidate.visibleContent || candidate.id,
        sha256: candidate.sha256,
        sourceKind: candidate.sourceKind,
        pageUrl: candidate.pageUrl,
        licenseUrl: candidate.licenseUrl,
      },
      { root, projectId: d.id },
    );
    if (!placement) return markApplication(d, result.id);
    const fps = d.canvas.fps.num / d.canvas.fps.den;
    if (
      meta.kind === "video" &&
      placement.sourceOutSeconds > meta.durationSeconds + 0.001
    )
      throw new Error("Footage trim exceeds actual media duration");
    const instance = {
      id: `footage-${hash(result.id).slice(0, 20)}`,
      assetId: "source-pip",
      assetVersion: 1,
      startFrame: placement.startFrame,
      durationFrames: placement.durationFrames,
      zIndex: Math.max(0, ...d.instances.map((i) => i.zIndex)) + 1,
      name: `真实素材 · ${candidate.visibleContent || candidate.id}`,
      props: {
        ...footageMediaProps(d.canvas, meta, placement),
        footageIdentity: {
          resultId: result.id,
          applicationKey: key,
          candidateId: candidate.id,
          placementId: placement.id,
        },
        durationSeconds: placement.durationFrames / fps,
      },
      assetReferences: {
        media: `templates/remotion-base/public/${meta.publicPath}`,
      },
    };
    appendTrack(d, instance, instance.name, automatic);
    d.instances.push(instance);
    validateEditorProps(instance, d.canvas.durationFrames, { fps });
    return markApplication(d, result.id);
  }
  function applyDelivery(current, result, job, meta, automatic = false) {
    const snapshot = snapshotFor(job);
    verifyDeliveryResult(result, snapshot);
    if (currentResultState(result, job, snapshot, current) === "stale")
      throw new Error("Delivery project source/canvas identity changed");
    const d = structuredClone(current),
      fps = d.canvas.fps.num / d.canvas.fps.den;
    const { startFrame, durationFrames } = result.target;
    if (
      startFrame < 0 ||
      durationFrames < 1 ||
      startFrame + durationFrames > d.canvas.durationFrames
    )
      throw new Error("Delivery target range exceeds project canvas");
    if (
      meta.kind === "video" &&
      (meta.durationSeconds + 0.001 < result.delivery.durationSeconds ||
        Math.abs(meta.durationSeconds - result.delivery.durationSeconds) >
          1 / fps + 0.001)
    )
      throw new Error(
        "Delivery duration must match actual media duration without trim/hold/loop",
      );
    if (
      Math.abs(meta.width / meta.height - d.canvas.width / d.canvas.height) >
      0.01
    )
      throw new Error("Delivery media canvas aspect mismatch");
    const key = deliveryApplicationKey(result);
    const dismissed = new Set(d.productionPlan.dismissedResultIds);
    if (dismissed.has(result.id))
      return markApplication(d, result.id, "ignored");
    const prior = jobs(d.id)
      .flatMap((job) => job.results)
      .filter(
        (entry) =>
          entry.kind === "delivery" &&
          entry.id !== result.id &&
          deliveryApplicationKey(entry) === key &&
          (entry.state === "applied" ||
            entry.state === "ignored" ||
            dismissed.has(entry.id) ||
            d.productionPlan.appliedResultIds.includes(entry.id)),
      );
    if (prior.length)
      return markApplication(
        d,
        result.id,
        prior.some((entry) =>
          d.instances.some(
            (instance) =>
              instance.id === `delivery-${hash(entry.id).slice(0, 20)}`,
          ),
        )
          ? "applied"
          : "ignored",
      );
    const instance = {
      id: `delivery-${hash(result.id).slice(0, 20)}`,
      assetId: "source-pip",
      assetVersion: 1,
      startFrame,
      durationFrames,
      zIndex: Math.max(0, ...d.instances.map((item) => item.zIndex)) + 1,
      name: `动画交付 ${result.delivery.entryIndex + 1}`,
      props: {
        deliveryIdentity: { resultId: result.id, applicationKey: key },
        sourceMode: "media",
        media: { ...meta, startSeconds: 0 },
        size: pipFitSize(d.canvas.width, d.canvas.height, {
          crop: {
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            sourceAspect: meta.width / meta.height,
          },
        }),
        x: 50,
        y: 50,
        radius: 0,
        borderWidth: 0,
        shadow: 0,
        entrance: "none",
        exit: "none",
        transitionSeconds: 0,
        crop: {
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          sourceAspect: meta.width / meta.height,
        },
        durationSeconds: durationFrames / fps,
      },
      assetReferences: {
        media: `templates/remotion-base/public/${meta.publicPath}`,
      },
    };
    appendTrack(
      d,
      instance,
      `${instance.name} · ${hash(result.id).slice(0, 6)}`,
      automatic,
    );
    d.instances.push(instance);
    validateEditorProps(instance, d.canvas.durationFrames, { fps });
    return markApplication(d, result.id);
  }
  function applyMedia(
    current,
    result,
    job,
    meta,
    override = {},
    contentConfirmation,
    automatic = false,
  ) {
    let d = reconcilePlan(current),
      p = d.productionPlan,
      shot = p.shots.find((s) => s.id === (override.shotId ?? result.shotId));
    if (!shot || shot.cancelled) throw new Error("Target shot unavailable");
    if(result.aiVideoCandidateId&&((override.shotId&&override.shotId!==result.shotId)||(override.slotId&&override.slotId!==result.slotId)||override.targetInstanceId))throw Error('AI video linked result cannot retarget or replace an existing instance');
    const slotId = override.slotId ?? result.slotId;
    let slot = shot.slots.find((s) => s.id === slotId);
    if(!slot&&result.aiVideoCandidateId){
      const candidate=aiVideoCandidateFor(d,result);
      if(slotId===aiVideoSlotId(candidate)){slot=automaticAiVideoSlot(candidate,shot.requirementVersion);shot.slots.push(slot);}
    }
    if (!slot) throw new Error("Target slot unavailable");
    const presentationMode = result.aiVideoCandidateId?'immersive':slot.presentationMode ?? shot.presentationMode;
    if (
      presentationMode === "overlay" &&
      (meta.hasAlpha !== true ||
        (meta.kind === "video"
          ? extname(meta.publicPath).toLowerCase() !== ".mov"
          : ![".png", ".webp"].includes(
              extname(meta.publicPath).toLowerCase(),
            )))
    )
      throw new Error(
        "Overlay requires actual transparent PNG/WebP or MOV / 透明素材",
      );
    if (
      contentConfirmation &&
      (contentConfirmation.requirementVersion !== shot.requirementVersion ||
        contentConfirmation.shotId !== shot.id ||
        contentConfirmation.slotId !== slot.id)
    )
      throw new Error("Content confirmation requirement or target changed");
    const instanceId = override.targetInstanceId;
    let target;
    if (instanceId) {
      const bound = shot.bindings.find(
        (b) => b.instanceId === instanceId && b.slotId === slotId,
      );
      if (!bound) throw new Error("Target instance not bound to slot");
      const instance = d.instances.find((i) => i.id === instanceId);
      if (!instance) throw new Error("Target instance deleted");
      if (
        d.tracks?.some((track) => track.id === instance.trackId && track.locked)
      )
        throw new Error("Target track is locked");
      target = {
        instanceId,
        startFrame: instance.startFrame,
        durationFrames: instance.durationFrames,
      };
    }
    const fps = d.canvas.fps.num / d.canvas.fps.den;
    const sourceInSeconds =
      override.sourceInSeconds ?? result.media.sourceInSeconds ?? 0;
    const sourceOutSeconds =
      override.sourceOutSeconds ??
      result.media.sourceOutSeconds ??
      (meta.kind === "video" && result.kind === "match"
        ? meta.durationSeconds
        : sourceInSeconds +
          (target?.durationFrames ??
            result.target?.durationFrames ??
            appendTarget(d, shot, {
              rangeId: override.rangeId ?? result.target?.rangeId,
            }).durationFrames) /
            fps);
    if (!target)
      target = appendTarget(
        d,
        shot,
        {
          ...(result.target ?? {}),
          ...(override.rangeId ? { rangeId: override.rangeId } : {}),
        },
        {
          durationFrames:
            meta.kind === "video"
              ? Math.round((sourceOutSeconds - sourceInSeconds) * fps)
              : undefined,
        },
      );
    if (
      !Number.isFinite(sourceInSeconds) ||
      sourceInSeconds < 0 ||
      !Number.isFinite(sourceOutSeconds) ||
      sourceOutSeconds <= sourceInSeconds
    )
      throw new Error("Invalid media in/out");
    if (
      meta.kind === "video" &&
      (sourceOutSeconds > meta.durationSeconds + 0.001 ||
        Math.abs(
          sourceOutSeconds - sourceInSeconds - target.durationFrames / fps,
        ) >
          1 / fps + 0.001)
    )
      throw new Error(
        "Media too short for target; explicit trim/hold/loop design required",
      );
    if(result.aiVideoCandidateId&&!aiVideoPlacementFits(d,shot.id,target))throw Error("AI video placement must fit its current canonical range");
    const key = applicationKey(shot, slotId, target, {
      mediaSha256: meta.sha256,
      sourceInSeconds,
      sourceOutSeconds,
      ...(result.media.editable ? { preset: result.media.preset } : {}),
      ...(result.aiVideoCandidateId?{aiVideoCandidateId:result.aiVideoCandidateId,aiVideoPromptVersion:result.aiVideoPromptVersion}:{}),
    });
    const duplicate = !instanceId && applicationDuplicate(d, shot, key);
    if (duplicate) return markApplication(d, result.id, duplicate);
    meta = { ...meta, startSeconds: sourceInSeconds };
    const instance = {
      id: instanceId ?? `plan-${hash(result.id).slice(0, 20)}`,
      assetId:
        result.media.editable && result.media.preset
          ? result.media.preset.assetId
          : "source-pip",
      assetVersion: 1,
      startFrame: target.startFrame,
      durationFrames: target.durationFrames,
      zIndex: Math.max(0, ...d.instances.map((i) => i.zIndex)) + 1,
      name: shot.title,
      props:
        result.media.editable && result.media.preset
          ? structuredClone(result.media.preset.props)
          : result.aiVideoCandidateId
            ? {
                ...footageMediaProps(d.canvas, meta, {layout: "contain", sourceInSeconds}),
                durationSeconds: target.durationFrames / fps,
              }
          : {
              sourceMode: "media",
              media: meta,
              size: 100,
              x: 50,
              y: 50,
              radius: 0,
              borderWidth: 0,
              shadow: 0,
              entrance: "none",
              exit: "none",
              transitionSeconds: 0,
              crop: {
                x: 0,
                y: 0,
                width: 1,
                height: 1,
                sourceAspect: meta.width / meta.height,
              },
              durationSeconds: target.durationFrames / fps,
            },
    };
    if(result.aiVideoCandidateId)instance.props.aiVideoIdentity={shotId:shot.id,aiVideoCandidateId:result.aiVideoCandidateId,aiVideoPromptVersion:result.aiVideoPromptVersion,...(result.aiVideoCandidateSha256?{aiVideoCandidateSha256:result.aiVideoCandidateSha256}:{}),sourceKind:'ai-generated'};
    instance.assetReferences = {
      media: `templates/remotion-base/public/${meta.publicPath}`,
    };
    if (!instanceId)
      appendTrack(
        d,
        instance,
        `${shot.title} · 素材 ${hash(result.id).slice(0, 6)}`,
        automatic,
      );
    if (instanceId) {
      const previous = d.instances.find((i) => i.id === instanceId);
      instance.zIndex = previous.zIndex;
      if (previous.trackId) instance.trackId = previous.trackId;
      d.instances = d.instances.map((i) =>
        i.id === instanceId ? instance : i,
      );
    } else d.instances.push(instance);
    validateEditorProps(instance, d.canvas.durationFrames, { fps });
    shot.bindings = shot.bindings.filter((b) => b.instanceId !== instance.id);
    shot.bindings.push({
      id: `binding-${hash(result.id).slice(0, 20)}`,
      slotId,
      instanceId: instance.id,
      path: instance.assetReferences.media,
      ...(result.candidateId ? { candidateId: result.candidateId } : {}),
      ...(result.aiVideoCandidateId?{aiVideoCandidateId:result.aiVideoCandidateId,aiVideoPromptVersion:result.aiVideoPromptVersion,...(result.aiVideoCandidateSha256?{aiVideoCandidateSha256:result.aiVideoCandidateSha256}:{})}:{}),
      sourceInSeconds,
      sourceOutSeconds,
      requirementVersion: shot.requirementVersion,
      confirmed: !!contentConfirmation,
      applicationKey: key,
      ...(contentConfirmation ? { contentConfirmation } : {}),
      resultId: result.id,
      status: "current",
      startFrame: instance.startFrame,
      durationFrames: instance.durationFrames,
    });
    p.appliedResultIds = [...new Set([...p.appliedResultIds, result.id])];
    p.dismissedResultIds = p.dismissedResultIds.filter(
      (id) => id !== result.id,
    );
    p.revision++;
    return d;
  }
  function applyAlignment(current, result, override = {}, explicit = false) {
    const d = structuredClone(current),
      p = d.productionPlan;
    const shot = p.shots.find(
      (s) => s.id === (override.shotId ?? result.shotId),
    );
    if (!shot || shot.cancelled) throw new Error("Target shot unavailable");
    const alignment = result.alignment ?? { anchor: result.anchor };
    const review = alignment.contentReview;
    if (
      shot.timing.manual &&
      (!explicit || override.replaceManualTiming !== true)
    )
      throw new Error("保留手调时间；采用建议需 replaceManualTiming:true");
    if (
      review?.critical &&
      (!explicit ||
        !["recognition_error", "spoken_slip", "intended_change"].includes(
          override.interpretation,
        ))
    )
      throw new Error("内容差异需确认 interpretation");
    if (
      !explicit &&
      (review?.critical !== false ||
        alignment.timing?.status !== "aligned" ||
        (alignment.anchor?.confidence ?? 0) < 0.85)
    )
      throw new Error("对齐置信度或正文差异待确认");
    const anchor = structuredClone(alignment.anchor);
    if (anchor) {
      if (
        !d.source?.path ||
        typeof anchor.sourcePath !== "string" ||
        resolve(root, anchor.sourcePath) !== resolve(root, d.source.path)
      )
        throw new Error("Alignment source changed");
      anchor.sourcePath = d.source.path;
    }
    const ranges = alignment.suggestedRanges ?? alignment.timing?.ranges ?? [];
    if (!ranges.length)
      throw new Error("Alignment has no reliable suggested ranges");
    if (anchor) shot.anchor = anchor;
    else delete shot.anchor;
    // Narration alignment cannot replace the separately designed effect window.
    // Only an explicit replacement of hand-edited timing adopts those ranges.
    if (
      !shot.effectTiming ||
      (shot.timing.manual && explicit && override.replaceManualTiming === true)
    )
      shot.timing = {
        status:
          explicit && (shot.timing.manual || !anchor) ? "manual" : "aligned",
        manual: explicit && (shot.timing.manual || !anchor),
        ranges: structuredClone(ranges),
      };
    if (explicit)
      shot.alignmentDecision = {
        resultId: result.id,
        choice: override.alignmentChoice ?? "suggested",
        ...(override.interpretation
          ? { interpretation: override.interpretation }
          : {}),
        replaceManualTiming: override.replaceManualTiming === true,
        createdAt: stamp(),
      };
    p.appliedResultIds = [...new Set([...p.appliedResultIds, result.id])];
    p.dismissedResultIds = p.dismissedResultIds.filter(
      (id) => id !== result.id,
    );
    if (typeof review?.actualNarration === "string")
      shot.actualNarration = review.actualNarration;
    if (explicit && override.interpretation === "intended_change") {
      if (
        typeof review?.actualNarration !== "string" ||
        !review.actualNarration.trim()
      )
        throw new Error("Intended change requires actual narration");
      const previousNarration = shot.narration,
        nextNarration = review.actualNarration;
      const incoming = structuredClone(p);
      incoming.shots.find((s) => s.id === shot.id).narration = nextNarration;
      const first = previousNarration
        ? p.script.indexOf(previousNarration)
        : -1;
      const unique =
        first >= 0 &&
        p.script.indexOf(previousNarration, first + previousNarration.length) <
          0;
      if (unique)
        incoming.script =
          p.script.slice(0, first) +
          nextNarration +
          p.script.slice(first + previousNarration.length);
      d.productionPlan = mergePlans(p, p, incoming);
      if (!unique && previousNarration !== nextNarration)
        d.productionPlan.conflicts.push({
          id: `narration-script-${result.id}`,
          field: "script",
          base: p.script,
          current: p.script,
          incoming: [...incoming.shots]
            .sort((a, b) => a.order - b.order)
            .map((s) => s.narration)
            .join("\n"),
          reason:
            "原正文无法唯一定位该镜原文；此建议按镜头口播重建，请核对完整正文",
        });
      d.productionPlan.changes.push({
        id: `narration-${result.id}`,
        type: "confirm-narration",
        shotId: shot.id,
        originalNarration: previousNarration,
        actualNarration: nextNarration,
        originalScript: p.script,
        createdAt: stamp(),
      });
    }
    d.productionPlan.revision++;
    const next = reconcilePlan(d);
    if (
      !next.productionPlan.shots.find((s) => s.id === shot.id).timing.ranges
        .length
    )
      throw new Error("Alignment has no current source ranges");
    return next;
  }
  function refreshPackageTranscript(current, job) {
    const snapshot = snapshotFor(job);
    if (snapshot.editReconciliationVersion !== 1 || !current.captions?.cues?.length) return current;
    const key = branchValueHash({revision:current.revision, source:current.source, canvas:current.canvas, captions:current.captions.cues});
    const metadata = freezeProjectTranscript(current, join(job.outputDir, 'reconciled-transcript', key), {sourcePath:inputPath(current.source.path)});
    current.productionPlan = {...current.productionPlan, ...metadata};
    return current;
  }
  function applyPlanResult(current, result, job, reconciled = false) {
    const frozen = snapshotFor(job);
    if (!reconciled && frozen.editReconciliationVersion === 1 &&
        (!same(frozen.document.source?.clips, current.source?.clips) ||
         !same(frozen.document.canvas, current.canvas))) {
      const base = structuredClone(frozen.document);
      const proposed = applyPlanResult(base, result, job, true);
      const merged = reconcilePackageDocument(base, proposed, current,
        {kind:'semanticPlan',writeSet:[{path:['productionPlan']}]});
      merged.document.productionPlan = normalizePlan(merged.document.productionPlan);
      return refreshPackageTranscript(merged.document, job);
    }
    for (const pkg of result.plan.packages ?? []) archivePackage(current, pkg);
    if (result.package) archivePackage(current, result.package);
    const next = structuredClone(current),
      base = snapshotFor(job).document.productionPlan;
    if (
      result.basePlan &&
      !same(normalizePlan(result.basePlan), normalizePlan(base))
    )
      throw new Error("Plan delta base does not match immutable snapshot");
    const incoming = structuredClone(result.plan);
    const scriptPatch = result.scriptPatch;
    if (scriptPatch && scriptPatch.baseScript !== base.script)
      throw new Error("Script patch base does not match immutable snapshot");
    if (
      scriptPatch &&
      (!Array.isArray(scriptPatch.conflicts) ||
        typeof scriptPatch.candidateScript !== "string")
    )
      throw new Error("Invalid script patch");
    if (scriptPatch?.conflicts.length) incoming.script = base.script;

    if (result.requiresConfirmation) {
      for (const shot of incoming.shots ?? []) {
        const previous = current.productionPlan.shots.find(
          (s) => s.id === shot.id,
        );
        if (previous?.timing.manual)
          shot.timing = structuredClone(previous.timing);
        if (shot.removalPending && shot.cancelled) shot.removalPending = false;
      }
    }
    next.productionPlan = mergePlans(base, next.productionPlan, incoming);
    if (scriptPatch?.conflicts.length)
      next.productionPlan.conflicts.push({
        id: `script-delta-${result.id}`,
        field: "script",
        base: base.script,
        current: current.productionPlan.script,
        incoming: scriptPatch.candidateScript,
        requiresManual: true,
        reason: scriptPatch.conflicts
          .map((c) => c.reason ?? "正文定位需人工确认")
          .join("；"),
      });
    if (result.requiresConfirmation) {
      next.productionPlan.approval = "needs_design";
      if (next.productionPlan.approvalRecord)
        next.productionPlan.approvalRecord.status = "needs_design";
      next.productionPlan.changes.push({
        id: `delta-${result.id}`,
        type: "confirm-content-delta",
        contentChanges: structuredClone(result.contentChanges ?? {}),
        ...(scriptPatch ? { scriptPatch: structuredClone(scriptPatch) } : {}),
        originalScript: base.script,
        resultId: result.id,
        createdAt: stamp(),
      });
    }
    next.productionPlan.appliedResultIds = [
      ...new Set([...next.productionPlan.appliedResultIds, result.id]),
    ];
    next.productionPlan.revision++;
    return reconciled ? next : refreshPackageTranscript(next, job);
  }
  function packageOperationContext(job,snapshot){
    return {outputRoot:job.outputDir,lockRoot:jobIndex,scope:snapshot.scope,projectId:job.projectId,runId:snapshot.runId,packageOrchestrationVersion:resolvePackageOrchestrationVersion(snapshot.packageOrchestrationVersion),
      load:()=>doc(job.projectId),save:(next,revision)=>{const current=doc(job.projectId);if(current.revision!==revision)throw conflict(current);return save(next);},
      isCancelled:()=>['cancelling','cancelled'].includes(getJob(job.id).status),
      validateDocument,
      ...(snapshot.editReconciliationVersion===1?{acceptCaptionReadback:acceptedPackageCaptionDocument,reconcile:(base,proposed,current,op,metadata)=>{if(op.kind==='bgm'&&snapshot.bgmExecutionVersion===1)assertBgmReconciliation(base,current);const merged=reconcilePackageDocument(base,proposed,current,{kind:op.kind,writeSet:op.writeSet,...metadata});
      if(op.kind==='bgm'&&snapshot.bgmExecutionVersion===1){
        // Audio and its ownership baseline were proven unchanged above. Keep replacement
        // atomic; generic array reconciliation intentionally retains other deleted items.
        for(const key of ['audioClips','audioTracks'])if(proposed[key]!==undefined)merged.document[key]=structuredClone(proposed[key]);
        const application=proposed.styleReference?.allowedOverrides?.bgmApplication;
        if(application!==undefined)merged.document.styleReference.allowedOverrides.bgmApplication=structuredClone(application);
      }
      if(op.kind==='semanticPlan')refreshPackageTranscript(merged.document,job);return merged;}}:{}),
      validateOperation:(op)=>{if(op.kind==='bgm'&&snapshot.bgmExecutionVersion===1){
        const writes=[['productionPlan'],['audioClips'],['audioTracks'],['styleReference','allowedOverrides','bgmApplication']];
        if(writes.some(path=>!op.writeSet.some(x=>same(x.path,path)))||[...writes,['source'],['canvas']].some(path=>!op.readSet.some(x=>same(x.path,path))))throw Error('BGM execution requires complete audio/metadata/source read and write protection');
      }const native=op.payload?.nativeResult??op.payload?.result;const expected={semanticPlan:'plan',template:'template',footage:'footage'}[op.kind];if(expected){if(native?.kind!==expected)throw Error('Native result kind mismatch');validateResult(native,job,snapshot);}if(['camera','captions'].includes(op.kind)&&!op.writeSet.some(x=>same(x.path,op.kind==='camera'?['source','cameraPlan']:['captions'])))throw Error('Native field missing from write set');},
      adapters:{
        semanticPlan:(current,op)=>applyPlanResult(current,op.payload.nativeResult??op.payload.result,job),
        template:(current,op)=>applyTemplate(current,op.payload.nativeResult??op.payload.result,{},true),
        footage:async(current,op)=>{const native=op.payload.nativeResult??op.payload.result;const meta=await prepareMedia(native,job);if(!evidenceReady(native,job))throw Error('Footage evidence unavailable');return applyFootage(current,native,job,meta,true);},
        camera:(current,op)=>{if(!current.source||current.source.locked)throw Error('Camera source protected');current.source.cameraPlan=structuredClone(op.payload.value);validateDocument(current);return current;},
        captions:(current,op)=>{validateCaptionTrack(op.payload.value,{durationFrames:current.canvas.durationFrames});current.captions=structuredClone(op.payload.value);validateDocument(current);return current;},
        aiVideo:(current,op)=>{const values=op.payload.value;if(!Array.isArray(values))throw Error('AI candidates must be per-shot values');const incoming=structuredClone(current.productionPlan);for(const row of values){const shot=incoming.shots.find(s=>s.id===row.shotId);if(!shot||shot.requirementVersion!==row.requirementVersion||!Array.isArray(row.aiVideoCandidates))throw Error('AI candidate semantic version changed');const prior=shot.aiVideoCandidates??[];for(const c of row.aiVideoCandidates){const old=prior.find(x=>x.id===c.id);if(old){if(!same(old,c))throw Error('Existing AI candidate preserved');}else prior.push(structuredClone(c));}shot.aiVideoCandidates=prior;}current.productionPlan=normalizePlan(incoming);return current;},
        cover:(current,op)=>{const receipt=op.payload.value;if(receipt?.schemaVersion!==1||receipt.branch!=='cover'||receipt.projectId!==current.id||receipt.runId!==snapshot.runId||!receipt.coverCandidateManifestPath)throw Error('Cover candidate receipt invalid');atomicJson(join(job.outputDir,'production','cover-receipt.json'),receipt);return current;},
        bgm:(current,op)=>{
          const value=op.payload.value??op.payload;
          if(snapshot.bgmPlanVersion!==1||value.bgmPlanVersion!==1||!Array.isArray(value.sections)||!Array.isArray(value.recommendations)||!Array.isArray(value.recommendationGaps))throw Error('Invalid frozen BGM plan payload');
          const plan=structuredClone(current.productionPlan),reviewed=new Set(value.sections.map(row=>row.id));
          if(reviewed.size!==value.sections.length)throw Error('Duplicate BGM section');
          const protectedShot=shot=>{const design=shot.bgmDesign;return !!design&&(shot.manual||shot.locked||design.manual||design.locked||!shot.upstream?.packageShot?.bgmDesign||!same(design,shot.upstream.packageShot.bgmDesign));};
          const protectedShotIds=new Set(plan.shots.filter(protectedShot).map(shot=>shot.id));
          const old=new Map((plan.bgmRecommendations??[]).map(rec=>[rec.id,rec])),protectedRefs=new Set(plan.shots.filter(shot=>!reviewed.has(shot.id)||protectedShot(shot)).flatMap(shot=>shot.bgmDesign?.recommendationIds??[]));
          const prior=plan.upstream?.packageBgm;
          if(!prior||!same(plan.bgmRecommendations??[],prior.bgmRecommendations??[]))for(const id of old.keys())protectedRefs.add(id);
          const recommendations=new Map(),renamed=new Map(),reserved=new Set([...old.keys(),...value.recommendations.map(rec=>rec.id)]);
          for(const item of value.recommendations){const rec=structuredClone(item);if(protectedRefs.has(rec.id)&&old.has(rec.id)&&!same(rec,old.get(rec.id))){let id=rec.id+'-'+hash(canonical(rec)).slice(0,12);while(reserved.has(id))id+='-new';renamed.set(rec.id,id);rec.id=id;reserved.add(id);}if(recommendations.has(rec.id))throw Error('Duplicate BGM recommendation');recommendations.set(rec.id,rec);}
          for(const row of value.sections){const shot=plan.shots.find(shot=>shot.id===row.id);if(!shot||shot.requirementVersion!==row.requirementVersion||!row.bgmDesign)throw Error('BGM requirementVersion changed');if(protectedShot(shot))continue;const design={...structuredClone(row.bgmDesign),requirementVersion:row.requirementVersion,recommendationIds:(row.bgmDesign.recommendationIds??[]).map(id=>renamed.get(id)??id)};shot.bgmDesign=design;shot.upstream={...shot.upstream,packageShot:{...shot.upstream?.packageShot,bgmDesign:structuredClone(design)}};}
          for(const id of protectedRefs)if(old.has(id))recommendations.set(id,old.get(id));
          plan.bgmPlanVersion=1;plan.bgmRecommendations=[...recommendations.values()];plan.bgmRecommendationGaps=structuredClone(value.recommendationGaps);plan.upstream={...plan.upstream,packageBgm:{bgmPlanVersion:1,bgmRecommendations:structuredClone(plan.bgmRecommendations),bgmRecommendationGaps:structuredClone(plan.bgmRecommendationGaps)}};
          current.productionPlan=normalizePlan(plan);
          if(snapshot.bgmExecutionVersion===1)return applyPackageBgmExecution(current,value,{root,outputRoot:job.outputDir,runId:snapshot.runId,files:op.files,protectedShotIds,renamed});
          return current;
        },
        sound:(current,op)=>mergeSoundDesign(current,stageSoundDesign(op.payload.value,current,{root})).document,
      }};
  }
  function saveAutomatic(jobId, document) {
    return withProjectLock(jobIndex, jobId, () => {
      if (["cancelling", "cancelled"].includes(getJob(jobId).status))
        return false;
      save(document);
      return true;
    });
  }
  async function ingestCore({
    projectId,
    jobId,
    results = [],
    status,
    stage,
    processed,
    total,
  }) {
    // Result files are named by content hashes, not publication order.
    // Install the same-batch plan before checking dependent native templates.
    results = [...results].sort(
      (a, b) => Number(b.kind === "plan") - Number(a.kind === "plan"),
    );
    let job = getJob(jobId);
    if (job.projectId !== projectId) throw new Error("Job project mismatch");
    const snapshot = snapshotFor(job);
    if(snapshot.kind==='package')resolvePackageOrchestrationVersion(snapshot.packageOrchestrationVersion);
    for (const r of results) validateResult(r, job, snapshot);
    // Publish immutable raw outputs before touching the effective project. Replays survive any subsequent CAS failure.
    const resultDir = join(dirname(job.snapshotPath), "results");
    mkdirSync(resultDir, { recursive: true });
    for (const r of results) {
      const file = join(resultDir, `${r.id}.json`);
      if (existsSync(file)) {
        if (!same(readJson(file), r))
          throw new Error("Result ID replay has different content");
      } else
        writeFileSync(file, JSON.stringify(r, null, 2) + "\n", { flag: "wx" });
      if (!job.results.some((x) => x.id === r.id))
        job.results.push({ ...structuredClone(r), state: "pending" });
    }
    persist(job);
    for (const raw of results) {
      let current = doc(projectId),
        state = currentResultState(raw, job, snapshot, current),
        result = job.results.find((r) => r.id === raw.id);
      result.state = state;
      if(raw.kind === "shot-revision" && state === "stale") result.reason="当前片段、目标对象或保护状态已变化；结果未回写，请基于当前版本重试";
      if (["applied", "ignored", "stale"].includes(state)) continue;
      try {
        if(raw.kind === 'packageOperation') {
          const context=packageOperationContext(job,snapshot);
          await enqueueBranchOperation(raw.operation,context);
          if(snapshot.packageExecution?.streamingApply || raw.operation.kind==='semanticPlan' || status==='complete' || status==='partial'){
            const rows=await drainBranchOperations(projectId,context),row=rows.find(x=>x.operationId===raw.operation.operationId);
            result.state=row?.status==='applied'?'applied':row?.status==='stale'?'stale':'pending';result.application=row;
            if(row?.error)result.reason=row.error;
          }
        } else if(raw.kind === "shot-revision") {
          withProjectLock(jobIndex,jobId,()=>{
            const durableJob=getJob(jobId);
            if(["cancelling","cancelled"].includes(durableJob.status)){result.state="pending";return;}
            current=doc(projectId);
            const state=currentResultState(raw,durableJob,snapshot,current);
            if(state!=="ready"){result.state=state;return;}
            const next=applyShotRevision(raw,snapshot,current);
            for(const patch of raw.patches.filter(p=>p.entity==="instance")){validateEditorProps(next.instances.find(i=>i.id===patch.id),next.canvas.durationFrames,{fps:next.canvas.fps.num/next.canvas.fps.den,requireAssets:true,publicRoot:join(root,"templates/remotion-base/public")});}
            if(raw.execution){durableJob.executionBaseline={shot:structuredClone(next.productionPlan.shots.find(s=>s.id===snapshot.shotId)),source:structuredClone(next.source),canvas:structuredClone(next.canvas)};atomicJson(jobPath(jobId),durableJob);}
            const saved=save(next);result.state="applied";
            if(raw.execution){job.executionBaseline={shot:structuredClone(saved.productionPlan.shots.find(s=>s.id===snapshot.shotId)),source:structuredClone(saved.source),canvas:structuredClone(saved.canvas)};}
            result.reason=raw.reason;
          });
        } else if (raw.kind === "candidate") {
          const shot = current.productionPlan.shots.find(
            (s) => s.id === raw.shotId,
          );
          const c = raw.candidate;
          if (!c) throw new Error("Candidate result missing candidate");
          const existing = shot.candidates.find(
            (x) => x.id === c.id || (x.slotId === c.slotId && x.url === c.url),
          );
          if (existing) {
            const { id, readAt, ignored } = existing;
            Object.assign(
              existing,
              c,
              { id },
              readAt ? { readAt } : {},
              ignored !== undefined ? { ignored } : {},
            );
          } else shot.candidates.push(structuredClone(c));
          current.productionPlan.appliedResultIds.push(raw.id);
          result.state = saveAutomatic(jobId, current) ? "applied" : "pending";
        } else if (raw.kind === "plan") {
          if (raw.requiresConfirmation) {
            result.state = "pending";
            continue;
          }
          for (const pkg of raw.plan.packages ?? [])
            archivePackage(current, pkg);
          if (raw.package) archivePackage(current, raw.package);
          current.productionPlan = mergePlans(
            snapshot.document.productionPlan,
            current.productionPlan,
            raw.plan,
          );
          current.productionPlan.appliedResultIds.push(raw.id);
          current.productionPlan.revision++;
          result.state = saveAutomatic(jobId, current)
            ? current.productionPlan.conflicts.length
              ? "conflict"
              : "applied"
            : "pending";
        } else if (raw.kind === "template") {
          withProjectLock(jobIndex, jobId, () => {
            const durableJob = getJob(jobId);
            if (["cancelling", "cancelled"].includes(durableJob.status)) {
              result.state = "pending";
              return;
            }
            current = doc(projectId);
            if (
              currentResultState(raw, durableJob, snapshot, current) !== "ready"
            ) {
              result.state = "stale";
              return;
            }
            const next = applyTemplate(current, raw, {}, true);
            result.applicationKey = applicationKey(
              next.productionPlan.shots.find((s) => s.id === raw.shotId),
              raw.slotId,
              raw.target,
              { template: raw.template },
            );
            save(next);
            result.state = next.productionPlan.dismissedResultIds.includes(
              raw.id,
            )
              ? "ignored"
              : "applied";
          });
        } else if (raw.kind === "alignment") {
          withProjectLock(jobIndex, jobId, () => {
            const durableJob = getJob(jobId);
            if (["cancelling", "cancelled"].includes(durableJob.status)) {
              result.state = "pending";
              return;
            }
            current = doc(projectId);
            if (
              currentResultState(raw, durableJob, snapshot, current) !== "ready"
            ) {
              result.state = "stale";
              return;
            }
            save(applyAlignment(current, raw));
            result.state = "applied";
          });
        } else if (
          (raw.kind === "delivery" ||
            raw.kind === "footage" ||
            raw.kind === "match" ||
            (raw.kind === "media" && (job.kind === "broll" || raw.aiVideoCandidateId))) &&
          evidenceReady(raw, job) &&
          !["cancelling", "cancelled"].includes(job.status)
        ) {
          const meta = await prepareMedia(raw, job);
          // Cancellation persists under this same cross-process job lock. Keep
          // the final check and synchronous project CAS inside one boundary.
          withProjectLock(jobIndex, jobId, () => {
            const durableJob = getJob(jobId);
            if (["cancelling", "cancelled"].includes(durableJob.status)) {
              result.state = "ready";
              return;
            }
            current = doc(projectId);
            if (
              currentResultState(raw, durableJob, snapshot, current) !== "ready"
            ) {
              result.state = "stale";
              return;
            }
            if (!evidenceReady(raw, durableJob))
              throw new Error("Result evidence changed during validation");
            const next =
              raw.kind === "delivery"
                ? applyDelivery(current, raw, durableJob, meta, true)
                : raw.kind === "footage"
                  ? applyFootage(current, raw, durableJob, meta, true)
                  : applyMedia(current, raw, durableJob, meta, {}, undefined, true);
            result.applicationKey =
              raw.kind === "delivery"
                ? deliveryApplicationKey(raw)
                : raw.kind === "footage"
                  ? footageApplicationKey(raw)
                  : next.productionPlan.shots
                      .find((s) => s.id === raw.shotId)
                      .bindings.find((binding) => binding.resultId === raw.id)
                      ?.applicationKey;
            save(next);
            result.state = next.productionPlan.dismissedResultIds.includes(
              raw.id,
            )
              ? "ignored"
              : "applied";
          });
        } else result.state = evidenceReady(raw, job) ? "ready" : "pending";
      } catch (error) {
        result.state = /Revision conflict/.test(error.message)
          ? "conflict"
          : "pending";
        result.reason = error.message;
      }
    }
    const outcomes = new Map(job.results.map((r) => [r.id, r]));
    const stored = readJson(jobPath(jobId));
    if(job.executionBaseline)stored.executionBaseline=job.executionBaseline;
    if(snapshot.kind==='package'){const journal=join(job.outputDir,'application-queue','journal.json');if(existsSync(journal))stored.outputs={...stored.outputs,packageApplicationJournalPath:journal,packageApplicationJournalSha256:hash(readFileSync(journal))};}
    for (const result of stored.results) {
      const outcome = outcomes.get(result.id);
      if (outcome) {
        result.state = outcome.state;
        if (outcome.reason) result.reason = outcome.reason;
        if(outcome.application)result.application=outcome.application;
        if (outcome.applicationKey)
          result.applicationKey = outcome.applicationKey;
      }
    }
    // States are recomputed from durable project markers after any concurrent editor save.
    const latest = doc(projectId);
    for (const r of stored.results) {
      const state = currentResultState(r, stored, snapshot, latest);
      if (["applied", "ignored", "stale"].includes(state)) r.state = state;
      else if (!outcomes.has(r.id))
        r.state = evidenceReady(r, stored) ? "ready" : "pending";
    }
    if (status !== undefined) {
      if (!statuses.has(status)) throw new Error("Invalid job status");
      if (!["cancelling", "cancelled"].includes(stored.status))
        stored.status = status;
    }
    if (stage !== undefined) stored.stage = String(stage);
    for (const [k, v] of Object.entries({ processed, total }))
      if (v !== undefined) {
        if (!Number.isInteger(v) || v < 0) throw new Error("Invalid progress");
        stored[k] = v;
      }
    persist(stored);
    const finalized = finalizeFootageUpstream(stored);
    if(stored.kind==='package')await updateFootageBranch(stored);
    await updateRevisionExecution(getJob(stored.id));
    if(stored.kind === "footage" && stored.parentJobId) await updateRevisionExecution(getJob(stored.parentJobId));
    return { job: getJob(stored.id), document: finalized ?? latest };
  }
  function ingest(request) {
    const previous = ingestions.get(request.jobId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => ingestCore(request));
    ingestions.set(request.jobId, next);
    return next.finally(() => {
      if (ingestions.get(request.jobId) === next)
        ingestions.delete(request.jobId);
    });
  }
  async function applyResults({ projectId, revision, operation }) {
    const baseline = doc(projectId);
    if (baseline.revision !== revision) throw conflict(baseline);
    const selected = [];
    for (const rid of [...new Set(operation.resultIds ?? [])]) {
      if (baseline.productionPlan.appliedResultIds.includes(rid)) continue;
      const job = jobs(projectId).find((j) =>
        j.results.some((r) => r.id === rid),
      );
      if (!job) throw new Error("Unknown result");
      if(job.kind==='package')resolvePackageOrchestrationVersion(snapshotFor(job).packageOrchestrationVersion);
      const result = job.results.find((r) => r.id === rid),
        override = operation.overrides?.[rid] ?? {};
      if (
        ![
          "media",
          "match",
          "delivery",
          "footage",
          "template",
          "alignment",
          "plan",
        ].includes(result.kind)
      )
        throw new Error("Result is not applicable");
      const media = ["media", "match", "delivery", "footage"].includes(
        result.kind,
      );
      const contentConfirmation =
        media &&
        !["delivery", "footage"].includes(result.kind) &&
        override.contentConfirmation !== undefined
          ? confirmMediaContent(baseline, result, override)
          : undefined;
      if (
        media &&
        !evidenceReady(result, job, {
          contentConfirmed: !!contentConfirmation,
          requireHashes: !!contentConfirmation,
        })
      )
        throw new Error("Result lacks technical/content evidence");
      if (
        currentResultState(result, job, snapshotFor(job), baseline) ===
          "stale" &&
        (result.kind === "template" || result.aiVideoCandidateId || !override.shotId)
      )
        throw new Error("Stale result requires explicit target confirmation");
      selected.push({
        job,
        result,
        override,
        ...(contentConfirmation ? { contentConfirmation } : {}),
        ...(media ? { meta: await prepareMedia(result, job) } : {}),
      });
    }
    let current = doc(projectId);
    if (current.revision !== revision)
      throw conflict(
        current,
        "Revision conflict: target changed during validation",
      );
    // Validate every selection against one document and save once. A failed later selection leaves no partial edit.
    let next = current;
    for (const item of selected) {
      if (
        ["media", "match", "delivery", "footage"].includes(item.result.kind) &&
        !evidenceReady(item.result, item.job, {
          contentConfirmed: !!item.contentConfirmation,
          requireHashes: !!item.contentConfirmation,
        })
      )
        throw new Error("Result evidence changed during validation");
      if (item.result.kind === "delivery")
        next = applyDelivery(next, item.result, item.job, item.meta);
      else if (item.result.kind === "footage")
        next = applyFootage(next, item.result, item.job, item.meta);
      else if (item.result.kind === "alignment")
        next = applyAlignment(next, item.result, item.override, true);
      else if (item.result.kind === "plan")
        next = applyPlanResult(next, item.result, item.job);
      else if (item.result.kind === "template")
        next = applyTemplate(next, item.result, item.override);
      else
        next = applyMedia(
          next,
          item.result,
          item.job,
          item.meta,
          item.override,
          item.contentConfirmation,
        );
    }
    if (selected.length) {
      next.productionPlan.changes.push({
        id: operation.operationId ?? randomUUID(),
        type: "apply-results",
        resultIds: selected.map((x) => x.result.id),
        ...(selected.some((x) => x.contentConfirmation)
          ? {
              contentConfirmations: selected.flatMap((x) =>
                x.contentConfirmation ? [x.contentConfirmation] : [],
              ),
            }
          : {}),
        baseRevision: revision,
        createdAt: stamp(),
        source: "editor",
      });
      current = save(next);
    }
    for (const item of selected) {
      const latest = getJob(item.job.id);
      const storedResult = latest.results.find((r) => r.id === item.result.id);
      storedResult.state = current.productionPlan.dismissedResultIds.includes(
        item.result.id,
      )
        ? "ignored"
        : "applied";
      const binding = current.productionPlan.shots
        .flatMap((shot) => shot.bindings)
        .find((binding) => binding.resultId === item.result.id);
      if (binding?.applicationKey)
        storedResult.applicationKey = binding.applicationKey;
      if (item.contentConfirmation)
        storedResult.contentConfirmation = item.contentConfirmation;
      persist(latest);
    }
    return { document: current, jobs: jobs(projectId) };
  }

  function footageScope(snapshot) {
    if(!snapshot.target || !snapshot.sourceSrtPath) throw new Error('Scoped footage requires selected range and shared SRT');
    const fps=snapshot.document.canvas.fps.num/snapshot.document.canvas.fps.den;
    const target=snapshot.target, source=snapshot.document.source;
    const sourceCueIds=[];
    const time=v=>{const [h,m,seconds]=v.replace(',', '.').split(':').map(Number);return h*3600+m*60+seconds;};
    const srt=readFileSync(snapshot.sourceSrtPath,'utf8').replace(/\r/g,'');
    for(const block of srt.trim().split(/\n\s*\n/)){
      const m=block.match(/^\s*(\d+)\s*\n(\d\d:\d\d:\d\d[,.]\d+)\s*-->\s*(\d\d:\d\d:\d\d[,.]\d+)/);if(!m)continue;
      const ranges=projectSourceRange(source,time(m[2])*fps,time(m[3])*fps,snapshot.document.canvas.durationFrames);
      if(ranges.some(r=>r.startFrame<target.startFrame+target.durationFrames && r.endFrame>target.startFrame))sourceCueIds.push(Number(m[1]));
    }
    if(!sourceCueIds.length)throw new Error('Scoped footage has no shared SRT cues in selected range');
    return {shotId:snapshot.shotId,rangeId:snapshot.rangeId,...target,sourceCueIds};
  }
  function validateScopedFootage(snapshot,review){
    if(!snapshot.shotId)return;
    const scope=snapshot.footageScope??footageScope(snapshot),allowed=new Set(scope.sourceCueIds.map(String));
    const cues=ids=>Array.isArray(ids)&&ids.length>0&&ids.every(id=>allowed.has(String(id)));
    if(review.sections.length!==1||review.sections[0].id!==snapshot.shotId||!Array.isArray(review.sections[0].sourceCueIds)||!same(review.sections[0].sourceCueIds.map(String),scope.sourceCueIds.map(String)))throw new Error("Scoped footage requires one canonical section with all selected cues");
    const sectionIds=new Set(review.sections.map(s=>s.id));
    if(review.sections.some(s=>!cues(s.sourceCueIds)||s.shotId!==undefined&&s.shotId!==snapshot.shotId))throw new Error('Scoped footage section outside selected shot cues');
    for(const c of review.candidates){
      if(!Array.isArray(c.matchedSectionIds)||!c.matchedSectionIds.length||c.matchedSectionIds.some(id=>!sectionIds.has(id))||c.sourceCueIds!==undefined&&!cues(c.sourceCueIds)||c.shotId!==undefined&&c.shotId!==snapshot.shotId)throw new Error('Scoped footage library association outside selected shot');
    }
    for(const p of review.placements){
      if(!sectionIds.has(p.sectionId)||!cues(p.sourceCueIds)||p.startFrame<scope.startFrame||p.startFrame+p.durationFrames>scope.startFrame+scope.durationFrames||p.shotId!==undefined&&p.shotId!==snapshot.shotId)throw new Error('Scoped footage placement outside selected range');
    }
  }
  function scopedFootageCurrent(job,snapshot,current){
    if(!snapshot.shotId)return true;
    const shot=current.productionPlan.shots.find(s=>s.id===snapshot.shotId),base=snapshot.document.productionPlan.shots.find(s=>s.id===snapshot.shotId);
    if(!shot||shot.cancelled||shot.locked||shot.manual||shot.userModified||shot.requirementVersion!==base?.requirementVersion||!same(shot.timing,base.timing)||!same(shot.narration,base.narration))return false;
    if(job.parentJobId){const parent=getJob(job.parentJobId);if(['cancelled','cancelling'].includes(parent.status))return false;
      if(!currentRevisionParent(parent))return false;
    }
    return true;
  }
  function currentRevisionParent(parent){
    return parent.kind!=='revise'||!jobs(parent.projectId).some(j=>j.kind==='revise'&&j.shotId===parent.shotId&&j.id!==parent.id&&(j.createdAt>parent.createdAt||j.createdAt===parent.createdAt&&(snapshotFor(j).document.revision>snapshotFor(parent).document.revision||snapshotFor(j).document.revision===snapshotFor(parent).document.revision&&j.id>parent.id)));
  }
  async function updateRevisionExecution(job){
    if(job.kind!=='revise'||!['complete','partial'].includes(job.status))return;
    const parent=getJob(job.id),snapshot=snapshotFor(parent);
    const result=parent.results.find(r=>r.kind==='shot-revision'&&r.execution?.kind==='footage'&&r.state==='applied');
    if(!result)return;
    let child=parent.executionJobId?getJob(parent.executionJobId):jobs(parent.projectId).find(j=>j.kind==='footage'&&j.parentJobId===parent.id);
    if(!child){
      const current=doc(parent.projectId),baseline=parent.executionBaseline,shot=current.productionPlan.shots.find(s=>s.id===snapshot.shotId);
      if(!currentRevisionParent(parent)||!baseline||!shot||shot.cancelled||shot.locked||shot.manual||shot.userModified||shot.requirementVersion!==baseline.shot.requirementVersion||!same(shot.timing,baseline.shot.timing)||!same(shot.narration,baseline.shot.narration)||!same(current.source,baseline.source)||!same(current.canvas,baseline.canvas)){parent.executionStatus='partial';parent.executionError='当前片段或源视频已变化，请基于当前版本重试';persist(parent);return;}
      try{
        child=(await createJob({projectId:parent.projectId,revision:current.revision,kind:'footage',shotId:snapshot.shotId,...(snapshot.rangeId?{rangeId:snapshot.rangeId}:{}),...(snapshot.instanceId?{instanceId:snapshot.instanceId}:{}),parentJobId:parent.id,scope:{camera:false,sound:false,footage:true},instructions:[snapshot.instructions,result.execution.instructions].filter(Boolean).join('\n\n'),...(snapshot.sourceSrtPath?{sourceSrtPath:snapshot.sourceSrtPath}:{})})).job;
      }catch(error){const latest=getJob(parent.id);latest.executionStatus='failed';latest.executionError=error.message;persist(latest);return;}
    }
    // A cancellation may arrive while input files are being archived.
    const latest=getJob(parent.id);
    if(['cancelled','cancelling'].includes(latest.status)){cancel(child.id);return;}
    latest.executionJobId=child.id;
    latest.executionStatus=child.status;
    if(child.status==='complete'){
      const actual=child.results.some(r=>r.kind==='footage'&&r.footage?.placementId!==null&&r.state==='applied'&&doc(parent.projectId).instances.some(i=>i.props?.footageIdentity?.resultId===r.id));
      if(!actual){latest.executionStatus='partial';latest.executionError='素材任务结束，但当前片段尚无已入轨的推荐素材';}
    }
    if(child.error)latest.executionError=child.error;
    latest.outputs={...latest.outputs,...Object.fromEntries(['footageReviewPath','footageSummaryPath','allCandidateManifestPath'].filter(k=>child.outputs?.[k]).map(k=>[k,child.outputs[k]]))};
    persist(latest);
  }

  function finalizeFootageUpstream(job) {
    if (job.kind !== "footage" || !["complete", "partial"].includes(job.status))
      return;
    let manifest = {};
    const envelopePath = join(job.outputDir, "manifest.json"),
      envelope = existsSync(envelopePath) ? readJson(envelopePath) : {};
    const pathsToCheck = [
      join(job.outputDir, "result-manifest.json"),
      ...(typeof envelope.workflowManifestPath === "string"
        ? [jobFile(job, envelope.workflowManifestPath)]
        : []),
      envelopePath,
    ];
    for (const path of pathsToCheck) {
      if (!existsSync(path)) continue;
      if (!inside(realpathSync(job.outputDir), realpathSync(path)))
        throw new Error("Footage workflow manifest escapes output directory");
      const value = readJson(path);
      if (
        value.outputs?.footageReviewPath &&
        Array.isArray(value.files) &&
        value.files.length
      ) {
        manifest = value;
        break;
      }
    }
    const outputs = { ...manifest.outputs, ...job.outputs };
    if (
      !outputs.footageReviewPath ||
      !outputs.footageSummaryPath ||
      !outputs.allCandidateManifestPath
    )
      return;
    const paths = {
      reviewPath: outputs.footageReviewPath,
      summaryPath: outputs.footageSummaryPath,
      allCandidateManifestPath: outputs.allCandidateManifestPath,
    };
    for (const path of Object.values(paths)) {
      if (
        typeof path !== "string" ||
        !existsSync(path) ||
        !inside(realpathSync(job.outputDir), realpathSync(path))
      )
        throw new Error(
          "Footage upstream output escapes job directory or is missing",
        );
      const record = (manifest.files ?? []).find(
        (f) =>
          typeof f.path === "string" &&
          existsSync(f.path) &&
          realpathSync(f.path) === realpathSync(path),
      );
      if (!record || record.sha256 !== verifiedFileDigest(path))
        throw new Error("Footage upstream output hash mismatch");
    }
    const snapshot = snapshotFor(job),
      review = readJson(paths.reviewPath),
      reviewSha256 = verifiedFileDigest(paths.reviewPath);
    if (
      review.schemaVersion !== 1 ||
      review.workflowMode !== "real-footage-v1" ||
      review.projectId !== job.projectId
    )
      throw new Error("Footage upstream review identity mismatch");
    for (const [field, key] of [
      ["sourceSrtPath", "sourceSrtPath"],
      ["sourceVideoPath", "videoPath"],
    ]) {
      const expected = snapshot[key],
        input = (snapshot.inputs ?? []).find(
          (i) => i.path === expected || i.originalPath === expected,
        );
      const paths = [expected, input?.path, input?.originalPath]
        .filter(Boolean)
        .map((p) => resolve(p));
      if (
        typeof review[field] !== "string" ||
        !paths.includes(resolve(review[field]))
      )
        throw new Error("Footage upstream SRT/source identity mismatch");
    }
    const results = job.results.filter((r) => r.kind === "footage");
    if (results.some((r) => !["applied", "ignored"].includes(r.state))) return;
    for (const result of results) {
      verifyFootageResult(result, snapshot, job.outputDir);
      if (result.footage.reviewSha256 !== reviewSha256)
        throw new Error("Footage upstream review hash identity mismatch");
    }
    for (const input of snapshot.inputs ?? [])
      if (
        !existsSync(input.path) ||
        verifiedFileDigest(input.path) !== input.sha256
      )
        throw new Error("Footage upstream source hash identity changed");
    const record = { ...paths, jobId: job.id, reviewSha256 };
    let current;
    for (let attempt = 0; attempt < 3; attempt++) {
      current = doc(job.projectId);
      if (
        !same(snapshot.document.source, current.source) ||
        !same(snapshot.document.canvas, current.canvas)
      )
        throw new Error("Footage upstream source/canvas identity changed");
      if(!scopedFootageCurrent(job,snapshot,current)) return;
      validateScopedFootage(snapshot,review);
      const upstream = snapshot.shotId ? current.productionPlan.shots.find(s=>s.id===snapshot.shotId)?.upstream : current.productionPlan.upstream;
      if (same(upstream?.footagePackage, record)) break;
      const next = structuredClone(current);
      const owner=snapshot.shotId ? next.productionPlan.shots.find(s=>s.id===snapshot.shotId) : next.productionPlan;
      owner.upstream = { ...owner.upstream, footagePackage: record };
      next.productionPlan.revision++;
      try {
        current = save(next);
        break;
      } catch (error) {
        if (error.status !== 409 || attempt === 2) throw error;
      }
    }
    job.outputs = { ...job.outputs, ...outputs };
    persist(job);
    return current;
  }
  async function updateFootageBranch(parent) {
    const snapshot = snapshotFor(parent);
    if (parent.kind==='package') {
      resolvePackageOrchestrationVersion(snapshot.packageOrchestrationVersion);
      parent.footageStatus = snapshot.scope?.footage===false?'skipped':'handled-in-full-package';
      persist(parent);
      return;
    }
    if (
      parent.kind !== "broll" ||
      !["complete", "partial", "plan_only"].includes(parent.status)
    )
      return;
    if (snapshot.footageBranchEnabled !== true) return;
    if (snapshot.scope?.footage === false) {
      parent.footageStatus = "skipped";
      persist(parent);
      return;
    }
    if (!parent.animationStatus) {
      parent.animationStatus = parent.status;
      persist(parent);
    }
    let child = jobs(parent.projectId).find((j) => j.parentJobId === parent.id);
    if (!child) {
      try {
        const current = doc(parent.projectId);
        child = (
          await createJob({
            projectId: parent.projectId,
            revision: current.revision,
            kind: "footage",
            parentJobId: parent.id,
            scope: { camera: false, sound: false, footage: true },
            ...(snapshot.instructions
              ? { instructions: snapshot.instructions }
              : {}),
            ...(snapshot.sourceSrtPath
              ? { sourceSrtPath: snapshot.sourceSrtPath }
              : {}),
          })
        ).job;
      } catch (error) {
        parent.footageStatus = "failed";
        parent.footageError = error.message;
        parent.status = "partial";
        parent.stage = "动画分支已处理；素材分支输入有缺口";
        persist(parent);
        return;
      }
    }
    parent.footageJobId = child.id;
    parent.footageStatus = child.status;
    parent.outputs = {
      ...parent.outputs,
      footageJobId: child.id,
      ...(child.outputs?.footageSummaryPath
        ? {
            footageSummaryPath: child.outputs.footageSummaryPath,
            ...(child.outputs.footageReviewPath
              ? { footageReviewPath: child.outputs.footageReviewPath }
              : {}),
            ...(child.outputs.allCandidateManifestPath
              ? {
                  allCandidateManifestPath:
                    child.outputs.allCandidateManifestPath,
                }
              : {}),
          }
        : {}),
    };
    if (!parent.animationStatus) parent.animationStatus = parent.status;
    parent.status =
      child.status === "complete" ? parent.animationStatus : "partial";
    parent.stage =
      child.status === "complete"
        ? "动画与真实素材分支已处理"
        : `动画分支已处理；真实素材：${child.stage}`;
    const summary = parent.outputs.finalSummaryPath;
    if (summary && existsSync(summary)) {
      const text = readFileSync(summary, "utf8"),
        marker = "## 给 Claude 的动画提示词",
        at = text.indexOf(marker);
      if (at >= 0) {
        const begin = "<!-- real-footage-branch:start -->",
          end = "<!-- real-footage-branch:end -->";
        const clean = text
          .slice(0, at)
          .replace(
            /<!-- real-footage-branch:start -->[\s\S]*?<!-- real-footage-branch:end -->\s*/g,
            "",
          );
        const block = `${begin}\n## 真实素材审稿与候选\n\n独立任务：${child.id}；状态：${child.status}；阶段：${child.stage}。\n${child.outputs?.footageSummaryPath ? `逐段审稿报告：${child.outputs.footageSummaryPath}。` : "素材分支尚未交付逐段报告。"}\n${end}\n\n`;
        writeFileSync(summary, clean + block + text.slice(at), "utf8");
      }
    }
    persist(parent);
  }
  async function scan(job) {
    if (!existsSync(job.outputDir)) return;
    const files = join(job.outputDir, "results"),
      results = existsSync(files)
        ? readdirSync(files)
            .filter((f) => f.endsWith(".json"))
            .map((f) => readJson(join(files, f)))
        : [];
    const statusFile = join(job.outputDir, "status.json"),
      manifestFile = join(job.outputDir, "manifest.json");
    const progress = existsSync(statusFile) ? readJson(statusFile) : {},
      manifest = existsSync(manifestFile) ? readJson(manifestFile) : {};
    await ingest({
      projectId: job.projectId,
      jobId: job.id,
      results,
      status: statuses.has(progress.state) ? progress.state : undefined,
      stage: progress.stage,
      processed: progress.processed,
      total: progress.total,
    });
    const latest = getJob(job.id);
    for (const field of ["approvalRequests", "choices", "outputs", "packageBranches", "earlyHandoff"]) {
      const value = manifest[field] ?? progress[field];
      if (value !== undefined) {
        validatePlanJson(value);
        latest[field] = value;
      }
    }
    if (["complete", "partial", "plan_only"].includes(latest.status)) {
      const workflowPath =
        progress.workflowManifestPath ?? manifest.workflowManifestPath;
      if (workflowPath && existsSync(jobFile(latest, workflowPath))) {
        const workflow = readJson(jobFile(latest, workflowPath));
        if (
          latest.kind === "package" &&
          workflow.workflowMode === "semantic-template-v1"
        ) {
          const receipt = finalizeAnimationReceipt(
            latest,
            doc(latest.projectId),
            workflow,
          );
          latest.outputs = {
            ...workflow.outputs,
            ...latest.outputs,
            ...receipt,
          };
          if ((receipt.unappliedTemplates > 0 || receipt.fullPackageState === 'partial') && latest.status === "complete") {
            latest.status = "partial";
            latest.stage = "部分模板尚未入轨";
          }
        }
      }
    }
    // Only replace the saved diagnostic after the terminal output and any
    // workflow receipt above have validated. A partial result can still carry
    // a real error; it must supersede an obsolete process-exit failure.
    if (terminal.has(progress.state) &&
        (latest.status === progress.state || (progress.state === "complete" && latest.status === "partial"))) {
      const currentError = progress.error || manifest.error;
      if (currentError) {
        validatePlanJson(currentError);
        latest.error = currentError;
      } else delete latest.error;
    }
    persist(latest);
    finalizeFootageUpstream(latest);
    await updateRevisionExecution(latest);
    if(latest.kind === "footage" && latest.parentJobId) await updateRevisionExecution(getJob(latest.parentJobId));
    await updateFootageBranch(latest);
    if (latest.kind === "footage" && latest.parentJobId)
      await updateFootageBranch(getJob(latest.parentJobId));
  }

  function cancel(id) {
    const job = getJob(id);
    if(job.kind === "revise" && (job.executionJobId || job.results.some(r=>r.kind==='shot-revision'&&r.execution?.kind==='footage'))){
      const linked=job.executionJobId?getJob(job.executionJobId):jobs(job.projectId).find(j=>j.kind==='footage'&&j.parentJobId===job.id);
      const child=linked?cancel(linked.id):null;job.executionStatus=child?.status??'cancelled';
      if(["complete","partial"].includes(job.status))job.status="cancelled";
      persist(job);
    }
    if (terminal.has(job.status) && job.status !== "interrupted") return job;
    if (job.status === "queued" || !job.pid || !alive(job.pid)) {
      job.status = "cancelled";
      job.stage = "已取消";
      return persist(job);
    }
    job.status = "cancelling";
    job.stage = "正在停止";
    persist(job);
    try {
      process.kill(-job.pid, "SIGTERM");
    } catch {
      try {
        process.kill(job.pid, "SIGTERM");
      } catch {}
    }
    return job;
  }
  async function retry(id) {
    const job = getJob(id);
    if (!terminal.has(job.status)) throw new Error("Task is still active");
    if(job.kind==='revise'){const child=job.executionJobId?getJob(job.executionJobId):jobs(job.projectId).find(j=>j.kind==='footage'&&j.parentJobId===job.id);if(child&&!terminal.has(child.status))throw new Error("Revision execution is still active; stop it before retrying");}
    const snapshot = snapshotFor(job),
      current = doc(job.projectId);
    // A failed initial package may only have request text. After any project
    // edit, the effective plan wins, including an explicitly cleared script.
    const script =
      job.kind === "package" &&
      current.revision === snapshot.document.revision &&
      current.productionPlan.script === "" &&
      snapshot.document.productionPlan.script === ""
        ? (snapshot.script ?? current.productionPlan.script)
        : current.productionPlan.script;
    return createJob({
      ...Object.fromEntries(
        [
          "kind",
          "shotId",
          "slotId",
          "instanceId",
          "rangeId",
          "mediaIds",
          "mediaPaths",
          "deliveryManifestPath",
          "sourceSrtPath",
          "transcriptTimeBase",
          "transcriptProvenancePath",
          "audioPath",
          "parentJobId",
          "candidateId",
          "aiVideoCandidateId",
          "aiVideoPromptVersion",
          "instructions",
          "scope",
        ]
          .filter((k) => snapshot[k] !== undefined && !(job.kind === "revise" && k === "instanceId" && !job.instanceId))
          .map((k) => [k, snapshot[k]]),
      ),
      projectId: job.projectId,
      revision: current.revision,
      script,
      resumeJobId: id,
    });
  }
  async function launch(job) {
    const latest = getJob(job.id);
    if (["cancelled", "cancelling"].includes(latest.status)) {
      latest.status = "cancelled";
      persist(latest);
      return;
    }
    const script =
        options.workerPath ?? join(contentRoot, "tools/editor_plan.py"),
      python =
        options.python ?? process.env.PRODUCTION_PLAN_PYTHON ?? "python3";
    const snapshot = snapshotFor(job);
    if(snapshot.kind==='package')snapshot.packageOrchestrationVersion=resolvePackageOrchestrationVersion(snapshot.packageOrchestrationVersion);
    if(snapshot.kind === "footage" && snapshot.shotId && !scopedFootageCurrent(latest,snapshot,doc(job.projectId))) throw new Error("Selected shot changed or revision was cancelled before execution");
    let executionPath = job.snapshotPath;
    if (!same(snapshot, readJson(job.snapshotPath))) {
      executionPath = join(
        dirname(job.snapshotPath),
        "execution-snapshot.json",
      );
      atomicJson(executionPath, snapshot);
    }
    const argv = [
      script,
      "worker",
      "--snapshot",
      executionPath,
      "--output-dir",
      job.outputDir,
    ];
    if (snapshot.resumeJobId)
      argv.push("--resume", getJob(snapshot.resumeJobId).outputDir);
    const log = openSync(join(dirname(job.snapshotPath), "worker.log"), "a");
    const child = spawn(python, argv, {
      cwd: contentRoot,
      env: {
        ...process.env,
        ...options.workerEnv,
        VISUALIZATION_ROOT: root,
        CONTENT_WORKFLOW_ROOT: contentRoot,
      },
      detached: process.platform !== "win32",
      stdio: ["ignore", log, log],
    });
    closeSync(log);
    children.set(job.id, child);
    job.pid = child.pid ?? null;
    job.ownerPid = process.pid;
    job.status = "running";
    job.stage = "执行工作流";
    persist(job);
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        await scan(getJob(job.id));
      } catch (e) {
        const j = getJob(job.id);
        j.error = e.message;
        persist(j);
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(tick, options.pollMs ?? 1000);
    timer.unref();
    polls.set(job.id, timer);
    let finished = false;
    const finish = async (code, error) => {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      polls.delete(job.id);
      children.delete(job.id);
      while (busy) await new Promise((r) => setTimeout(r, 10));
      try {
        await scan(getJob(job.id));
      } catch (e) {
        error ??= e;
      }
      const latest = getJob(job.id);
      if (latest.status === "cancelling" || code === 130 || code === 143) {
        latest.status = "cancelled";
        latest.stage = "已取消";
      } else if (error || code !== 0) {
        latest.status = "failed";
        latest.error = error?.message ?? `Worker exited ${code}`;
      } else if (!terminal.has(latest.status)) {
        latest.status = "partial";
        latest.stage = "工作流结束，待核对缺口";
      }
      latest.pid = null;
      persist(latest);
      void pump();
    };
    child.once("error", (e) => void finish(null, e));
    child.once("exit", (code) => void finish(code));
  }
  async function pump() {
    if (pumping || closed) return;
    pumping = true;
    try {
      while (!closed) {
        let claimed;
        withProjectLock(jobIndex, "queue", () => {
          const all = allJobs(),
            active = all.filter(
              (j) =>
                ["running", "cancelling"].includes(j.status) &&
                ((j.pid && alive(j.pid)) ||
                  (!j.pid && j.ownerPid && alive(j.ownerPid))),
            );
          if (active.length >= limit) return;
          const next = all.find((j) => j.status === "queued");
          if (!next) return;
          next.status = "running";
          next.ownerPid = process.pid;
          persist(next);
          claimed = next;
        });
        if (!claimed) break;
        try {
          await launch(claimed);
        } catch (error) {
          const job = getJob(claimed.id);
          job.status = "failed";
          job.error = error.message;
          job.pid = null;
          persist(job);
        }
      }
    } finally {
      pumping = false;
    }
  }

  async function recover({ includeCompleted = true } = {}) {
    for (const parent of (includeCompleted ? allJobs() : []).filter(
      (j) =>
        ["package", "broll", "revise"].includes(j.kind) &&
        ["complete", "partial", "plan_only"].includes(j.status),
    )) {
      if (
        parent.kind === "revise" || parent.outputs?.semanticPackagePath ||
        existsSync(join(parent.outputDir, "manifest.json"))
      )
        await scan(parent).catch(() => {});
    }
    for (const job of allJobs().filter((j) =>
      ["running", "cancelling"].includes(j.status),
    )) {
      if (children.has(job.id)) continue;
      await scan(job).catch(() => {});
      const latest = getJob(job.id);
      if (job.pid && alive(job.pid)) {
        // Never launch a second process. Poll durable output until the orphan has exited.
        const timer = setInterval(async () => {
          try {
            await scan(getJob(job.id));
            if (!alive(job.pid)) {
              clearInterval(timer);
              polls.delete(job.id);
              const j = getJob(job.id);
              if (!terminal.has(j.status)) {
                j.status =
                  j.status === "cancelling" ? "cancelled" : "interrupted";
                j.stage = "服务重启后任务已停止，可重试";
                persist(j);
              }
              void pump();
            }
          } catch {}
        }, options.pollMs ?? 1000);
        timer.unref();
        polls.set(job.id, timer);
      } else if (!terminal.has(latest.status)) {
        latest.status =
          latest.status === "cancelling" ? "cancelled" : "interrupted";
        latest.stage = "任务中断，可重试";
        latest.pid = null;
        persist(latest);
      }
    }
    if (options.autoStart !== false) await pump();
  }
  function history(projectId, version) {
    safeProjectId(version);
    return readJson(join(packages(projectId), version, "manifest.json"));
  }
  function currentMarkdown(projectId) {
    return { markdown: currentPlanMarkdown(doc(projectId)) };
  }
  function resolveFile(projectId, path) {
    if (typeof path !== "string") throw new Error("Missing file");
    const document = doc(projectId),
      permitted = new Set();
    const add = (p) => {
      if (typeof p === "string") permitted.add(resolve(root, p));
    };
    for (const ref of referencedPaths(document)) {
      add(ref);
      add(join("templates/remotion-base/public", ref));
    }
    // Package reports are not render assets: authorize their explicit upstream
    // references only inside this project's registered job output directories.
    const upstreamReportPaths = new Set();
    for (const owner of [document.productionPlan, ...(document.productionPlan?.shots ?? [])]) {
      for (const name of ["animationPackage", "footagePackage", "completePackage"]) {
        const metadata = owner?.upstream?.[name];
        for (const [key, value] of Object.entries(metadata ?? {})) {
          if (/Path$/.test(key) && typeof value === "string") upstreamReportPaths.add(value);
        }
        for (const value of Object.values(metadata?.productionReceiptPaths ?? {})) {
          if (typeof value === "string") upstreamReportPaths.add(value);
        }
      }
    }
    for (const j of jobs(projectId)) {
      for (const reportPath of upstreamReportPaths) {
        const candidate = resolve(root, reportPath);
        if (
          inside(j.outputDir, candidate) &&
          existsSync(candidate) &&
          inside(realpathSync(j.outputDir), realpathSync(candidate))
        )
          permitted.add(candidate);
      }

      // The early handoff authorizes one report, never arbitrary output paths.
      try {
        const early=j.earlyHandoff,frozen=snapshotFor(j);
        const output=realpathSync(j.outputDir),canonicalPlan=resolve(j.outputDir,'package','plan.md'),canonicalReceipt=resolve(j.outputDir,'package','early-handoff.json');
        if(j.kind==='package'&&(frozen.packageOrchestrationVersion??2)===2&&early?.status==='ready'&&early.projectId===projectId&&early.runId===frozen.runId&&early.planPath===canonicalPlan&&early.receiptPath===canonicalReceipt&&/^[a-f0-9]{64}$/.test(early.receiptSha256??'')&&realpathSync(canonicalPlan)===join(output,'package','plan.md')&&realpathSync(canonicalReceipt)===join(output,'package','early-handoff.json')&&hash(readFileSync(canonicalReceipt))===early.receiptSha256){
          const receipt=readJson(canonicalReceipt),expected=early.currentPlanSha256??early.planSha256,proofHash=receipt.currentPlanSha256??receipt.planSha256;
          if(receipt.version===1&&receipt.status==='ready'&&receipt.projectId===projectId&&receipt.runId===frozen.runId&&receipt.planPath===canonicalPlan&&/^[a-f0-9]{64}$/.test(expected??'')&&expected===proofHash&&hash(readFileSync(canonicalPlan))===expected)permitted.add(canonicalPlan);
        }
      }catch{/* Missing, changed or escaped early evidence grants no file access. */}

      for (const input of snapshotFor(j).inputs ?? []) {
        add(input.path);
        add(input.originalPath);
      }
      for (const request of j.approvalRequests ?? [])
        for (const file of request.files ?? [])
          if (typeof file.path === "string")
            permitted.add(resolve(j.outputDir, file.path));
      for (const choice of j.choices ?? []) {
        for (const path of [
          choice.previewPath,
          choice.presenterPreviewPath,
          choice.alphaPreviewPath,
          ...(choice.statePaths ?? []),
        ]) {
          if (typeof path !== "string") continue;
          const candidate = resolve(j.outputDir, path);
          const within = (base, file) => {
            const rel = relative(base, file);
            return rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel);
          };
          if (
            within(j.outputDir, candidate) &&
            existsSync(candidate) &&
            within(realpathSync(j.outputDir), realpathSync(candidate))
          )
            permitted.add(candidate);
        }
      }
      for (const [key, path] of Object.entries(j.outputs ?? {})) {
        if (!/Path$/.test(key) || typeof path !== "string") continue;
        const candidate = jobFile(j, path);
        if (
          inside(j.outputDir, candidate) &&
          existsSync(candidate) &&
          inside(realpathSync(j.outputDir), realpathSync(candidate))
        )
          permitted.add(resolve(candidate));
      }
      for (const result of j.results) {
        if (result.kind === "footage") {
          try {
            const {candidate} = verifyFootageResult(result, snapshotFor(j), j.outputDir);
            const reviewPath = resolve(j.outputDir, result.footage.reviewPath);
            permitted.add(reviewPath);
            for (const frame of candidate.review.frames) {
              const framePath = resolve(dirname(reviewPath), typeof frame === "string" ? frame : frame.path);
              if (inside(realpathSync(j.outputDir), realpathSync(framePath))) permitted.add(framePath);
            }
          } catch { continue; }
        }
        if (result.media?.path)
          permitted.add(resolve(j.outputDir, result.media.path));
        for (const f of result.contentReview?.frames ?? [])
          permitted.add(
            resolve(j.outputDir, typeof f === "string" ? f : f.path),
          );
        if (result.plan)
          for (const s of result.plan.shots ?? [])
            for (const k of s.keyframes ?? [])
              permitted.add(resolve(j.outputDir, k.path));
      }
    }
    const cachePath = join(internal(projectId), "candidate-media-cache.json");
    if (existsSync(cachePath)) for (const entry of readJson(cachePath)) {
      try {
        const candidate = currentCandidate(projectId, entry.shotId, entry.candidateId);
        if (candidateIdentity(candidate) !== entry.identity) continue;
        const file = safeMediaPath(root, entry.path);
        if (verifiedFileDigest(file) === entry.sha256) {permitted.add(file);permitted.add(resolve(root,entry.path));}
      } catch {}
    }
    const requested = resolve(root, path);
    let absolute = requested;
    if (!permitted.has(requested))
      throw new Error("File is not referenced by this project");
    if (!existsSync(absolute)) {
      for (const job of jobs(projectId)) {
        const recovered = jobFile(job, requested);
        if (existsSync(recovered)) {
          absolute = recovered;
          break;
        }
      }
      if (!existsSync(absolute)) {
        const manifest = join(internal(projectId), "media-snapshot.json");
        if (existsSync(manifest)) {
          const item = readJson(manifest).find(
            (item) => item.reference === path || item.mirror === requested,
          );
          if (item) {
            const archive = join(
              document.projectBinding.projectRoot,
              ".制作资料",
              "项目素材",
              item.path.split("/").at(-1),
            );
            if (
              existsSync(archive) &&
              verifiedFileDigest(archive) === item.hash
            )
              absolute = archive;
          }
        }
      }
    }
    if (!existsSync(absolute) || !statSync(absolute).isFile())
      throw new Error("Referenced file is unavailable");
    if (
      ![
        ".json",
        ".md",
        ".txt",
        ".srt",
        ".vtt",
        ".png",
        ".jpg",
        ".jpeg",
        ".webp",
        ".gif",
        ".mp4",
        ".mov",
        ".webm",
        ".mp3",
        ".wav",
      ].includes(extname(absolute).toLowerCase())
    )
      throw new Error("Unsupported preview file");
    return realpathSync(absolute);
  }
  function currentCandidate(projectId, shotId, candidateId) {
    const shot = doc(projectId).productionPlan?.shots.find(s => s.id === shotId);
    if (!shot) throw new Error("候选所属段落不存在");
    const canonical = shot.candidates?.find(c => c.id === candidateId && !c.ignored);
    if (canonical) return canonical;
    for (const job of jobs(projectId)) for (const result of job.results) {
      if (result.kind !== "footage" || result.footage?.candidateId !== candidateId) continue;
      try {
        const {candidate} = verifyFootageResult(result, snapshotFor(job), job.outputDir);
        return {...candidate, path:resolve(dirname(resolve(job.outputDir,result.footage.reviewPath)),candidate.path)};
      } catch {}
    }
    throw new Error("当前工程没有此候选或候选校验已失效");
  }
  const candidateIdentity = candidate => hash(JSON.stringify([candidate.id,candidate.url??candidate.pageUrl,candidate.downloadUrl,candidate.path??candidate.previewPath,candidate.sha256,candidate.license,candidate.reuseStatus,candidate.sourceKind]));
  const candidateDownloads = new Map();
  function candidatePlacement(document,shotId,candidateId,target){
    const shot=document.productionPlan.shots.find(s=>s.id===shotId);
    let associated=!!shot.candidates?.some(c=>c.id===candidateId&&!c.ignored), selected;
    const associatedResultIds=[];
    for(const job of jobs(document.id))for(const result of job.results){
      if(result.kind!=='footage'||result.footage?.candidateId!==candidateId)continue;
      try{
        const snapshot=snapshotFor(job),{review,candidate}=verifyFootageResult(result,snapshot,job.outputDir);
        const sourceIdentity=s=>[s?.path,s?.publicPath,s?.startFrame,s?.durationFrames,s?.clips];
        if(snapshot.shotId&&snapshot.shotId!==shotId||!same(sourceIdentity(snapshot.document.source),sourceIdentity(document.source))||!same(snapshot.document.canvas,document.canvas))continue;
        const sections=new Set(review.sections.filter(s=>s.id===shotId&&candidate.matchedSectionIds?.includes(s.id)).map(s=>s.id));
        if(!sections.size)continue;associated=true;
        if(review.placements.some(p=>p.id===result.footage.placementId&&sections.has(p.sectionId)))associatedResultIds.push(result.id);
        const placements=review.placements.filter(p=>p.candidateId===candidateId&&sections.has(p.sectionId)&&p.startFrame>=target.startFrame&&p.startFrame+p.durationFrames<=target.startFrame+target.durationFrames);
        if(!selected&&placements.length===1){const p=placements[0];verifyFootageResult({...result,footage:{...result.footage,placementId:p.id},target:{startFrame:p.startFrame,durationFrames:p.durationFrames},media:{...result.media,sourceInSeconds:p.sourceInSeconds,sourceOutSeconds:p.sourceOutSeconds}},snapshot,job.outputDir);selected={placement:structuredClone(p),candidateSha256:candidate.sha256};}
      }catch{}
    }
    if(!associated)throw new Error('候选没有关联到当前所选段落，不能自动入轨');
    return {...selected,associatedResultIds};
  }
  const selectedRevisionToken=(projectId,shotId)=>hash(JSON.stringify(jobs(projectId).filter(j=>j.kind==='revise'&&j.shotId===shotId).map(j=>j.id).sort()));
  async function adoptCandidateDownload(request){
    const {projectId,shotId,candidateId}=request,baseline=doc(projectId);
    if(!Number.isInteger(request.revision)||request.revision!==baseline.revision)throw conflict(baseline,'Revision conflict: candidate selection requires current project revision');
    const selected=baseline.productionPlan.shots.find(s=>s.id===shotId);
    if(!selected||selected.cancelled||selected.locked)throw new Error('当前段落已删除、取消或锁定，不能入轨');
    const target=targetFor(baseline,{kind:'footage',shotId,...(request.rangeId?{rangeId:request.rangeId}:{})});
    if(!target)throw new Error('当前段落没有真实时间范围');
    const candidate=currentCandidate(projectId,shotId,candidateId),identity=candidateIdentity(candidate),revisionToken=selectedRevisionToken(projectId,shotId);
    const verified=candidatePlacement(baseline,shotId,candidateId,target);
    const descriptor=await candidateDownload({projectId,shotId,candidateId},true);
    const beforeHash=verifiedFileDigest(descriptor.path);
    if(candidate.sha256&&candidate.sha256!==beforeHash)throw new Error('候选媒体内容已改变，不能入轨');
    await (options.candidateDownloadTools?.inspect??inspectDownloadedMedia)(descriptor.path);
    const meta=stageCompositionFile({kind:descriptor.kind,path:descriptor.path,startSeconds:0},{root,base:root,quality:true});
    if(meta.sha256!==beforeHash)throw new Error('技术检查期间候选文件已改变');
    const fps=baseline.canvas.fps.num/baseline.canvas.fps.den;
    let startFrame=target.startFrame,durationFrames=meta.kind==='video'?Math.min(target.durationFrames,Math.floor(meta.durationSeconds*fps+1e-6)):target.durationFrames,sourceInSeconds=0;
    if(verified.placement){const p=verified.placement;
      if(verified.candidateSha256!==meta.sha256)throw new Error('已验收素材身份发生变化');
      startFrame=p.startFrame;durationFrames=p.durationFrames;sourceInSeconds=p.sourceInSeconds;
      if(meta.kind==='video'&&(p.sourceOutSeconds>meta.durationSeconds+1e-6||p.sourceOutSeconds<=sourceInSeconds||Math.abs(p.sourceOutSeconds-sourceInSeconds-durationFrames/fps)>1/fps+.001||durationFrames>Math.round((meta.durationSeconds-sourceInSeconds)*fps)))throw new Error('已验收素材窗口超出实际源片，不能拉伸或定格');
    }
    if(durationFrames<1)throw new Error('候选时长不足一个工程帧');
    const placedTarget={startFrame,durationFrames},sourceOutSeconds=meta.kind==='video'?(verified?.placement?.sourceOutSeconds??sourceInSeconds+durationFrames/fps):0;
    const key=hash(JSON.stringify([shotId,candidateId,meta.sha256,placedTarget,sourceInSeconds,sourceOutSeconds]));
    const baseResultId=`candidate-adoption-${key.slice(0,24)}`;
    for(let attempt=0;attempt<3;attempt++){
      const current=doc(projectId),shot=current.productionPlan.shots.find(s=>s.id===shotId);
      if(!shot||shot.cancelled||shot.locked||shot.requirementVersion!==selected.requirementVersion||!same(shot.timing,selected.timing)||!same(shot.narration,selected.narration)||!same(current.source,baseline.source)||!same(current.canvas,baseline.canvas)||selectedRevisionToken(projectId,shotId)!==revisionToken||candidateIdentity(currentCandidate(projectId,shotId,candidateId))!==identity)throw new Error('下载期间当前段落、时间范围、候选或源视频已变化，请重新选择');
      const existing=current.instances.find(i=>{
        const identity=i.props?.candidateIdentity??i.props?.footageIdentity;
        if(identity?.candidateId!==candidateId||i.props?.media?.sha256!==meta.sha256||i.startFrame>=target.startFrame+target.durationFrames||i.startFrame+i.durationFrames<=target.startFrame)return false;
        if(current.productionPlan.shots.some(s=>s.id!==shotId&&s.bindings.some(b=>b.instanceId===i.id&&b.status!=="removed")))return false;
        return i.props.candidateIdentity?.shotId===shotId||verified.associatedResultIds.includes(i.props.footageIdentity?.resultId)||shot.bindings.some(b=>b.instanceId===i.id&&b.candidateId===candidateId&&b.status!=="removed");
      });
      if(existing)return {...descriptor,added:false,alreadyPresent:true,instanceId:existing.id,document:current,jobs:jobs(projectId)};
      const previouslyApplied=((current.productionPlan.appliedResultIds.includes(baseResultId)||current.productionPlan.dismissedResultIds.includes(baseResultId))&&!current.instances.some(i=>i.props?.candidateIdentity?.resultId===baseResultId))||shot.bindings.some(b=>b.applicationKey===key&&b.status==='removed')||(current.productionPlan.candidateSelections??[]).some(r=>r.applicationKey===key&&!current.instances.some(i=>i.id===r.instanceId));
      const removedFootage=jobs(projectId).some(j=>j.results.some(r=>r.kind==='footage'&&verified.associatedResultIds.includes(r.id)&&!current.instances.some(i=>i.props?.footageIdentity?.resultId===r.id)&&r.footage?.candidateId===candidateId&&same(r.target,placedTarget)&&r.technical?.details?.sha256===meta.sha256&&(r.media.sourceInSeconds??0)===sourceInSeconds&&(current.productionPlan.appliedResultIds.includes(r.id)||current.productionPlan.dismissedResultIds.includes(r.id))));
      if(previouslyApplied||removedFootage)throw new Error('这项候选在当前时间位置已删除，不自动恢复；请保留删除记录');
      const next=structuredClone(current),nextShot=next.productionPlan.shots.find(s=>s.id===shotId);
      const suffix=current.productionPlan.appliedResultIds.includes(baseResultId)||current.instances.some(i=>i.id===`candidate-${key.slice(0,24)}`)?`-${randomUUID().slice(0,8)}`:"";
      const resultId=baseResultId+suffix;
      const instance={id:`candidate-${key.slice(0,24)}${suffix}`,assetId:'source-pip',assetVersion:1,startFrame,durationFrames,zIndex:Math.max(0,...next.instances.map(i=>i.zIndex))+1,name:`真实素材 · ${candidate.title??candidate.visibleContent??candidateId}`,props:{...footageMediaProps(next.canvas,{...meta,hasAlpha:false,muted:true},{layout:'contain',sourceInSeconds}),durationSeconds:durationFrames/fps,candidateIdentity:{shotId,candidateId,applicationKey:key,resultId}},assetReferences:{media:`templates/remotion-base/public/${meta.publicPath}`}};
      appendTrack(next,instance,instance.name,true);next.instances.push(instance);
      const slotId=candidate.slotId??nextShot.slots[0]?.id;
      if(slotId)nextShot.bindings.push({id:`candidate-binding-${key.slice(0,20)}${suffix}`,slotId,candidateId,instanceId:instance.id,path:instance.assetReferences.media,sourceInSeconds,sourceOutSeconds,requirementVersion:shot.requirementVersion,applicationKey:key,resultId,status:'current',startFrame,durationFrames});
      next.productionPlan.candidateSelections=[...(next.productionPlan.candidateSelections??[]),{applicationKey:key,resultId,instanceId:instance.id,shotId,...(target.rangeId?{rangeId:target.rangeId}:{})}];
      next.productionPlan.appliedResultIds.push(resultId);next.productionPlan.revision++;
      validateEditorProps(instance,next.canvas.durationFrames,{fps,requireAssets:true,publicRoot:join(root,'templates/remotion-base/public')});
      try{registerProjectMedia({path:instance.assetReferences.media,name:instance.name,...meta,sha256:meta.sha256,sourceKind:candidate.sourceKind,pageUrl:candidate.pageUrl??candidate.url,licenseUrl:candidate.licenseUrl},{root,projectId});const saved=save(next);return {...descriptor,added:true,alreadyPresent:false,instanceId:instance.id,document:saved,jobs:jobs(projectId)};}catch(error){if(error.status!==409||attempt===2)throw error;}
    }
  }

  async function candidateDownload(request, allowDownload=true) {
    if(allowDownload&&request.addToTimeline===true)return adoptCandidateDownload(request);
    const {projectId,shotId,candidateId}=request;
    const key = JSON.stringify([projectId,shotId,candidateId,allowDownload]);
    if (candidateDownloads.has(key)) return candidateDownloads.get(key);
    const task = (async()=>{
      const candidate = currentCandidate(projectId,shotId,candidateId);
      const descriptor = (path,kind,mediaId) => {
        const url = `/api/editor/production-plan/file?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(path)}`;
        return {candidateId,path,kind,url:url+"&browserPreview=1",downloadUrl:url+"&download=1",...(mediaId?{mediaId}:{})};
      };
      const local = candidate.path;
      if (local && /\.(mp4|mov|webm|png|jpe?g|webp)$/i.test(local)) {
        try {const path=resolveFile(projectId,local);return descriptor(path,/\.(mp4|mov|webm)$/i.test(path)?"video":"image");}catch{}
      }
      const cachePath=join(internal(projectId),"candidate-media-cache.json"),identity=candidateIdentity(candidate);
      const entries=existsSync(cachePath)?readJson(cachePath):[];
      const entry=entries.find(e=>e.shotId===shotId&&e.candidateId===candidateId&&e.identity===identity);
      if(entry){try{return descriptor(resolveFile(projectId,entry.path),entry.kind,entry.mediaId);}catch{}}
      if (!allowDownload) return {candidateId,available:false};
      const sourceUrl=assertReusableCandidate(candidate);
      const extension=extname(new URL(sourceUrl).pathname).toLowerCase();
      if(![".mp4",".mov",".webm",".png",".jpg",".jpeg",".webp"].includes(extension))throw new Error("直接下载地址缺少支持的媒体扩展名");
      const path=`workspace/editor-projects/${safeProjectId(projectId)}/candidate-downloads/${randomUUID()}${extension}`;
      const target=safeMediaPath(root,path,{createParent:true});
      let meta;
      try { await (options.candidateDownloadTools?.download ?? downloadPublicMedia)(sourceUrl,target); meta=await (options.candidateDownloadTools?.inspect ?? inspectDownloadedMedia)(target); }
      catch(error) { await removeCandidateFile(target,{force:true}); throw error; }
      if(candidateIdentity(currentCandidate(projectId,shotId,candidateId))!==identity){await removeCandidateFile(target,{force:true});throw new Error("下载期间候选已改变，请重试");}
      const sha256=verifiedFileDigest(target);
      const media=registerProjectMedia({path,name:candidate.title??candidate.visibleContent??candidateId,...meta,sha256},{root,projectId});
      const latest=existsSync(cachePath)?readJson(cachePath):[];
      latest.push({shotId,candidateId,identity,sourceUrl,path,sha256,...meta,mediaId:media.id});atomicJson(cachePath,latest);
      return descriptor(target,meta.kind,media.id);
    })();
    candidateDownloads.set(key,task);
    try{return await task;}finally{candidateDownloads.delete(key);}
  }
  function close() {
    closed = true;
    for (const timer of polls.values()) clearInterval(timer);
    polls.clear();
  }
  const service = {
    read,
    action,
    createJob,
    ingest,
    applyResults,
    cancel,
    retry,
    recover,
    pump,
    getJob,
    jobs,
    history,
    currentMarkdown,
    resolveFile,
    candidateDownload,
    candidateMedia: async request => { const value=await candidateDownload(request,false); return value.path ? {...value,available:true} : value; },
    close,
  };
  if (options.autoStart !== false)
    queueMicrotask(() =>
      recover({ includeCompleted: options.recoverCompleted !== false }).catch(() => {}),
    );
  return service;
}
