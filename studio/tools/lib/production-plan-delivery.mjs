import { createHash } from "node:crypto";
import { readFileSync, existsSync, statSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
const digest = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const actual = (path) => realpathSync(resolve(path));
const sha = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function validateDeliveryManifest(value, projectId) {
  if (
    !value ||
    value.schemaVersion !== 1 ||
    value.timeBase !== "project" ||
    !Array.isArray(value.files) ||
    !value.files.length
  )
    throw new Error("Invalid delivery manifest schema/timeBase/files");
  if (value.projectId !== undefined && value.projectId !== projectId)
    throw new Error("Delivery manifest project identity mismatch");
  if (value.sourceVideoSha256 !== undefined && !sha(value.sourceVideoSha256))
    throw new Error("Invalid delivery manifest source hash");
  for (const entry of value.files)
    if (
      !entry ||
      typeof entry.file !== "string" ||
      !entry.file ||
      entry.file.includes("\0") ||
      entry.file.includes("://") ||
      !Number.isFinite(entry.startSeconds) ||
      entry.startSeconds < 0 ||
      !Number.isFinite(entry.durationSeconds) ||
      entry.durationSeconds <= 0 ||
      typeof entry.transparent !== "boolean"
    )
      throw new Error("Invalid delivery manifest file entry");
  return value;
}
export function verifyDeliveryResult(result, snapshot) {
  const d = result.delivery;
  if (
    !d ||
    d.timeBase !== "project" ||
    !Number.isInteger(d.entryIndex) ||
    d.entryIndex < 0 ||
    !snapshot.deliveryManifestPath ||
    actual(d.manifestPath ?? "") !== actual(snapshot.deliveryManifestPath) ||
    d.manifestSha256 !== snapshot.deliveryManifestSha256 ||
    !sha(d.manifestSha256) ||
    digest(snapshot.deliveryManifestPath) !== d.manifestSha256
  )
    throw new Error("Delivery manifest identity/integrity mismatch");
  const manifest = validateDeliveryManifest(
      JSON.parse(readFileSync(snapshot.deliveryManifestPath, "utf8")),
      snapshot.projectId,
    ),
    entry = manifest.files[d.entryIndex];
  if (
    !entry ||
    entry.startSeconds !== d.startSeconds ||
    entry.durationSeconds !== d.durationSeconds ||
    entry.transparent !== d.transparent ||
    !result.media ||
    actual(result.media.path) !== actual(entry.file) ||
    result.media.sourceInSeconds !== 0 ||
    result.media.sourceOutSeconds !== entry.durationSeconds
  )
    throw new Error("Delivery selected entry/media/time identity mismatch");
  const fps =
    snapshot.document.canvas.fps.num / snapshot.document.canvas.fps.den;
  if (
    result.target?.startFrame !== Math.round(entry.startSeconds * fps) ||
    result.target?.durationFrames !== Math.round(entry.durationSeconds * fps)
  )
    throw new Error("Delivery target differs from manifest timing");
  const input = snapshot.inputs?.find(
    (item) => actual(item.path) === actual(entry.file),
  );
  if (
    !input ||
    !sha(input.sha256) ||
    input.sha256 !== result.technical?.details?.sha256 ||
    !existsSync(entry.file) ||
    !statSync(entry.file).isFile() ||
    digest(entry.file) !== input.sha256
  )
    throw new Error("Delivery media hash identity changed");
  return entry;
}
export function deliveryApplicationKey(result) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        result.technical?.details?.sha256,
        result.delivery?.startSeconds,
        result.delivery?.durationSeconds,
        result.delivery?.transparent,
      ]),
    )
    .digest("hex");
}
