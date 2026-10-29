import {TEMPLATE_CATEGORIES, templateUse} from './template-categories.mjs';
export const DRAFT_KEY = "motion-studio:recovery:v1";
export function encodeDraft(document, frame = 0, savedAt = Date.now()) {
  return JSON.stringify({
    version: 1,
    document,
    frame: Math.max(
      0,
      Math.min(Math.round(frame), document.canvas.durationFrames - 1),
    ),
    savedAt,
  });
}
export function decodeDraft(raw) {
  try {
    const draft = JSON.parse(raw),
      d = draft.document,
      c = d?.canvas;
    if (
      draft.version !== 1 ||
      !d ||
      d.schemaVersion !== 1 ||
      typeof d.id !== "string" ||
      typeof d.name !== "string" ||
      !Array.isArray(d.instances) ||
      !Number.isInteger(d.revision) ||
      !c ||
      ![c.width, c.height, c.durationFrames, c.fps?.num, c.fps?.den].every(
        (n) => Number.isInteger(n) && n > 0,
      ) ||
      !Number.isFinite(draft.savedAt) ||
      !Number.isFinite(draft.frame)
    )
      return null;
    if (
      !d.instances.every(
        (i) =>
          typeof i.id === "string" &&
          typeof i.assetId === "string" &&
          Number.isInteger(i.startFrame) &&
          i.startFrame >= 0 &&
          Number.isInteger(i.durationFrames) &&
          i.durationFrames > 0 &&
          i.startFrame + i.durationFrames <= c.durationFrames &&
          i.props &&
          typeof i.props === "object",
      )
    )
      return null;
    return {
      ...draft,
      frame: Math.max(
        0,
        Math.min(Math.round(draft.frame), c.durationFrames - 1),
      ),
    };
  } catch {
    return null;
  }
}
export function filterTemplates(assets, query = "", category = "all") {
  const q = query.trim().toLocaleLowerCase();
  return assets.filter((a) => {
    const use = templateUse(a.id);
    const label = TEMPLATE_CATEGORIES.find(c=>c.id === use.category)?.label ?? '';
    return (category === "all" || use.category === category) &&
      `${a.name} ${a.id} ${a.description ?? ""} ${label} ${use.purpose} ${use.keywords}`
        .toLocaleLowerCase()
        .includes(q);
  });
}
export function formatStudioTime(frame, fps = 30) {
  const total = Math.max(0, Math.round(frame));
  const seconds = Math.floor(total / fps);
  return [Math.floor(seconds / 60), seconds % 60, Math.floor(total % fps)]
    .map((v) => String(v).padStart(2, "0"))
    .join(":");
}
