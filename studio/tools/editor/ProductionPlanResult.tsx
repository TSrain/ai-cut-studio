import { ProductionPlanContentChanges } from "./ProductionPlanContentChanges";
import { planMediaUrl } from "./production-plan-sync.mjs";
import React from "react";
/** Plan and alignment decisions use their own semantic controls, never media slots. */
export function ProductionPlanResult({
  document: doc,
  result: r,
  override: o = {},
  onOverride,
  onApply,
  onIgnore,
  checked,
  onChecked,
  busy,
}: any) {
  const fps = doc.canvas.fps.num / doc.canvas.fps.den,
    shot = doc.productionPlan?.shots.find(
      (s) => s.id === (o.shotId ?? r.shotId),
    );
  const alignment = r.alignment ?? {},
    anchor = alignment.anchor ?? r.anchor,
    review = alignment.contentReview ?? r.contentReview ?? {},
    suggested = alignment.suggestedRanges ?? alignment.timing?.ranges ?? [];
  const format = (ranges: any[]) =>
    ranges.length
      ? ranges
          .map(
            (t) =>
              `${(t.startFrame / fps).toFixed(2)}–${((t.startFrame + t.durationFrames) / fps).toFixed(2)} 秒`,
          )
          .join("、")
      : "没有可靠区间";
  const manual = !!shot?.timing?.manual,
    critical = !!review.critical;
  return (
    <article className="plan-semantic-result">
      <label>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChecked(e.target.checked)}
        />
        {r.kind === "alignment" ? "口播差异与时间确认" : "接入新的分镜方案"} ·{" "}
        {shot?.title ?? r.shotId ?? ""}
      </label>
      <small>
        {r.state === "stale"
          ? "旧输入版本，确认后才采用"
          : r.state === "conflict"
            ? "当前安排与建议有冲突"
            : "待确认"}
      </small>
      {r.kind === "alignment" ? (
        <>
          <p>
            <b>计划口播</b>
            <br />
            {shot?.narration || "无原文"}
          </p>
          <p>
            <b>实际口播</b>
            <br />
            {review.actualNarration || "尚无可靠转写"}
          </p>
          <p>{review.reason || r.reason}</p>
          {anchor && (
            <small>
              原媒体 {anchor.startSeconds?.toFixed(3)}–
              {anchor.endSeconds?.toFixed(3)} 秒 · 置信度{" "}
              {Math.round((anchor.confidence ?? 0) * 100)}%
            </small>
          )}
          <p>
            当前工程区间：{format(shot?.timing.ranges ?? [])}
            {manual ? "（手动调整）" : ""}
          </p>
          <p>建议工程区间：{format(suggested)}</p>
          {critical && (
            <label>
              关键差异判断
              <select
                value={o.interpretation ?? ""}
                onChange={(e) => onOverride({ interpretation: e.target.value })}
              >
                <option value="">请选择差异性质</option>
                <option value="recognition_error">
                  识别错误，保留脚本正文
                </option>
                <option value="spoken_slip">录制口误，保留脚本正文</option>
                <option value="intended_change">
                  有意改稿，记录后更新设计
                </option>
              </select>
            </label>
          )}
          {critical && (
            <small>
              识别错误 / 口误保留有效正文；有意改稿更新口播并等待设计审批。
            </small>
          )}
          {manual && (
            <label>
              <input
                type="checkbox"
                checked={!!o.replaceManualTiming}
                onChange={(e) =>
                  onOverride({ replaceManualTiming: e.target.checked })
                }
              />
              明确用建议区间覆盖这镜的手调时间
            </label>
          )}
          <div className="plan-actions">
            <button
              disabled={
                busy ||
                !anchor ||
                !review.actualNarration ||
                !suggested.length ||
                (manual && !o.replaceManualTiming) ||
                (critical && !o.interpretation)
              }
              onClick={() =>
                onApply({
                  shotId: shot?.id ?? r.shotId,
                  alignmentChoice: "suggested",
                  ...(manual ? { replaceManualTiming: true } : {}),
                })
              }
            >
              {manual ? "采用建议时间（覆盖手调）" : "确认采用建议时间"}
            </button>
            <button disabled={busy} onClick={onIgnore}>
              {manual ? "保留手调时间" : "保留当前计划时间"}
            </button>
          </div>
        </>
      ) : (
        <>
          <p>
            新方案 {r.plan?.shots?.length ?? 0}{" "}
            镜，采用时比较当前修改并保留冲突；移出镜头的旧素材继续保留。
          </p>
          {r.plan?.shots?.map((s) => (
            <details key={s.id}>
              <summary>
                {s.cancelled
                  ? "移出当前安排："
                  : !doc.productionPlan?.shots.some(
                        (current) => current.id === s.id,
                      )
                    ? "新增镜头："
                    : "更新镜头："}
                {s.title || s.id}
              </summary>
              <p>口播：{s.narration}</p>
              <p>画面要求：{s.visualRequirement}</p>
              <p>素材描述：{s.mediaDescription}</p>
            </details>
          ))}
          {r.contentChanges && (
            <div>
              <b>本次段落增量</b>
              {r.contentChanges.addedShots?.map((s) => (
                <p key={s.shotId}>新增：{s.narration}</p>
              ))}
              {r.contentChanges.removedShotIds?.map((id) => (
                <p key={id}>
                  移出：
                  {doc.productionPlan?.shots.find((s) => s.id === id)?.title ||
                    id}
                  （旧素材保留）
                </p>
              ))}
              {r.contentChanges.reorderedShotIds?.map((id) => (
                <p key={id}>
                  顺序调整：
                  {doc.productionPlan?.shots.find((s) => s.id === id)?.title ||
                    id}
                </p>
              ))}
              {r.contentChanges.reviewPath && (
                <a
                  href={planMediaUrl(r.contentChanges.reviewPath, doc.id)}
                  target="_blank"
                  rel="noreferrer"
                >
                  查看完整增量依据
                </a>
              )}
            </div>
          )}
          <div className="plan-actions">
            <button disabled={busy || !r.plan} onClick={() => onApply({})}>
              {r.requiresConfirmation ? "确认此增量" : "合并当前方案"}
            </button>
            <button disabled={busy} onClick={onIgnore}>
              保留当前方案
            </button>
          </div>
        </>
      )}
      {alignment.contentChanges &&
        (alignment.contentChanges.addedSections?.length > 0 ||
          alignment.contentChanges.removedSections?.length > 0) && (
          <details>
            <summary>本次口播新增 / 删除</summary>
            <ProductionPlanContentChanges
              changes={alignment.contentChanges}
              shots={doc.productionPlan?.shots}
            />
          </details>
        )}
      <details>
        <summary>完整差异与对齐依据</summary>
        <pre>
          {JSON.stringify(r.kind === "alignment" ? alignment : r.plan, null, 2)}
        </pre>
      </details>
    </article>
  );
}
