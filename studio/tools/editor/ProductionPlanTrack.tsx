import React, { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import {PlanVisualBadges} from "./PlanVisualBadges";
import { getPlanPreviewView } from "./production-plan-view-model.mjs";
import { planRanges } from "../lib/production-plan-model.mjs";
import { adjustPlanRange } from "./production-plan-sync.mjs";
import "./production-plan.css";
export function ProductionPlanTrack({
  document: doc,
  getDocument,
  px,
  labelWidth,
  selectedShot,
  onSelect,
  onAction,
  onDrop,
  jobs = [],
  resources = {},
}: any) {
  const [preview, setPreview] = useState<any>(null),
    [error, setError] = useState(""), [drop, setDrop] = useState("");
  const gesture = useRef<(() => void) | null>(null);
  const enabled = doc.productionPlan?.hoverEnabled !== false;
  const fps = doc.canvas.fps.num / doc.canvas.fps.den,
    views = new Map<string, any>((doc.productionPlan?.shots ?? []).map((shot:any)=>[shot.id,getPlanPreviewView(doc,shot,jobs,resources)])),
    ranges = planRanges(doc).filter(entry => views.get(entry.shotId)?.visible),
    shots = [...(doc.productionPlan?.shots ?? [])].sort((a,b)=>a.order-b.order),
    shotNumber = (id:string)=>shots.findIndex(shot=>shot.id===id)+1;
  useEffect(()=>()=>gesture.current?.(),[]);
  useEffect(()=>{setPreview(null);gesture.current?.();},[doc.id]);
  const start = (e: React.PointerEvent, entry: any, mode: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    gesture.current?.();
    const initial = e.clientX,
      original = {
        id: entry.rangeId,
        startFrame: entry.startFrame,
        durationFrames: entry.durationFrames,
      };
    let value = original,
      moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - initial) < 4) return;
      moved = true;
      value = adjustPlanRange(
        original,
        mode,
        (ev.clientX - initial) / px,
        (getDocument?.() ?? doc).canvas.durationFrames,
      );
      setPreview({ shotId: entry.shotId, rangeId: entry.rangeId, ...value });
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", key, true);
      gesture.current = null;
      setPreview(null);
    };
    const cancel = () => cleanup();
    const key = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        cancel();
      }
    };
    const end = () => {
      cleanup();
      if (!moved) {
        onSelect(entry.shotId, entry.startFrame);
        return;
      }
      const latest = getDocument?.() ?? doc,
        shot = latest.productionPlan?.shots.find((s) => s.id === entry.shotId);
      if (!shot) return;
      void onAction({
        type: "move-shot",
        shotId: entry.shotId,
        ranges: shot.timing.ranges.map((r) =>
          r.id === entry.rangeId ? value : r,
        ),
      }).catch((e) => setError(e.message));
    };
    gesture.current = cancel;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
    window.addEventListener("pointercancel", cancel, { once: true });
    window.addEventListener("blur", cancel, { once: true });
    window.addEventListener("keydown", key, true);
  };
  if (!doc.productionPlan) return null;
  return (
    <div
      className="production-plan-track track"
      aria-label="制作计划辅助轨道"
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="track-label">
        <strong>制作计划</strong>
        <button
          aria-label={enabled ? "隐藏画布计划标注" : "显示画布计划标注"}
          aria-pressed={enabled}
          title="开关画布标注；保留计划轨道"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() =>
            void onAction({ type: "hover", enabled: !enabled }).catch((e) =>
              setError(e.message),
            )
          }
        >
          <Icon name={enabled ? "eye" : "eye-off"} />
        </button>
      </div>
      {ranges.map((entry) => {
        const s = entry.shot,
          r =
            preview?.rangeId === entry.rangeId &&
            preview?.shotId === entry.shotId
              ? preview
              : entry;
        return (
          <div
            key={entry.shotId + "/" + entry.rangeId}
            role="button"
            tabIndex={0}
            data-plan-shot={entry.shotId}
            className={
              "production-plan-block plan-category-" + views.get(s.id)?.category + " " +
              (selectedShot === entry.shotId ? "is-selected " : "") +
              (drop === entry.shotId ? "is-drop " : "") +
              (s.timing.status === "review" ? "needs-review " : "") +
              (s.cancelled ? "is-cancelled" : "")
            }
            style={{
              left: labelWidth + r.startFrame * px,
              width: Math.max(5, r.durationFrames * px),
            }}
            onPointerDown={(e) => start(e, entry, "move")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onSelect(entry.shotId, entry.startFrame);
              }
            }}
            aria-label={`${s.title}，${(entry.startFrame / fps).toFixed(2)} 至 ${((entry.startFrame + entry.durationFrames) / fps).toFixed(2)} 秒`}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes("application/x-motion-media")) {
                e.preventDefault();
                e.stopPropagation();
                setDrop(entry.shotId);
                          }
            }}
            onDragLeave={() => setDrop("")}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDrop("");
              const id = e.dataTransfer.getData("application/x-motion-media");
              if (id) onDrop?.(id, entry.shotId, entry.rangeId);
            }}
          >
            <span
              className="plan-handle left"
              role="separator"
              aria-label={`调整计划起点 ${s.title}`}
              onPointerDown={(e) => start(e, entry, "left")}
            />
            <PlanVisualBadges kinds={views.get(s.id)?.visualKinds??[]} compact/>
            <span className="plan-block-title">
              {shotNumber(s.id)}. {s.title}
            </span>
            {s.candidates.some((c) => !c.readAt && !c.ignored) && (
              <i className="plan-unread" />
            )}
            <span
              className="plan-handle right"
              role="separator"
              aria-label={`调整计划终点 ${s.title}`}
              onPointerDown={(e) => start(e, entry, "right")}
            />
          </div>
        );
      })}
      {!ranges.length && (
        <small className="plan-unaligned" style={{ left: labelWidth + 12 }}>
          {shots.some(s=>views.get(s.id)?.visible) ? "未对齐计划请从右侧查看 · 不使用估时冒充准确位置" : "本段计划保留原片 · 完整计划可在右侧查看"}
        </small>
      )}
      {error && (
        <small role="alert" className="plan-track-error">
          {error}
        </small>
      )}
    </div>
  );
}
