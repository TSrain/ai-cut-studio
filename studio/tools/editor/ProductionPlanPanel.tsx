import {ProductionPlanQuickView} from "./ProductionPlanShotInspector";
import { PlanTimingDetails } from "./PlanTimingDetails";
import { ProductionPlanContentChanges } from "./ProductionPlanContentChanges";
import { ProductionPlanResult } from "./ProductionPlanResult";
import React, { useEffect, useRef, useState } from "react";
import { planSummary } from "../lib/production-plan-model.mjs";
import { productionPlanApi } from "./useProductionPlan";
import {
  contentConfirmationFor,
  mediaResultEligible,
  observeCandidateReads,
  planMediaUrl,
} from "./production-plan-sync.mjs";
import { ProjectMediaUpload } from "./ProjectMediaUpload";
import "./production-plan.css";
const statusNames: any = {
  draft: "草案",
  waiting_approval: "待批准",
  waiting_selection: "待选方向",
  approved: "已批准",
  needs_design: "需更新设计",
  queued: "排队中",
  running: "运行中",
  plan_only: "文字计划就绪",
  partial: "部分完成",
  complete: "完成",
  failed: "失败",
  cancelling: "正在停止",
  cancelled: "已取消",
  interrupted: "已中断",
  unaligned: "未对齐",
  estimated: "预计",
  aligned: "已定位",
  review: "待确认",
  manual: "手动调整",
  stale: "旧版本",
  ready: "待确认",
  pending: "待核验",
  conflict: "目标冲突",
  applied: "已采用",
  ignored: "已忽略",
};
const state = (s: string) => statusNames[s] || s;
const stageName = (s: string) =>
  (
    ({
      alignment_review: "核对口播与计划差异",
      awaiting_confirmation: "结果就绪，正在核验",
      queued: "等待执行",
      model: "分析与制作",
      workflow: "执行工作流",
      transcribing: "识别口播",
      transcribe: "识别口播",
      plan: "整理分镜方案",
      design: "制作分镜设计",
      keyframes: "制作关键帧",
      render: "渲染镜头",
      rendering: "渲染镜头",
      recognition: "分析素材",
      footage_ready: "素材已入库并推荐入轨",
      full_package_ready: "完整package职责已执行",
      delivery_import: "按交付清单导入",
      validate_delivery: "核验交付清单与素材",
      import_delivery: "追加独立轨道",
      waiting_approval: "等待本期审批",
      waiting_selection: "等待选择视觉方向",
      complete: "处理完成",
      partial: "已完成可用部分",
      stopping_process: "正在停止进程",
      cancelled: "已取消",
      analyze_media: "分析素材内容",
      match_plan: "匹配计划镜头",
      unmatched: "分析完成，未匹配计划",
      waiting_recording: "等待终稿口播",
      align_recording: "对齐真实口播",
      validate_inputs: "校验制作输入",
      resume_validated: "确认复用已有结果",
      timing_required: "等待真实镜头区间",
      failed: "执行失败",
    }) as Record<string, string>
  )[s] || (/^[a-z_]+$/.test(s || "") ? "处理中" : s || "等待阶段");
const seconds = (n: number, fps: number) => (n / fps).toFixed(2);
const readPlanDrafts = (id: string) => {
  try {
    const stored = JSON.parse(
      localStorage.getItem("motion-plan-drafts/" + id) || "{}",
    );
    return Object.fromEntries(
      Object.entries(stored).filter(
        ([key, value]: any) =>
          key &&
          value &&
          typeof value.visualRequirement === "string" &&
          typeof value.mediaDescription === "string" &&
          typeof value.base?.visualRequirement === "string" &&
          typeof value.base?.mediaDescription === "string",
      ),
    );
  } catch {
    return {};
  }
};

function DeliveryResultDetails({ result, projectId }: any) {
  const delivery = result.delivery;
  return (
    <div className="plan-delivery-details">
      <b>独立轨道 · {delivery?.transparent ? "透明叠加" : "完整画面"}</b>
      {delivery && (
        <p>
          工程时间 {delivery.startSeconds.toFixed(2)}–
          {(delivery.startSeconds + delivery.durationSeconds).toFixed(2)} 秒
          {" · "}时长 {delivery.durationSeconds.toFixed(2)} 秒
        </p>
      )}
      <small>
        {result.state === "applied" ? "已入轨" : result.state === "ready" ? "待入轨" : state(result.state ?? "pending")}
        {" · "}技术：{result.technical?.passed ? "通过" : "待核验"}
      </small>
      {result.reason && <p>{result.reason}</p>}
      {result.media?.path && (
        <a href={planMediaUrl(result.media.path, projectId, true)} target="_blank" rel="noreferrer">
          {result.media.path}
        </a>
      )}
      {result.relatedShotIds?.length > 0 && <small>关联段落：{result.relatedShotIds.join("、")}</small>}
      <details>
        <summary>清单与核验依据</summary>
        <pre>{JSON.stringify({delivery, target: result.target, technical: result.technical}, null, 2)}</pre>
      </details>
    </div>
  );
}

export function ProductionPlanEntry({
  document: doc,
  controller,
  onOpen,
}: any) {
  const summary = planSummary(doc);
  return (
    <div className="project-feature-row production-plan-entry">
      <div className="project-feature-identity">
        <span className="project-feature-name">
          制作计划
          {summary.unread > 0 && (
            <i
              className="plan-unread"
              aria-label={`${summary.unread} 个新候选`}
            />
          )}
        </span>
        <span className="project-feature-status">
          {summary.shots
            ? `${summary.shots} 镜 · 缺 ${summary.missing} 项`
            : "未生成"}
          {controller.pendingResults.length > 0
            ? ` · ${controller.pendingResults.length} ${doc.productionPlan?.animationWorkflow === "semantic-template-v1" ? "待处理记录" : "待确认"}`
            : ""}
        </span>
        {controller.jobs.some((j) =>
          ["running", "queued"].includes(j.status),
        ) && (
          <small role="status">
            {stageName(
              controller.jobs.find((j) =>
                ["running", "queued"].includes(j.status),
              ).stage,
            )}
          </small>
        )}
      </div>
      <div className="project-feature-actions">
        <button onClick={onOpen} aria-label="查看制作计划">
          {doc.productionPlan ? "查看" : "生成"}
        </button>
      </div>
    </div>
  );
}
function FootageResultDetails({ result: r, projectId }: any) {
  const candidateOnly = r.footage?.placementId == null;
  const label = r.state === "ignored" ? "已忽略" : candidateOnly ? "项目候选" : r.state === "applied" ? "已入轨" : r.state === "conflict" || r.state === "stale" ? "位置需更新" : "待入轨";
  return (
    <div className="plan-footage-result">
      <p><b>{label}</b> · {r.footage?.candidateId} · {r.reason || "真实素材"}</p>
      <small>技术：{r.technical?.passed ? "通过" : "待核验"}；{candidateOnly ? "保留在项目素材库" : "按素材审稿位置自动追加独立轨道"}</small>
      {r.media?.path && <p><a href={planMediaUrl(r.media.path, projectId, true)} target="_blank" rel="noreferrer">预览原始素材</a></p>}
      {r.footage?.reviewPath && <p><a href={planMediaUrl(r.footage.reviewPath, projectId)} target="_blank" rel="noreferrer">逐段素材审稿</a></p>}
    </div>
  );
}

export function FullProductionPlanPanel({
  document: doc,
  controller,
  selectedShot,
  onSelect,
  active = true,
}: any) {
  const { action, startJob, jobAction } = controller,
    plan = doc.productionPlan,
    semanticTemplates = plan?.animationWorkflow === "semantic-template-v1",
    shots = [...(plan?.shots ?? [])].sort((a, b) => a.order - b.order),
    fps = doc.canvas.fps.num / doc.canvas.fps.den;
  const [script, setScript] = useState(plan?.script ?? ""),
    [instructions, setInstructions] = useState(""),
    [camera, setCamera] = useState(true),
    [sound, setSound] = useState(true);
  const [view, setView] = useState("simple"),
    [markdown, setMarkdown] = useState(""),
    [version, setVersion] = useState(""),
    [localError, setLocalError] = useState(""),
    [binding, setBinding] = useState(doc.projectBinding?.scriptId ?? ""),
    [root, setRoot] = useState(doc.projectBinding?.projectRoot ?? "");
  const [drafts, setDrafts] = useState<Record<string, any>>({}),
    [expandedCandidates, setExpandedCandidates] = useState<
      Record<string, boolean>
    >({}),
    [choices, setChoices] = useState<Record<string, string>>({}),
    [jobChoices, setJobChoices] = useState<Record<string, string>>({}),
    [targets, setTargets] = useState<Record<string, string>>({}),
    [rangeDrafts, setRangeDrafts] = useState<Record<string, any[]>>({}),
    [overrides, setOverrides] = useState<Record<string, any>>({}),
    [checked, setChecked] = useState<string[]>([]);
  const [deliveryManifestPath, setDeliveryManifestPath] = useState("");
  const panelRoot = useRef<HTMLDivElement>(null);
  const draftOwner = useRef("");
  useEffect(() => {
    if (draftOwner.current !== doc.id) {
      draftOwner.current = doc.id;
      return;
    }
    try {
      if (Object.keys(drafts).length)
        localStorage.setItem(
          "motion-plan-drafts/" + doc.id,
          JSON.stringify(drafts),
        );
      else localStorage.removeItem("motion-plan-drafts/" + doc.id);
    } catch {}
  }, [doc.id, drafts]);
  const lastScript = useRef(plan?.script ?? "");
  useEffect(() => {
    const incoming = plan?.script ?? "";
    setScript((current) =>
      current === lastScript.current ? incoming : current,
    );
    lastScript.current = incoming;
  }, [plan?.script]);
  const request = useRef(0),
    importInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setScript(plan?.script ?? "");
    setDrafts(readPlanDrafts(doc.id));
    setExpandedCandidates({});
    setChoices({});
    setTargets({});
    setRangeDrafts({});
    setOverrides({});
    setChecked([]);
    setBinding(doc.projectBinding?.scriptId ?? "");
    setRoot(doc.projectBinding?.projectRoot ?? "");
    setView("simple");
    setDeliveryManifestPath("");
  }, [doc.id]);
  const execute = async (fn: () => Promise<any>) => {
    setLocalError("");
    try {
      return await fn();
    } catch (e: any) {
      setLocalError(e.message);
    }
  };
  useEffect(() => {
    if (view === "simple") return;
    const token = ++request.current;
    setMarkdown("读取中…");
    void productionPlanApi(
      view === "current"
        ? "/current?projectId=" + encodeURIComponent(doc.id)
        : "/history?projectId=" +
            encodeURIComponent(doc.id) +
            "&version=" +
            encodeURIComponent(version),
    )
      .then((r) => {
        if (token === request.current)
          setMarkdown(r.markdown || "此版本没有原文。");
      })
      .catch((e) => {
        if (token === request.current) setMarkdown(e.message);
      });
    return () => {
      request.current++;
    };
  }, [view, version, doc.id, plan?.revision]);
  // Observe each rendered card within the scrolling inspector. A hidden panel,
  // an alternate view, and cards below the viewport must keep their unread dot.
  useEffect(() => {
    const panel = panelRoot.current;
    if (!active || view !== "simple" || controller.busy || !panel) return;
    const inspector = panel.closest(".inspector");
    if (!inspector) return;
    return observeCandidateReads({
      root: inspector,
      elements: Array.from(panel.querySelectorAll("[data-candidate-id]")),
      isActive: () => active && view === "simple" && !controller.busy,
      onRead: (rows) => {
        void execute(async () => {
          for (const row of rows)
            await action({ type: "read-candidates", ...row });
        });
      },
    });
  }, [active, view, selectedShot, expandedCandidates, shots, controller.busy]);
  const dirty =
    Object.keys(rangeDrafts).length > 0 ||
    Object.keys(drafts).some((id) => {
      const s = shots.find((v) => v.id === id),
        d = drafts[id];
      return (
        s &&
        (d.visualRequirement !== s.visualRequirement ||
          d.mediaDescription !== s.mediaDescription)
      );
    });
  const saveShot = (shot: any) =>
    execute(async () => {
      const d = drafts[shot.id];
      if (!d) return;
      await action({
        type: "edit-shot",
        shotId: shot.id,
        patch: Object.fromEntries(
          ["visualRequirement", "mediaDescription"]
            .filter((key) => d[key] !== d.base[key])
            .map((key) => [key, d[key]]),
        ),
        base: d.base,
      });
      setDrafts((v) => {
        const next = { ...v };
        delete next[shot.id];
        return next;
      });
    });
  const patchDraft = (shot: any, key: string, value: string) =>
    setDrafts((v) => ({
      ...v,
      [shot.id]: {
        ...(v[shot.id] ?? {
          visualRequirement: shot.visualRequirement,
          mediaDescription: shot.mediaDescription,
          base: {
            visualRequirement: shot.visualRequirement,
            mediaDescription: shot.mediaDescription,
          },
        }),
        [key]: value,
      },
    }));
  const allResults = controller.pendingResults.filter(
      (r) => !["ignored", "applied"].includes(r.state),
    ),
    selectedResults = allResults.filter((r) => !["delivery", "footage"].includes(r.kind) && checked.includes(r.id));
  const applyResults = (ids: string[], extra?: Record<string, any>) =>
    execute(async () => {
      for (const id of ids) {
        const r = allResults.find((v) => v.id === id),
          o = extra?.[id] ?? overrides[id];
        if (r && !mediaResultEligible(r, doc, o))
          throw Error("素材技术核验未通过，或尚未确认当前素材与目标要求。");
        if (
          o?.sourceOutSeconds !== undefined &&
          Number(o.sourceOutSeconds) <=
            Number(o.sourceInSeconds ?? r?.media?.sourceInSeconds ?? 0)
        )
          throw Error("素材出点须晚于入点");
      }
      await action({
        type: "apply-results",
        resultIds: ids,
        overrides: { ...overrides, ...extra },
      });
      setChecked((v) => v.filter((id) => !ids.includes(id)));
    });
  const resolveConflict = (c: any, choice: string) =>
    execute(async () => {
      const response = await action({
        type: "resolve-conflict",
        conflictId: c.id,
        choice,
      });
      const shot = response.document?.productionPlan?.shots.find(
        (s) => s.id === c.shotId,
      );
      if (shot && ["visualRequirement", "mediaDescription"].includes(c.field))
        setDrafts((v) => {
          const d = v[c.shotId];
          if (!d) return v;
          const next = {
            ...d,
            base: { ...d.base, [c.field]: shot[c.field] },
            [c.field]: shot[c.field],
          };
          for (const field of ["visualRequirement", "mediaDescription"])
            if (field !== c.field && d[field] === d.base[field]) {
              next[field] = shot[field];
              next.base[field] = shot[field];
            }
          const result = { ...v, [c.shotId]: next };
          if (
            next.visualRequirement === next.base.visualRequirement &&
            next.mediaDescription === next.base.mediaDescription
          )
            delete result[c.shotId];
          return result;
        });
      return response;
    });
  const resume = async (
    job: any,
    mode: "design" | "timing" | "selection" = "design",
    request?: any,
  ) => {
    if (mode === "timing") {
      if (!request?.files?.length)
        throw Error("缺少当前真实时间轴文件与校验摘要");
      await action({
        type: "approve",
        timing: { status: "approved", files: request.files },
      });
    } else if (mode === "selection") {
      const choice = job.choices?.find((c) => c.id === jobChoices[job.id]);
      if (!choice) throw Error("先选择当前任务提供的视觉方向");
      await action({
        type: "approve",
        selection: {
          id: choice.id,
          ...(choice.previewPath ? { previewPath: choice.previewPath } : {}),
        },
      });
    } else {
      await action({
        type: "approve",
        selection: { choices },
        shotIds: shots.filter((s) => !s.cancelled).map((s) => s.id),
      });
    }
    return startJob(job.kind, {
      resumeJobId: job.id,
      shotId: job.shotId,
      slotId: job.slotId,
      instanceId: job.instanceId,
      rangeId: job.rangeId,
    });
  };
  const renderShot = (shot: any) => {
    const draft = drafts[shot.id],
      values = draft ?? shot,
      ranges = shot.timing?.ranges ?? [],
      bindings = shot.bindings ?? [],
      actual = bindings.map((b) => ({
        binding: b,
        instance: doc.instances.find((i) => i.id === b.instanceId),
      })),
      targetsForShot = [
        ...actual
          .filter((b) => b.instance)
          .map((b) => ({
            value: "instance:" + b.instance.id,
            label: `实际 ${seconds(b.instance.startFrame, fps)}–${seconds(b.instance.startFrame + b.instance.durationFrames, fps)} 秒 (${b.instance.id.slice(0, 8)})`,
          })),
        ...ranges.map((r) => ({
          value: "range:" + r.id,
          label: `计划 ${seconds(r.startFrame, fps)}–${seconds(r.startFrame + r.durationFrames, fps)} 秒`,
        })),
      ];
    return (
      <article
        key={shot.id}
        className={
          "plan-shot " + (selectedShot === shot.id ? "is-selected" : "")
        }
        data-shot-id={shot.id}
      >
        <button
          className="plan-shot-heading"
          aria-expanded={selectedShot === shot.id}
          onClick={() => onSelect(selectedShot === shot.id ? "" : shot.id)}
        >
          <b>
            {shots.indexOf(shot) + 1}. {shot.title || "未命名镜头"}
          </b>
          <span>
            {semanticTemplates ? "需求已分析" : state(shot.approval)}
            {shot.cancelled ? " · 已取消" : ""}
            {shot.candidates.some((c) => !c.readAt && !c.ignored) && (
              <i className="plan-unread" />
            )}
          </span>
        </button>
        {selectedShot === shot.id && (
          <div className="plan-shot-detail">
            <p className="plan-narration">{shot.narration || "尚无口播原文"}</p>
            <p className="plan-timing">
              {state(shot.timing?.status)} ·{" "}
              {ranges.length
                ? ranges
                    .map(
                      (r) =>
                        `${seconds(r.startFrame, fps)}–${seconds(r.startFrame + r.durationFrames, fps)} 秒`,
                    )
                    .join("、")
                : shot.timing?.estimatedSeconds
                  ? `预计 ${shot.timing.estimatedSeconds} 秒（待口播对齐）`
                  : "准确位置待口播对齐"}
            </p>
            <PlanTimingDetails shot={shot} />
            <details>
              <summary>手动计划区间</summary>
              <small>
                工程时间与素材内部时间分别保存。手动定位后，自动对齐不会覆盖。
              </small>
              {(rangeDrafts[shot.id] ?? ranges).map((range, index) => (
                <div className="plan-source-range" key={range.id}>
                  <label>
                    工程起点（秒）
                    <input
                      aria-label={`计划区间起点 ${shot.title} ${index + 1}`}
                      type="number"
                      min={0}
                      step={1 / fps}
                      value={range.startFrame / fps}
                      onChange={(e) =>
                        setRangeDrafts((v) => ({
                          ...v,
                          [shot.id]: (v[shot.id] ?? ranges).map((r) =>
                            r.id === range.id
                              ? {
                                  ...r,
                                  startFrame: Math.round(
                                    Number(e.target.value) * fps,
                                  ),
                                }
                              : r,
                          ),
                        }))
                      }
                    />
                  </label>
                  <label>
                    工程时长（秒）
                    <input
                      aria-label={`计划区间时长 ${shot.title} ${index + 1}`}
                      type="number"
                      min={1 / fps}
                      step={1 / fps}
                      value={range.durationFrames / fps}
                      onChange={(e) =>
                        setRangeDrafts((v) => ({
                          ...v,
                          [shot.id]: (v[shot.id] ?? ranges).map((r) =>
                            r.id === range.id
                              ? {
                                  ...r,
                                  durationFrames: Math.round(
                                    Number(e.target.value) * fps,
                                  ),
                                }
                              : r,
                          ),
                        }))
                      }
                    />
                  </label>
                  <button
                    onClick={() =>
                      setRangeDrafts((v) => ({
                        ...v,
                        [shot.id]: (v[shot.id] ?? ranges).filter(
                          (r) => r.id !== range.id,
                        ),
                      }))
                    }
                  >
                    移除区间
                  </button>
                </div>
              ))}
              <div className="plan-actions">
                <button
                  onClick={() =>
                    setRangeDrafts((v) => ({
                      ...v,
                      [shot.id]: [
                        ...(v[shot.id] ?? ranges),
                        {
                          id: crypto.randomUUID(),
                          startFrame: 0,
                          durationFrames: 1,
                        },
                      ],
                    }))
                  }
                >
                  添加手动区间
                </button>
                <button
                  disabled={controller.busy || !rangeDrafts[shot.id]}
                  onClick={() =>
                    void execute(async () => {
                      const selected = rangeDrafts[shot.id];
                      if (
                        selected.some(
                          (r) =>
                            !Number.isInteger(r.startFrame) ||
                            r.startFrame < 0 ||
                            r.durationFrames < 1 ||
                            r.startFrame + r.durationFrames >
                              doc.canvas.durationFrames,
                        )
                      )
                        throw Error("计划区间须在工程范围内，至少一帧");
                      await action({
                        type: "move-shot",
                        shotId: shot.id,
                        ranges: selected,
                      });
                      setRangeDrafts((v) => {
                        const next = { ...v };
                        delete next[shot.id];
                        return next;
                      });
                    })
                  }
                >
                  保存手动区间
                </button>
                {rangeDrafts[shot.id] && (
                  <button
                    onClick={() =>
                      setRangeDrafts((v) => {
                        const next = { ...v };
                        delete next[shot.id];
                        return next;
                      })
                    }
                  >
                    放弃时间草稿
                  </button>
                )}
              </div>
            </details>
            {actual.map(({ binding: b, instance: i }) => (
              <p key={b.id} className="plan-actual">
                实际采用：
                {i
                  ? `${seconds(i.startFrame, fps)}–${seconds(i.startFrame + i.durationFrames, fps)} 秒`
                  : "已移除"}{" "}
                · 素材内 {(b.sourceInSeconds ?? 0).toFixed(2)}
                {b.sourceOutSeconds !== undefined
                  ? `–${b.sourceOutSeconds.toFixed(2)}`
                  : ""}{" "}
                秒
                {b.status === "requirements_changed" && (
                  <strong> · 需求已变更</strong>
                )}
                <small>{b.path}</small>
              </p>
            ))}
            <label>
              画面要求
              <textarea
                aria-label={`画面要求 ${shot.title}`}
                rows={4}
                value={values.visualRequirement}
                onChange={(e) =>
                  patchDraft(shot, "visualRequirement", e.target.value)
                }
              />
            </label>
            <label>
              素材描述
              <textarea
                aria-label={`素材描述 ${shot.title}`}
                rows={3}
                value={values.mediaDescription}
                onChange={(e) =>
                  patchDraft(shot, "mediaDescription", e.target.value)
                }
              />
            </label>
            {draft &&
              (draft.base.visualRequirement !== shot.visualRequirement ||
                draft.base.mediaDescription !== shot.mediaDescription) && (
                <p className="plan-warning">
                  后台已更新此镜。输入草稿已保留，保存时会比较字段。
                </p>
              )}
            <div className="plan-actions">
              <button
                disabled={!draft || controller.busy}
                onClick={() => void saveShot(shot)}
              >
                保存要求
              </button>
              {draft && (
                <button
                  onClick={() =>
                    setDrafts((v) => {
                      const n = { ...v };
                      delete n[shot.id];
                      return n;
                    })
                  }
                >
                  放弃草稿
                </button>
              )}
              <button
                disabled={controller.busy || !ranges.length || shot.cancelled}
                onClick={() =>
                  void execute(() =>
                    action({ type: "reset-timing", shotId: shot.id }),
                  )
                }
              >
                恢复自动对齐
              </button>
            </div>
            {shot.keyframes.length > 0 && (
              <div className="plan-keyframes">
                {shot.keyframes.map((k, i) => (
                  /\.(mp4|mov|webm|m4v)(?:[?#]|$)/i.test(k.path) ? (
                    <div key={k.path + i} style={{ gridColumn: "1 / -1" }}>
                      <video
                        controls
                        preload="metadata"
                        onKeyDown={(e) => e.stopPropagation()}
                        src={planMediaUrl(k.path, doc.id, true)}
                        aria-label={k.label || `${shot.title} B-roll 预览`}
                        style={{ width: "100%", maxHeight: 420 }}
                      />
                      <small>{k.label || "B-roll 预览 · 待验收"}</small>
                    </div>
                  ) : <a
                    key={k.path + i}
                    href={planMediaUrl(k.path, doc.id)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <img
                      src={planMediaUrl(k.path, doc.id)}
                      alt={k.label || `${shot.title} 关键帧 ${i + 1}`}
                    />
                    <small>{k.label || "关键帧"}</small>
                  </a>
                ))}
              </div>
            )}
            <div className="plan-slots">
              {shot.slots.map((slot) => (
                <div key={slot.id}>
                  <b>{slot.description || slot.type}</b>
                  <span>
                    {slot.presentationMode === "overlay"
                      ? "透明叠层"
                      : slot.presentationMode === "immersive"
                        ? "沉浸式"
                        : ""}
                  </span>
                  <small>
                    {bindings.some(
                      (b) => b.slotId === slot.id && b.status === "current",
                    )
                      ? "已入轨"
                      : slot.status || "待素材"}
                  </small>
                  <ProjectMediaUpload
                    label="补充到此槽位"
                    onImported={() => {}}
                    onFilesImported={(files: any[]) =>
                      execute(() =>
                        startJob("recognize", {
                          shotId: shot.id,
                          slotId: slot.id,
                          mediaPaths: files.map(
                            (f) => f.path || f.stagedPath || f.publicPath,
                          ),
                          mediaIds: files.map((f) => f.id).filter(Boolean),
                        }),
                      )
                    }
                  />
                </div>
              ))}
            </div>
            <button
              className="plan-candidate-toggle"
              aria-expanded={!!expandedCandidates[shot.id]}
              onClick={() =>
                setExpandedCandidates((v) => ({ ...v, [shot.id]: !v[shot.id] }))
              }
            >
              网络候选 {shot.candidates.filter((c) => !c.ignored).length}{" "}
              条（链接不代表已下载）
            </button>
            {expandedCandidates[shot.id] && (
              <div className="plan-candidates">
                {shot.candidates.map((c) => (
                  <article
                    key={c.id}
                    className={c.ignored ? "is-ignored" : ""}
                    data-shot-id={shot.id}
                    data-candidate-id={c.id}
                    data-unread={!c.readAt && !c.ignored ? "true" : "false"}
                  >
                    <a
                      href={/^https?:\/\//i.test(c.url) ? c.url : undefined}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {c.title}
                    </a>
                    <small>
                      {c.platform} {c.author} ·{" "}
                      {c.quality?.basis === "file"
                        ? "文件实测"
                        : c.quality?.basis === "page"
                          ? "网页规格"
                          : "尺寸待核验"}{" "}
                      {c.quality?.width &&
                        `${c.quality.width}×${c.quality.height}`}
                    </small>
                    <p>{c.reason}</p>
                    <small>
                      {c.sourceInSeconds !== undefined
                        ? `建议使用素材内 ${c.sourceInSeconds}–${c.sourceOutSeconds ?? "?"} 秒`
                        : ""}{" "}
                      {c.license} {c.availability}
                    </small>
                    {c.previewPath && (
                      <img
                        src={planMediaUrl(c.previewPath, doc.id)}
                        alt={c.title}
                      />
                    )}
                    <div className="plan-actions">
                      {c.downloadUrl && (
                        <a
                          href={
                            /^https?:\/\//i.test(c.downloadUrl)
                              ? c.downloadUrl
                              : undefined
                          }
                          target="_blank"
                          rel="noreferrer"
                        >
                          打开下载页
                        </a>
                      )}
                      <button
                        disabled={c.ignored || controller.busy}
                        onClick={() =>
                          void execute(() =>
                            action({
                              type: "ignore-candidate",
                              shotId: shot.id,
                              candidateId: c.id,
                            }),
                          )
                        }
                      >
                        忽略
                      </button>
                    </div>
                    <ProjectMediaUpload
                      label="导入此候选下载文件"
                      onImported={() => {}}
                      onFilesImported={(files: any[]) =>
                        execute(() =>
                          startJob("recognize", {
                            shotId: shot.id,
                            slotId: c.slotId,
                            candidateId: c.id,
                            mediaPaths: files.map(
                              (f) => f.path || f.stagedPath || f.publicPath,
                            ),
                            mediaIds: files.map((f) => f.id).filter(Boolean),
                          }),
                        )
                      }
                    />
                  </article>
                ))}
              </div>
            )}
            {(shot.alternatives?.length || shot.details || shot.upstream) && (
              <details>
                <summary>完整设计、备选与来源</summary>
                <pre>
                  {JSON.stringify(
                    {
                      alternatives: shot.alternatives,
                      details: shot.details,
                      upstream: shot.upstream,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            )}
            <div className="plan-redo">
              <label>
                重新制作目标
                <select
                  aria-label={`重新制作目标 ${shot.title}`}
                  value={targets[shot.id] ?? ""}
                  onChange={(e) =>
                    setTargets((v) => ({ ...v, [shot.id]: e.target.value }))
                  }
                >
                  <option value="">
                    {targetsForShot.length > 1
                      ? "请选择一个实例或区间"
                      : "使用唯一当前目标"}
                  </option>
                  {targetsForShot.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                disabled={
                  controller.busy ||
                  !!draft ||
                  !!rangeDrafts[shot.id] ||
                  shot.cancelled ||
                  (targetsForShot.length > 1 && !targets[shot.id])
                }
                onClick={() =>
                  void execute(() => {
                    const t = targets[shot.id] || targetsForShot[0]?.value;
                    return startJob("broll", {
                      shotId: shot.id,
                      ...(t?.startsWith("instance:")
                        ? { instanceId: t.slice(9) }
                        : t?.startsWith("range:")
                          ? { rangeId: t.slice(6) }
                          : {}),
                    });
                  })
                }
              >
                {semanticTemplates || shot.approval === "approved"
                  ? "重新制作这一镜"
                  : "更新本镜设计"}
              </button>
              <button
                disabled={controller.busy || shot.cancelled}
                onClick={() =>
                  void execute(() =>
                    action({ type: "cancel-shot", shotId: shot.id }),
                  )
                }
              >
                取消本镜计划
              </button>
            </div>
          </div>
        )}
      </article>
    );
  };
  return (
    <div
      ref={panelRoot}
      className="production-plan-panel"
      aria-label="制作计划"
    >
      <div className="plan-overview">
        <b>版本 {plan?.revision ?? 0}</b>
        <span>
          {semanticTemplates ? "全文需求已分析" : state(plan?.approval ?? "draft")} ·{" "}
          {shots.filter((s) => !s.cancelled).length} 镜
        </span>
      </div>
      {(localError || controller.error) && (
        <p className="error" role="alert">
          {localError || controller.error}
        </p>
      )}
      <details className="plan-project">
        <summary>项目绑定与目录</summary>
        <small>工程 ID：{doc.id}</small>
        <small>当前归档：{doc.projectBinding?.projectRoot || "尚未归档"}</small>
        <label>
          脚本编号
          <input
            value={binding}
            placeholder="可留空，例如 SC-0032"
            onChange={(e) => setBinding(e.target.value)}
          />
        </label>
        <label>
          项目目录
          <input
            value={root}
            placeholder="留空使用唯一工程目录"
            onChange={(e) => setRoot(e.target.value)}
          />
        </label>
        <div className="plan-actions">
          <button
            disabled={controller.busy}
            onClick={() =>
              void execute(() =>
                action({
                  type: "bind-project",
                  scriptId: binding || undefined,
                  projectRoot: root || undefined,
                }),
              )
            }
          >
            保存绑定
          </button>
          <button
            disabled={controller.busy || !root}
            onClick={() =>
              void execute(() =>
                action({ type: "relocate", projectRoot: root }),
              )
            }
          >
            重新定位
          </button>
          {doc.projectBinding && (
            <button
              onClick={() =>
                void execute(() =>
                  productionPlanApi("/open-project", { projectId: doc.id }),
                )
              }
            >
              打开项目目录
            </button>
          )}
        </div>
      </details>
      <details open={!plan} className="plan-generate">
        <summary>{plan ? "生成 / 更新计划" : "从脚本生成计划"}</summary>
        <label>
          本期正文
          <textarea
            rows={6}
            aria-label="制作计划脚本"
            value={script}
            onChange={(e) => setScript(e.target.value)}
            placeholder="粘贴完整定稿；只有口播时可先复用转写，再确认正文。"
          />
        </label>
        <label>
          本期要求
          <textarea
            rows={2}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
        </label>
        {!doc.source && (
          <p className="plan-note">
            当前无口播。可以生成文字分镜并审批关键帧；准确轨道和最终镜头待录制后对齐。
          </p>
        )}
        <button
          disabled={controller.busy || dirty || (!script.trim() && !doc.source)}
          onClick={() =>
            void execute(() =>
              startJob("package", {
                packageOrchestrationVersion: 2,
                bgmExecutionVersion: 1,
                packageExecution: {streamingApply: true, reusePolicy: "same-run"},
                script: script.trim() || undefined,
                instructions,
              }),
            )
          }
        >
          {plan ? "更新计划与设计" : "生成分镜计划"}
        </button>
        <button
          disabled={controller.busy || dirty || !doc.source || !plan}
          onClick={() => void execute(() => startJob("align"))}
        >
          按当前口播增量对齐
        </button>
      </details>
      {dirty && (
        <p className="plan-warning">有未提交要求，请先保存再发起制作。</p>
      )}
      <div className="plan-view-tabs" role="group" aria-label="计划查看方式">
        <button
          aria-pressed={view === "simple"}
          onClick={() => setView("simple")}
        >
          简版
        </button>
        <button
          aria-pressed={view === "current"}
          disabled={!plan}
          onClick={() => setView("current")}
        >
          完整当前计划
        </button>
        <button
          aria-pressed={view === "history"}
          disabled={!controller.history.length && !plan?.packages?.length}
          onClick={() => {
            setVersion(controller.history[0]?.id || plan.packages[0]?.id || "");
            setView("history");
          }}
        >
          原始 package / 历史
        </button>
      </div>
      {view === "history" && (
        <label>
          只读历史版本
          <select value={version} onChange={(e) => setVersion(e.target.value)}>
            {(controller.history.length
              ? controller.history
              : (plan?.packages ?? [])
            ).map((v) => (
              <option key={v.id} value={v.id}>
                {v.createdAt || v.id}
              </option>
            ))}
          </select>
        </label>
      )}
      {view !== "simple" ? (
        <pre className="plan-markdown">{markdown}</pre>
      ) : (
        <div className="plan-shot-list">
          {shots.length ? (
            shots
              .slice()
              .sort((a, b) => a.order - b.order)
              .filter(s=>!selectedShot||s.id===selectedShot)
              .map(renderShot)
          ) : (
            <p className="plan-note">
              尚无制作计划。先粘贴正文生成，或导入已批准的结构化方案。
            </p>
          )}
        </div>
      )}
      <details className="plan-import plan-delivery-import">
        <summary>导入动画交付清单</summary>
        <p className="plan-note">
          每个文件按清单的工程开始时间、时长和透明状态追加独立轨道；允许跨段落，保留原口播声音。
        </p>
        <form onSubmit={(e) => e.preventDefault()}>
          <label>
            本地 JSON 绝对路径
            <input
              aria-label="动画交付清单绝对路径"
              value={deliveryManifestPath}
              placeholder="/Users/…/animation-delivery.json"
              onChange={(e) => setDeliveryManifestPath(e.target.value)}
            />
          </label>
          <small>粘贴清单原文件路径；清单中的相对素材路径按其所在目录读取。</small>
          <button
            type="button"
            disabled={controller.busy || !deliveryManifestPath.trim()}
            onClick={() => void execute(() => {
              const path = deliveryManifestPath.trim();
              if (!path.startsWith("/") || !/\.json$/i.test(path))
                throw Error("请填写本地 JSON 文件的绝对路径");
              return startJob("recognize", {
                deliveryManifestPath: path,
                scope: { camera: false, sound: false },
              });
            })}
          >
            按交付清单导入
          </button>
        </form>
      </details>
      <details className="plan-import">
        <summary>导入结构化计划</summary>
        <p>明确导入后进行三方合并；原版保留为历史。</p>
        <input
          ref={importInput}
          type="file"
          accept=".json"
          aria-label="导入结构化计划 JSON"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file)
              void execute(async () => {
                const data = JSON.parse(await file.text());
                return action({
                  type: "import-plan",
                  plan: data.productionPlan ?? data.plan ?? data,
                  basePlan: data.basePlan,
                  package: data.package,
                });
              });
          }}
        />
      </details>
      {semanticTemplates && (plan?.upstream?.animationPackage?.finalSummaryPath || controller.jobs.find((j:any) => j.outputs?.finalSummaryPath)?.outputs?.finalSummaryPath) && (
        <p><a target="_blank" rel="noreferrer" href={planMediaUrl(plan.upstream?.animationPackage?.finalSummaryPath || controller.jobs.find((j:any) => j.outputs?.finalSummaryPath).outputs.finalSummaryPath, doc.id)}>查看 package 总结和 Claude 提示词</a></p>
      )}
      <section className="plan-footage">
        <button
          disabled={controller.busy || dirty || !doc.source}
          onClick={() => void execute(() => startJob("footage", { scope: { camera: false, sound: false, footage: true } }))}
        >真实素材审稿与搜集</button>
        {!doc.source && <small>导入最终口播及共享 SRT 后可运行。</small>}
        {plan?.upstream?.footagePackage?.summaryPath && (
          <p><a href={planMediaUrl(plan.upstream.footagePackage.summaryPath, doc.id)} target="_blank" rel="noreferrer">查看最新真实素材审稿与候选报告</a></p>
        )}
      </section>
      {plan && (
        <details className="plan-broll" open>
          <summary>整期 broll 执行范围</summary>
          <label>
            <input
              type="checkbox"
              checked={camera}
              onChange={(e) => setCamera(e.target.checked)}
            />
            真人镜头推拉
          </label>
          <label>
            <input
              type="checkbox"
              checked={sound}
              onChange={(e) => setSound(e.target.checked)}
            />
            声音安排
          </label>
          <button
            disabled={
              controller.busy ||
              dirty ||
              !doc.source ||
              (!semanticTemplates && plan.approval !== "approved")
            }
            onClick={() =>
              void execute(() =>
                startJob("broll", { scope: { camera, sound } }),
              )
            }
          >
            运行整期 broll
          </button>
          {!doc.source && <small>导入最终口播并对齐后可运行。</small>}
          {!semanticTemplates && plan.approval !== "approved" && (
            <small>先批准本期分镜 / 更新设计。</small>
          )}
        </details>
      )}
      {plan &&
        !semanticTemplates &&
        [
          "waiting_approval",
          "needs_design",
          "waiting_selection",
          "draft",
        ].includes(plan.approval) && (
          <section className="plan-approval">
            <b>
              {plan.approval === "waiting_selection"
                ? "选择视觉方向"
                : "本期分镜审批"}
            </b>
            {shots
              .filter((s) => !s.cancelled && s.alternatives?.length)
              .map((s) => (
                <label key={s.id}>
                  {s.title}
                  <select
                    value={choices[s.id] ?? ""}
                    onChange={(e) =>
                      setChoices((v) => ({ ...v, [s.id]: e.target.value }))
                    }
                  >
                    <option value="">请选择</option>
                    {s.alternatives.map((a: any, i) => (
                      <option key={a.id ?? i} value={a.id ?? String(i)}>
                        {a.title || a.label || a.description || `方案 ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            <button
              disabled={
                controller.busy ||
                dirty ||
                plan.approval === "waiting_selection"
              }
              onClick={() =>
                void execute(async () => {
                  const waiting = controller.jobs.find(
                    (j) =>
                      j.status === "waiting_approval" &&
                      !j.approvalRequests?.some((r) => r.type === "timing"),
                  );
                  if (waiting) return resume(waiting, "design");
                  return action({
                    type: "approve",
                    shotIds: shots.filter((s) => !s.cancelled).map((s) => s.id),
                    selection: { choices },
                  });
                })
              }
            >
              批准当前分镜并继续
            </button>
          </section>
        )}
      {plan?.conflicts?.length > 0 && (
        <section className="plan-conflicts">
          <b>同步冲突 {plan.conflicts.length}</b>
          {plan.conflicts.map((c) => (
            <article key={c.id}>
              <small>
                {c.shotId} · {c.field}
              </small>
              <p>
                当前：
                {typeof c.current === "string"
                  ? c.current
                  : JSON.stringify(c.current)}
              </p>
              <p>
                新方案：
                {typeof c.incoming === "string"
                  ? c.incoming
                  : JSON.stringify(c.incoming)}
              </p>
              <div className="plan-actions">
                {["current", "incoming"].map((choice) => (
                  <button
                    disabled={controller.busy}
                    key={choice}
                    onClick={() => void resolveConflict(c, choice)}
                  >
                    {choice === "current" ? "保留当前" : "采用新方案"}
                  </button>
                ))}
              </div>
            </article>
          ))}
        </section>
      )}
      <section className="plan-jobs">
        <b>后台任务</b>
        {controller.jobs.length ? (
          controller.jobs.map((j) => (
            <article key={j.id}>
              <div>
                <strong>
                  {j.deliveryManifestPath ? "交付清单导入" : j.kind === "package" && (j.fullPackageVersion === 1 || j.outputs?.fullPackageState) ? "完整package制作准备" : (
                    {
                      package: "分镜与关键帧",
                      broll: "素材制作",
                      recognize: "素材分析",
                      align: "口播对齐",
                      footage: "真实素材审稿与搜集",
                    } as any
                  )[j.kind] || j.kind}
                </strong>
                <span>{j.kind === "footage" && ["waiting_approval", "waiting_selection"].includes(j.status) ? "任务状态需更新" : semanticTemplates && ["package", "broll"].includes(j.kind) && ["waiting_approval", "waiting_selection"].includes(j.status) ? "历史动画任务" : state(j.status)}</span>
              </div>
              <p>
                {stageName(j.stage)} · {j.kind === "package" && j.outputs?.fullPackageBranches ? `${j.outputs.fullPackageBranches.filter((row: any) => row.status !== "blocked" && !(row.changed?.length)).length} / ${j.outputs.fullPackageBranches.length} 项职责` : `${j.processed ?? 0} / ${j.total ?? 0}`}
              </p>
              {j.earlyHandoff?.status === 'ready' && <div role="status">Claude 动画提示词已就绪，可立即手动制作；其余专项继续执行。{j.earlyHandoff.planPath&&<a href={planMediaUrl(j.earlyHandoff.planPath,doc.id)} target="_blank" rel="noreferrer">打开 Claude 动画提示词</a>}</div>}
              {j.packageBranches?.branches?.length>0&&<ul aria-label="专项任务状态">{[...j.packageBranches.branches,...(j.packageBranches.version===2&&j.packageBranches.postStages?.sound?[{...j.packageBranches.postStages.sound,id:'sound'}]:[])].map((branch:any)=><li key={branch.id}>
                <strong>{({templates:'模板',footage:'真实素材',aiVideo:'AI 视频提示词','ai-video':'AI 视频提示词',camera:'镜头',captions:'字幕',cover:'封面',sound:'声音',bgm:'自动配乐'} as any)[branch.id]||branch.id}</strong> · {({pending:'等待依赖',queued:'排队中',running:'执行中',complete:'提案就绪',completed:'提案就绪',blocked:'缺少输入',failed:'失败',cancelled:'已取消',stale:'输入已变化',skipped:'本轮留白',waiting_external:'等待外部结果'} as any)[branch.status]||branch.status}
                {branch.validation&&<> · {({pending:'等待校验',passed:'校验通过',failed:'校验失败'} as any)[branch.validation.status]||branch.validation.status}</>}
                {branch.application&&<> · {branch.id==='sound'&&branch.application.status==='waiting_dependencies'?'等待实际事件':({not_required:'无需工程修改',waiting_dependencies:'等待依赖',queued:'等待保存',applying:'保存中',applied:'已保存',preserved_manual:'已保护手调',blocked:'应用受阻',stale:'输入已变化',cancelled:'已取消'} as any)[branch.application.status]||branch.application.status}</>}
                {branch.reuse?.status&&branch.reuse.status!=='none'&&<> · {branch.validation?.status==='passed'?'已复用内容，本轮已核验':'已复用内容，等待本轮核验'}</>}
                {branch.error&&<small className="error">{branch.error}</small>}{branch.application?.error&&<small className="error">{branch.application.error}</small>}
              </li>)}</ul>}
              {j.outputs?.fullPackageBranches ? (
                <progress max={j.outputs.fullPackageBranches.length} value={j.outputs.fullPackageBranches.filter((row: any) => row.status !== "blocked" && !(row.changed?.length)).length} />
              ) : j.total > 0 && (
                <progress max={j.total} value={j.processed ?? 0} />
              )}
              <details>
                <summary>任务技术详情</summary>
                <small>
                  任务 {j.id} · 阶段 {j.stage}
                </small>
              </details>
              {j.error && <p className="error">{j.error}</p>}
              <div className="plan-actions">
                {["queued", "running", "cancelling"].includes(j.status) && (
                  <button
                    disabled={j.status === "cancelling" || controller.busy}
                    onClick={() =>
                      void execute(() => jobAction(j.id, "cancel"))
                    }
                  >
                    {j.status === "cancelling" ? "等待进程停止" : "取消任务"}
                  </button>
                )}
                {["failed", "interrupted", "partial", "cancelled"].includes(
                  j.status,
                ) && (
                  <button
                    disabled={controller.busy}
                    onClick={() => void execute(() => jobAction(j.id, "retry"))}
                  >
                    重试缺失项
                  </button>
                )}
                {j.kind !== "footage" && !semanticTemplates && j.status === "waiting_approval" &&
                  !j.approvalRequests?.some((r) => r.type === "timing") && (
                    <button
                      disabled={controller.busy || dirty}
                      onClick={() => void execute(() => resume(j, "design"))}
                    >
                      批准本期分镜并继续
                    </button>
                  )}
              </div>
              {j.contentChanges &&
                (j.contentChanges.addedSections?.length > 0 ||
                  j.contentChanges.removedSections?.length > 0) && (
                  <details>
                    <summary>实际口播新增 / 删除段落</summary>
                    <ProductionPlanContentChanges
                      changes={j.contentChanges}
                      shots={shots}
                    />
                  </details>
                )}
              {j.approvalRequests?.filter((r) => j.kind !== "footage" && (!semanticTemplates || r.type === "timing")).map((r, index) => (
                <section className="plan-job-approval" key={r.id ?? index}>
                  <b>
                    {r.type === "timing"
                      ? "最终口播时间轴审批"
                      : "当前任务审批"}
                  </b>
                  <p>{r.reason}</p>
                  {r.files?.map((f) => (
                    <p key={f.path}>
                      <a
                        href={planMediaUrl(f.path, doc.id)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        查看 {f.path.split("/").pop()}
                      </a>
                      <small>版本摘要：{f.sha256}</small>
                    </p>
                  ))}
                  {r.type === "timing" && j.status === "waiting_approval" && (
                    <button
                      disabled={controller.busy || dirty || !r.files?.length}
                      onClick={() => void execute(() => resume(j, "timing", r))}
                    >
                      批准当前真实时间轴并继续
                    </button>
                  )}
                </section>
              ))}
              {j.kind !== "footage" && !semanticTemplates && j.status === "waiting_selection" && (
                <section className="plan-job-selection">
                  <b>当前任务视觉方向</b>
                  {j.choices?.length ? (
                    j.choices.map((c) => (
                      <label key={c.id}>
                        <input
                          type="radio"
                          name={"job-selection-" + j.id}
                          checked={jobChoices[j.id] === c.id}
                          onChange={() =>
                            setJobChoices((v) => ({ ...v, [j.id]: c.id }))
                          }
                        />
                        {c.label || c.id}
                        <small>{c.id}</small>
                        {c.previewPath && (
                          <a
                            href={planMediaUrl(c.previewPath, doc.id)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <img
                              className="plan-choice-preview"
                              src={planMediaUrl(c.previewPath, doc.id)}
                              alt={c.label || c.id}
                            />
                          </a>
                        )}
                      </label>
                    ))
                  ) : (
                    <p className="plan-warning">
                      任务尚未提供可选择的实际关键帧，请保留任务并查看其输出。
                    </p>
                  )}
                  <button
                    disabled={controller.busy || dirty || !jobChoices[j.id]}
                    onClick={() => void execute(() => resume(j, "selection"))}
                  >
                    采用所选方向并继续
                  </button>
                </section>
              )}
              {j.kind === "footage" && <div className="plan-footage-reports">
                {[["footageSummaryPath", "素材审稿与候选报告"], ["footageReviewPath", "逐段素材审稿"], ["allCandidateManifestPath", "全部候选清单"]].map(([key, label]) => j.outputs?.[key] && (
                  <p key={key}><a href={planMediaUrl(j.outputs[key], doc.id)} target="_blank" rel="noreferrer">{label}</a></p>
                ))}
              </div>}
              <details>
                <summary>逐项交付与核验 {j.results?.length ?? 0}</summary>
                {j.results?.map((r) => r.kind === "footage" ? (
                  <FootageResultDetails key={r.id} result={r} projectId={doc.id} />
                ) : r.kind === "delivery" ? (
                  <DeliveryResultDetails key={r.id} result={r} projectId={doc.id} />
                ) : (
                  <p key={r.id}>
                    {r.shotId} · {r.reason || r.kind} ·{" "}
                    {state(r.state ?? "pending")}
                    <small>
                      技术：{r.technical?.passed ? "通过" : "待核验"} · 内容：
                      {r.contentReview?.passed ? "通过" : "待核验"}
                    </small>
                    {r.media?.path && (
                      <a
                        href={planMediaUrl(r.media.path, doc.id, true)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        预览产物
                        {r.media.editable ? "（原生可编辑）" : "（视频）"}
                      </a>
                    )}
                  </p>
                ))}
              </details>
            </article>
          ))
        ) : (
          <p className="plan-note">没有后台任务。</p>
        )}
      </section>
      <section className="plan-result-review">
        <b>"处理记录" {allResults.length}</b>
        <p className="plan-note">
          分析不会打断剪辑。按结果确认素材位置、口播差异或分镜增量。
        </p>
        {allResults.filter(r=>r.kind!=="shot-revision").map((r) => {
          const o = overrides[r.id] ?? {},
            shot = shots.find((s) => s.id === (o.shotId ?? r.shotId)),
            bindings = shot?.bindings ?? [];
          const set = (key: string, value: any) =>
            setOverrides((v) => ({
              ...v,
              [r.id]: {
                ...v[r.id],
                [key]: value,
                ...(["slotId", "sourceInSeconds", "sourceOutSeconds"].includes(
                  key,
                )
                  ? { contentConfirmation: undefined }
                  : {}),
              },
            }));
          if (r.kind === "footage")
            return (
              <article key={r.id} className="plan-footage-result">
                <FootageResultDetails result={r} projectId={doc.id} />
                <button disabled={controller.busy} onClick={() => void execute(() => action({ type: "ignore-results", resultIds: [r.id] }))}>忽略</button>
              </article>
            );
          if (r.kind === "delivery")
            return (
              <article key={r.id} className="plan-delivery-result">
                <DeliveryResultDetails result={r} projectId={doc.id} />
                <p className="plan-note">技术核验通过后按清单自动追加；此记录无需选择镜头或批准位置。</p>
                <button
                  disabled={controller.busy}
                  onClick={() => void execute(() => action({ type: "ignore-results", resultIds: [r.id] }))}
                >忽略</button>
              </article>
            );
          if (["alignment", "plan"].includes(r.kind))
            return (
              <ProductionPlanResult
                key={r.id}
                document={doc}
                result={r}
                override={o}
                busy={controller.busy}
                checked={checked.includes(r.id)}
                onChecked={(value) =>
                  setChecked((v) =>
                    value ? [...v, r.id] : v.filter((id) => id !== r.id),
                  )
                }
                onOverride={(patch) =>
                  setOverrides((v) => ({
                    ...v,
                    [r.id]: { ...v[r.id], ...patch },
                  }))
                }
                onApply={(patch) =>
                  void applyResults([r.id], { [r.id]: { ...o, ...patch } })
                }
                onIgnore={() =>
                  void execute(() =>
                    action({ type: "ignore-results", resultIds: [r.id] }),
                  )
                }
              />
            );
          return (
            <article key={r.id}>
              <label>
                <input
                  type="checkbox"
                  checked={checked.includes(r.id)}
                  onChange={(e) =>
                    setChecked((v) =>
                      e.target.checked
                        ? [...v, r.id]
                        : v.filter((id) => id !== r.id),
                    )
                  }
                />
                {r.reason || r.media?.path || r.kind}
              </label>
              <small>
                {state(r.state ?? "pending")} · 技术{" "}
                {r.technical?.passed ? "通过" : "待核验"} · 内容{" "}
                {r.contentReview?.passed ? "通过" : "待核验"}
              </small>
              {r.media?.path && (
                <a
                  href={planMediaUrl(r.media.path, doc.id, true)}
                  target="_blank"
                  rel="noreferrer"
                >
                  预览素材
                </a>
              )}
              <label>
                目标镜头
                <select
                  value={o.shotId ?? r.shotId ?? ""}
                  onChange={(e) => {
                    setOverrides((v) => ({
                      ...v,
                      [r.id]: {
                        ...v[r.id],
                        shotId: e.target.value,
                        slotId: undefined,
                        targetInstanceId: undefined,
                        rangeId: undefined,
                        contentConfirmation: undefined,
                      },
                    }));
                  }}
                >
                  <option value="">选择镜头</option>
                  {shots
                    .filter((s) => !s.cancelled)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {shots.indexOf(s) + 1}. {s.title}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                目标槽位
                <select
                  value={o.slotId ?? r.slotId ?? ""}
                  onChange={(e) => set("slotId", e.target.value)}
                >
                  <option value="">选择槽位</option>
                  {shot?.slots.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.description || s.type}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                采用位置
                <select
                  value={
                    o.targetInstanceId
                      ? "instance:" + o.targetInstanceId
                      : o.rangeId
                        ? "range:" + o.rangeId
                        : r.target?.instanceId
                          ? "instance:" + r.target.instanceId
                          : r.target?.rangeId
                            ? "range:" + r.target.rangeId
                            : ""
                  }
                  onChange={(e) => {
                    const t = e.target.value;
                    setOverrides((v) => ({
                      ...v,
                      [r.id]: {
                        ...v[r.id],
                        targetInstanceId: t.startsWith("instance:")
                          ? t.slice(9)
                          : undefined,
                        rangeId: t.startsWith("range:")
                          ? t.slice(6)
                          : undefined,
                      },
                    }));
                  }}
                >
                  <option value="">仅填当前空槽；已占用需指定</option>
                  {bindings.map((b) => {
                    const i = doc.instances.find((v) => v.id === b.instanceId);
                    return i ? (
                      <option key={b.id} value={"instance:" + i.id}>
                        替换实际 {seconds(i.startFrame, fps)}–
                        {seconds(i.startFrame + i.durationFrames, fps)} 秒
                      </option>
                    ) : null;
                  })}
                  {shot?.timing.ranges.map((t) => (
                    <option key={t.id} value={"range:" + t.id}>
                      计划 {seconds(t.startFrame, fps)}–
                      {seconds(t.startFrame + t.durationFrames, fps)} 秒
                    </option>
                  ))}
                </select>
              </label>
              {r.media && (
                <div className="plan-source-range">
                  <label>
                    素材入点（秒）
                    <input
                      type="number"
                      min={0}
                      step=".001"
                      value={o.sourceInSeconds ?? r.media.sourceInSeconds ?? 0}
                      onChange={(e) =>
                        set("sourceInSeconds", Number(e.target.value))
                      }
                    />
                  </label>
                  <label>
                    素材出点（秒）
                    <input
                      type="number"
                      min={0}
                      step=".001"
                      value={
                        o.sourceOutSeconds ?? r.media.sourceOutSeconds ?? ""
                      }
                      onChange={(e) =>
                        set(
                          "sourceOutSeconds",
                          e.target.value ? Number(e.target.value) : undefined,
                        )
                      }
                    />
                  </label>
                </div>
              )}
              {["media", "match"].includes(r.kind) &&
                r.contentReview?.passed !== true && (
                  <section className="plan-content-confirmation">
                    <b>内容仍需人工判断</b>
                    {r.contentReview?.uncertainties?.map((item, index) => (
                      <p key={index}>
                        {typeof item === "string" ? item : JSON.stringify(item)}
                      </p>
                    ))}
                    {r.media?.path &&
                      (/\.(png|jpe?g|webp|gif)(?:[?#]|$)/i.test(
                        r.media.path,
                      ) ? (
                        <img
                          src={planMediaUrl(r.media.path, doc.id)}
                          alt="待确认的实际素材"
                          style={{ maxWidth: "100%" }}
                        />
                      ) : (
                        <video
                          controls
                          preload="metadata"
                          onKeyDown={(e) => e.stopPropagation()}
                          src={planMediaUrl(r.media.path, doc.id, true)}
                          aria-label="待确认的实际素材"
                          style={{ width: "100%" }}
                        />
                      ))}
                    <label>
                      <input
                        type="checkbox"
                        disabled={
                          controller.busy ||
                          !contentConfirmationFor(r, shot, o.slotId ?? r.slotId)
                        }
                        checked={mediaResultEligible(r, doc, o)}
                        onChange={(e) =>
                          setOverrides((v) => ({
                            ...v,
                            [r.id]: {
                              ...v[r.id],
                              shotId: shot?.id,
                              slotId: o.slotId ?? r.slotId,
                              contentConfirmation: e.target.checked
                                ? contentConfirmationFor(
                                    r,
                                    shot,
                                    o.slotId ?? r.slotId,
                                  )
                                : undefined,
                            },
                          }))
                        }
                      />
                      我已预览并确认此素材符合当前要求
                    </label>
                    <small>
                      保留AI原核验结论；此确认仅针对所选镜头、槽位、当前要求版本与这一素材文件。
                    </small>
                    {r.technical?.passed !== true && (
                      <p>技术核验未通过，暂不能采用。</p>
                    )}
                  </section>
                )}
              <details>
                <summary>建议、差异与核验依据</summary>
                <pre>
                  {JSON.stringify(
                    {
                      target: r.target,
                      plan: r.plan,
                      technical: r.technical,
                      contentReview: r.contentReview,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
              <div className="plan-actions">
                <button
                  disabled={controller.busy || !mediaResultEligible(r, doc, o)}
                  onClick={() => void applyResults([r.id])}
                >
                  采用此结果
                </button>
                <button
                  disabled={controller.busy}
                  onClick={() =>
                    void execute(() =>
                      action({ type: "ignore-results", resultIds: [r.id] }),
                    )
                  }
                >
                  忽略
                </button>
              </div>
            </article>
          );
        })}
        {allResults.length > 0 && (
          <div className="plan-actions">
            <button
              disabled={
                controller.busy ||
                !selectedResults.length ||
                selectedResults.some(
                  (r) => !mediaResultEligible(r, doc, overrides[r.id]),
                )
              }
              onClick={() => void applyResults(selectedResults.map((r) => r.id))}
            >
              一次确认所选 {checked.length} 项
            </button>
            <button
              disabled={controller.busy || !selectedResults.length}
              onClick={() =>
                void execute(() =>
                  action({ type: "ignore-results", resultIds: checked }),
                )
              }
            >
              忽略所选
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

export function ProductionPlanPanel(props:any){
 const [moreOpen,setMoreOpen]=useState(false);
 return <div className="production-plan-panel plan-focused-panel">
  {props.controller.error&&<p className="error" role="alert">{props.controller.error}</p>}
  <ProductionPlanQuickView {...props}/>
  <details className="plan-more-controls" onToggle={e=>setMoreOpen(e.currentTarget.open)}>
   <summary>更多：完整控制、生成与历史</summary>
   <FullProductionPlanPanel {...props} active={props.active&&moreOpen}/>
  </details>
 </div>;
}
