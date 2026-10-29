import {normalizeAiVideoCandidates} from "./production-plan-ai-video.mjs";
import { validateEffectTiming } from "./production-plan-effect-timing.mjs";
import {validateBgmPlan,prepareBgmMerge} from "./bgm-plan-model.mjs";
/** Browser-safe, immutable production-plan domain. No storage, network or Node imports. */
const APPROVALS = new Set([
  "draft",
  "waiting_approval",
  "waiting_selection",
  "approved",
  "needs_design",
]);
const clone = (value) => structuredClone(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function validatePlanJson(value, seen = new Set()) {
  if (value === null || ["string", "boolean"].includes(typeof value)) return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (!value || typeof value !== "object" || seen.has(value))
    throw new Error("Plan must contain safe JSON only");
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype
  )
    throw new Error("Plan must contain plain JSON");
  if (Array.isArray(value)) {
    if (
      Object.keys(value).length !== value.length ||
      Array.from({ length: value.length }, (_, i) => i).some(
        (i) => !Object.hasOwn(value, i),
      )
    )
      throw new Error("Plan arrays must be dense JSON");
  }
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") continue;
    if (
      typeof key !== "string" ||
      ["__proto__", "constructor", "prototype"].includes(key)
    )
      throw new Error("Unsafe plan key");
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d.enumerable || !Object.hasOwn(d, "value"))
      throw new Error("Unsafe plan property");
    validatePlanJson(d.value, seen);
  }
  seen.delete(value);
}
const id = (v) => {
  if (
    typeof v !== "string" ||
    !v.trim() ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(v)
  )
    throw new Error("Invalid plan ID");
  return v;
};
const number = (v, min = 0) => {
  if (!Number.isFinite(v) || v < min) throw new Error("Invalid plan number");
  return v;
};
const frame = (v) => {
  number(v);
  if (!Number.isInteger(v)) throw new Error("Plan frames must be integers");
  return v;
};
const url = (v) => {
  if (typeof v !== "string" || !/^https?:\/\//i.test(v))
    throw new Error("Candidate URL must use http(s)");
  new URL(v);
  return v;
};
function unique(items, label) {
  const ids = new Set();
  for (const item of items) {
    id(item.id);
    if (ids.has(item.id)) throw new Error(`Duplicate ${label} ID`);
    ids.add(item.id);
  }
}
export function normalizePlan(input = {}) {
  validatePlanJson(input);
  if (input.schemaVersion !== undefined && input.schemaVersion !== 1)
    throw new Error("Unsupported plan schema");
  const p = {
    schemaVersion: 1,
    revision: 0,
    script: "",
    approval: "draft",
    hoverEnabled: true,
    shots: [],
    conflicts: [],
    packages: [],
    appliedResultIds: [],
    dismissedResultIds: [],
    changes: [],
    ...clone(input),
  };
  if (!APPROVALS.has(p.approval)) throw new Error("Invalid plan approval");
  frame(p.revision);
  if (typeof p.script !== "string" || typeof p.hoverEnabled !== "boolean")
    throw new Error("Invalid plan fields");
  for (const key of [
    "shots",
    "conflicts",
    "packages",
    "appliedResultIds",
    "dismissedResultIds",
    "changes",
  ])
    if (!Array.isArray(p[key])) throw new Error(`Invalid plan ${key}`);
  p.shots = p.shots.map((s, i) => {
    const result = {
      order: i,
      title: "",
      narration: "",
      visualRequirement: "",
      mediaDescription: "",
      requirementVersion: 1,
      approval: "draft",
      keyframes: [],
      slots: [],
      bindings: [],
      candidates: [],
      ...s,
      timing: { status: "unaligned", ranges: [], manual: false, ...s.timing },
    };
    id(result.id);
    validateEffectTiming(result.effectTiming);
    if (!APPROVALS.has(result.approval))
      throw new Error("Invalid shot approval");
    frame(result.requirementVersion);
    for (const k of [
      "title",
      "narration",
      "visualRequirement",
      "mediaDescription",
    ])
      if (typeof result[k] !== "string") throw new Error(`Invalid ${k}`);
    if (
      !["unaligned", "estimated", "aligned", "review", "manual"].includes(
        result.timing.status,
      ) ||
      typeof result.timing.manual !== "boolean" ||
      !Array.isArray(result.timing.ranges)
    )
      throw new Error("Invalid timing");
    for (const key of ["slots", "bindings", "candidates", "keyframes"])
      if (!Array.isArray(result[key])) throw new Error(`Invalid shot ${key}`);
    unique(result.timing.ranges, "range");
    for (const r of result.timing.ranges) {
      id(r.id);
      frame(r.startFrame);
      frame(r.durationFrames);
      if (!r.durationFrames) throw new Error("Empty plan range");
    }
    if (result.anchor) {
      number(result.anchor.startSeconds);
      number(result.anchor.endSeconds);
      number(result.anchor.confidence);
      if (
        result.anchor.endSeconds <= result.anchor.startSeconds ||
        result.anchor.confidence > 1
      )
        throw new Error("Invalid anchor");
    }
    result.slots = result.slots.map((slot) => ({
      requirementVersion: result.requirementVersion,
      ...slot,
    }));
    unique(result.slots, "slot");
    for (const slot of result.slots) {
      if (
        !["animation", "video", "image", "screen", "other"].includes(
          slot.type,
        ) ||
        typeof slot.description !== "string"
      )
        throw new Error("Invalid slot");
      frame(slot.requirementVersion);
      if (
        slot.presentationMode !== undefined &&
        !["overlay", "immersive"].includes(slot.presentationMode)
      )
        throw new Error("Invalid presentation mode");
    }
    for (const c of result.candidates) {
      id(c.id);
      id(c.slotId);
      url(c.url);
      if (c.downloadUrl) url(c.downloadUrl);
      if (c.sourceInSeconds !== undefined) number(c.sourceInSeconds);
      if (c.sourceOutSeconds !== undefined) number(c.sourceOutSeconds);
    }
    unique(result.candidates, "candidate");
    result.aiVideoCandidates = normalizeAiVideoCandidates(result.aiVideoCandidates);
    for (const b of result.bindings) {
      id(b.id);
      id(b.instanceId);
      id(b.slotId);
      number(b.sourceInSeconds ?? 0);
    }
    return result;
  });
  unique(p.shots, "shot");
  validateBgmPlan(p);
  return p;
}
function rangesFor(doc, shot) {
  if (shot.cancelled) return [];
  if (shot.timing.manual || shot.timing.status === "manual")
    return shot.timing.ranges;
  if (
    shot.effectTiming &&
    shot.bindings.some(
      (b) =>
        b.status !== "removed" &&
        doc.instances.some((i) => i.id === b.instanceId),
    )
  )
    return shot.timing.ranges;
  const a = shot.effectTiming ?? shot.anchor;
  if (
    a &&
    (!doc.source ||
      ![doc.source.path, doc.source.publicPath].includes(a.sourcePath))
  )
    return [];
  if (!a)
    return ["aligned", "review"].includes(shot.timing.status)
      ? shot.timing.ranges
      : [];
  const fps = doc.canvas.fps.num / doc.canvas.fps.den,
    start = Math.round(a.startSeconds * fps),
    end = Math.round(a.endSeconds * fps);
  const clips = doc.source.clips ?? [
    {
      id: "source",
      startFrame: 0,
      durationFrames: doc.canvas.durationFrames,
      sourceInFrame: doc.source.startFrame ?? 0,
    },
  ];
  return clips.flatMap((c) => {
    const speed = c.playbackRate ?? c.speed ?? 1;
    if (c.disabled || !Number.isFinite(speed) || speed <= 0) return [];
    const left = Math.max(start, c.sourceInFrame),
      right = Math.min(end, c.sourceInFrame + c.durationFrames * speed);
    return right > left
      ? [
          {
            id: `${shot.id}.${c.id}`,
            startFrame:
              c.startFrame + Math.round((left - c.sourceInFrame) / speed),
            durationFrames: Math.max(1, Math.round((right - left) / speed)),
          },
        ]
      : [];
  });
}
export function planRanges(doc) {
  return normalizePlan(doc.productionPlan).shots.flatMap((shot) =>
    rangesFor(doc, shot).map((r) => ({
      ...r,
      shotId: shot.id,
      rangeId: r.id,
      shot,
    })),
  );
}
export function reconcilePlan(document) {
  if (!document.productionPlan) return document;
  const doc = clone(document),
    plan = normalizePlan(doc.productionPlan),
    instances = new Map(doc.instances.map((i) => [i.id, i]));
  for (const s of plan.shots) {
    if (
      (s.effectTiming || s.anchor) &&
      !s.timing.manual &&
      s.timing.status !== "manual"
    ) {
      s.timing.ranges = rangesFor(doc, s);
      s.timing.status = s.timing.ranges.length
        ? (
            s.effectTiming
              ? s.effectTiming.status === "confirmed"
              : s.anchor.confidence >= 0.85
          )
          ? "aligned"
          : "review"
        : "unaligned";
    }
    for (const b of s.bindings) {
      const instance = instances.get(b.instanceId);
      if (!instance) {
        b.status = "removed";
        if (b.resultId && !plan.dismissedResultIds.includes(b.resultId))
          plan.dismissedResultIds.push(b.resultId);
      } else {
        b.startFrame = instance.startFrame;
        b.durationFrames = instance.durationFrames;
        b.status =
          b.requirementVersion === s.requirementVersion
            ? "current"
            : "requirements_changed";
      }
    }
  }
  doc.productionPlan = plan;
  return doc;
}
export function planSummary(doc) {
  const p = normalizePlan(reconcilePlan(doc).productionPlan);
  return {
    shots: p.shots.filter((s) => !s.cancelled).length,
    missing: p.shots
      .filter((s) => !s.cancelled)
      .reduce(
        (n, s) =>
          n +
          s.slots.filter(
            (slot) =>
              !s.bindings.some(
                (b) => b.slotId === slot.id && b.status === "current",
              ),
          ).length,
        0,
      ),
    unread: p.shots.reduce(
      (n, s) => n + s.candidates.filter((c) => !c.readAt && !c.ignored).length,
      0,
    ),
    pending:
      p.conflicts.length +
      p.shots.filter((s) => !s.cancelled && s.approval !== "approved").length,
  };
}
function mergeCandidates(current, incoming) {
  const result = clone(current);
  for (const c of incoming) {
    const found = result.find(
      (x) => x.id === c.id || (x.slotId === c.slotId && x.url === c.url),
    );
    if (found) {
      const { id, readAt, ignored } = found;
      Object.assign(
        found,
        c,
        { id },
        readAt ? { readAt } : {},
        ignored !== undefined ? { ignored } : {},
      );
    } else result.push(clone(c));
  }
  return result;
}
const requirementFields = [
  "animationNeed", "expressionGoal", "requiredInformation", "relationships", "comprehensionDifficulty", "factBoundary",
  "effectTiming",
  "cameraIntent",
  "presenterLayerIntent",
  "visualRequirement",
  "mediaDescription",
  "narration",
  "slots",
];
export function invalidateRequirements(plan, shot, previous) {
  const full=plan.upstream?.completePackage?.fullPackageVersion===1;
  const compact=value=>typeof value==='string'?value.replace(/\s+/g,''):value;
  if (!requirementFields.some((key) => {
    if(full&&key==='cameraIntent')return false;
    if(full&&['narration','mediaDescription'].includes(key))return !equal(compact(previous[key]),compact(shot[key]));
    return !equal(previous[key], shot[key]);
  }))return;
  shot.requirementVersion = Math.max(
    previous.requirementVersion + 1,
    shot.requirementVersion,
    ...shot.bindings.map((binding) => (binding.requirementVersion ?? 0) + 1),
  );
  for (const slot of shot.slots)
    slot.requirementVersion = shot.requirementVersion;
  for (const binding of shot.bindings)
    if (binding.status !== "removed") binding.status = "requirements_changed";
  shot.approval = "needs_design";
  delete shot.approvedRequirementVersion;
  plan.approval = "needs_design";
  if (plan.approvalRecord) plan.approvalRecord.status = "needs_design";
}
export function mergePlans(base, current, incoming) {
  const b = normalizePlan(base),
    c = normalizePlan(current),
    n = prepareBgmMerge(c, normalizePlan(incoming)),
    out = clone(c);
  let seq = out.conflicts.length;
  const conflict = (shotId, field, bv, cv, nv) =>
    out.conflicts.push({
      id: `conflict-${c.revision}-${++seq}`,
      ...(shotId ? { shotId } : {}),
      field,
      base: bv ?? null,
      current: cv ?? null,
      incoming: nv ?? null,
    });
  for (const key of ["script", "approval"]) {
    if (equal(c[key], b[key])) out[key] = n[key];
    else if (!equal(n[key], b[key]) && !equal(c[key], n[key]))
      conflict(undefined, key, b[key], c[key], n[key]);
  }
  // These independent metadata fields opt into merging only when published.
  // Older workers omitting them must not erase the current workflow or inputs.
  const mergeMetadata = (field, bv, cv, nv, write) => {
    if (equal(cv, bv)) write(clone(nv));
    else if (!equal(nv, bv) && !equal(cv, nv))
      conflict(undefined, field, bv, cv, nv);
  };
  for (const key of ["animationWorkflow", "soundDesignVersion", "bgmPlanVersion", "bgmRecommendationGaps", "bgmExecution"])
    if (Object.hasOwn(n, key))
      mergeMetadata(key, b[key], c[key], n[key], (value) => {
        out[key] = value;
      });
  // The transcript locator, time base and evidence are one identity. A CAS
  // conflict must retain or replace the whole bundle, never individual fields.
  const transcriptKeys=['sourceSrtPath','transcriptBinding','transcriptTimeBase','transcriptProvenancePath'];
  const transcriptBundle=plan=>Object.fromEntries(transcriptKeys.filter(key=>Object.hasOwn(plan,key)).map(key=>[key,plan[key]]));
  if(transcriptKeys.some(key=>Object.hasOwn(n,key))){
    const bv=transcriptBundle(b),cv=transcriptBundle(c),nv={...bv,...transcriptBundle(n)};
    if(equal(cv,bv)) Object.assign(out,clone(nv));
    else if(!equal(nv,bv)&&!equal(cv,nv)){
      const field=transcriptKeys.find(key=>!equal(bv[key],nv[key]));
      conflict(undefined,field,bv[field],cv[field],nv[field]);
      out.conflicts.at(-1).transcriptMetadata={base:clone(bv),current:clone(cv),incoming:clone(nv)};
    }
  }
  if(Object.hasOwn(n,'bgmRecommendations')) out.bgmRecommendations=clone(n.bgmRecommendations);
  for(const key of ['animationPackage','completePackage','packageBgm'])
    if(n.upstream&&Object.hasOwn(n.upstream,key))
      mergeMetadata('upstream.'+key,b.upstream?.[key],c.upstream?.[key],n.upstream[key],value=>{
        out.upstream={...out.upstream,[key]:value};
      });
  for (const next of n.shots) {
    const old = b.shots.find((s) => s.id === next.id),
      now = out.shots.find((s) => s.id === next.id);
    if (!now) {
      out.shots.push(clone(next));
      continue;
    }
    if (!old) {
      if (!equal(now, next)) conflict(next.id, "shot", null, now, next);
      continue;
    }
    for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {
      if (["id", "candidates", "bindings"].includes(key)) continue;
      if (key === "bgmDesign" && !Object.hasOwn(next, key)) continue;
      if (equal(now[key], old[key])) {
        if (next[key] === undefined) delete now[key];
        else now[key] = clone(next[key]);
      } else if (!equal(next[key], old[key]) && !equal(now[key], next[key]))
        conflict(next.id, key, old[key], now[key], next[key]);
    }
    now.candidates = mergeCandidates(now.candidates, next.candidates);
  }
  for (const old of b.shots) {
    if (!n.shots.some((s) => s.id === old.id)) {
      const now = out.shots.find((s) => s.id === old.id);
      if (now) {
        if (equal(now, old)) now.cancelled = true;
        else conflict(now.id, "cancelled", false, false, true);
      }
    }
  }
  for (const next of out.shots) {
    const previous = c.shots.find((s) => s.id === next.id);
    if (previous) invalidateRequirements(out, next, previous);
  }
  out.packages = [
    ...c.packages,
    ...n.packages.filter((p) => !c.packages.some((x) => x.id === p.id)),
  ];
  return normalizePlan(out);
}
export function changePlan(document, operation) {
  validatePlanJson(operation);
  let doc = clone(document),
    p = normalizePlan(doc.productionPlan);
  const s = p.shots.find((s) => s.id === operation.shotId);
  const requireShot = () => {
    if (!s) throw new Error("Unknown shot");
    return s;
  };
  switch (operation.type) {
    case "edit-shot": {
      requireShot();
      const previous = clone(s);
      for (const key of ["visualRequirement", "mediaDescription"])
        if (Object.hasOwn(operation.patch ?? {}, key)) {
          const next = operation.patch[key];
          if (typeof next !== "string")
            throw new Error("Shot field must be text");
          if (next !== s[key]) {
            s[key] = next;
          }
        }
      invalidateRequirements(p, s, previous);
      break;
    }
    case "move-shot":
      requireShot();
      s.timing = {
        ...s.timing,
        status: "manual",
        manual: true,
        ranges: clone(operation.ranges),
      };
      break;
    case "reset-timing":
      requireShot();
      s.timing.manual = false;
      s.timing.status = "unaligned";
      break;
    case "hover":
      p.hoverEnabled = !!operation.enabled;
      break;
    case "read-candidates":
      requireShot();
      for (const c of s.candidates)
        if (operation.candidateIds.includes(c.id))
          c.readAt = c.readAt ?? new Date().toISOString();
      break;
    case "ignore-candidate":
      requireShot();
      {
        const c = s.candidates.find((c) => c.id === operation.candidateId);
        if (!c) throw new Error("Unknown candidate");
        c.ignored = true;
      }
      break;
    case "import-plan":
      p = mergePlans(operation.basePlan ?? p, p, operation.plan);
      if (
        operation.package &&
        !p.packages.some((v) => v.id === operation.package.id)
      )
        p.packages.push(clone(operation.package));
      break;
    case "approve": {
      if (operation.timing) {
        p.approvalRecord = {
          ...(p.approvalRecord ?? { status: p.approval }),
          timing: clone(operation.timing),
        };
        break;
      }
      if (operation.selection && !operation.shotIds) {
        p.approvalRecord = {
          ...(p.approvalRecord ?? { status: p.approval }),
          selection: clone(operation.selection),
        };
        break;
      }
      const selected =
        operation.shotIds ??
        p.shots.filter((s) => !s.cancelled).map((s) => s.id);
      for (const sid of selected) {
        const shot = p.shots.find((s) => s.id === sid);
        if (!shot) throw new Error("Unknown approval shot");
        shot.approval = "approved";
        shot.approvedRequirementVersion = shot.requirementVersion;
      }
      p.approval = p.shots.every(
        (s) => s.cancelled || s.approval === "approved",
      )
        ? "approved"
        : "waiting_approval";
      p.approvalRecord = {
        ...p.approvalRecord,
        status: "approved",
        shotIds: selected,
        requirementVersions: Object.fromEntries(
          p.shots
            .filter((s) => selected.includes(s.id))
            .map((s) => [s.id, s.requirementVersion]),
        ),
        ...(operation.selection ? { selection: operation.selection } : {}),
      };
      break;
    }
    case "restore-shot":
      requireShot();
      s.cancelled = false;
      break;
    case "cancel-shot":
      requireShot();
      s.cancelled = true;
      break;
    case "ignore-results":
      p.dismissedResultIds = [
        ...new Set([...p.dismissedResultIds, ...operation.resultIds]),
      ];
      break;
    case "resolve-conflict": {
      const c = p.conflicts.find((c) => c.id === operation.conflictId);
      if (!c) throw new Error("Unknown conflict");
      if (operation.choice === "incoming") {
        const target = c.shotId ? p.shots.find((s) => s.id === c.shotId) : p;
        const previous = c.shotId ? clone(target) : undefined;
        let resolved = target;
        if (!c.shotId && c.transcriptMetadata) {
          for (const key of ['sourceSrtPath','transcriptBinding','transcriptTimeBase','transcriptProvenancePath']) delete p[key];
          Object.assign(p,clone(c.transcriptMetadata.incoming));
        } else if (c.field === "shot") {
          const index = p.shots.findIndex((s) => s.id === c.shotId);
          resolved = p.shots[index] = clone(c.incoming);
        } else if (!c.shotId && ["upstream.animationPackage", "upstream.completePackage"].includes(c.field)) {
          p.upstream = { ...p.upstream, [c.field.split(".")[1]]: clone(c.incoming) };
        } else target[c.field] = clone(c.incoming);
        if (previous) invalidateRequirements(p, resolved, previous);
      }
      p.conflicts = p.conflicts.filter((x) => x.id !== c.id);
      break;
    }
    default:
      throw new Error(`Unsupported plan operation: ${operation.type}`);
  }
  p.revision++;
  p.changes.push({
    id: operation.operationId ?? `change-${p.revision}`,
    type: operation.type,
    shotId: operation.shotId ?? null,
    baseRevision: document.revision,
    createdAt: new Date().toISOString(),
    source: operation.source ?? "editor",
  });
  doc.productionPlan = normalizePlan(p);
  return reconcilePlan(doc);
}
export function dependencyFingerprint(doc, shotId, target = {}) {
  const shot = normalizePlan(doc.productionPlan).shots.find(
    (s) => s.id === shotId,
  );
  if (!shot) return JSON.stringify({ projectId: doc.id, missing: shotId });
  const instance = target.instanceId
    ? doc.instances.find((i) => i.id === target.instanceId)
    : undefined;
  return JSON.stringify({
    projectId: doc.id,
    shotId,
    requirementVersion: shot.requirementVersion,
    visualRequirement: shot.visualRequirement,
    mediaDescription: shot.mediaDescription,
    narration: shot.narration,
    effectTiming: shot.effectTiming,
    cameraIntent: shot.cameraIntent,
    presenterLayerIntent: shot.presenterLayerIntent,
    slots: shot.slots,
    cancelled: !!shot.cancelled,
    canvas: {
      width: doc.canvas.width,
      height: doc.canvas.height,
      fps: doc.canvas.fps,
    },
    source: doc.source?.path ?? null,
    target: instance
      ? {
          id: instance.id,
          startFrame: instance.startFrame,
          durationFrames: instance.durationFrames,
          props: instance.props,
        }
      : target.instanceId
        ? { missing: target.instanceId }
        : rangesFor(doc, shot).filter(
            (r) => !target.rangeId || r.id === target.rangeId,
          ),
  });
}
export function currentPlanMarkdown(document) {
  const doc = reconcilePlan(document),
    p = normalizePlan(doc.productionPlan);
  return (
    [
      `# ${doc.name ?? doc.id} · 当前制作计划`,
      `工程 ${doc.id} · 工程版本 ${doc.revision} · 计划版本 ${p.revision}`,
      `审批：${p.approval}`,
      `## 正文`,
      p.script,
      ...p.shots.map((s) =>
        [
          `## ${s.order + 1}. ${s.title} (${s.id})`,
          `口播：${s.narration}`,
          `画面要求：${s.visualRequirement}`,
          `素材描述：${s.mediaDescription}`,
          `状态：${s.approval} / ${s.timing.status}${s.cancelled ? " / 已取消" : ""}`,
          `计划区间：${JSON.stringify(s.timing.ranges)}`,
          `效果时间设计：${JSON.stringify(s.effectTiming ?? null)}`,
          `镜头意图：${JSON.stringify(s.cameraIntent ?? null)}`,
          `人物分层意图：${JSON.stringify(s.presenterLayerIntent ?? null)}`,
          `实际采用：${JSON.stringify(s.bindings)}`,
          `关键帧：${JSON.stringify(s.keyframes)}`,
          `槽位：${JSON.stringify(s.slots)}`,
          `候选：${JSON.stringify(s.candidates)}`,
          `备选：${JSON.stringify(s.alternatives ?? [])}`,
          `完整设计：${JSON.stringify(s.details ?? {})}`,
          `上游信息：${JSON.stringify(s.upstream ?? {})}`,
        ].join("\n\n"),
      ),
      `## 冲突\n${JSON.stringify(p.conflicts)}`,
      `## 修改记录\n${JSON.stringify(p.changes)}`,
    ].join("\n\n") + "\n"
  );
}
