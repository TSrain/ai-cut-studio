import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  createDocument,
  saveDocument,
  loadDocument,
} from "../lib/editor-store.mjs";
import { createProductionPlanService } from "../lib/production-plan-jobs.mjs";
import { pipGeometry } from "../../templates/remotion-base/src/editor/source-pip.mjs";
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
async function fixture(layout = "contain") {
  const root = mkdtempSync(join(tmpdir(), "footage-")),
    options = {
      root,
      rootDir: join(root, "index"),
      artifactRoot: join(root, "artifacts"),
      assetSourceRoot: root,
      autoStart: false,
    };
  mkdirSync(join(root, "templates/remotion-base/public"), { recursive: true });
  const file = join(root, "界面.mp4"),
    srt = join(root, "source.srt");
  writeFileSync(srt, "1\n00:00:00,000 --> 00:00:02,000\n实际界面\n");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=1280x720:r=10",
    "-t",
    "2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    file,
  ]);
  let d = createDocument({
    id: "p",
    name: "P",
    canvas: {
      width: 720,
      height: 1280,
      fps: { num: 30, den: 1 },
      durationFrames: 300,
    },
    source: {
      path: "界面.mp4",
      startFrame: 0,
      durationFrames: 60,
      volume: 0.7,
      muted: false,
      locked: true,
    },
    productionPlan: {
      sourceSrtPath: srt,
      shots: [
        {
          id: "old",
          narration: "旧动画",
          slots: [
            {
              id: "overlay",
              type: "animation",
              description: "旧动画",
              presentationMode: "overlay",
            },
          ],
        },
      ],
    },
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
  const service = createProductionPlanService(options),
    makeJob = () =>
      service.createJob({
        projectId: "p",
        revision: service.read("p").document.revision,
        kind: "footage",
      });
  const { job } = await makeJob();
  function resultFor(job, id = "footage1", placement = true) {
    const reviewPath = join(job.outputDir, "footage-review.json"),
      probePath = join(job.outputDir, "probe.json"),
      framePath = join(job.outputDir, "frame.jpg");
    writeFileSync(probePath, "{}");
    writeFileSync(framePath, "reviewed fixture frame");
    const snapshot = JSON.parse(readFileSync(job.snapshotPath));
    const review = {
      schemaVersion: 1,
      workflowMode: "real-footage-v1",
      projectId: "p",
      sourceSrtPath: snapshot.sourceSrtPath,
      sourceVideoPath: snapshot.videoPath,
      sections: [
        {
          id: "s1",
          narration: "实际界面",
          sourceCueIds: [1],
          footageNeed: "optional",
          reason: "展示界面",
          evidenceRestrictions: [],
        },
      ],
      candidates: [
        {
          id: "c1",
          path: file,
          sha256: sha(file),
          width: 1280,
          height: 720,
          durationSeconds: 2,
          pageUrl: "https://example.com/demo",
          reuseStatus: "downloadable",
          visibleContent: "实际界面",
          matchedSectionIds: ["s1"],
          sourceKind: "stock",
          review: {
            sampled: true,
            frames: [{ path: framePath, sha256: sha(framePath) }],
          },
          technical: { passed: true, decoded: true, probePath },
        },
      ],
      placements: [
        {
          id: "pl1",
          candidateId: "c1",
          sectionId: "s1",
          sourceCueIds: [1],
          startFrame: 60,
          durationFrames: 30,
          sourceInSeconds: 0.5,
          sourceOutSeconds: 1.5,
          layout,
          reason: "显示界面",
        },
      ],
    };
    writeFileSync(reviewPath, JSON.stringify(review));
    return {
      id,
      jobId: job.id,
      projectId: "p",
      kind: "footage",
      footage: {
        reviewPath,
        reviewSha256: sha(reviewPath),
        candidateId: "c1",
        placementId: placement ? "pl1" : null,
      },
      media: {
        path: file,
        ...(placement ? { sourceInSeconds: 0.5, sourceOutSeconds: 1.5 } : {}),
      },
      ...(placement ? { target: { startFrame: 60, durationFrames: 30 } } : {}),
      technical: { passed: true, details: { sha256: sha(file) } },
    };
  }
  return { root, options, service, job, makeJob, resultFor, before: d };
}
test("footage bypasses old overlay slots, fits complete UI and preserves locked source/manual state", async () => {
  const e = await fixture(),
    r = e.resultFor(e.job);
  const response = await e.service.ingest({
    projectId: "p",
    jobId: e.job.id,
    results: [r],
  });
  assert.equal(response.job.results[0].state, "applied");
  const d = response.document;
  assert.deepEqual(d.instances[0], e.before.instances[0]);
  assert.deepEqual(d.tracks[0], e.before.tracks[0]);
  assert.deepEqual(d.source, e.before.source);
  assert.deepEqual(d.productionPlan.shots, e.before.productionPlan.shots);
  const i = d.instances[1],
    g = pipGeometry(720, 1280, 30, 10, 30, i.props);
  assert.equal(g.width, 720);
  assert.equal(g.height, 405);
  assert.equal(g.crop.width, 1);
  assert.equal(g.crop.height, 1);
  assert.equal(i.props.sceneBackground.color, "#111318");
  assert.equal(i.props.media.startSeconds, 0.5);
  assert.notEqual(i.trackId, "locked");
});
test("nonrecommended footage enters project library without an instance", async () => {
  const e = await fixture();
  const response = await e.service.ingest({
    projectId: "p",
    jobId: e.job.id,
    results: [e.resultFor(e.job, "library", false)],
  });
  assert.equal(response.job.results[0].state, "applied");
  assert.equal(response.document.instances.length, 1);
  const { listProjectMedia } = await import("../lib/project-media.mjs");
  const items = listProjectMedia({ ...e.options, projectId: "p" }).items;
  assert.ok(items.some((i) => i.kind === "video"));
  assert.equal(
    listProjectMedia({ ...e.options, projectId: "p", scope: "shared" }).items
      .length,
    0,
  );
});
test("footage immutable review identities reject tampering and changed canvas is stale", async () => {
  const e = await fixture(),
    r = e.resultFor(e.job);
  r.target.startFrame++;
  await assert.rejects(
    e.service.ingest({ projectId: "p", jobId: e.job.id, results: [r] }),
    /target|identity/i,
  );
  const clean = e.resultFor(e.job, "clean");
  let d = loadDocument("p", e.options);
  d.canvas.durationFrames++;
  saveDocument(d, e.options);
  const response = await e.service.ingest({
    projectId: "p",
    jobId: e.job.id,
    results: [clean],
  });
  assert.equal(response.job.results[0].state, "stale");
  assert.equal(response.document.instances.length, 1);
});
test("same footage placement remains idempotent across jobs and deletion never restores", async () => {
  const e = await fixture();
  await e.service.ingest({
    projectId: "p",
    jobId: e.job.id,
    results: [e.resultFor(e.job)],
  });
  const { job } = await e.makeJob();
  let response = await e.service.ingest({
    projectId: "p",
    jobId: job.id,
    results: [e.resultFor(job, "copy")],
  });
  assert.equal(response.document.instances.length, 2);
  let d = loadDocument("p", e.options);
  d.instances = d.instances.filter((i) => i.id === "manual");
  saveDocument(d, e.options);
  const next = await e.makeJob();
  response = await e.service.ingest({
    projectId: "p",
    jobId: next.job.id,
    results: [e.resultFor(next.job, "deleted-copy")],
  });
  assert.equal(response.document.instances.length, 1);
  assert.equal(response.job.results[0].state, "ignored");
});
test("independent footage job clears historical shot selectors and excludes camera or sound", async () => {
  const e = await fixture();
  const { job } = await e.service.createJob({
    projectId: "p",
    revision: e.service.read("p").document.revision,
    kind: "footage",
    shotId: "obsolete",
    slotId: "obsolete",
    candidateId: "obsolete",
    scope: { camera: true, sound: true },
  });
  const snap = JSON.parse(readFileSync(job.snapshotPath));
  assert.equal(snap.shotId, undefined);
  assert.equal(snap.target, undefined);
  assert.equal(snap.workflowMode, "real-footage-v1");
  assert.equal(snap.scope.camera, false);
  assert.equal(snap.scope.sound, false);
});
test("cover footage fills portrait canvas without stretching and library candidates deduplicate", async () => {
  const e = await fixture("cover");
  const response = await e.service.ingest({
    projectId: "p",
    jobId: e.job.id,
    results: [
      e.resultFor(e.job, "candidate", false),
      e.resultFor(e.job, "placement"),
    ],
  });
  const i = response.document.instances[1],
    g = pipGeometry(720, 1280, 30, 10, 30, i.props);
  assert.equal(g.width, 720);
  assert.equal(g.height, 1280);
  assert.equal(g.crop.height, 1);
  assert.ok(g.crop.width < 1);
  const { listProjectMedia } = await import("../lib/project-media.mjs");
  const media = listProjectMedia({ ...e.options, projectId: "p" }).items;
  assert.equal(new Set(media.map((i) => i.sha256).filter(Boolean)).size, 1);
});
test("stock cannot be presented as proof of a section whose visual targets all require proof", async () => {
  const e = await fixture(),
    r = e.resultFor(e.job);
  const review = JSON.parse(readFileSync(r.footage.reviewPath));
  review.sections[0].visualTargets = [
    { evidenceRole: "proof", description: "本人作品" },
  ];
  writeFileSync(r.footage.reviewPath, JSON.stringify(review));
  r.footage.reviewSha256 = sha(r.footage.reviewPath);
  await assert.rejects(
    e.service.ingest({ projectId: "p", jobId: e.job.id, results: [r] }),
    /proof|evidence/i,
  );
});
test("unused footage candidates retain project input archives for migration", async () => {
  const e = await fixture(),
    r = e.resultFor(e.job, "library-archive", false);
  await e.service.ingest({ projectId: "p", jobId: e.job.id, results: [r] });
  const { resolveDocumentPath } = await import("../lib/editor-store.mjs");
  const { dirname } = await import("node:path");
  const records = JSON.parse(
    readFileSync(
      join(dirname(resolveDocumentPath("p", e.options)), "media-snapshot.json"),
    ),
  );
  assert.ok(
    records.some(
      (x) =>
        x.reference.startsWith("templates/remotion-base/public/") &&
        x.hash === r.technical.details.sha256,
    ),
  );
});
test("project file resolver exposes the bound footage review without exposing arbitrary files", async () => {
  const e = await fixture(),
    r = e.resultFor(e.job, "review-link", false);
  await e.service.ingest({ projectId: "p", jobId: e.job.id, results: [r] });
  assert.equal(
    e.service.resolveFile("p", r.footage.reviewPath),
    realpathSync(r.footage.reviewPath),
  );
  const frame = join(e.job.outputDir, "frame.jpg");
  assert.equal(e.service.resolveFile("p", frame), realpathSync(frame));
  const media = await e.service.candidateDownload({projectId:"p",shotId:"old",candidateId:"c1"});
  assert.equal(media.path, realpathSync(e.file ?? join(e.root, "界面.mp4")));
  assert.match(media.downloadUrl, /download=1/);
  assert.equal(media.kind, "video");
  assert.equal((await e.service.candidateMedia({projectId:"p",shotId:"old",candidateId:"c1"})).available,true);
  await assert.rejects(e.service.candidateDownload({projectId:"foreign",shotId:"old",candidateId:"c1"}));
  await assert.rejects(e.service.candidateDownload({projectId:"p",shotId:"missing",candidateId:"c1"}));
  assert.throws(
    () => e.service.resolveFile("p", join(e.root, "unknown.md")),
    /not referenced/i,
  );
});
test("explicit animation-only scope and historical packages do not start a footage child", async () => {
  for (const legacy of [false, true]) {
    const e = await fixture();
    const { job } = await e.service.createJob({
      projectId: "p",
      revision: e.service.read("p").document.revision,
      kind: "package",
      scope: {
        camera: false,
        sound: false,
        ...(!legacy ? { footage: false } : {}),
      },
    });
    if (legacy) {
      const snapshot = JSON.parse(readFileSync(job.snapshotPath));
      delete snapshot.footageBranchEnabled;
      writeFileSync(job.snapshotPath, JSON.stringify(snapshot));
      const { dirname } = await import("node:path");
      const jobPath = join(dirname(job.snapshotPath), "job.json");
      const stored = JSON.parse(readFileSync(jobPath));
      stored.snapshotHash = sha(job.snapshotPath);
      writeFileSync(jobPath, JSON.stringify(stored));
    }
    const workflowPath = join(job.outputDir, "workflow.json"),
      planPath = join(job.outputDir, "summary.md");
    writeFileSync(planPath, "正文\n## 给 Claude 的动画提示词\n保留末尾");
    writeFileSync(
      workflowPath,
      JSON.stringify({
        workflowMode: "semantic-template-v1",
        files: [{ path: planPath, sha256: sha(planPath) }],
        outputs: {
          planPath,
          semanticPackagePath: join(job.outputDir, "package-contract.json"),
        },
      }),
    );
    writeFileSync(
      join(job.outputDir, "manifest.json"),
      JSON.stringify({ workflowManifestPath: workflowPath }),
    );
    writeFileSync(
      join(job.outputDir, "status.json"),
      JSON.stringify({ state: "complete", workflowManifestPath: workflowPath }),
    );
    await e.service.ingest({
      projectId: "p",
      jobId: job.id,
      results: [],
      status: "complete",
    });
    await e.service.recover();
    assert.equal(
      e.service.read("p").jobs.filter((j) => j.parentJobId === job.id).length,
      0,
    );
    if (!legacy)
      assert.equal(e.service.getJob(job.id).footageStatus, "skipped");
  }
});
test("actual 720px PNG remains a project candidate and displays for the declared placement without source duration", async () => {
  const e = await fixture(),
    r = e.resultFor(e.job, "screenshot"),
    png = join(e.root, "截图.png");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=1280x720",
    "-frames:v",
    "1",
    "-threads",
    "1",
    png,
  ]);
  const review = JSON.parse(readFileSync(r.footage.reviewPath));
  Object.assign(review.candidates[0], {
    kind: "image",
    path: png,
    sha256: sha(png),
    durationSeconds: 0,
    sourceKind: "user",
  });
  Object.assign(review.placements[0], {
    sourceInSeconds: 0,
    sourceOutSeconds: 0,
  });
  writeFileSync(r.footage.reviewPath, JSON.stringify(review));
  r.footage.reviewSha256 = sha(r.footage.reviewPath);
  r.media = { path: png, sourceInSeconds: 0, sourceOutSeconds: 0 };
  r.technical.details.sha256 = sha(png);
  const candidate = {
    ...r,
    id: "screenshot-candidate",
    footage: { ...r.footage, placementId: null },
    media: { path: png },
  };
  delete candidate.target;
  const response = await e.service.ingest({
    projectId: "p",
    jobId: e.job.id,
    results: [candidate, r],
  });
  assert.deepEqual(
    response.job.results.map((x) => x.state),
    ["applied", "applied"],
  );
  assert.equal(response.document.instances[1].props.media.kind, "image");
  assert.equal(response.document.instances[1].durationFrames, 30);
  assert.equal(response.document.instances[1].props.media.startSeconds, 0);
  assert.deepEqual(response.document.source, e.before.source);
});
test("new broll jobs launch an independent footage child and explicit scope false skips it", async () => {
  for (const skip of [false, true]) {
    const e = await fixture();
    const { job } = await e.service.createJob({
      projectId: "p",
      revision: e.service.read("p").document.revision,
      kind: "broll",
      scope: {
        camera: false,
        sound: false,
        ...(skip ? { footage: false } : {}),
      },
    });
    writeFileSync(
      join(job.outputDir, "status.json"),
      JSON.stringify({ state: "complete" }),
    );
    writeFileSync(
      join(job.outputDir, "manifest.json"),
      JSON.stringify({ state: "complete" }),
    );
    await e.service.ingest({
      projectId: "p",
      jobId: job.id,
      results: [],
      status: "complete",
    });
    await e.service.recover();
    await e.service.recover();
    const children = e.service
      .jobs("p")
      .filter((j) => j.parentJobId === job.id);
    assert.equal(children.length, skip ? 0 : 1);
    if (!skip) {
      assert.equal(children[0].kind, "footage");
      assert.equal(
        e.service.read("p").jobs.find((j) => j.id === job.id).status,
        "partial",
      );
    }
  }
});
test("unknown footage source kinds are rejected", async () => {
  const e = await fixture(),
    r = e.resultFor(e.job);
  const review = JSON.parse(readFileSync(r.footage.reviewPath));
  review.candidates[0].sourceKind = "unknown";
  writeFileSync(r.footage.reviewPath, JSON.stringify(review));
  r.footage.reviewSha256 = sha(r.footage.reviewPath);
  await assert.rejects(
    e.service.ingest({ projectId: "p", jobId: e.job.id, results: [r] }),
    /source.*kind|sourceKind/i,
  );
});
test("parent retains its complete status across an initial child-dispatch failure and successful recovery", async () => {
  const e = await fixture();
  const { job } = await e.service.createJob({
    projectId: "p",
    revision: e.service.read("p").document.revision,
    kind: "broll",
    scope: { camera: false, sound: false },
  });
  const { dirname } = await import("node:path"),
    { rmSync } = await import("node:fs");
  const childId =
      "footage-" +
      createHash("sha256").update(job.id).digest("hex").slice(0, 24),
    partialDir = join(dirname(dirname(job.snapshotPath)), childId);
  mkdirSync(partialDir, { recursive: true });
  const collision = join(partialDir, "snapshot.json");
  writeFileSync(collision, "simulated incomplete dispatch");
  writeFileSync(
    join(job.outputDir, "status.json"),
    JSON.stringify({ state: "complete" }),
  );
  writeFileSync(
    join(job.outputDir, "manifest.json"),
    JSON.stringify({ state: "complete" }),
  );
  await e.service.ingest({
    projectId: "p",
    jobId: job.id,
    results: [],
    status: "complete",
  });
  await e.service.recover();
  let parent = e.service.getJob(job.id);
  assert.equal(parent.footageStatus, "failed");
  assert.equal(parent.status, "partial");
  assert.equal(parent.animationStatus, "complete");
  rmSync(collision);
  await e.service.recover();
  const child = e.service.jobs("p").find((j) => j.parentJobId === job.id);
  assert.ok(child);
  await e.service.ingest({
    projectId: "p",
    jobId: child.id,
    results: [],
    status: "complete",
  });
  parent = e.service.read("p").jobs.find((j) => j.id === job.id);
  assert.equal(parent.status, "complete");
});
test("finished footage persists its upstream package and a new broll snapshot reuses all bound files by hash", async () => {
  const e = await fixture(),
    r = e.resultFor(e.job, "finished");
  const summaryPath = join(e.job.outputDir, "真实素材审稿与候选.md"),
    allCandidateManifestPath = join(e.job.outputDir, "footage-candidates.json");
  writeFileSync(summaryPath, "素材报告");
  writeFileSync(allCandidateManifestPath, "[]");
  const outputs = {
    footageReviewPath: r.footage.reviewPath,
    footageSummaryPath: summaryPath,
    allCandidateManifestPath,
  };
  writeFileSync(
    join(e.job.outputDir, "manifest.json"),
    JSON.stringify({
      outputs,
      files: Object.values(outputs).map((path) => ({
        path,
        sha256: sha(path),
      })),
    }),
  );
  const verifiedManifest = JSON.parse(
    readFileSync(join(e.job.outputDir, "manifest.json")),
  );
  writeFileSync(
    join(e.job.outputDir, "result-manifest.json"),
    JSON.stringify(verifiedManifest),
  );
  writeFileSync(
    join(e.job.outputDir, "manifest.json"),
    JSON.stringify({
      outputs,
      workflowManifestPath: join(e.job.outputDir, "result-manifest.json"),
    }),
  );
  const response = await e.service.ingest({
    projectId: "p",
    jobId: e.job.id,
    results: [r],
    status: "complete",
  });
  const pkg = response.document.productionPlan.upstream?.footagePackage;
  assert.equal(pkg.reviewPath, r.footage.reviewPath);
  assert.equal(pkg.summaryPath, summaryPath);
  assert.equal(pkg.allCandidateManifestPath, allCandidateManifestPath);
  assert.equal(pkg.jobId, e.job.id);
  assert.equal(pkg.reviewSha256, r.footage.reviewSha256);
  const { job } = await e.service.createJob({
    projectId: "p",
    revision: e.service.read("p").document.revision,
    kind: "broll",
    script: "实际界面",
    scope: { camera: false, sound: false, footage: false },
  });
  const snapshot = JSON.parse(readFileSync(job.snapshotPath));
  for (const path of Object.values(outputs))
    assert.ok(
      snapshot.inputs.some(
        (i) => i.originalPath === path && i.sha256 === sha(path),
      ),
    );
  const out = join(e.root, "new-broll-request");
  execFileSync("python3", [
    "-c",
    'import json,sys;sys.path.insert(0,"../workflow/tools");from editor_plan_runtime import prepare_external_job;prepare_external_job(json.load(open(sys.argv[1])),sys.argv[2])',
    job.snapshotPath,
    out,
  ]);
  const request = JSON.parse(readFileSync(join(out, "external-job.json")));
  assert.equal(request.footagePackage.reviewSha256, r.footage.reviewSha256);
  for (const key of ["reviewPath", "summaryPath", "allCandidateManifestPath"])
    assert.ok(
      request.sources.some(
        (s) =>
          s.path === request.footagePackage[key] &&
          s.sha256 === sha(request.footagePackage[key]),
      ),
    );
});
test("current upstream final summary resolves only within this project registered job outputs", async () => {
  const e = await fixture(),
    summary = join(e.job.outputDir, "最终package总结-含真实素材审稿.md");
  writeFileSync(summary, "最终总结");
  let d = loadDocument("p", e.options);
  d.productionPlan.upstream = {
    ...d.productionPlan.upstream,
    animationPackage: { finalSummaryPath: summary },
  };
  saveDocument(d, e.options);
  assert.equal(e.service.resolveFile("p", summary), realpathSync(summary));
  const outside = join(e.root, "unregistered.md");
  writeFileSync(outside, "private");
  d = loadDocument("p", e.options);
  d.productionPlan.upstream.animationPackage.finalSummaryPath = outside;
  saveDocument(d, e.options);
  assert.throws(() => e.service.resolveFile("p", outside), /not referenced/i);
  let other = createDocument({
    id: "q",
    name: "Q",
    canvas: {
      width: 720,
      height: 1280,
      fps: { num: 30, den: 1 },
      durationFrames: 300,
    },
    productionPlan: { shots: [] },
  });
  other = saveDocument(other, e.options);
  const { job } = await e.service.createJob({
      projectId: "q",
      revision: other.revision,
      kind: "footage",
    }),
    foreign = join(job.outputDir, "foreign.md");
  writeFileSync(foreign, "other project");
  d = loadDocument("p", e.options);
  d.productionPlan.upstream.animationPackage.finalSummaryPath = foreign;
  saveDocument(d, e.options);
  assert.throws(() => e.service.resolveFile("p", foreign), /not referenced/i);
  const { symlinkSync } = await import("node:fs"),
    linked = join(e.job.outputDir, "linked.md");
  symlinkSync(outside, linked);
  d = loadDocument("p", e.options);
  d.productionPlan.upstream.animationPackage.finalSummaryPath = linked;
  saveDocument(d, e.options);
  assert.throws(() => e.service.resolveFile("p", linked), /not referenced/i);
});

test('new full package accepts its camera update before footage, but source clips remain protected',async()=>{
 const e=await fixture();const {job}=await e.service.createJob({projectId:'p',revision:e.service.read('p').document.revision,kind:'package'});
 const r=e.resultFor(job);let d=e.service.read('p').document;d.source.cameraPlan={version:2,duration:10,levels:{A:1},anchor:{x:.5,y:.5},events:[{at:0,to:'A',transition:'cut',purpose:'hook',cue:'实际界面',reason:'本轮保留构图'}]};saveDocument(d,e.options);
 const response=await e.service.ingest({projectId:'p',jobId:job.id,results:[r]});assert.equal(response.job.results[0].state,'applied');
 const second=await e.service.createJob({projectId:'p',revision:e.service.read('p').document.revision,kind:'package'});const changed=e.resultFor(second.job,'changed-footage');d=e.service.read('p').document;d.source.clips=[{id:'different-cut',startFrame:0,durationFrames:30,sourceInFrame:0}];saveDocument(d,e.options);
 const stale=await e.service.ingest({projectId:'p',jobId:second.job.id,results:[changed]});assert.equal(stale.job.results[0].state,'stale');
});

async function scopedExecutionFixture(){
 const e=await fixture();let d=loadDocument('p',e.options);d.productionPlan.shots[0].timing={manual:true,status:'manual',ranges:[{id:'selected',startFrame:0,durationFrames:30}]};d.productionPlan.upstream={footagePackage:{reviewPath:'full-film.json',summaryPath:'full-summary.md',allCandidateManifestPath:'full-candidates.json',reviewSha256:'a'.repeat(64)}};d=saveDocument(d,e.options);
 const {job:parent}=await e.service.createJob({projectId:'p',revision:d.revision,kind:'revise',shotId:'old',rangeId:'selected',instructions:'找使用电脑的镜头'});const snap=JSON.parse(readFileSync(parent.snapshotPath));
 await e.service.ingest({projectId:'p',jobId:parent.id,status:'partial',results:[{id:`request-${parent.id}`,jobId:parent.id,projectId:'p',kind:'shot-revision',shotId:'old',target:snap.target,reason:'执行素材查找',gaps:[],patches:[],execution:{kind:'footage',instructions:'下载可用镜头推荐入轨'}}]});
 const child=e.service.getJob(e.service.getJob(parent.id).executionJobId),r=e.resultFor(child,`scoped-${child.id}`);const review=JSON.parse(readFileSync(r.footage.reviewPath));review.sections[0].id='old';review.candidates[0].matchedSectionIds=['old'];review.placements[0].sectionId='old';review.placements[0].startFrame=0;r.target.startFrame=0;writeFileSync(r.footage.reviewPath,JSON.stringify(review));r.footage.reviewSha256=sha(r.footage.reviewPath);return {...e,parent,child,result:r};
}
test('scoped revision execution saves real placement per-shot upstream and preserves full-film report and manual media',async()=>{
 const e=await scopedExecutionFixture(),r=e.result;const summaryPath=join(e.child.outputDir,'summary.md'),allCandidateManifestPath=join(e.child.outputDir,'candidates.json');writeFileSync(summaryPath,'selected shot');writeFileSync(allCandidateManifestPath,'[]');const outputs={footageReviewPath:r.footage.reviewPath,footageSummaryPath:summaryPath,allCandidateManifestPath};writeFileSync(join(e.child.outputDir,'manifest.json'),JSON.stringify({outputs,files:Object.values(outputs).map(path=>({path,sha256:sha(path)}))}));
 const response=await e.service.ingest({projectId:'p',jobId:e.child.id,results:[r],status:'complete'});
 assert.equal(response.job.results[0].state,'applied');assert.equal(e.service.getJob(e.parent.id).executionStatus,'complete');assert.equal(response.document.productionPlan.upstream.footagePackage.reviewPath,'full-film.json');assert.equal(response.document.productionPlan.shots[0].upstream.footagePackage.reviewPath,r.footage.reviewPath);assert.equal(response.document.instances.find(i=>i.id==='manual').props.size,40);assert.equal(e.service.resolveFile('p',summaryPath),realpathSync(summaryPath));e.service.close();
});
test('scoped footage rejects foreign sections candidate associations and out-of-range placements before library registration',async()=>{
 for(const change of ['cue','candidate','placement','section']){
  const e=await scopedExecutionFixture(),r=e.result,review=JSON.parse(readFileSync(r.footage.reviewPath));if(change==='cue'){review.sections[0].sourceCueIds=[99];review.placements[0].sourceCueIds=[99];}if(change==='candidate')review.candidates[0].matchedSectionIds=['foreign'];if(change==='section'){review.sections[0].id='foreign';review.candidates[0].matchedSectionIds=['foreign'];review.placements[0].sectionId='foreign';}if(change==='placement'){review.placements[0].startFrame=60;r.target.startFrame=60;}writeFileSync(r.footage.reviewPath,JSON.stringify(review));r.footage.reviewSha256=sha(r.footage.reviewPath);
  await assert.rejects(e.service.ingest({projectId:'p',jobId:e.child.id,results:[r]}),/Scoped footage/);assert.equal(e.service.read('p').document.instances.length,1);e.service.close();
 }
});
test('scoped child never applies after parent cancellation or selected requirement changes and empty completion remains partial',async()=>{
 for(const action of ['cancel','change','empty']){
  const e=await scopedExecutionFixture();if(action==='cancel')e.service.cancel(e.parent.id);if(action==='change')e.service.action({projectId:'p',revision:e.service.read('p').document.revision,operation:{type:'edit-shot',shotId:'old',patch:{visualRequirement:'later user request'}}});
  await e.service.ingest({projectId:'p',jobId:e.child.id,results:action==='empty'?[]:[e.result],status:'complete'});assert.equal(e.service.read('p').document.instances.length,1);assert.notEqual(e.service.read('p').jobs.find(j=>j.id===e.parent.id).executionStatus,'complete');e.service.close();
 }
});
test('newer no-op revision invalidates old execution footage before it can append',async()=>{
 const e=await scopedExecutionFixture();const d=e.service.read('p').document;await e.service.createJob({projectId:'p',revision:d.revision,kind:'revise',shotId:'old',instructions:'改为另一种画面'});const applied=await e.service.ingest({projectId:'p',jobId:e.child.id,status:'complete',results:[e.result]});assert.equal(applied.job.results[0].state,'stale');assert.equal(applied.document.instances.length,1);e.service.close();
});

async function adoptionFixture({placement=true,long=false,remote=false,download}={}){
 const e=await scopedExecutionFixture(),r=e.result;let review=JSON.parse(readFileSync(r.footage.reviewPath));if(!placement)review.placements=[];writeFileSync(r.footage.reviewPath,JSON.stringify(review));r.footage.reviewSha256=sha(r.footage.reviewPath);r.footage.placementId=null;delete r.target;delete r.media.sourceInSeconds;delete r.media.sourceOutSeconds;await e.service.ingest({projectId:'p',jobId:e.child.id,results:[r],status:'complete'});
 if(long||remote){let d=loadDocument('p',e.options);if(long)d.productionPlan.shots[0].timing.ranges[0].durationFrames=90;if(remote)d.productionPlan.shots[0].candidates=[{id:'remote',slotId:'overlay',title:'电脑',reason:'演示',url:'https://example.com/view',downloadUrl:'https://example.com/movie.mp4',license:'CC0'}];d=saveDocument(d,e.options);}
 if(remote){e.service.close();const {copyFileSync}=await import('node:fs');e.options.candidateDownloadTools={download:download??(async(_url,target)=>copyFileSync(r.media.path,target)),inspect:(await import('../lib/candidate-download.mjs')).inspectDownloadedMedia};e.service=createProductionPlanService(e.options);}
 return {...e,request:()=>({projectId:'p',revision:e.service.read('p').document.revision,shotId:'old',candidateId:remote?'remote':'c1',addToTimeline:true})};
}
test('candidate local download adds verified exact placement as editable muted contain instance, duplicate does not append',async()=>{
 const e=await adoptionFixture();const before=e.service.read('p').document;const result=await e.service.candidateDownload(e.request());assert.equal(result.added,true);assert.ok(result.instanceId);assert.equal(result.document.instances.length,2);assert.equal(result.document.revision,before.revision+1);const instance=result.document.instances.find(i=>i.id===result.instanceId);assert.equal(instance.startFrame,0);assert.equal(instance.durationFrames,30);assert.equal(instance.props.media.startSeconds,.5);assert.equal(instance.props.media.muted,true);assert.equal(instance.props.crop.width,1);assert.equal(instance.props.crop.height,1);assert.equal(result.document.instances.find(i=>i.id==='manual').props.size,40);
 const duplicate=await e.service.candidateDownload(e.request());assert.equal(duplicate.added,false);assert.equal(duplicate.alreadyPresent,true);assert.equal(duplicate.instanceId,result.instanceId);assert.equal(duplicate.document.instances.length,2);e.service.close();
});
test('candidate without placement uses canonical range and actual short source; cached download still adopts exactly once',async()=>{
 let downloads=0;const e=await adoptionFixture({placement:false,long:true,remote:true,download:async(_url,target)=>{downloads++;(await import('node:fs')).copyFileSync(e.result.media.path,target);}});await e.service.candidateDownload({projectId:'p',shotId:'old',candidateId:'remote'});assert.equal(downloads,1);assert.equal(e.service.read('p').document.instances.length,1);const result=await e.service.candidateDownload(e.request());assert.equal(result.added,true);assert.equal(downloads,1);const instance=result.document.instances.find(i=>i.id===result.instanceId);assert.equal(instance.startFrame,0);assert.equal(instance.durationFrames,60);assert.equal(instance.props.media.startSeconds,0);assert.equal(instance.props.media.durationSeconds,2);assert.equal(result.document.source.durationFrames,60);e.service.close();
});
test('candidate adoption rejects stale revision protected/deleted shot and ambiguous ranges',async()=>{
 for(const action of ['revision','locked','deleted','ranges']){const e=await adoptionFixture();let request=e.request();if(action==='revision')request.revision--;else{let d=loadDocument('p',e.options);if(action==='locked')d.productionPlan.shots[0].locked=true;if(action==='deleted')d.productionPlan.shots[0].cancelled=true;if(action==='ranges')d.productionPlan.shots[0].timing.ranges.push({id:'other',startFrame:90,durationFrames:30});d=saveDocument(d,e.options);request.revision=d.revision;}await assert.rejects(e.service.candidateDownload(request));assert.equal(e.service.read('p').document.instances.length,1);e.service.close();}
});
test('candidate adoption refuses to restore a previously removed selected media instance',async()=>{
 const e=await adoptionFixture(),result=await e.service.candidateDownload(e.request());let d=loadDocument('p',e.options);d.instances=d.instances.filter(i=>i.id!==result.instanceId);d=saveDocument(d,e.options);await assert.rejects(e.service.candidateDownload(e.request()),/已删除|removed/);assert.equal(e.service.read('p').document.instances.length,1);e.service.close();
});
test('candidate range changed during a pending download fails without guessing a new position',async()=>{
 let unblock,started;const start=new Promise(resolve=>started=resolve),wait=new Promise(resolve=>unblock=resolve);const e=await adoptionFixture({placement:false,remote:true,download:async(_url,target)=>{started();await wait;(await import('node:fs')).copyFileSync(e.result.media.path,target);}});const pending=e.service.candidateDownload(e.request());await start;let d=loadDocument('p',e.options);d.productionPlan.shots[0].timing.ranges[0].startFrame=120;saveDocument(d,e.options);unblock();await assert.rejects(pending,/改变|变化|changed/);assert.equal(e.service.read('p').document.instances.length,1);e.service.close();
});
test('concurrent only-download and add requests share file download but only the explicit add mutates timeline',async()=>{
 let downloads=0,unblock,started;const wait=new Promise(resolve=>unblock=resolve),start=new Promise(resolve=>started=resolve);const e=await adoptionFixture({placement:false,remote:true,download:async(_url,target)=>{downloads++;started();await wait;(await import('node:fs')).copyFileSync(e.result.media.path,target);}});
 const plain=e.service.candidateDownload({projectId:'p',shotId:'old',candidateId:'remote'});await start;const adopted=e.service.candidateDownload(e.request());unblock();const [download,result]=await Promise.all([plain,adopted]);assert.equal(download.added,undefined);assert.equal(result.added,true);assert.equal(downloads,1);assert.equal(download.path,result.path);assert.equal(e.service.read('p').document.instances.length,2);e.service.close();
});
test('download-time cancellation locks or source changes prevent adoption while unrelated edit rebases safely',async()=>{
 for(const action of ['cancel','locked','source','unrelated']){let unblock,started;const wait=new Promise(resolve=>unblock=resolve),start=new Promise(resolve=>started=resolve);const e=await adoptionFixture({placement:false,remote:true,download:async(_url,target)=>{started();await wait;(await import('node:fs')).copyFileSync(e.result.media.path,target);}});const pending=e.service.candidateDownload(e.request());await start;let d=loadDocument('p',e.options);if(action==='cancel')d.productionPlan.shots[0].cancelled=true;if(action==='locked')d.productionPlan.shots[0].locked=true;if(action==='source')d.source.startFrame=30;if(action==='unrelated')d.name='新标题';saveDocument(d,e.options);unblock();if(action==='unrelated'){const result=await pending;assert.equal(result.added,true);assert.equal(result.document.name,'新标题');}else{await assert.rejects(pending,/变化|取消|锁定|deleted|changed/);assert.equal(e.service.read('p').document.instances.length,1);}e.service.close();}
});
test('explicit candidate range selects one current range and adding a second candidate preserves independent first selection',async()=>{
 const e=await adoptionFixture({placement:false,remote:true});let d=loadDocument('p',e.options);d.productionPlan.shots[0].timing.ranges.push({id:'second-range',startFrame:90,durationFrames:30});const second={...d.productionPlan.shots[0].candidates[0],id:'second-candidate'};d.productionPlan.shots[0].candidates.push(second);saveDocument(d,e.options);
 const first=await e.service.candidateDownload({...e.request(),rangeId:'selected'});const next=await e.service.candidateDownload({...e.request(),candidateId:'second-candidate',rangeId:'second-range'});assert.equal(first.added,true);assert.equal(next.added,true);assert.equal(next.document.instances.length,3);assert.equal(next.document.instances.find(i=>i.id===first.instanceId).startFrame,0);assert.equal(next.document.instances.find(i=>i.id===next.instanceId).startFrame,90);assert.deepEqual(next.document.source,e.before.source);e.service.close();
});
test('new selected-shot feedback request during download invalidates candidate adoption even without semantic patches',async()=>{
 let unblock,started;const wait=new Promise(resolve=>unblock=resolve),start=new Promise(resolve=>started=resolve);const e=await adoptionFixture({placement:false,remote:true,download:async(_url,target)=>{started();await wait;(await import('node:fs')).copyFileSync(e.result.media.path,target);}});const pending=e.service.candidateDownload(e.request());await start;await e.service.createJob({projectId:'p',revision:e.service.read('p').document.revision,kind:'revise',shotId:'old',rangeId:'selected',instructions:'换一种画面'});unblock();await assert.rejects(pending,/变化/);assert.equal(e.service.read('p').document.instances.length,1);e.service.close();
});
async function legacyAdoptionFixture(){
 const e=await adoptionFixture();const r=e.resultFor(e.child,`legacy-${e.child.id}`),review=JSON.parse(readFileSync(r.footage.reviewPath));review.sections[0].id='old';review.candidates[0].matchedSectionIds=['old'];review.placements[0].sectionId='old';review.placements[0].startFrame=0;r.target.startFrame=0;writeFileSync(r.footage.reviewPath,JSON.stringify(review));r.footage.reviewSha256=sha(r.footage.reviewPath);await e.service.ingest({projectId:'p',jobId:e.child.id,results:[r],status:'complete'});const instance=e.service.read('p').document.instances.find(i=>i.props?.footageIdentity?.resultId===r.id);return {...e,legacyInstanceId:instance.id};
}
test('manually trimmed moved cropped hidden and locked candidate remains already present without any editor mutation',async()=>{
 for(const kind of ['legacy','selection']){const e=kind==='legacy'?await legacyAdoptionFixture():await adoptionFixture();const selected=kind==='legacy'?{instanceId:e.legacyInstanceId}:await e.service.candidateDownload(e.request());let d=loadDocument('p',e.options),instance=d.instances.find(i=>i.id===selected.instanceId);instance.startFrame=8;instance.durationFrames=20;instance.props.media.startSeconds=.8;instance.props.crop={x:.1,y:0,width:.9,height:1,sourceAspect:1280/720};instance.locked=true;instance.manual=true;const track=d.tracks.find(t=>t.id===instance.trackId);track.locked=true;track.hidden=true;d=saveDocument(d,e.options);const before=structuredClone(d);const result=await e.service.candidateDownload(e.request());assert.equal(result.added,false);assert.equal(result.alreadyPresent,true);assert.equal(result.instanceId,selected.instanceId);assert.deepEqual(result.document,before);e.service.close();}
});
test('same candidate in another range does not prevent adding to explicitly selected current range',async()=>{
 for(const kind of ['legacy','selection']){const e=kind==='legacy'?await legacyAdoptionFixture():await adoptionFixture();const selected=kind==='legacy'?{instanceId:e.legacyInstanceId}:await e.service.candidateDownload(e.request());let d=loadDocument('p',e.options);d.productionPlan.shots[0].timing.ranges.push({id:'other-range',startFrame:90,durationFrames:30});d.instances.find(i=>i.id===selected.instanceId).startFrame=90;d=saveDocument(d,e.options);const result=await e.service.candidateDownload({...e.request(),rangeId:'selected'});assert.equal(result.added,true);assert.notEqual(result.instanceId,selected.instanceId);assert.equal(result.document.instances.find(i=>i.id===selected.instanceId).startFrame,90);assert.equal(result.document.instances.find(i=>i.id===result.instanceId).startFrame,0);assert.equal(result.document.instances.length,3);let removed=structuredClone(result.document);removed.instances=removed.instances.filter(i=>i.id!==result.instanceId);saveDocument(removed,e.options);await assert.rejects(e.service.candidateDownload({...e.request(),rangeId:'selected'}),/已删除|removed/);e.service.close();}
});
test('deleted legacy footage remains deleted when the candidate button is pressed again',async()=>{
 const e=await legacyAdoptionFixture();let d=loadDocument('p',e.options);d.instances=d.instances.filter(i=>i.id!==e.legacyInstanceId);saveDocument(d,e.options);await assert.rejects(e.service.candidateDownload(e.request()),/已删除|removed/);assert.equal(e.service.read('p').document.instances.length,1);e.service.close();
});
test('candidate associated with another shot does not count as present even when its media overlaps selected range',async()=>{
 const e=await legacyAdoptionFixture();let d=loadDocument('p',e.options);const foreign={...structuredClone(d.productionPlan.shots[0]),id:'foreign',bindings:[{id:'foreign-binding',slotId:'overlay',instanceId:e.legacyInstanceId,candidateId:'c1',sourceInSeconds:.5,sourceOutSeconds:1.5,status:'current'}]};d.productionPlan.shots.push(foreign);d=saveDocument(d,e.options);const preserved=structuredClone(d.instances.find(i=>i.id===e.legacyInstanceId));const result=await e.service.candidateDownload(e.request());assert.equal(result.added,true);assert.notEqual(result.instanceId,e.legacyInstanceId);assert.deepEqual(result.document.instances.find(i=>i.id===e.legacyInstanceId),preserved);assert.equal(result.document.instances.length,3);e.service.close();
});
