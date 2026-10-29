import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve, dirname, relative, isAbsolute, extname } from "node:path";
import { pipFitSize } from "../../templates/remotion-base/src/editor/source-pip.mjs";
import {verifiedFileDigest as digest} from "./verified-file-digest.mjs";
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const absolute = (path, base) => realpathSync(resolve(base, path));
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};
export function verifyFootageResult(result, snapshot, outputDir) {
  const f = result.footage;
  assert(
    f &&
      typeof f.reviewPath === "string" &&
      /^[a-f0-9]{64}$/.test(f.reviewSha256 ?? ""),
    "Footage review identity missing",
  );
  const path = absolute(f.reviewPath, outputDir),
    rel = relative(realpathSync(outputDir), path);
  assert(
    rel && !rel.startsWith("..") && !isAbsolute(rel),
    "Footage review escapes immutable job output",
  );
  assert(
    digest(path) === f.reviewSha256,
    "Footage review hash identity changed",
  );
  const review = JSON.parse(readFileSync(path, "utf8"));
  assert(
    review.schemaVersion === 1 &&
      review.workflowMode === "real-footage-v1" &&
      review.projectId === snapshot.projectId,
    "Footage review project/schema identity mismatch",
  );
  for (const [key, snapshotKey] of [
    ["sourceVideoPath", "videoPath"],
    ["sourceSrtPath", "sourceSrtPath"],
  ]) {
    const expected = snapshot[snapshotKey];
    assert(
      expected && typeof review[key] === "string",
      "Footage source identity missing",
    );
    const input = (snapshot.inputs ?? []).find(
      (x) => x.path === expected || x.originalPath === expected,
    );
    const paths = [expected, input?.path, input?.originalPath]
      .filter(Boolean)
      .map((x) => resolve(x));
    assert(
      paths.includes(resolve(review[key])),
      "Footage source identity mismatch",
    );
  }
  assert(
    Array.isArray(review.sections) &&
      Array.isArray(review.candidates) &&
      Array.isArray(review.placements),
    "Footage review arrays missing",
  );
  const candidate = review.candidates.find((c) => c.id === f.candidateId);
  assert(candidate, "Footage candidate identity missing");
  assert(
    ["stock", "official-demo", "user", "public-reference"].includes(
      candidate.sourceKind,
    ),
    "Footage sourceKind is invalid",
  );
  const mediaKind =
    candidate.kind ??
    (/^\.(png|jpe?g|webp)$/i.test(extname(candidate.path ?? ""))
      ? "image"
      : "video");
  assert(
    ["image", "video"].includes(mediaKind),
    "Footage media kind is invalid",
  );
  assert(
    candidate.reuseStatus === "downloadable" &&
      candidate.technical?.passed === true &&
      candidate.technical?.decoded === true,
    "Footage candidate lacks download/decode evidence",
  );
  assert(
    candidate.width >= 720 &&
      candidate.height >= 720 &&
      Number.isFinite(candidate.durationSeconds) &&
      (mediaKind === "image"
        ? candidate.durationSeconds === 0
        : candidate.durationSeconds > 0),
    "Footage candidate quality evidence invalid",
  );
  assert(
    candidate.review?.sampled === true && candidate.review.frames?.length > 0,
    "Footage candidate lacks sampled review",
  );
  for (const frame of candidate.review.frames) {
    const value = typeof frame === "string" ? frame : frame?.path;
    assert(
      typeof value === "string" && existsSync(resolve(dirname(path), value)),
      "Footage sampled frame missing",
    );
    if (frame?.sha256)
      assert(
        digest(resolve(dirname(path), value)) === frame.sha256,
        "Footage sampled frame identity changed",
      );
  }
  assert(
    typeof candidate.technical.probePath === "string" &&
      existsSync(resolve(dirname(path), candidate.technical.probePath)),
    "Footage probe missing",
  );
  assert(
    typeof candidate.path === "string" &&
      typeof result.media?.path === "string" &&
      absolute(candidate.path, dirname(path)) ===
        absolute(result.media.path, outputDir),
    "Footage media path identity mismatch",
  );
  assert(
    candidate.sha256 === result.technical?.details?.sha256 &&
      digest(absolute(candidate.path, dirname(path))) === candidate.sha256,
    "Footage media hash identity changed",
  );
  assert(
    result.technical?.passed === true,
    "Footage technical verification missing",
  );
  const placement =
    f.placementId === null
      ? null
      : review.placements.find((p) => p.id === f.placementId);
  assert(
    f.placementId === null || placement,
    "Footage placement identity missing",
  );
  if (!placement) {
    assert(
      result.target === undefined &&
        result.media.sourceInSeconds === undefined &&
        result.media.sourceOutSeconds === undefined,
      "Footage library result cannot declare a target/trim",
    );
    return { review, candidate, placement: null };
  }
  assert(
    placement.candidateId === candidate.id &&
      review.sections.some((s) => s.id === placement.sectionId) &&
      ["cover", "contain"].includes(placement.layout),
    "Footage placement candidate/section/layout identity mismatch",
  );
  assert(
    Number.isInteger(placement.startFrame) &&
      placement.startFrame >= 0 &&
      Number.isInteger(placement.durationFrames) &&
      placement.durationFrames > 0 &&
      placement.startFrame + placement.durationFrames <=
        snapshot.document.canvas.durationFrames,
    "Footage target range exceeds canvas",
  );
  assert(
    same(result.target, {
      startFrame: placement.startFrame,
      durationFrames: placement.durationFrames,
    }) &&
      result.media.sourceInSeconds === placement.sourceInSeconds &&
      result.media.sourceOutSeconds === placement.sourceOutSeconds,
    "Footage target/trim identity mismatch",
  );
  const fps =
    snapshot.document.canvas.fps.num / snapshot.document.canvas.fps.den;
  if (mediaKind === "image") {
    assert(
      placement.sourceInSeconds === 0 && placement.sourceOutSeconds === 0,
      "Footage image source window must be zero",
    );
  } else {
    assert(
      Number.isFinite(placement.sourceInSeconds) &&
        placement.sourceInSeconds >= 0 &&
        Number.isFinite(placement.sourceOutSeconds) &&
        placement.sourceOutSeconds > placement.sourceInSeconds &&
        placement.sourceOutSeconds <= candidate.durationSeconds + 0.001 &&
        Math.abs(
          placement.sourceOutSeconds -
            placement.sourceInSeconds -
            placement.durationFrames / fps,
        ) <=
          1 / fps + 0.001,
      "Footage source duration/trim invalid",
    );
  }
  const section = review.sections.find((s) => s.id === placement.sectionId);
  const proofOnly =
    section.visualTargets?.length > 0 &&
    section.visualTargets.every((t) => t.evidenceRole === "proof");
  assert(
    candidate.sourceKind !== "stock" ||
      !(placement.evidenceRole === "proof" || proofOnly),
    "Footage stock cannot serve as proof evidence",
  );
  assert(
    Array.isArray(placement.sourceCueIds) &&
      placement.sourceCueIds.length > 0 &&
      placement.sourceCueIds.every((id) => section.sourceCueIds.includes(id)),
    "Footage source cue identity mismatch",
  );
  return { review, candidate, placement };
}
export function footageApplicationKey(result) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        result.technical?.details?.sha256,
        result.target ?? null,
        result.media?.sourceInSeconds ?? null,
        result.media?.sourceOutSeconds ?? null,
      ]),
    )
    .digest("hex");
}
export function footageMediaProps(canvas, meta, placement) {
  const sourceAspect = meta.width / meta.height,
    targetAspect = canvas.width / canvas.height;
  const crop =
    placement.layout === "cover"
      ? {
          x: (1 - Math.min(1, targetAspect / sourceAspect)) / 2,
          y: (1 - Math.min(1, sourceAspect / targetAspect)) / 2,
          width: Math.min(1, targetAspect / sourceAspect),
          height: Math.min(1, sourceAspect / targetAspect),
          sourceAspect,
        }
      : { x: 0, y: 0, width: 1, height: 1, sourceAspect };
  const props = {
    sourceMode: "media",
    media: {
      ...meta,
      hasAlpha: false,
      startSeconds: placement.sourceInSeconds,
    },
    x: 50,
    y: 50,
    radius: 0,
    borderWidth: 0,
    shadow: 0,
    entrance: "none",
    exit: "none",
    transitionSeconds: 0,
    crop,
    editorBackground: "original",
    ...(placement.layout === "contain"
      ? { sceneBackground: { type: "solid", color: "#111318" } }
      : {}),
  };
  props.size = pipFitSize(canvas.width, canvas.height, props);
  return props;
}
