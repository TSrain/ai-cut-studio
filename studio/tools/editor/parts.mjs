export function readPartText(props, part) {
  if (!part?.slotKey) return undefined;
  let value = props.slots?.[part.slotKey];
  if (part.index !== undefined)
    value = (
      Array.isArray(value)
        ? value
        : String(value ?? "")
            .split(part.listSeparator === "," ? /[,，、]+/ : "|")
            .map((s) => s.trim())
            .filter(Boolean)
    )[part.index];
  if (part.segment !== undefined)
    value =
      String(value ?? "").split(part.separator || "|")[part.segment] ?? "";
  return value;
}
export function writePartText(props, part, value) {
  if (!part?.slotKey) return;
  props.slots ??= {};
  const original = props.slots[part.slotKey];
  if (part.index === undefined) {
    props.slots[part.slotKey] = value;
    return;
  }
  const rows = Array.isArray(original)
    ? [...original]
    : String(original ?? "")
        .split(part.listSeparator === "," ? /[,，、]+/ : "|")
        .map((s) => s.trim())
        .filter(Boolean);
  if (part.index >= rows.length) return;
  if (part.segment !== undefined) {
    const chunks = String(rows[part.index] ?? "").split(part.separator || "|");
    while (chunks.length <= part.segment) chunks.push("");
    chunks[part.segment] = value;
    rows[part.index] = chunks.join(part.separator || "|");
  } else rows[part.index] = value;
  props.slots[part.slotKey] = Array.isArray(original)
    ? rows
    : rows.join(part.listSeparator || "|");
}
