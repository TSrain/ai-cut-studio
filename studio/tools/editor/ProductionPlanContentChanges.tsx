import React from "react";
/** Current workers emit structured sections; archived jobs may still contain text. */
export function ProductionPlanContentChanges({ changes, shots = [] }: any) {
  const confidence = (value: any) =>
    typeof value === "number" ? ` · 置信度 ${Math.round(value * 100)}%` : "";
  return (
    <>
      {changes?.addedSections?.map((section: any, index: number) => (
        <p key={"added" + index}>
          新增：
          {typeof section === "string"
            ? section
            : section?.narration || "新增段落"}
          {typeof section === "object" && section && (
            <small>
              {section.reason}
              {confidence(section.confidence)}
            </small>
          )}
        </p>
      ))}
      {changes?.removedSections?.map((section: any, index: number) => (
        <p key={"removed" + index}>
          删除：
          {typeof section === "string"
            ? section
            : shots.find((s: any) => s.id === section?.shotId)?.title ||
              section?.shotId ||
              "移出段落"}
          {typeof section === "object" && section && (
            <small>
              {section.reason}
              {confidence(section.confidence)}
            </small>
          )}
        </p>
      ))}
    </>
  );
}
