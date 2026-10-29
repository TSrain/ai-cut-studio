import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createDocument,
  saveDocument,
  loadDocument,
} from "../lib/editor-store.mjs";
import { createProductionPlanService } from "../lib/production-plan-jobs.mjs";
const digest = (p) =>
  createHash("sha256").update(readFileSync(p)).digest("hex");
async function setup({
  mode = "immersive",
  kind = "png",
  passed = false,
  technicalPassed = true,
  frameHash = true,
  opaqueImage = false,
  autoApply = true,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "manual-media-")),
    options = {
      root,
      rootDir: join(root, "index"),
      artifactRoot: join(root, "artifacts"),
      assetSourceRoot: root,
      autoStart: false,
    };
  mkdirSync(join(root, "templates/remotion-base/public"), { recursive: true });
  const path = join(root, `material.${kind}`),
    frame = join(root, "frame.png");
  const extra =
    kind === "png"
      ? ["-frames:v", "1", "-pix_fmt", "rgba"]
      : kind === "mov"
        ? ["-t", "2", "-c:v", "qtrle", "-pix_fmt", "argb"]
        : ["-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p"];
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    `color=c=${kind === "mp4" || opaqueImage ? "blue" : "red@0.25"}:s=160x90:r=10,format=rgba`,
    ...extra,
    path,
  ]);
  execFileSync("ffmpeg", ["-v", "error", "-i", path, "-frames:v", "1", frame]);
  const document = saveDocument(
      createDocument({
        id: "p",
        name: "P",
        canvas: {
          width: 1920,
          height: 1080,
          fps: { num: 30, den: 1 },
          durationFrames: 300,
        },
        productionPlan: {
          approval: "approved",
          shots: [
            {
              id: "s",
              title: "演示",
              approval: "approved",
              slots: [
                {
                  id: "slot",
                  type: kind === "png" ? "image" : "video",
                  description: "示意",
                  presentationMode: mode,
                },
              ],
              timing: {
                status: "manual",
                manual: true,
                ranges: [{ id: "r", startFrame: 0, durationFrames: 30 }],
              },
            },
          ],
        },
      }),
      options,
    ),
    service = createProductionPlanService(options);
  const { job } = await service.createJob({
    projectId: "p",
    revision: document.revision,
    kind: "recognize",
    shotId: "s",
    slotId: "slot",
  });
  const result = {
    id: "r1",
    projectId: "p",
    jobId: job.id,
    kind: "match",
    shotId: "s",
    slotId: "slot",
    requirementVersion: 1,
    media: { path, sourceInSeconds: 0 },
    technical: { passed: technicalPassed, details: { sha256: digest(path) } },
    contentReview: {
      passed,
      uncertainties: ["主体含义待人工判断"],
      evidence: "sampled frame",
      frames: [
        { path: frame, ...(frameHash ? { sha256: digest(frame) } : {}) },
      ],
    },
  };
  if (!autoApply) service.cancel(job.id);
  await service.ingest({ projectId: "p", jobId: job.id, results: [result] });
  const confirmation = {
    confirmed: true,
    mediaSha256: result.technical.details.sha256,
    requirementVersion: 1,
    shotId: "s",
    slotId: "slot",
  };
  const request = () => ({
    projectId: "p",
    revision: service.read("p").document.revision,
    operation: {
      type: "apply-results",
      resultIds: [result.id],
      overrides: {
        [result.id]: {
          shotId: "s",
          slotId: "slot",
          contentConfirmation: confirmation,
        },
      },
    },
  });
  return { service, options, job, result, path, frame, confirmation, request };
}
test("pending semantics requires explicit content confirmation and records it without changing AI review", async () => {
  const e = await setup();
  const request = e.request();
  delete request.operation.overrides.r1.contentConfirmation;
  await assert.rejects(
    () => e.service.applyResults(request),
    /evidence|confirmation/i,
  );
  const { document } = await e.service.applyResults(e.request());
  assert.equal(document.instances.length, 1);
  const confirmation =
    document.productionPlan.shots[0].bindings[0].contentConfirmation;
  assert.equal(confirmation.confirmed, true);
  assert.equal(confirmation.source, "user");
  assert.equal(confirmation.mediaSha256, e.confirmation.mediaSha256);
  const stored = e.service.read("p").jobs[0].results[0];
  assert.deepEqual(stored.contentReview, e.result.contentReview);
  assert.equal(stored.contentConfirmation.source, "user");
});
test("manual confirmation rejects stale media identity and current requirement versions", async () => {
  const e = await setup();
  e.confirmation.mediaSha256 = "0".repeat(64);
  await assert.rejects(
    () => e.service.applyResults(e.request()),
    /hash|identity/i,
  );
  e.confirmation.mediaSha256 = e.result.technical.details.sha256;
  let d = loadDocument("p", e.options);
  d.productionPlan.shots[0].requirementVersion = 2;
  saveDocument(d, e.options);
  await assert.rejects(
    () => e.service.applyResults(e.request()),
    /requirement/i,
  );
  assert.equal(e.service.read("p").document.instances.length, 0);
});
test("manual confirmation is bound to the selected target and explicit action", async () => {
  const e = await setup();
  for (const change of [
    { confirmed: false },
    { shotId: "other" },
    { slotId: "other" },
  ]) {
    const request = e.request();
    request.operation.overrides.r1.contentConfirmation = {
      ...e.confirmation,
      ...change,
    };
    await assert.rejects(
      e.service.applyResults(request),
      /confirmation|target/i,
    );
  }
  assert.equal(e.service.read("p").document.instances.length, 0);
});
test("overlay gate follows the current slot and falls back to the shot", async () => {
  const e = await setup({ kind: "mp4", passed: true, autoApply: false });
  let document = loadDocument("p", e.options);
  document.productionPlan.shots[0].presentationMode = "overlay";
  delete document.productionPlan.shots[0].slots[0].presentationMode;
  saveDocument(document, e.options);
  const request = () => {
    const value = e.request();
    delete value.operation.overrides.r1.contentConfirmation;
    return value;
  };
  await assert.rejects(
    e.service.applyResults(request()),
    /overlay|transparent/i,
  );
  document = loadDocument("p", e.options);
  document.productionPlan.shots[0].slots[0].presentationMode = "immersive";
  saveDocument(document, e.options);
  const applied = await e.service.applyResults(request());
  assert.equal(applied.document.instances.length, 1);
});
test("manual confirmation cannot bypass changed media bytes or frame evidence hashes", async () => {
  const e = await setup();
  writeFileSync(e.frame, "changed frame");
  await assert.rejects(() => e.service.applyResults(e.request()), /evidence/i);
  const f = await setup();
  writeFileSync(f.path, "broken file");
  await assert.rejects(
    () => f.service.applyResults(f.request()),
    /hash|verification/i,
  );
});
for (const passed of [false, true])
  test(`opaque overlay media is refused even when ${passed ? "AI passes" : "user confirms"}`, async () => {
    const e = await setup({ mode: "overlay", kind: "mp4", passed });
    const request = e.request();
    if (passed) delete request.operation.overrides.r1.contentConfirmation;
    await assert.rejects(
      () => e.service.applyResults(request),
      /overlay|transparent|透明/i,
    );
    assert.equal(e.service.read("p").document.instances.length, 0);
  });
for (const kind of ["png", "mov"])
  test(`actual alpha ${kind} can be manually confirmed for overlay`, async () => {
    const e = await setup({ mode: "overlay", kind });
    const { document } = await e.service.applyResults(e.request());
    assert.equal(document.instances[0].props.media.hasAlpha, true);
    assert.equal(
      document.productionPlan.shots[0].bindings[0].contentConfirmation
        .confirmed,
      true,
    );
  });

test("explicit semantic confirmation never bypasses failed technical review or unhashed evidence", async () => {
  for (const options of [{ technicalPassed: false }, { frameHash: false }]) {
    const e = await setup(options);
    await assert.rejects(
      () => e.service.applyResults(e.request()),
      /evidence/i,
    );
    assert.equal(e.service.read("p").document.instances.length, 0);
  }
});
test("an opaque RGBA image is not transparent overlay material", async () => {
  const e = await setup({ mode: "overlay", opaqueImage: true });
  await assert.rejects(
    () => e.service.applyResults(e.request()),
    /overlay|transparent|透明/i,
  );
});
test("manual adoption preserves true duration and deduplicates equivalent occupied-slot results", async () => {
  const e = await setup({ kind: "mp4" }),
    short = e.request();
  short.operation.overrides.r1.sourceOutSeconds = 3;
  await assert.rejects(() => e.service.applyResults(short), /too short/i);
  await e.service.applyResults(e.request());
  const d = e.service.read("p").document,
    { job } = await e.service.createJob({
      projectId: "p",
      revision: d.revision,
      kind: "recognize",
      shotId: "s",
      slotId: "slot",
    });
  const second = { ...e.result, id: "r2", jobId: job.id };
  await e.service.ingest({ projectId: "p", jobId: job.id, results: [second] });
  const request = {
    projectId: "p",
    revision: e.service.read("p").document.revision,
    operation: {
      type: "apply-results",
      resultIds: ["r2"],
      overrides: {
        r2: {
          shotId: "s",
          slotId: "slot",
          contentConfirmation: e.confirmation,
        },
      },
    },
  };
  await e.service.applyResults(request);
  assert.equal(e.service.read("p").document.instances.length, 1);
});
