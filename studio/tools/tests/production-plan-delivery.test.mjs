import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pipGeometry } from "../../templates/remotion-base/src/editor/source-pip.mjs";
import {
  createDocument,
  saveDocument,
  loadDocument,
} from "../lib/editor-store.mjs";
import { createProductionPlanService } from "../lib/production-plan-jobs.mjs";
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
async function fixture({
  transparent = false,
  alpha = false,
  startSeconds = 2,
  durationSeconds = 2,
  withSource = false,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "delivery-")),
    options = {
      root,
      rootDir: join(root, "index"),
      artifactRoot: join(root, "artifacts"),
      assetSourceRoot: root,
      autoStart: false,
    };
  mkdirSync(join(root, "templates/remotion-base/public"), { recursive: true });
  const file = join(root, alpha ? "独立动画.mov" : "独立动画.mp4");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    `color=c=${alpha ? "red@0.25" : "blue"}:s=320x180:r=10,format=rgba`,
    ...(withSource
      ? ["-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000"]
      : []),
    "-t",
    "2",
    ...(alpha
      ? ["-c:v", "qtrle", "-pix_fmt", "argb"]
      : ["-c:v", "libx264", "-pix_fmt", "yuv420p"]),
    file,
  ]);
  const manifest = join(root, "animation-delivery.json");
  writeFileSync(
    manifest,
    JSON.stringify({
      schemaVersion: 1,
      timeBase: "project",
      projectId: "p",
      files: [
        {
          file: "独立动画" + (alpha ? ".mov" : ".mp4"),
          startSeconds,
          durationSeconds,
          transparent,
        },
      ],
    }),
  );
  let d = createDocument({
    id: "p",
    name: "P",
    canvas: {
      width: 320,
      height: 180,
      fps: { num: 30, den: 1 },
      durationFrames: 300,
    },
    ...(withSource
      ? {
          source: {
            path: "独立动画.mp4",
            startFrame: 0,
            durationFrames: 60,
            volume: 0.7,
            muted: false,
            locked: true,
            clips: [
              { id: "a", startFrame: 0, durationFrames: 30, sourceInFrame: 0 },
              {
                id: "b",
                startFrame: 120,
                durationFrames: 30,
                sourceInFrame: 30,
              },
            ],
          },
          audioTracks: [
            { id: "sound", name: "原配乐", locked: true, disabled: false },
          ],
          audioClips: [
            {
              id: "sound1",
              name: "原配乐片段",
              path: "独立动画.mp4",
              trackId: "sound",
              startFrame: 0,
              durationFrames: 30,
              sourceDurationFrames: 60,
              sourceInFrame: 0,
              fadeInFrames: 0,
              fadeOutFrames: 0,
              volume: 0.3,
              muted: false,
            },
          ],
        }
      : {}),
    productionPlan: { shots: [] },
    instances: [
      {
        id: "manual",
        assetId: "source-pip",
        assetVersion: 1,
        startFrame: 0,
        durationFrames: 30,
        zIndex: 50,
        trackId: "locked",
        props: { size: 40 },
      },
    ],
    tracks: [{ id: "locked", name: "手调", locked: true, hidden: true }],
  });
  d = saveDocument(d, options);
  const service = createProductionPlanService(options);
  const makeJob = () =>
    service.createJob({
      projectId: "p",
      revision: service.read("p").document.revision,
      kind: "recognize",
      deliveryManifestPath: manifest,
    });
  const { job } = await makeJob();
  const resultFor = (job, id = "delivery1") => {
    const snapshot = JSON.parse(readFileSync(job.snapshotPath));
    const staged = JSON.parse(
      readFileSync(snapshot.deliveryManifestPath ?? manifest),
    );
    const entry = staged.files[0];
    return {
      id,
      jobId: job.id,
      projectId: "p",
      kind: "delivery",
      media: {
        path: entry.file,
        sourceInSeconds: 0,
        sourceOutSeconds: durationSeconds,
      },
      technical: {
        passed: true,
        details: {
          sha256: sha(
            entry.file.startsWith("/")
              ? entry.file
              : join(dirname(manifest), entry.file),
          ),
        },
      },
      target: {
        startFrame: Math.round(startSeconds * 30),
        durationFrames: Math.round(durationSeconds * 30),
      },
      delivery: {
        manifestPath: snapshot.deliveryManifestPath ?? manifest,
        manifestSha256: snapshot.deliveryManifestSha256 ?? sha(manifest),
        entryIndex: 0,
        startSeconds,
        durationSeconds,
        transparent,
        timeBase: "project",
      },
    };
  };
  return {
    root,
    options,
    service,
    job,
    manifest,
    file,
    makeJob,
    resultFor,
    result: resultFor(job),
    before: service.read("p").document,
  };
}
test("manifest deliveries auto append without plan shots and preserve existing locked hidden edits", async () => {
  const e = await fixture();
  const response = await e.service.ingest({
    projectId: "p",
    jobId: e.job.id,
    results: [e.result],
  });
  assert.equal(response.job.results[0].state, "applied");
  const d = response.document;
  assert.equal(d.instances.length, 2);
  assert.deepEqual(d.instances[0], e.before.instances[0]);
  assert.deepEqual(d.tracks[0], e.before.tracks[0]);
  assert.deepEqual(d.source, e.before.source);
  assert.deepEqual(d.productionPlan.shots, []);
  const added = d.instances[1];
  assert.equal(added.startFrame, 60);
  assert.equal(added.durationFrames, 60);
  assert.equal(added.assetId, "source-pip");
  const geometry = pipGeometry(d.canvas.width, d.canvas.height, added.durationFrames, 10, 30, added.props);
  assert.equal(geometry.width, d.canvas.width);
  assert.equal(geometry.height, d.canvas.height);
  assert.equal(added.props.entrance, "none");
  assert.equal(added.props.media.hasAlpha, false);
  assert.ok(added.zIndex > 50);
  assert.notEqual(added.trackId, "locked");
});
test("delivery manifest and entry identity are authoritative and immutable", async () => {
  for (const tamper of [
    (r) => r.delivery.startSeconds++,
    (r) => r.target.startFrame++,
    (r) => (r.delivery.manifestSha256 = "0".repeat(64)),
    (r) => (r.delivery.transparent = true),
    (r) => (r.delivery.entryIndex = 2),
    (r) => (r.media.sourceOutSeconds = 1),
  ]) {
    const e = await fixture();
    tamper(e.result);
    await assert.rejects(
      e.service.ingest({
        projectId: "p",
        jobId: e.job.id,
        results: [e.result],
      }),
      /delivery|manifest|entry|target|identity/i,
    );
    assert.equal(e.service.read("p").document.instances.length, 1);
  }
});
test("delivery never restores media deleted or ignored in another recognition job", async () => {
  const e = await fixture();
  await e.service.ingest({
    projectId: "p",
    jobId: e.job.id,
    results: [e.result],
  });
  let d = loadDocument("p", e.options);
  d.instances = d.instances.filter((i) => i.id === "manual");
  saveDocument(d, e.options);
  const { job } = await e.makeJob();
  const response = await e.service.ingest({
    projectId: "p",
    jobId: job.id,
    results: [e.resultFor(job, "delivery2")],
  });
  assert.equal(response.document.instances.length, 1);
  assert.equal(response.job.results[0].state, "ignored");
});
test("delivery rejects opaque media declared transparent and out-of-canvas timing", async () => {
  for (const config of [
    { transparent: true },
    { startSeconds: 9, durationSeconds: 2 },
    { durationSeconds: 3 },
  ]) {
    const e = await fixture(config);
    const response = await e.service.ingest({
      projectId: "p",
      jobId: e.job.id,
      results: [e.result],
    });
    assert.equal(response.document.instances.length, 1);
    assert.equal(response.job.results[0].state, "pending");
    assert.match(
      response.job.results[0].reason,
      /transparent|Alpha|range|duration|short|canvas/i,
    );
  }
});
test("transparent delivery works independently of any existing overlay slot", async () => {
  const e = await fixture({ transparent: true, alpha: true });
  const response = await e.service.ingest({
    projectId: "p",
    jobId: e.job.id,
    results: [e.result],
  });
  assert.equal(response.job.results[0].state, "applied");
  assert.equal(response.document.instances[1].props.media.hasAlpha, true);
});
test("changed current canvas or source invalidates delivery while plan edits do not", async () => {
  const e = await fixture();
  let d = loadDocument("p", e.options);
  d.canvas.durationFrames = 400;
  saveDocument(d, e.options);
  const response = await e.service.ingest({
    projectId: "p",
    jobId: e.job.id,
    results: [e.result],
  });
  assert.equal(response.job.results[0].state, "stale");
  assert.equal(response.document.instances.length, 1);
});
test("sibling manifest discovery archives all entries including explicit manifest-only jobs", async () => {
  const e = await fixture();
  const snap = JSON.parse(readFileSync(e.job.snapshotPath));
  assert.ok(snap.deliveryManifestPath);
  assert.equal(snap.mediaPaths.length, 1);
  assert.ok(snap.inputs.some((i) => i.path === snap.deliveryManifestPath));
  const { job } = await e.service.createJob({
    projectId: "p",
    revision: e.service.read("p").document.revision,
    kind: "recognize",
    mediaPaths: [e.file],
  });
  const discovered = JSON.parse(readFileSync(job.snapshotPath));
  assert.ok(discovered.deliveryManifestPath);
});
test("duplicate delivery jobs remain idempotent while the first instance remains live", async () => {
  const e = await fixture();
  await e.service.ingest({
    projectId: "p",
    jobId: e.job.id,
    results: [e.result],
  });
  for (let i = 2; i < 5; i++) {
    const { job } = await e.makeJob();
    const response = await e.service.ingest({
      projectId: "p",
      jobId: job.id,
      results: [e.resultFor(job, "delivery" + i)],
    });
    assert.equal(response.document.instances.length, 2);
    assert.equal(response.job.results[0].state, "applied");
  }
});
test("same file can appear at multiple independent manifest intervals", async () => {
  const e = await fixture();
  await e.service.ingest({projectId:"p",jobId:e.job.id,results:[e.result]});
  const manifest = JSON.parse(readFileSync(e.manifest));
  manifest.files.push({ ...manifest.files[0], startSeconds: 6 });
  writeFileSync(e.manifest, JSON.stringify(manifest));
  const { job } = await e.makeJob();
  const snap = JSON.parse(readFileSync(job.snapshotPath));
  const staged = JSON.parse(readFileSync(snap.deliveryManifestPath));
  assert.equal(staged.files[0].file, staged.files[1].file);
  const result = e.resultFor(job, "second");
  result.delivery.entryIndex = 1;
  result.delivery.startSeconds = 6;
  result.target.startFrame = 180;
  const response = await e.service.ingest({
    projectId: "p",
    jobId: job.id,
    results: [result],
  });
  assert.equal(response.document.instances[2].startFrame, 180);
  assert.equal(response.document.instances[1].trackId,response.document.instances[2].trackId);
  assert.equal(response.document.tracks.length,2);
  assert.deepEqual(response.document.tracks[0],e.before.tracks[0]);
});
test("cancelled delivery can be applied explicitly, and later ignored results never restore", async () => {
  const e = await fixture();
  e.service.cancel(e.job.id);
  await e.service.ingest({
    projectId: "p",
    jobId: e.job.id,
    results: [e.result],
  });
  assert.equal(e.service.read("p").document.instances.length, 1);
  const response = await e.service.applyResults({
    projectId: "p",
    revision: e.service.read("p").document.revision,
    operation: { type: "apply-results", resultIds: [e.result.id] },
  });
  assert.equal(response.document.instances.length, 2);
});
test("retry retains immutable manifest after original delivery files and manifest change", async () => {
  const e = await fixture();
  e.service.cancel(e.job.id);
  writeFileSync(e.file, "broken changed original");
  writeFileSync(e.manifest, "broken changed manifest");
  const retry = await e.service.retry(e.job.id);
  const result = e.resultFor(retry.job, "retry");
  const response = await e.service.ingest({
    projectId: "p",
    jobId: retry.job.id,
    results: [result],
  });
  assert.equal(response.job.results[0].state, "applied");
});
test("declared opaque media renders opaque even when encoded with an alpha channel", async () => {
  const e = await fixture({ alpha: true, transparent: false });
  const response = await e.service.ingest({
    projectId: "p",
    jobId: e.job.id,
    results: [e.result],
  });
  assert.equal(response.job.results[0].state, "applied");
  assert.equal(response.document.instances[1].props.media.hasAlpha, false);
});
test("explicit ignore suppresses a fresh equivalent manifest delivery without semantic review", async () => {
  const e = await fixture();
  e.service.cancel(e.job.id);
  await e.service.ingest({
    projectId: "p",
    jobId: e.job.id,
    results: [e.result],
  });
  e.service.action({
    projectId: "p",
    revision: e.service.read("p").document.revision,
    operation: { type: "ignore-results", resultIds: [e.result.id] },
  });
  const { job } = await e.makeJob();
  const response = await e.service.ingest({
    projectId: "p",
    jobId: job.id,
    results: [e.resultFor(job, "ignored-copy")],
  });
  assert.equal(response.job.results[0].state, "ignored");
  assert.equal(response.document.instances.length, 1);
});
test("real Python delivery worker consumes backend immutable manifest and auto-applies without a model", async () => {
  const e = await fixture({ withSource: true });
  execFileSync(
    "python3",
    [
      "../workflow/tools/editor_plan.py",
      "worker",
      "--snapshot",
      e.job.snapshotPath,
      "--output-dir",
      e.job.outputDir,
    ],
    {
      timeout: 60000,
      maxBuffer: 2 * 1024 * 1024,
      env: {
        ...process.env,
        CODEX_BIN: "/nonexistent-model",
        PRODUCTION_PLAN_API_BASE: "http://127.0.0.1:1",
      },
    },
  );
  const { readdirSync } = await import("node:fs");
  const files = readdirSync(join(e.job.outputDir, "results"));
  const results = files
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(e.job.outputDir, "results", f))));
  assert.equal(results.length, 1);
  assert.equal(results[0].kind, "delivery");
  assert.equal(results[0].contentReview, undefined);
  const response = await e.service.ingest({
    projectId: "p",
    jobId: e.job.id,
    results,
  });
  assert.equal(response.job.results[0].state, "applied");
  assert.equal(response.document.instances.length, 2);
  assert.deepEqual(response.document.instances[0], e.before.instances[0]);
  assert.deepEqual(response.document.tracks[0], e.before.tracks[0]);
  assert.deepEqual(response.document.source, e.before.source);
  assert.deepEqual(response.document.audioClips, e.before.audioClips);
  assert.deepEqual(response.document.audioTracks, e.before.audioTracks);
});
test("deleting a delivery updates old job rows and blocks explicit restoration durably", async () => {
  const e = await fixture();
  await e.service.ingest({
    projectId: "p",
    jobId: e.job.id,
    results: [e.result],
  });
  let d = loadDocument("p", e.options);
  d.instances = d.instances.filter((i) => i.id === "manual");
  saveDocument(d, e.options);
  assert.equal(e.service.read("p").jobs[0].results[0].state, "ignored");
  assert.ok(
    e.service
      .read("p")
      .document.productionPlan.dismissedResultIds.includes(e.result.id),
  );
  const applied = await e.service.applyResults({
    projectId: "p",
    revision: e.service.read("p").document.revision,
    operation: { type: "apply-results", resultIds: [e.result.id] },
  });
  assert.equal(applied.document.instances.length, 1);
});
test("manifest jobs never archive obsolete transcript or paired audio references", async () => {
  const e = await fixture({ withSource: true });
  let d = loadDocument("p", e.options);
  d.productionPlan.sourceSrtPath = join(
    e.root,
    "missing-shared-transcript.srt",
  );
  d.productionPlan.audioPath = join(e.root, "missing-paired-audio.wav");
  d.source.sourceSrtPath = join(e.root, "missing-source-transcript.srt");
  d = saveDocument(d, e.options);
  const { job } = await e.service.createJob({
    projectId: "p",
    revision: d.revision,
    kind: "recognize",
    deliveryManifestPath: e.manifest,
    sourceSrtPath: join(e.root, "missing-explicit.srt"),
    audioPath: join(e.root, "missing-explicit.wav"),
  });
  const snap = JSON.parse(readFileSync(job.snapshotPath));
  assert.equal(snap.sourceSrtPath, undefined);
  assert.equal(snap.audioPath, undefined);
  assert.ok(!snap.inputs.some((i) => /missing-/.test(i.path)));
  assert.ok(snap.videoPath);
  const response = await e.service.ingest({
    projectId: "p",
    jobId: job.id,
    results: [e.resultFor(job, "no-asr")],
  });
  assert.equal(response.job.results[0].state, "applied");
  assert.deepEqual(response.document.source, d.source);
});
test("sibling manifest discovery clears stale shot slot and scope selectors before any old gate", async () => {
  const e = await fixture({ withSource: true });
  let d = loadDocument("p", e.options);
  d.productionPlan.shots = [
    {
      id: "old",
      title: "旧取消段",
      cancelled: true,
      slots: [],
      timing: { status: "unaligned", ranges: [] },
    },
  ];
  d = saveDocument(d, e.options);
  const { job } = await e.service.createJob({
    projectId: "p",
    revision: d.revision,
    kind: "recognize",
    mediaPaths: [e.file],
    shotId: "nonexistent-old",
    slotId: "old-slot",
    instanceId: "old-instance",
    rangeId: "old-range",
    candidateId: "old-candidate",
    scope: { camera: true, sound: true },
  });
  const snap = JSON.parse(readFileSync(job.snapshotPath));
  for (const key of [
    "shotId",
    "slotId",
    "instanceId",
    "rangeId",
    "candidateId",
    "target",
  ])
    assert.equal(snap[key], undefined);
  assert.deepEqual(snap.scope, { camera: false, sound: false });
  assert.deepEqual(snap.document.productionPlan.shots, d.productionPlan.shots);
  execFileSync(
    "python3",
    [
      "../workflow/tools/editor_plan.py",
      "worker",
      "--snapshot",
      job.snapshotPath,
      "--output-dir",
      job.outputDir,
    ],
    {
      timeout: 60000,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, CODEX_BIN: "/nonexistent-model" },
    },
  );
  const { readdirSync } = await import("node:fs");
  const results = readdirSync(join(job.outputDir, "results"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(job.outputDir, "results", f))));
  assert.equal(results.length, 1);
  assert.equal(results[0].kind, "delivery");
  const response = await e.service.ingest({
    projectId: "p",
    jobId: job.id,
    results,
  });
  assert.equal(response.job.results[0].state, "applied");
});
