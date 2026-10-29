export function keyboardCommand(
  event,
  { editing = false, modal = false, selected = false, timeline = false, captions = false } = {},
) {
  const mod = event.metaKey || event.ctrlKey,
    k = event.key.toLowerCase();
  if (k === "escape") return "escape";
  if (mod && k === "s" && !modal) return "save";
  if (editing || modal) return null;
  if (mod && k === "g" && selected) return event.shiftKey ? "ungroup" : "group";
  if (timeline && k === "arrowup") return "previousEdit";
  if (timeline && k === "arrowdown") return "nextEdit";
  if (mod && k === "a" && (timeline || captions)) return "selectAll";
  if (mod && k === "v" && (timeline || selected)) return "paste";
  if (mod && selected && ["c","x","b"].includes(k)) return ({c:"copy",x:"cut",b:"split"})[k];
  if (mod && k === "z") return event.shiftKey ? "redo" : "undo";
  if (mod && k === "d" && selected && !modal) return "duplicate";
  if (modal) return null;
  if ((k === "backspace" || k === "delete") && selected) return "delete";
  if (event.code === "Space" || k === " ") return "toggle";
  if (k === "arrowleft") return event.shiftKey ? "back10" : "back";
  if (k === "arrowright") return event.shiftKey ? "forward10" : "forward";
  if (k === "home") return "start";
  if (k === "end") return "end";
  return null;
}
export function frameAtClient(
  clientX,
  rectLeft,
  scrollLeft,
  labelWidth,
  pxPerFrame,
  total,
) {
  return Math.max(
    0,
    Math.min(
      total - 1,
      Math.round((clientX - rectLeft + scrollLeft - labelWidth) / pxPerFrame),
    ),
  );
}
export function duplicateInstance(document, id, newId) {
  const next = structuredClone(document),
    source = next.instances.find((i) => i.id === id);
  if (!source) return next;
  const copy = structuredClone(source);
  copy.id = newId;
  copy.zIndex = Math.max(0, ...next.instances.map((i) => i.zIndex)) + 1;
  next.instances.push(copy);
  return next;
}

/** Gesture thresholds are screen pixels, independent of preview magnification. */
export function canvasDragPosition({dx, dy, scale, x = 0, y = 0, started = false, snap = false}) {
  if (!started && Math.hypot(dx, dy) < 4) return null;
  const align = (value) => snap && Math.abs(value * scale) <= 6 ? 0 : value;
  return {x: align(x + Math.round(dx / scale)), y: align(y + Math.round(dy / scale))};
}
