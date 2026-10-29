import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDocument,
  saveDocument,
  loadDocument,
} from "../lib/editor-store.mjs";
const mod = await import("../lib/production-plan-jobs.mjs").catch(() => ({}));
function setup() {
  const root = mkdtempSync(join(tmpdir(), "plan-jobs-")),
    options = {
      root,
      rootDir: join(root, "index"),
      artifactRoot: join(root, "artifacts"),
      assetSourceRoot: root,
      autoStart: false,
    };
  mkdirSync(join(root, "templates/remotion-base/public"), { recursive: true });
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
            visualRequirement: "展现",
            slots: [{ id: "v", type: "video", description: "素材" }],
            timing: {
              manual: true,
              status: "manual",
              ranges: [{ id: "r", startFrame: 30, durationFrames: 60 }],
            },
          },
        ],
      },
    }),
    options,
  );
  return {
    options,
    document,
    service: mod.createProductionPlanService?.(options),
  };
}
test("durable service exists", () =>
  assert.equal(typeof mod.createProductionPlanService, "function"));
test("job snapshots exact revision and range, survives a new service", async () => {
  const { service, document, options } = setup();
  const { job } = await service.createJob({
    projectId: "p",
    revision: document.revision,
    kind: "broll",
    shotId: "s",
  });
  assert.equal(job.status, "queued");
  const snapshot = JSON.parse(readFileSync(job.snapshotPath));
  assert.equal(snapshot.target.durationFrames, 60);
  assert.equal(snapshot.document.revision, document.revision);
  const reloaded = mod.createProductionPlanService(options);
  assert.equal(reloaded.read("p").jobs[0].id, job.id);
  assert.throws(
    () =>
      service.action({
        projectId: "p",
        revision: 0,
        operation: { type: "hover", enabled: false },
      }),
    /Revision conflict/,
  );
});
test("same field conflict preserved, unrelated edit merges", () => {
  const { service, document } = setup();
  service.action({
    projectId: "p",
    revision: document.revision,
    operation: {
      type: "edit-shot",
      shotId: "s",
      patch: { visualRequirement: "A" },
      base: { visualRequirement: "展现" },
    },
  });
  const other = service.action({
    projectId: "p",
    revision: document.revision,
    operation: {
      type: "edit-shot",
      shotId: "s",
      patch: { mediaDescription: "B" },
      base: { mediaDescription: "" },
    },
  });
  assert.equal(other.document.productionPlan.shots[0].mediaDescription, "B");
  const conflict = service.action({
    projectId: "p",
    revision: document.revision,
    operation: {
      type: "edit-shot",
      shotId: "s",
      patch: { visualRequirement: "C" },
      base: { visualRequirement: "展现" },
    },
  });
  assert.equal(conflict.conflicts.length, 1);
  assert.equal(
    conflict.document.productionPlan.shots[0].visualRequirement,
    "A",
  );
});
test("candidate ingestion is progressive, idempotent, read state persists", async () => {
  const { service, document } = setup();
  const { job } = await service.createJob({
    projectId: "p",
    revision: document.revision,
    kind: "broll",
    shotId: "s",
  });
  const result = {
    id: "c1",
    jobId: job.id,
    projectId: "p",
    shotId: "s",
    slotId: "v",
    kind: "candidate",
    requirementVersion: 1,
    candidate: {
      id: "c",
      slotId: "v",
      url: "https://example.org/v",
      title: "候选",
      reason: "r",
    },
  };
  await service.ingest({ projectId: "p", jobId: job.id, results: [result] });
  let read = service.read("p");
  assert.equal(read.document.productionPlan.shots[0].candidates.length, 1);
  service.action({
    projectId: "p",
    revision: read.document.revision,
    operation: { type: "read-candidates", shotId: "s", candidateIds: ["c"] },
  });
  await service.ingest({ projectId: "p", jobId: job.id, results: [result] });
  read = service.read("p");
  assert.equal(read.document.productionPlan.shots[0].candidates.length, 1);
  assert.ok(read.document.productionPlan.shots[0].candidates[0].readAt);
  await assert.rejects(
    () =>
      service.ingest({ projectId: "wrong", jobId: job.id, results: [result] }),
    /project/i,
  );
});
test("related edit makes result stale, name revision does not", async () => {
  const { service, document, options } = setup();
  const { job } = await service.createJob({
    projectId: "p",
    revision: document.revision,
    kind: "broll",
    shotId: "s",
  });
  const make = (id) => ({
    id,
    jobId: job.id,
    projectId: "p",
    shotId: "s",
    slotId: "v",
    kind: "candidate",
    requirementVersion: 1,
    candidate: {
      id,
      slotId: "v",
      url: `https://example.org/${id}`,
      title: "t",
      reason: "r",
    },
  });
  saveDocument({ ...loadDocument("p", options), name: "renamed" }, options);
  await service.ingest({
    projectId: "p",
    jobId: job.id,
    results: [make("one")],
  });
  assert.equal(service.read("p").jobs[0].results[0].state, "applied");
  let current = service.read("p").document;
  service.action({
    projectId: "p",
    revision: current.revision,
    operation: {
      type: "edit-shot",
      shotId: "s",
      patch: { visualRequirement: "changed" },
    },
  });
  await service.ingest({
    projectId: "p",
    jobId: job.id,
    results: [make("two")],
  });
  assert.equal(
    service.read("p").jobs[0].results.find((r) => r.id === "two").state,
    "stale",
  );
});
test("queued cancel is durable, retry uses resume output and new snapshot", async () => {
  const { service, document } = setup();
  const { job } = await service.createJob({
    projectId: "p",
    revision: document.revision,
    kind: "broll",
  });
  assert.equal(service.cancel(job.id).status, "cancelled");
  const retry = await service.retry(job.id);
  assert.notEqual(retry.job.id, job.id);
  assert.equal(
    JSON.parse(readFileSync(retry.job.snapshotPath)).resumeJobId,
    job.id,
  );
});
test("multiple shot ranges require explicit target and single shot excludes full camera/sound", async () => {
  const { service, document, options } = setup();
  const d = loadDocument("p", options);
  d.productionPlan.shots[0].timing.ranges.push({
    id: "r2",
    startFrame: 120,
    durationFrames: 30,
  });
  const saved = saveDocument(d, options);
  await assert.rejects(
    () =>
      service.createJob({
        projectId: "p",
        revision: saved.revision,
        kind: "broll",
        shotId: "s",
      }),
    /target|目标/,
  );
  await assert.rejects(
    () =>
      service.createJob({
        projectId: "p",
        revision: saved.revision,
        kind: "broll",
        shotId: "s",
        rangeId: "r",
        scope: { camera: true, sound: false },
      }),
    /scope|单镜/,
  );
});

test("real verified media applies once and full undo cannot resurrect it", async () => {
  const { service, document, options } = setup();
  const { execFileSync } = await import("node:child_process");
  const source = join(options.root, "video.mp4"),
    frame = join(options.root, "evidence.png");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=1280x720:r=30",
    "-t",
    "3",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    source,
  ]);
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-i",
    source,
    "-frames:v",
    "1",
    frame,
  ]);
  const { job } = await service.createJob({
    projectId: "p",
    revision: document.revision,
    kind: "recognize",
    shotId: "s",
    slotId: "v",
    mediaPaths: [source],
  });
  const result = {
    id: "verified",
    jobId: job.id,
    projectId: "p",
    shotId: "s",
    slotId: "v",
    kind: "match",
    requirementVersion: 1,
    media: { path: source, sourceInSeconds: 0, sourceOutSeconds: 2 },
    technical: { passed: true },
    contentReview: {
      passed: true,
      evidence: "实际帧符合要求",
      frames: [{ path: frame }],
    },
  };
  await service.ingest({ projectId: "p", jobId: job.id, results: [result] });
  let current = service.read("p").document;
  assert.equal(current.instances.length, 1);
  const applied = await service.applyResults({
    projectId: "p",
    revision: current.revision,
    operation: { type: "apply-results", resultIds: ["verified"] },
  });
  assert.equal(applied.document.instances.length, 1);
  assert.equal(applied.document.instances[0].startFrame, 30);
  await service.applyResults({
    projectId: "p",
    revision: applied.document.revision,
    operation: { type: "apply-results", resultIds: ["verified"] },
  });
  assert.equal(service.read("p").document.instances.length, 1);
  current = service.read("p").document;
  saveDocument(
    {
      ...document,
      revision: current.revision,
      projectBinding: current.projectBinding,
    },
    options,
  );
  await service.ingest({ projectId: "p", jobId: job.id, results: [result] });
  assert.equal(service.read("p").document.instances.length, 0);
  assert.ok(
    service
      .read("p")
      .document.productionPlan.dismissedResultIds.includes(result.id),
  );
});

test("worker process cancellation waits for process exit, and interrupted jobs recover", async () => {
  const { document, options } = setup();
  const worker = join(options.root, "worker.py");
  writeFileSync(worker, `import time\ntime.sleep(20)\n`);
  const service = mod.createProductionPlanService({
    ...options,
    autoStart: true,
    contentRoot: options.root,
    workerPath: worker,
    pollMs: 20,
  });
  const { job } = await service.createJob({
    projectId: "p",
    revision: document.revision,
    kind: "broll",
  });
  for (let i = 0; i < 100 && service.getJob(job.id).status === "queued"; i++)
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(service.getJob(job.id).status, "running");
  assert.equal(service.cancel(job.id).status, "cancelling");
  for (
    let i = 0;
    i < 100 && service.getJob(job.id).status === "cancelling";
    i++
  )
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(service.getJob(job.id).status, "cancelled");
  service.close();
  const retry = await service.retry(job.id);
  const path = join(retry.job.snapshotPath, "..", "job.json");
  let interrupted = JSON.parse(readFileSync(path));
  interrupted.status = "running";
  interrupted.pid = 99999999;
  writeFileSync(path, JSON.stringify(interrupted));
  const fresh = mod.createProductionPlanService(options);
  await fresh.recover();
  assert.equal(fresh.getJob(retry.job.id).status, "interrupted");
  fresh.close();
});

test("batch apply fails as one transaction when a later selection is invalid", async () => {
  const { service, document, options } = setup();
  const { execFileSync } = await import("node:child_process");
  const source = join(options.root, "batch.png");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=100x100",
    "-frames:v",
    "1",
    source,
  ]);
  const { job } = await service.createJob({
    projectId: "p",
    revision: document.revision,
    kind: "recognize",
  });
  service.cancel(job.id); // Keep explicit batch transaction coverage independent of auto append.
  const result = {
    id: "batch-valid",
    jobId: job.id,
    projectId: "p",
    shotId: "s",
    slotId: "v",
    kind: "match",
    media: { path: source, sourceInSeconds: 0 },
    technical: { passed: true },
    contentReview: { passed: true, frames: [source] },
  };
  await service.ingest({ projectId: "p", jobId: job.id, results: [result] });
  const current = service.read("p").document;
  await assert.rejects(() =>
    service.applyResults({
      projectId: "p",
      revision: current.revision,
      operation: { type: "apply-results", resultIds: [result.id, "missing"] },
    }),
  );
  assert.equal(service.read("p").document.instances.length, 0);
  assert.equal(service.read("p").document.revision, current.revision);
});

test("candidate content dependency survives moving the target", async () => {
  const { service, document } = setup();
  const { job } = await service.createJob({
    projectId: "p",
    revision: document.revision,
    kind: "broll",
    shotId: "s",
  });
  const moved = service.action({
    projectId: "p",
    revision: document.revision,
    operation: {
      type: "move-shot",
      shotId: "s",
      ranges: [{ id: "r", startFrame: 150, durationFrames: 60 }],
    },
  });
  await service.ingest({
    projectId: "p",
    jobId: job.id,
    results: [
      {
        id: "candidate-after-move",
        jobId: job.id,
        projectId: "p",
        shotId: "s",
        slotId: "v",
        kind: "candidate",
        requirementVersion: 1,
        candidate: {
          id: "cm",
          slotId: "v",
          title: "t",
          url: "https://example.org/v",
          reason: "r",
        },
      },
    ],
  });
  assert.equal(service.read("p").jobs[0].results[0].state, "applied");
});

for (const separateProcess of [false, true])
  test(`cancellation by another ${separateProcess ? "process" : "service"} during media preparation prevents automatic commit`, async () => {
    const { service, options } = setup();
    const { execFileSync } = await import("node:child_process");
    const source = join(options.root, "cancel.png");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=1280x720",
      "-frames:v",
      "1",
      source,
    ]);
    let d = loadDocument("p", options);
    d.productionPlan.shots[0].timing.manual = false;
    d.productionPlan.shots[0].timing.status = "aligned";
    d = saveDocument(d, options);
    const { job } = await service.createJob({
      projectId: "p",
      revision: d.revision,
      kind: "broll",
      shotId: "s",
      slotId: "v",
    });
    const result = {
      id: "cancel-race",
      jobId: job.id,
      projectId: "p",
      shotId: "s",
      slotId: "v",
      kind: "media",
      requirementVersion: 1,
      media: { path: source, sourceInSeconds: 0 },
      technical: { passed: true },
      contentReview: {
        passed: true,
        evidence: "actual image",
        frames: [{ path: source }],
      },
    };
    const other = mod.createProductionPlanService(options);
    const pending = service.ingest({
      projectId: "p",
      jobId: job.id,
      results: [result],
    });
    await Promise.resolve();
    await Promise.resolve();
    const cancelled = separateProcess
      ? execFileSync(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            `import {createProductionPlanService} from ${JSON.stringify(new URL("../lib/production-plan-jobs.mjs", import.meta.url).href)};const service=createProductionPlanService(${JSON.stringify(options)});process.stdout.write(service.cancel(${JSON.stringify(job.id)}).status);`,
          ],
          { encoding: "utf8" },
        )
      : other.cancel(job.id).status;
    assert.equal(cancelled, "cancelled");
    await pending;
    const read = service.read("p");
    assert.equal(read.jobs[0].status, "cancelled");
    assert.equal(read.document.instances.length, 0);
    assert.equal(read.jobs[0].results.length, 1);
    assert.notEqual(read.jobs[0].results[0].state, "applied");
  });

test("input hashing yields to requests and deduplicates resolved source paths", async () => {
  const { service, options } = setup();
  const { createHash } = await import("node:crypto");
  const source = join(options.root, "large-source.mp4"),
    bytes = Buffer.alloc(8 * 1024 * 1024, 7);
  writeFileSync(source, bytes);
  let d = loadDocument("p", options);
  d.source = { path: "large-source.mp4", startFrame: 0 };
  d = saveDocument(d, options);
  let responsive = false;
  setImmediate(() => {
    responsive = true;
  });
  const { job } = await service.createJob({
    projectId: "p",
    revision: d.revision,
    kind: "align",
    mediaPaths: ["large-source.mp4", source],
  });
  assert.equal(responsive, true, "hashing must yield the event loop");
  const snapshot = JSON.parse(readFileSync(job.snapshotPath));
  assert.equal(snapshot.inputs.length, 1);
  assert.equal(
    snapshot.inputs[0].sha256,
    createHash("sha256").update(bytes).digest("hex"),
  );
  assert.equal(snapshot.videoPath, source);
});

async function alignmentSetup({
  manual = false,
  effect = false,
  bound = false,
} = {}) {
  const env = setup(),
    { service, options } = env;
  writeFileSync(join(options.root, "talk.mp4"), "source identity");
  let d = loadDocument("p", options);
  d.source = { path: "talk.mp4", startFrame: 0 };
  d.productionPlan.shots[0].timing = {
    status: manual ? "manual" : "unaligned",
    manual,
    ranges: manual
      ? [{ id: "manual", startFrame: 180, durationFrames: 30 }]
      : [],
  };
  if (effect) {
    const shot = d.productionPlan.shots[0];
    shot.effectTiming = {
      status: "draft",
      sourcePath: "talk.mp4",
      startSeconds: 1.5,
      changeSeconds: 1.7,
      holdSeconds: 2.2,
      endSeconds: 2.5,
      evidence: {
        sourceSha256: "a".repeat(64),
        transcriptHash: "b".repeat(64),
        sourceCueIds: [1],
        reason: "short emphasis",
      },
    };
    shot.timing = {
      status: "review",
      manual: false,
      ranges: [{ id: "effect", startFrame: 45, durationFrames: 30 }],
    };
    if (bound) {
      d.instances = [
        {
          id: "actual",
          assetId: "number-beat",
          assetVersion: 1,
          startFrame: 45,
          durationFrames: 30,
          zIndex: 1,
          props: {},
        },
      ];
      shot.bindings = [
        {
          id: "binding",
          slotId: "v",
          instanceId: "actual",
          status: "current",
          requirementVersion: 1,
        },
      ];
    }
  }
  d = saveDocument(d, options);
  const { job } = await service.createJob({
    projectId: "p",
    revision: d.revision,
    kind: "align",
  });
  const result = {
    id: "aligned-result",
    jobId: job.id,
    projectId: "p",
    shotId: "s",
    kind: "alignment",
    requirementVersion: 1,
    alignment: {
      anchor: {
        sourcePath: join(options.root, "talk.mp4"),
        startSeconds: 1,
        endSeconds: 3,
        confidence: 1,
      },
      timing: {
        status: "aligned",
        manual: false,
        ranges: [{ id: "suggested", startFrame: 30, durationFrames: 60 }],
      },
      suggestedRanges: [
        { id: "suggested", startFrame: 30, durationFrames: 60 },
      ],
      contentReview: {
        shotId: "s",
        critical: false,
        actualNarration: "actual text",
        reason: "matches",
      },
    },
  };
  return { ...env, job, result };
}
test("worker nested alignment normalizes absolute source and automatically maps reliable timing", async () => {
  const { service, job, result } = await alignmentSetup();
  const { document } = await service.ingest({
    projectId: "p",
    jobId: job.id,
    results: [result],
  });
  assert.equal(document.productionPlan.shots[0].anchor?.sourcePath, "talk.mp4");
  assert.equal(
    document.productionPlan.shots[0].timing.ranges[0].startFrame,
    30,
  );
  assert.ok(document.productionPlan.appliedResultIds.includes(result.id));
});
test("critical alignment waits for explicit interpretation and preserves approved content", async () => {
  const { service, job, result } = await alignmentSetup();
  result.alignment.contentReview.critical = true;
  result.alignment.timing = { status: "review", manual: false, ranges: [] };
  let { document } = await service.ingest({
    projectId: "p",
    jobId: job.id,
    results: [result],
  });
  assert.equal(document.productionPlan.shots[0].timing.ranges.length, 0);
  await assert.rejects(
    () =>
      service.applyResults({
        projectId: "p",
        revision: document.revision,
        operation: { type: "apply-results", resultIds: [result.id] },
      }),
    /interpretation/,
  );
  const before = document.productionPlan.shots[0];
  ({ document } = await service.applyResults({
    projectId: "p",
    revision: document.revision,
    operation: {
      type: "apply-results",
      resultIds: [result.id],
      overrides: {
        [result.id]: {
          alignmentChoice: "suggested",
          interpretation: "spoken_slip",
        },
      },
    },
  }));
  const shot = document.productionPlan.shots[0];
  assert.equal(shot.timing.ranges[0].startFrame, 30);
  for (const key of [
    "narration",
    "visualRequirement",
    "requirementVersion",
    "approval",
  ])
    assert.equal(shot[key], before[key]);
  assert.equal(shot.alignmentDecision.interpretation, "spoken_slip");
});
test("alignment keeps manual timing until explicit replacement and rejects empty low confidence results", async () => {
  const { service, job, result } = await alignmentSetup({ manual: true });
  let { document } = await service.ingest({
    projectId: "p",
    jobId: job.id,
    results: [result],
  });
  assert.equal(
    document.productionPlan.shots[0].timing.ranges[0].startFrame,
    180,
  );
  const request = {
    projectId: "p",
    revision: document.revision,
    operation: {
      type: "apply-results",
      resultIds: [result.id],
      overrides: { [result.id]: { alignmentChoice: "suggested" } },
    },
  };
  await assert.rejects(
    () => service.applyResults(request),
    /replaceManualTiming/,
  );
  request.operation.overrides[result.id].replaceManualTiming = true;
  ({ document } = await service.applyResults(request));
  assert.equal(
    document.productionPlan.shots[0].timing.ranges[0].startFrame,
    30,
  );
  const second = await alignmentSetup();
  second.result.alignment.anchor.confidence = 0.1;
  second.result.alignment.suggestedRanges = [];
  second.result.alignment.timing = {
    status: "review",
    manual: false,
    ranges: [],
  };
  const read = await second.service.ingest({
    projectId: "p",
    jobId: second.job.id,
    results: [second.result],
  });
  assert.equal(read.document.productionPlan.shots[0].timing.ranges.length, 0);
  await assert.rejects(
    () =>
      second.service.applyResults({
        projectId: "p",
        revision: read.document.revision,
        operation: { type: "apply-results", resultIds: [second.result.id] },
      }),
    /suggested ranges/,
  );
});

test("cancelled plan output stays pending and can be explicitly merged later", async () => {
  const { service, document } = setup();
  const { job } = await service.createJob({
    projectId: "p",
    revision: document.revision,
    kind: "package",
  });
  service.cancel(job.id);
  const plan = structuredClone(document.productionPlan);
  plan.script = "incoming script";
  const result = {
    id: "cancelled-plan",
    kind: "plan",
    jobId: job.id,
    projectId: "p",
    plan,
  };
  let { document: next } = await service.ingest({
    projectId: "p",
    jobId: job.id,
    results: [result],
  });
  assert.equal(next.productionPlan.script, document.productionPlan.script);
  ({ document: next } = await service.applyResults({
    projectId: "p",
    revision: next.revision,
    operation: { type: "apply-results", resultIds: [result.id] },
  }));
  assert.equal(next.productionPlan.script, "incoming script");
});

test("intended narration change updates effective text and invalidates design approval", async () => {
  const { service, job, result, options } = await alignmentSetup();
  // The user approves the current design while alignment is still running.
  let d = loadDocument("p", options);
  d.productionPlan.shots[0].narration = "planned text";
  d.productionPlan.script = "intro planned text ending";
  d = saveDocument(d, options);
  const { job: reviewJob } = await service.createJob({
    projectId: "p",
    revision: d.revision,
    kind: "align",
  });
  result.jobId = reviewJob.id;
  result.alignment.contentReview.critical = true;
  result.alignment.timing = { status: "review", manual: false, ranges: [] };
  let { document } = await service.ingest({
    projectId: "p",
    jobId: reviewJob.id,
    results: [result],
  });
  ({ document } = await service.applyResults({
    projectId: "p",
    revision: document.revision,
    operation: {
      type: "apply-results",
      resultIds: [result.id],
      overrides: {
        [result.id]: {
          alignmentChoice: "suggested",
          interpretation: "intended_change",
        },
      },
    },
  }));
  const shot = document.productionPlan.shots[0];
  assert.equal(shot.narration, "actual text");
  assert.equal(document.productionPlan.script, "intro actual text ending");
  assert.equal(shot.requirementVersion, 2);
  assert.equal(shot.approval, "needs_design");
});

test("input identity or project edits during streaming hashing cannot publish a stale snapshot", async () => {
  for (const change of ["media", "document"]) {
    const { service, options } = setup(),
      file = join(options.root, "hash-race.bin");
    writeFileSync(file, Buffer.alloc(8 * 1024 * 1024, 3));
    const initial = loadDocument("p", options);
    setImmediate(() => {
      if (change === "media")
        writeFileSync(file, Buffer.alloc(8 * 1024 * 1024, 4));
      else
        saveDocument(
          { ...loadDocument("p", options), name: "edited while hashing" },
          options,
        );
    });
    await assert.rejects(
      () =>
        service.createJob({
          projectId: "p",
          revision: initial.revision,
          kind: "recognize",
          mediaPaths: [file],
        }),
      change === "media" ? /changed while hashing/ : /Revision conflict/,
    );
    assert.equal(service.jobs("p").length, 0);
  }
});

test("content plan delta waits for explicit confirmation and preserves existing manual media", async () => {
  const { service, options } = setup();
  let document = loadDocument("p", options);
  document.instances = [
    {
      id: "existing",
      assetId: "number-beat",
      assetVersion: 1,
      startFrame: 20,
      durationFrames: 60,
      zIndex: 2,
      props: { value: 42, labelStyle: { color: "#fff" } },
    },
  ];
  document.productionPlan.shots[0].bindings = [
    {
      id: "bound",
      slotId: "v",
      instanceId: "existing",
      path: "old.mp4",
      requirementVersion: 1,
      sourceInSeconds: 0,
      confirmed: true,
    },
  ];
  document = saveDocument(document, options);
  const { job } = await service.createJob({
    projectId: "p",
    revision: document.revision,
    kind: "align",
  });
  const plan = structuredClone(document.productionPlan);
  plan.shots[0].cancelled = true;
  plan.shots[0].removalPending = true;
  plan.shots[0].timing = {
    status: "aligned",
    manual: false,
    ranges: [{ id: "new", startFrame: 0, durationFrames: 10 }],
  };
  plan.shots.push({
    id: "added",
    title: "新增段落",
    narration: "新增原文",
    approval: "needs_design",
    slots: [],
    timing: {
      status: "aligned",
      manual: false,
      ranges: [{ id: "added-range", startFrame: 180, durationFrames: 30 }],
    },
  });
  const result = {
    id: "plan-delta",
    kind: "plan",
    jobId: job.id,
    projectId: "p",
    requiresConfirmation: true,
    plan,
    basePlan: document.productionPlan,
    contentChanges: {
      addedShots: [{ shotId: "added", narration: "新增原文", cueIds: ["c1"] }],
      removedShotIds: ["s"],
      reorderedShotIds: [],
    },
  };
  let { document: next } = await service.ingest({
    projectId: "p",
    jobId: job.id,
    results: [result],
  });
  assert.equal(next.productionPlan.shots.length, 1);
  assert.notEqual(next.productionPlan.shots[0].cancelled, true);
  ({ document: next } = await service.applyResults({
    projectId: "p",
    revision: next.revision,
    operation: { type: "apply-results", resultIds: [result.id] },
  }));
  assert.equal(next.productionPlan.shots.length, 2);
  assert.equal(next.productionPlan.shots[0].cancelled, true);
  assert.equal(next.productionPlan.shots[0].removalPending, false);
  assert.deepEqual(
    next.productionPlan.shots[0].timing,
    document.productionPlan.shots[0].timing,
  );
  assert.deepEqual(next.instances, document.instances);
  assert.equal(next.productionPlan.shots[0].bindings[0].instanceId, "existing");
  assert.equal(next.productionPlan.approval, "needs_design");
  assert.equal(
    next.productionPlan.changes.some((c) => c.type === "confirm-content-delta"),
    true,
  );
});

test("retry prefers current effective script over prior request text and preserves initial draft fallback", async () => {
  const { service, document, options } = setup();
  const { job } = await service.createJob({
    projectId: "p",
    revision: document.revision,
    kind: "package",
    script: "initial request",
  });
  service.cancel(job.id);
  const initial = await service.retry(job.id);
  assert.equal(
    JSON.parse(readFileSync(initial.job.snapshotPath)).script,
    "initial request",
  );
  const d = service.read("p").document;
  d.productionPlan.script = "edited effective script";
  saveDocument(d, options);
  const latest = await service.retry(job.id);
  assert.equal(
    JSON.parse(readFileSync(latest.job.snapshotPath)).script,
    "edited effective script",
  );
  service.cancel(latest.job.id);
  const empty = service.read("p").document;
  empty.productionPlan.script = "";
  saveDocument(empty, options);
  const cleared = await service.retry(latest.job.id);
  assert.equal(JSON.parse(readFileSync(cleared.job.snapshotPath)).script, "");
});

test("narration alignment keeps a draft effect window and existing actual binding interval", async () => {
  const { service, job, result } = await alignmentSetup({
    effect: true,
    bound: true,
  });
  const { document } = await service.ingest({
    projectId: "p",
    jobId: job.id,
    results: [result],
  });
  const shot = document.productionPlan.shots[0];
  assert.equal(shot.anchor.startSeconds, 1);
  assert.equal(shot.timing.status, "review");
  assert.deepEqual(
    shot.timing.ranges.map((r) => [r.startFrame, r.durationFrames]),
    [[45, 30]],
  );
});

function templateResult(job, extra = {}) {
  return {
    id: "native-template",
    jobId: job.id,
    projectId: "p",
    kind: "template",
    shotId: "s",
    slotId: "v",
    requirementVersion: 1,
    narration: "",
    template: {
      id: "number-beat",
      props: { slots: { value: 42, label: "演示" } },
    },
    target: { rangeId: "r", startFrame: 30, durationFrames: 60 },
    technical: { passed: true },
    ...extra,
  };
}
async function templateSetup({ occupied = false } = {}) {
  const env = setup();
  let d = loadDocument("p", env.options);
  d.productionPlan.approval = "needs_design";
  d.productionPlan.shots[0].approval = "needs_design";
  if (occupied) {
    d.tracks = [
      { id: "original", name: "原模板", locked: true, disabled: true },
    ];
    d.instances = [
      {
        id: "original",
        assetId: "number-beat",
        assetVersion: 1,
        startFrame: 120,
        durationFrames: 30,
        zIndex: 3,
        trackId: "original",
        disabled: true,
        props: { slots: { value: 7, label: "用户手调" } },
      },
    ];
    d.productionPlan.shots[0].bindings = [
      { id: "old", instanceId: "original", slotId: "v", requirementVersion: 1 },
    ];
  }
  d = saveDocument(d, env.options);
  const { job } = await env.service.createJob({
    projectId: "p",
    revision: d.revision,
    kind: "package",
  });
  return { ...env, job, result: templateResult(job), before: d };
}
test("native template auto appends without approval, preserving occupied manual slot and locked track", async () => {
  const { service, job, result, before } = await templateSetup({
    occupied: true,
  });
  await service.ingest({ projectId: "p", jobId: job.id, results: [result] });
  const { document, jobs } = service.read("p");
  assert.equal(jobs[0].results[0].state, "applied");
  assert.equal(document.instances.length, 2);
  assert.deepEqual(document.instances[0], before.instances[0]);
  assert.deepEqual(document.tracks[0], before.tracks[0]);
  const added = document.instances[1];
  assert.equal(added.assetId, "number-beat");
  assert.deepEqual(added.props, result.template.props);
  assert.equal(added.startFrame, 30);
  assert.equal(added.durationFrames, 60);
  assert.notEqual(added.trackId, "original");
  assert.equal(document.productionPlan.shots[0].bindings.length, 2);
  assert.equal(document.productionPlan.approval, "needs_design");
});
test("native template accepts a shot introduced by this package plan then checks current identity", async () => {
  const { service, job, result, before } = await templateSetup();
  const plan = structuredClone(before.productionPlan);
  const shot = structuredClone(plan.shots[0]);
  shot.id = "new-shot";
  shot.narration = "新增口播";
  plan.shots.push(shot);
  const planResult = {
    id: "package-plan",
    jobId: job.id,
    projectId: "p",
    kind: "plan",
    plan,
  };
  await service.ingest({
    projectId: "p",
    jobId: job.id,
    results: [planResult],
  });
  const fresh = { ...result, shotId: "new-shot", narration: "新增口播" };
  await service.ingest({ projectId: "p", jobId: job.id, results: [fresh] });
  assert.equal(
    service.read("p").jobs[0].results.find((r) => r.id === fresh.id).state,
    "applied",
  );
  const stale = {
    ...result,
    id: "wrong-narration",
    shotId: "new-shot",
    narration: "旧口播",
  };
  await service.ingest({ projectId: "p", jobId: job.id, results: [stale] });
  assert.equal(
    service.read("p").jobs[0].results.find((r) => r.id === stale.id).state,
    "stale",
  );
  assert.equal(service.read("p").document.instances.length, 1);
});
for (const [name, patch, reason] of [
  [
    "unknown preset",
    { template: { id: "missing-preset", props: {} } },
    /模板|preset/,
  ],
  [
    "invalid native props",
    {
      template: {
        id: "number-beat",
        props: { slots: { value: "bad", label: "演示" } },
      },
    },
    /数值|数字/,
  ],
  [
    "incorrect target time",
    { target: { rangeId: "r", startFrame: 91, durationFrames: 60 } },
    /range|范围/,
  ],
  [
    "unverified technical result",
    { technical: { passed: false } },
    /technical|技术/,
  ],
])
  test(`native template rejects ${name} without creating an instance`, async () => {
    const { service, job, result } = await templateSetup();
    await service.ingest({
      projectId: "p",
      jobId: job.id,
      results: [{ ...result, ...patch }],
    });
    const read = service.read("p");
    assert.equal(read.document.instances.length, 0);
    assert.notEqual(read.jobs[0].results[0].state, "applied");
    assert.match(read.jobs[0].results[0].reason, reason);
  });
test("native template deduplicates equivalent props across jobs and never resurrects deleted implementation", async () => {
  const { service, options, job, result } = await templateSetup();
  await service.ingest({ projectId: "p", jobId: job.id, results: [result] });
  let d = service.read("p").document;
  const second = await service.createJob({
    projectId: "p",
    revision: d.revision,
    kind: "package",
  });
  const replay = {
    ...result,
    id: "same-template",
    jobId: second.job.id,
    template: {
      id: "number-beat",
      props: { slots: { label: "演示", value: 42 } },
    },
  };
  await service.ingest({
    projectId: "p",
    jobId: second.job.id,
    results: [replay],
  });
  assert.equal(service.read("p").document.instances.length, 1);
  d = service.read("p").document;
  d.instances = [];
  saveDocument(d, options);
  d = service.read("p").document;
  const third = await service.createJob({
    projectId: "p",
    revision: d.revision,
    kind: "package",
  });
  const deletedReplay = {
    ...result,
    id: "deleted-replay",
    jobId: third.job.id,
  };
  await service.ingest({
    projectId: "p",
    jobId: third.job.id,
    results: [deletedReplay],
  });
  assert.equal(service.read("p").document.instances.length, 0);
  assert.equal(
    service.read("p").jobs.find((j) => j.id === third.job.id).results[0].state,
    "ignored",
  );
});
test("native template source hash changes and cancellation block automatic application", async () => {
  const { service, options } = setup();
  const source = join(options.root, "source.mp4");
  writeFileSync(source, "first source");
  let d = loadDocument("p", options);
  d.source = { path: "source.mp4", startFrame: 0 };
  d = saveDocument(d, options);
  const { job } = await service.createJob({
    projectId: "p",
    revision: d.revision,
    kind: "package",
  });
  writeFileSync(source, "changed source");
  await service.ingest({
    projectId: "p",
    jobId: job.id,
    results: [templateResult(job)],
  });
  assert.equal(service.read("p").jobs[0].results[0].state, "stale");
  d = service.read("p").document;
  const second = await service.createJob({
    projectId: "p",
    revision: d.revision,
    kind: "package",
  });
  service.cancel(second.job.id);
  await service.ingest({
    projectId: "p",
    jobId: second.job.id,
    results: [templateResult(second.job)],
  });
  assert.equal(service.read("p").document.instances.length, 0);
});
test("recognized media appends on its actual interval beside an occupied template and keeps uncertainty notes", async () => {
  const { service, options, before } = await templateSetup({ occupied: true });
  const { execFileSync } = await import("node:child_process");
  const source = join(options.root, "recognized.mp4"),
    frame = join(options.root, "recognized.png");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=1280x720:r=30",
    "-t",
    "3",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    source,
  ]);
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-i",
    source,
    "-frames:v",
    "1",
    frame,
  ]);
  const { job } = await service.createJob({
    projectId: "p",
    revision: before.revision,
    kind: "recognize",
    shotId: "s",
    slotId: "v",
    mediaPaths: [source],
  });
  const result = {
    id: "auto-match",
    jobId: job.id,
    projectId: "p",
    kind: "match",
    shotId: "s",
    slotId: "v",
    requirementVersion: 1,
    target: {
      instanceId: "original",
      rangeId: "r",
      startFrame: 45,
      durationFrames: 30,
    },
    media: { path: source, sourceInSeconds: 0.5, sourceOutSeconds: 1.5 },
    technical: { passed: true },
    contentReview: {
      passed: true,
      evidence: "画面符合表达",
      frames: [{ path: frame }],
      uncertainties: ["制作工具未知"],
    },
  };
  await service.ingest({ projectId: "p", jobId: job.id, results: [result] });
  const read = service.read("p");
  assert.equal(
    read.jobs.find((j) => j.id === job.id).results[0].state,
    "applied",
  );
  assert.equal(read.document.instances.length, 2);
  assert.deepEqual(read.document.instances[0], before.instances[0]);
  assert.equal(read.document.instances[1].startFrame, 45);
  assert.equal(read.document.instances[1].durationFrames, 30);
  assert.notEqual(read.document.instances[1].trackId, "original");
  const repeat = await service.createJob({
    projectId: "p",
    revision: read.document.revision,
    kind: "recognize",
    mediaPaths: [source],
  });
  await service.ingest({
    projectId: "p",
    jobId: repeat.job.id,
    results: [{ ...result, id: "auto-match-repeat", jobId: repeat.job.id }],
  });
  assert.equal(service.read("p").document.instances.length, 2);
});

test("native template accepts a real semantic range subinterval without extending it", async () => {
  const { service, job, result } = await templateSetup();
  result.target = { rangeId: "r", startFrame: 45, durationFrames: 30 };
  await service.ingest({ projectId: "p", jobId: job.id, results: [result] });
  const d = service.read("p").document;
  assert.equal(d.instances[0].startFrame, 45);
  assert.equal(d.instances[0].durationFrames, 30);
});

test("native template explicit application cannot bypass a changed snapshot source", async () => {
  const { service, options } = setup();
  const source = join(options.root, "template-source.mp4");
  writeFileSync(source, "original source");
  let d = loadDocument("p", options);
  d.source = { path: "template-source.mp4", startFrame: 0 };
  d = saveDocument(d, options);
  const { job } = await service.createJob({
    projectId: "p",
    revision: d.revision,
    kind: "package",
  });
  writeFileSync(source, "updated source");
  const result = templateResult(job);
  await service.ingest({ projectId: "p", jobId: job.id, results: [result] });
  await assert.rejects(
    () =>
      service.applyResults({
        projectId: "p",
        revision: service.read("p").document.revision,
        operation: {
          type: "apply-results",
          resultIds: [result.id],
          overrides: { [result.id]: { shotId: "s" } },
        },
      }),
    /stale|source/i,
  );
  assert.equal(service.read("p").document.instances.length, 0);
});
test("native template transparent mode is checked from real native parameters", async () => {
  const { service, job, result, options } = await templateSetup();
  let d = service.read("p").document;
  d.productionPlan.shots[0].slots[0].presentationMode = "overlay";
  saveDocument(d, options);
  await service.ingest({ projectId: "p", jobId: job.id, results: [result] });
  assert.equal(service.read("p").document.instances.length, 0);
  assert.match(service.read("p").jobs[0].results[0].reason, /transparent|透明/);
  const transparent = {
    ...result,
    id: "transparent-template",
    template: {
      ...result.template,
      props: {
        ...result.template.props,
        variant: { layout: "side", bg: "transparent" },
      },
    },
  };
  await service.ingest({
    projectId: "p",
    jobId: job.id,
    results: [transparent],
  });
  assert.equal(service.read("p").document.instances.length, 1);
});
test("native template current requirement and slot identity cannot be stale", async () => {
  const { service, job, result } = await templateSetup();
  for (const patch of [
    { id: "bad-version", requirementVersion: 2 },
    { id: "bad-slot", slotId: "missing" },
  ]) {
    await service.ingest({
      projectId: "p",
      jobId: job.id,
      results: [{ ...result, ...patch }],
    });
    assert.equal(
      service.read("p").jobs[0].results.find((r) => r.id === patch.id).state,
      "stale",
    );
  }
  assert.equal(service.read("p").document.instances.length, 0);
});
test("native template explicit replacement respects locked tracks", async () => {
  const { service, job, result, before, options } = await templateSetup({
    occupied: true,
  });
  service.cancel(job.id);
  await service.ingest({ projectId: "p", jobId: job.id, results: [result] });
  const request = () => ({
    projectId: "p",
    revision: service.read("p").document.revision,
    operation: {
      type: "apply-results",
      resultIds: [result.id],
      overrides: { [result.id]: { targetInstanceId: "original" } },
    },
  });
  await assert.rejects(() => service.applyResults(request()), /locked/);
  assert.deepEqual(service.read("p").document.instances, before.instances);
  let d = service.read("p").document;
  d.tracks[0].locked = false;
  saveDocument(d, options);
  const applied = await service.applyResults(request());
  assert.equal(applied.document.instances.length, 1);
  assert.equal(applied.document.instances[0].id, "original");
  assert.equal(applied.document.instances[0].props.slots.value, 42);
});

test("explicit native application preserves deletion identity across a full undo and a fresh job", async () => {
  const { service, job, result, before, options } = await templateSetup();
  service.cancel(job.id);
  await service.ingest({ projectId: "p", jobId: job.id, results: [result] });
  await service.applyResults({
    projectId: "p",
    revision: service.read("p").document.revision,
    operation: { type: "apply-results", resultIds: [result.id] },
  });
  let current = service.read("p").document;
  saveDocument({ ...before, revision: current.revision }, options);
  current = service.read("p").document;
  const second = await service.createJob({
    projectId: "p",
    revision: current.revision,
    kind: "package",
  });
  const again = { ...result, id: "explicit-undo-replay", jobId: second.job.id };
  service.cancel(second.job.id);
  await service.ingest({
    projectId: "p",
    jobId: second.job.id,
    results: [again],
  });
  const applied = await service.applyResults({
    projectId: "p",
    revision: service.read("p").document.revision,
    operation: { type: "apply-results", resultIds: [again.id] },
  });
  assert.equal(applied.document.instances.length, 0);
  assert.equal(
    applied.jobs.find((j) => j.id === second.job.id).results[0].state,
    "ignored",
  );
});

for (const count of [1, 2])
  test(`recognition snapshots the unique plan range with ${count} occupied implementations`, async () => {
    const { service, options, before } = await templateSetup({
      occupied: true,
    });
    let d = before;
    if (count === 2) {
      d.instances.push({
        ...structuredClone(d.instances[0]),
        id: "second",
        startFrame: 210,
      });
      d.productionPlan.shots[0].bindings.push({
        id: "second-binding",
        instanceId: "second",
        slotId: "v",
        requirementVersion: 1,
      });
      d = saveDocument(d, options);
    }
    const { job } = await service.createJob({
      projectId: "p",
      revision: d.revision,
      kind: "recognize",
      shotId: "s",
      slotId: "v",
    });
    const snapshot = JSON.parse(readFileSync(job.snapshotPath));
    assert.deepEqual(snapshot.target, {
      rangeId: "r",
      startFrame: 30,
      durationFrames: 60,
    });
    assert.equal(snapshot.instanceId, undefined);
    assert.equal(snapshot.rangeId, "r");
    const explicit = await service.createJob({
      projectId: "p",
      revision: d.revision,
      kind: "recognize",
      shotId: "s",
      slotId: "v",
      instanceId: "original",
    });
    const explicitSnapshot = JSON.parse(
      readFileSync(explicit.job.snapshotPath),
    );
    assert.deepEqual(explicitSnapshot.target, {
      instanceId: "original",
      startFrame: 120,
      durationFrames: 30,
    });
    assert.equal(explicitSnapshot.instanceId, "original");
  });

test("recognition with occupied implementations requires an explicit range when the plan has multiple ranges", async () => {
  const { service, options, before } = await templateSetup({ occupied: true });
  before.productionPlan.shots[0].timing.ranges.push({
    id: "r2",
    startFrame: 180,
    durationFrames: 60,
  });
  const d = saveDocument(before, options);
  await assert.rejects(
    () =>
      service.createJob({
        projectId: "p",
        revision: d.revision,
        kind: "recognize",
        shotId: "s",
        slotId: "v",
      }),
    /range|范围|Multiple/,
  );
  const { job } = await service.createJob({
    projectId: "p",
    revision: d.revision,
    kind: "recognize",
    shotId: "s",
    slotId: "v",
    rangeId: "r2",
  });
  const snapshot = JSON.parse(readFileSync(job.snapshotPath));
  assert.deepEqual(snapshot.target, {
    rangeId: "r2",
    startFrame: 180,
    durationFrames: 60,
  });
  assert.equal(snapshot.instanceId, undefined);
});

test("semantic package workflow, summary and SRT metadata survive automatic plan ingestion and storage reload", async () => {
  const { service, options, job, before } = await templateSetup();
  const srt = join(options.root, "metadata.srt");
  writeFileSync(srt, "1\n00:00:01,000 --> 00:00:03,000\n演示\n");
  const plan = structuredClone(before.productionPlan);
  plan.animationWorkflow = "semantic-template-v1";
  plan.sourceSrtPath = srt;
  plan.transcriptBinding = {
    sourceSha256: "source-digest",
    transcriptSha256: "transcript-digest",
  };
  plan.upstream = {
    animationPackage: {
      summaryPath: join(options.root, "summary.md"),
      version: 1,
    },
  };
  await service.ingest({
    projectId: "p",
    jobId: job.id,
    results: [
      {
        id: "semantic-metadata",
        jobId: job.id,
        projectId: "p",
        kind: "plan",
        plan,
      },
    ],
  });
  const reloaded = mod.createProductionPlanService(options).read("p")
    .document.productionPlan;
  assert.equal(reloaded.animationWorkflow, "semantic-template-v1");
  assert.equal(reloaded.sourceSrtPath, srt);
  assert.deepEqual(reloaded.transcriptBinding, plan.transcriptBinding);
  assert.deepEqual(
    reloaded.upstream.animationPackage,
    plan.upstream.animationPackage,
  );
});

test("package reuses the existing camera plan SRT reference without duplicating transcription", async () => {
  const { service, options } = setup();
  const source = join(options.root, "camera-plan-source.mp4"),
    srt = join(options.root, "camera-plan-source.srt");
  writeFileSync(source, "existing source identity");
  writeFileSync(srt, "1\n00:00:01,000 --> 00:00:03,000\n演示\n");
  const document = loadDocument("p", options);
  document.source = {
    path: "camera-plan-source.mp4",
    startFrame: 0,
    cameraPlan: {
      version: 2,
      duration: 10,
      levels: { A: 1, B: 1.12, C: 1.18 },
      anchor: { x: 0.5, y: 0.1 },
      events: [
        {
          at: 0,
          to: "A",
          transition: "cut",
          purpose: "hook",
          cue: "开场",
          reason: "基础",
        },
      ],
      sourceSrtPath: srt,
    },
  };
  const d = saveDocument(document, options);
  const { job } = await service.createJob({
    projectId: "p",
    revision: d.revision,
    kind: "package",
  });
  const snapshot = JSON.parse(readFileSync(job.snapshotPath));
  assert.equal(
    readFileSync(snapshot.sourceSrtPath, "utf8"),
    readFileSync(srt, "utf8"),
  );
  assert.ok(
    snapshot.inputs.some(
      (input) =>
        input.originalPath === srt && input.path === snapshot.sourceSrtPath,
    ),
  );
});

test('a template arriving before its same-batch updated plan is applied after the plan', async()=>{
 const {service,job,before,result}=await templateSetup();
 const plan=structuredClone(before.productionPlan);
 plan.animationWorkflow='semantic-template-v1';
 plan.shots[0].narration='新口播';plan.shots[0].requirementVersion=2;
 plan.shots[0].slots[0].requirementVersion=2;
 const template={...result,requirementVersion:2,narration:'新口播'};
 const updated={id:'after-template-plan',kind:'plan',jobId:job.id,projectId:'p',plan};
 await service.ingest({projectId:'p',jobId:job.id,results:[template,updated]});
 const current=service.read('p');
 assert.equal(current.jobs[0].results.find(r=>r.id===template.id).state,'applied');
 assert.equal(current.document.instances.length,1);
});

test('explicit transparent editor background does not duplicate an already transparent template',async()=>{
 const {service,options,job,result}=await templateSetup();
 const first={...result,template:{id:'word-cascade',props:{slots:{lines:['原文']},variant:{bg:'transparent',mode:'cascade'}}}};
 await service.ingest({projectId:'p',jobId:job.id,results:[first]});
 let d=service.read('p').document;assert.equal(d.instances.length,1);const original=structuredClone(d.instances[0]);
 d.instances[0].props.tune={y:77};saveDocument(d,options);const manual=structuredClone(service.read('p').document.instances[0]);
 const next=await service.createJob({projectId:'p',revision:service.read('p').document.revision,kind:'package'});
 await service.ingest({projectId:'p',jobId:next.job.id,results:[{...first,id:'transparent-default-replay',jobId:next.job.id,template:{...first.template,props:{...first.template.props,editorBackground:'transparent'}}}]});
 d=service.read('p').document;assert.equal(d.instances.length,1);assert.deepEqual(d.instances[0],manual);assert.equal(d.instances[0].id,original.id);
 d.instances=[];saveDocument(d,options);const third=await service.createJob({projectId:'p',revision:service.read('p').document.revision,kind:'package'});
 await service.ingest({projectId:'p',jobId:third.job.id,results:[{...first,id:'removed-transparent-default',jobId:third.job.id,template:{...first.template,props:{...first.template.props,editorBackground:'transparent'}}}]});
 assert.equal(service.read('p').document.instances.length,0);assert.equal(service.read('p').jobs.find(j=>j.id===third.job.id).results[0].state,'ignored');service.close();
});

 test('automatic native templates share one persisted lane when their times do not overlap',async()=>{
 const {service,options,job,result,before}=await templateSetup();
 await service.ingest({projectId:'p',jobId:job.id,results:[{...result,id:'auto-first',target:{rangeId:'r',startFrame:30,durationFrames:30}},{...result,id:'auto-second',target:{rangeId:'r',startFrame:60,durationFrames:30}}]});
 const d=loadDocument('p',options);assert.equal(d.instances.length,2);assert.equal(d.tracks.length,1);assert.equal(d.instances[0].trackId,d.instances[1].trackId);assert.equal(d.tracks[0].name,'自动素材与动画');assert.deepEqual(d.source,before.source);service.close();
 });

test('explicit manual adoption of a result does not use the automatic shared lane',async()=>{
 const {service,job,result}=await templateSetup();
 await service.ingest({projectId:'p',jobId:job.id,results:[{...result,id:'automatic-a',target:{rangeId:'r',startFrame:30,durationFrames:30}}]});
 const second=await service.createJob({projectId:'p',revision:service.read('p').document.revision,kind:'package'});service.cancel(second.job.id);
 const manual={...result,id:'manual-b',jobId:second.job.id,target:{rangeId:'r',startFrame:60,durationFrames:30}};
 await service.ingest({projectId:'p',jobId:second.job.id,results:[manual]});
 await service.applyResults({projectId:'p',revision:service.read('p').document.revision,operation:{type:'apply-results',resultIds:[manual.id],overrides:{}}});
 const d=service.read('p').document;assert.equal(d.instances.length,2);assert.notEqual(d.instances[0].trackId,d.instances[1].trackId);assert.equal(d.instances[1].autoPlacement,undefined);service.close();
});

test("revise requires text and ingests bounded durable edits", async()=>{
 const {service,document}=setup();
 await assert.rejects(service.createJob({projectId:'p',revision:document.revision,kind:'revise',shotId:'s',instructions:''}), /instructions/);
 const {job}=await service.createJob({projectId:'p',revision:document.revision,kind:'revise',shotId:'s',instructions:'改表达目标',scope:{camera:true,sound:true}});
 const snapshot=JSON.parse(readFileSync(job.snapshotPath));
 const r={id:'revision-one',jobId:job.id,projectId:'p',kind:'shot-revision',shotId:'s',target:snapshot.target,reason:'更新表达目标',gaps:[],patches:[{entity:'shot',id:'s',field:'visualRequirement',before:snapshot.document.productionPlan.shots[0].visualRequirement,after:'新的表达目标'}]};
 await service.ingest({projectId:'p',jobId:job.id,results:[r]});
 assert.equal(service.read('p').document.productionPlan.shots[0].visualRequirement,'新的表达目标');
 const revision=service.read('p').document.revision;
 await service.ingest({projectId:'p',jobId:job.id,results:[r]});
 assert.equal(service.read('p').document.revision,revision);
});
test('revise rejects changed target and merges unrelated concurrent edits',async()=>{
 for(const changed of [true,false]){
  const {service,document}=setup();const {job}=await service.createJob({projectId:'p',revision:document.revision,kind:'revise',shotId:'s',instructions:'修改'});
  const snap=JSON.parse(readFileSync(job.snapshotPath));
  service.action({projectId:'p',revision:service.read('p').document.revision,operation:{type:'edit-shot',shotId:'s',patch:changed?{visualRequirement:'user'}:{title:'user title'}}});
  const r={id:'bounded',jobId:job.id,projectId:'p',kind:'shot-revision',shotId:'s',target:snap.target,reason:'修改',gaps:[],patches:[{entity:'shot',id:'s',field:'visualRequirement',before:snap.document.productionPlan.shots[0].visualRequirement,after:'model'}]};
  await service.ingest({projectId:'p',jobId:job.id,results:[r]});
  const read=service.read('p');assert.equal(read.jobs[0].results[0].state,changed?'stale':'applied');assert.equal(read.document.productionPlan.shots[0].visualRequirement,changed?'user':'model');
 }
});
test('revise result cannot forge snapshot identity or modify another shot',async()=>{
 const {service,document}=setup();const {job}=await service.createJob({projectId:'p',revision:document.revision,kind:'revise',shotId:'s',instructions:'修改'});const snap=JSON.parse(readFileSync(job.snapshotPath));
 const r={id:'forged',jobId:job.id,projectId:'p',kind:'shot-revision',shotId:'s',target:snap.target,reason:'修改',gaps:[],patches:[{entity:'shot',id:'other',field:'visualRequirement',before:'old',after:'new'}]};
 await assert.rejects(service.ingest({projectId:'p',jobId:job.id,results:[r]}),/Cross-shot/);
 r.patches=[];r.target={...snap.target,startFrame:0};await assert.rejects(service.ingest({projectId:'p',jobId:job.id,results:[r]}),/identity/);
});
test('revise archives semantic package and automatically adds camera on an identity source clip',async()=>{
 const {service,document,options}=setup();writeFileSync(join(options.root,'source.mp4'),'test bytes');writeFileSync(join(options.root,'analysis.json'),JSON.stringify({fullScript:'全文',segments:[{id:'s',expressionGoal:'已有全文关系'}]}));
 const d=loadDocument('p',options);d.source={path:'source.mp4',startFrame:0,durationFrames:300,clips:[{id:'source-main',startFrame:0,durationFrames:300,sourceInFrame:0}]};d.productionPlan.upstream={animationPackage:{analysisPath:'analysis.json'}};
 const saved=saveDocument(d,options);const {job}=await service.createJob({projectId:'p',revision:saved.revision,kind:'revise',shotId:'s',rangeId:'r',instructions:'这里推近'});
 const snapshot=JSON.parse(readFileSync(job.snapshotPath));const context=snapshot.revisionContext;assert.equal(JSON.parse(readFileSync(context.contextPaths.analysisPath)).fullScript,'全文');
 writeFileSync(join(options.root,'analysis.json'),'changed');assert.equal(JSON.parse(readFileSync(context.contextPaths.analysisPath)).fullScript,'全文');
 const capability=context.editable.find(x=>x.entity==='camera-create');assert.ok(capability);assert.equal(context.cameraSourceInterval.startSeconds,1);
 const result={id:'camera-result',jobId:job.id,projectId:'p',shotId:'s',kind:'shot-revision',target:snapshot.target,reason:'已新增当前片段镜头参数',gaps:[],patches:[{...capability,after:{id:capability.id,start:1,in:.4,hold:1,out:.4,zoom:1.15,enabled:true,name:'强调',inEasing:'ramped',outEasing:'ramped'}}]};
 await service.ingest({projectId:'p',jobId:job.id,results:[result]});const read=service.read('p');assert.equal(read.jobs[0].results[0].state,'applied');assert.equal(read.document.source.cameraPlan.clipGroups.length,1);
});
test('semantic revision invalidates prior in-flight template result but parameter edits do not',async()=>{
 const {service,job:oldJob,result:oldTemplate}=await templateSetup();const current=service.read('p').document;
 const {job}=await service.createJob({projectId:'p',revision:current.revision,kind:'revise',shotId:'s',rangeId:'r',instructions:'取消动画需求'});const snap=JSON.parse(readFileSync(job.snapshotPath));
 const revision={id:'semantic-revision',jobId:job.id,projectId:'p',shotId:'s',kind:'shot-revision',target:snap.target,reason:'取消动画语义',gaps:['旧动画实例保留，新素材尚未生产'],patches:[{entity:'shot',id:'s',field:'animationNeed',before:null,after:'none'}]};
 await service.ingest({projectId:'p',jobId:job.id,results:[revision]});assert.equal(service.read('p').document.productionPlan.shots[0].requirementVersion,snap.document.productionPlan.shots[0].requirementVersion+1);
 await service.ingest({projectId:'p',jobId:oldJob.id,results:[oldTemplate]});const read=service.read('p');assert.equal(read.jobs.find(j=>j.id===oldJob.id).results.find(r=>r.id===oldTemplate.id).state,'stale');assert.equal(read.document.instances.length,0);
});

async function executionSetup({large=false}={}){
 const env=setup(),{service,options}=env;writeFileSync(join(options.root,'talk.mp4'),large?Buffer.alloc(16*1024*1024,7):'source');writeFileSync(join(options.root,'talk.srt'),'1\n00:00:01,000 --> 00:00:03,000\n使用电脑\n\n2\n00:00:04,000 --> 00:00:05,000\n其他段\n');
 let d=loadDocument('p',options);d.source={path:'talk.mp4',startFrame:0,durationFrames:300};d.productionPlan.sourceSrtPath=join(options.root,'talk.srt');d=saveDocument(d,options);
 const {job}=await service.createJob({projectId:'p',revision:d.revision,kind:'revise',shotId:'s',rangeId:'r',instructions:'找一些使用和操作电脑的镜头'});const snap=JSON.parse(readFileSync(job.snapshotPath));
 const result={id:`execution-${job.id}`,jobId:job.id,projectId:'p',shotId:'s',kind:'shot-revision',target:snap.target,reason:'搜集镜头',gaps:[],patches:[],execution:{kind:'footage',instructions:'搜集并下载使用电脑的真实画面'}};
 return {...env,job,result};
}
test('shot execution dispatch is scoped durable idempotent and terminal parent stays terminal',async()=>{
 const {service,job,result,options}=await executionSetup();await service.ingest({projectId:'p',jobId:job.id,results:[result],status:'partial'});
 const parent=service.getJob(job.id);assert.ok(parent.executionJobId,parent.executionError);assert.equal(parent.status,'partial');assert.equal(parent.executionStatus,'queued');
 const child=service.getJob(parent.executionJobId),snapshot=JSON.parse(readFileSync(child.snapshotPath));assert.equal(child.parentJobId,job.id);assert.equal(snapshot.shotId,'s');assert.equal(snapshot.rangeId,'r');assert.equal(snapshot.target.startFrame,30);assert.deepEqual(snapshot.footageScope.sourceCueIds,[1]);assert.match(snapshot.instructions,/找一些使用/);
 await service.ingest({projectId:'p',jobId:job.id,results:[result],status:'partial'});assert.equal(service.read('p').jobs.length,2);
 const reload=mod.createProductionPlanService(options);await reload.recover();assert.equal(reload.read('p').jobs.length,2);assert.equal(reload.getJob(job.id).executionJobId,child.id);reload.close();service.close();
});
test('cancel terminal revision stops queued execution child and retry gets new identity',async()=>{
 const {service,job,result}=await executionSetup();await service.ingest({projectId:'p',jobId:job.id,results:[result],status:'partial'});const childId=service.getJob(job.id).executionJobId;service.cancel(job.id);assert.equal(service.getJob(childId).status,'cancelled');assert.equal(service.getJob(job.id).executionStatus,'cancelled');
 const retry=await service.retry(job.id);assert.notEqual(retry.job.id,job.id);assert.equal(retry.job.executionJobId,undefined);service.close();
});
test('scoped footage accepts only footage results and unchanged requirements',async()=>{
 const {service,job,result}=await executionSetup();await service.ingest({projectId:'p',jobId:job.id,results:[result],status:'partial'});const child=service.getJob(service.getJob(job.id).executionJobId);
 await assert.rejects(service.ingest({projectId:'p',jobId:child.id,results:[{id:'bad-plan',jobId:child.id,projectId:'p',kind:'plan',plan:{shots:[]}}]}),/Scoped footage/);service.close();
});
test('execution rejects unsupported intents and never dispatches stale revision',async()=>{
 const {service,job,result}=await executionSetup();await assert.rejects(service.ingest({projectId:'p',jobId:job.id,results:[{...result,execution:{kind:'animation',instructions:'新增'}}]}),/execution/);
 service.action({projectId:'p',revision:service.read('p').document.revision,operation:{type:'edit-shot',shotId:'s',patch:{visualRequirement:'用户改动'}}});await service.ingest({projectId:'p',jobId:job.id,results:[result],status:'partial'});assert.equal(service.getJob(job.id).executionJobId,undefined);service.close();
});
test('concurrent scoped child creation returns one immutable durable job',async()=>{
 const {service,job,result,options}=await executionSetup();const current=service.read('p').document,other=mod.createProductionPlanService(options);const request={projectId:'p',revision:current.revision,kind:'footage',shotId:'s',rangeId:'r',parentJobId:job.id,scope:{footage:true}};
 const created=await Promise.all([service.createJob(request),other.createJob(request)]);assert.equal(created[0].job.id,created[1].job.id);assert.equal(service.read('p').jobs.filter(j=>j.kind==='footage').length,1);assert.equal(service.getJob(created[0].job.id).snapshotHash,created[0].job.snapshotHash);service.close();other.close();
});
test('shot revision and scoped footage use canonical shot range instead of older bound template interval',async()=>{
 const {service,options}=setup();let d=loadDocument('p',options);d.instances=[{id:'old-template',assetId:'number-beat',assetVersion:1,startFrame:45,durationFrames:15,props:{},zIndex:0}];d.productionPlan.shots[0].bindings=[{id:'old-binding',instanceId:'old-template',slotId:'v',status:'active',rangeId:'r'}];d=saveDocument(d,options);
 const {job}=await service.createJob({projectId:'p',revision:d.revision,kind:'revise',shotId:'s',instructions:'这里换素材'});const snapshot=JSON.parse(readFileSync(job.snapshotPath));assert.equal(snapshot.target.rangeId,'r');assert.equal(snapshot.target.startFrame,30);assert.equal(snapshot.target.durationFrames,60);service.close();
});
test('active execution child blocks parent retry and newer no-op revise invalidates prior scoped child',async()=>{
 const {service,job,result}=await executionSetup();await service.ingest({projectId:'p',jobId:job.id,results:[result],status:'partial'});await assert.rejects(service.retry(job.id),/execution.*active|素材.*进行/);service.close();
});
test('cancel revision during child input archival prevents detached execution launch',async()=>{
 const {service,job,result}=await executionSetup({large:true});const pending=service.ingest({projectId:'p',jobId:job.id,results:[result],status:'partial'});
 for(let i=0;i<100;i++){await new Promise(resolve=>setImmediate(resolve));const parent=service.getJob(job.id);if(parent.status==='partial'&&parent.results.some(r=>r.state==='applied')){assert.equal(parent.executionJobId,undefined);service.cancel(job.id);break;}}
 await pending;assert.equal(service.getJob(job.id).status,'cancelled');assert.equal(service.read('p').jobs.filter(j=>j.parentJobId===job.id&&['queued','running'].includes(j.status)).length,0);service.close();
});
test('same timestamp and revision parent tie chooses exactly one execution winner',async()=>{
 const {service,job,result}=await executionSetup();const {job:second}=await service.createJob({projectId:'p',revision:service.read('p').document.revision,kind:'revise',shotId:'s',rangeId:'r',instructions:'另一条意见'});const secondPath=second.snapshotPath.replace(/snapshot\.json$/,'job.json');const secondStored=JSON.parse(readFileSync(secondPath));secondStored.createdAt=job.createdAt;writeFileSync(secondPath,JSON.stringify(secondStored));
 const snapshot=JSON.parse(readFileSync(second.snapshotPath)),secondResult={...result,id:`request-${second.id}`,jobId:second.id,target:snapshot.target};const ordered=[{job,result},{job:second,result:secondResult}].sort((a,b)=>a.job.id.localeCompare(b.job.id));for(const entry of ordered)await service.ingest({projectId:'p',jobId:entry.job.id,results:[entry.result],status:'partial'});assert.equal(service.read('p').jobs.filter(j=>j.kind==='footage').length,1);assert.ok(service.getJob(ordered[1].job.id).executionJobId);assert.equal(service.getJob(ordered[0].job.id).executionJobId,undefined);service.close();
});

test("recognition exposes immutable upload identities on create and after reload", async () => {
  const {service, document, options} = setup();
  const {job} = await service.createJob({projectId: "p", revision: document.revision,
    kind: "recognize", mediaIds: ["upload-a", "upload-b"], mediaPaths: []});
  assert.deepEqual(job.mediaIds, ["upload-a", "upload-b"]);
  assert.deepEqual(job.mediaPaths, []);
  const path = join(job.outputDir, "..", "job.json");
  const stored = JSON.parse(readFileSync(path));
  delete stored.mediaIds; delete stored.mediaPaths;
  writeFileSync(path, JSON.stringify(stored));
  const restored = mod.createProductionPlanService(options).read("p").jobs.find(row => row.id === job.id);
  assert.deepEqual(restored.mediaIds, ["upload-a", "upload-b"]);
  assert.deepEqual(restored.mediaPaths, []);
});

test('new package freezes template retirement while keeping footage and AI enabled',async()=>{
 const {service,document}=setup();
 const {job}=await service.createJob({projectId:'p',revision:document.revision,kind:'package',scope:{templates:true,sound:false}});
 const snapshot=JSON.parse(readFileSync(job.snapshotPath,'utf8'));
 assert.equal(snapshot.scope.templates,false);
 assert.equal(snapshot.scope.footage,true);
 assert.equal(snapshot.scope.aiVideo,true);
 assert.equal(snapshot.scope.sound,false);
});
