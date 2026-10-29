import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative, isAbsolute } from "node:path";
import {
  createDocument,
  saveDocument,
  loadDocument,
} from "../lib/editor-store.mjs";
import { createProductionPlanService } from "../lib/production-plan-jobs.mjs";
const srt = "1\n00:00:00,000 --> 00:00:01,000\n真实字幕\n";
test("recognition preserves explicit external CLI media and custom artifact roots in its catalog", async () => {
  const { options, external } = setup();
  options.rootDir = join(options.root, "workspace/editor-projects");
  const document = saveDocument(
    createDocument({
      id: "isolated",
      name: "Isolated",
      canvas: {
        width: 160,
        height: 90,
        fps: { num: 10, den: 1 },
        durationFrames: 10,
      },
    }),
    options,
  );
  const externalMedia = join(external, "recording.mp4");
  writeFileSync(externalMedia, "explicit CLI input");
  const service = createProductionPlanService(options);
  const { job } = await service.createJob({
    projectId: "isolated",
    revision: document.revision,
    kind: "recognize",
    mediaPaths: [externalMedia],
  });
  const snapshot = JSON.parse(readFileSync(job.snapshotPath));
  assert.equal(
    readFileSync(snapshot.mediaPaths[0], "utf8"),
    "explicit CLI input",
  );
  assert.equal(snapshot.inputs[0].originalPath, externalMedia);
  service.cancel(job.id);
  writeFileSync(snapshot.mediaPaths[0], "corrupt archive");
  await assert.rejects(service.retry(job.id), /hash mismatch/i);
});
test("relative imported recognition media is archived absolutely and survives retry worker launch", async () => {
  const { options, document, external } = setup();
  const reference =
    "templates/remotion-base/public/editor-project-media/p/imported.mp4";
  const original = join(options.root, reference);
  mkdirSync(dirname(original), { recursive: true });
  writeFileSync(original, "uploaded media identity");
  const worker = join(external, "worker.py");
  writeFileSync(
    worker,
    `import sys,json,pathlib,hashlib\na=sys.argv\ns=json.loads(pathlib.Path(a[a.index('--snapshot')+1]).read_text())\nfor p in s['mediaPaths']:\n assert pathlib.Path(p).is_absolute()\n assert pathlib.Path(p).read_text()=='uploaded media identity'\n assert any(i['path']==p and i['sha256']==hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest() for i in s['inputs'])\no=pathlib.Path(a[a.index('--output-dir')+1]);(o/'consumed.json').write_text(json.dumps(s))\n`,
  );
  const service = createProductionPlanService({
    ...options,
    contentRoot: external,
    workerPath: worker,
    pollMs: 20,
  });
  const { job } = await service.createJob({
    projectId: "p",
    revision: document.revision,
    kind: "recognize",
    mediaPaths: [reference, original],
  });
  const snapshot = JSON.parse(readFileSync(job.snapshotPath));
  assert.equal(snapshot.mediaPaths.length, 1);
  assert.ok(isAbsolute(snapshot.mediaPaths[0]));
  assert.notEqual(snapshot.mediaPaths[0], original);
  assert.equal(snapshot.inputs[0].path, snapshot.mediaPaths[0]);
  assert.equal(snapshot.inputs[0].originalPath, original);
  service.cancel(job.id);
  rmSync(original);
  const retried = await service.retry(job.id);
  await service.pump();
  for (
    let n = 0;
    n < 150 && !existsSync(join(retried.job.outputDir, "consumed.json"));
    n++
  )
    await new Promise((r) => setTimeout(r, 10));
  assert.ok(
    existsSync(join(retried.job.outputDir, "consumed.json")),
    JSON.stringify(service.getJob(retried.job.id)),
  );
  await service.close();
});
test("recognition media rejects relative traversal, symlink escape and another project imports", async () => {
  const { options, document, external } = setup();
  const outside = join(external, "private.mp4");
  writeFileSync(outside, "private");
  const link = join(options.root, "escaped.mp4");
  symlinkSync(outside, link);
  const foreign =
    "templates/remotion-base/public/editor-project-media/other/imported.mp4";
  mkdirSync(dirname(join(options.root, foreign)), { recursive: true });
  writeFileSync(join(options.root, foreign), "other project");
  const service = createProductionPlanService(options);
  for (const path of [relative(options.root, outside), "escaped.mp4", foreign])
    await assert.rejects(
      service.createJob({
        projectId: "p",
        revision: document.revision,
        kind: "recognize",
        mediaPaths: [path],
      }),
      /outside|escape|permitted|project|越界/i,
    );
});
function setup() {
  const root = mkdtempSync(join(tmpdir(), "plan-input-archive-")),
    external = mkdtempSync(join(tmpdir(), "plan-external-"));
  const options = {
    root,
    rootDir: join(root, "index"),
    artifactRoot: join(root, "artifacts"),
    assetSourceRoot: root,
    autoStart: false,
    contentRoot: root,
  };
  mkdirSync(join(root, "templates/remotion-base/public"), { recursive: true });
  const sourceSrtPath = join(external, "raw.srt"),
    audioPath = join(external, "voice.wav");
  writeFileSync(sourceSrtPath, srt);
  writeFileSync(audioPath, "audio identity fixture");
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
      productionPlan: { shots: [] },
    }),
    options,
  );
  return { options, external, sourceSrtPath, audioPath, document };
}
function assertInputs(snapshot, original) {
  assert.equal(readFileSync(snapshot.sourceSrtPath, "utf8"), srt);
  assert.equal(
    readFileSync(snapshot.audioPath, "utf8"),
    "audio identity fixture",
  );
  assert.notEqual(snapshot.sourceSrtPath, original.sourceSrtPath);
  assert.notEqual(snapshot.audioPath, original.audioPath);
  assert.equal(
    snapshot.inputs.every((i) => existsSync(i.path)),
    true,
  );
  assert.equal(existsSync(original.sourceSrtPath), false);
  assert.equal(existsSync(original.audioPath), false);
}
test("saved plan archives transcript and paired audio and resolves deleted external originals", async () => {
  const env = setup(),
    { options, sourceSrtPath, audioPath } = env;
  const d = loadDocument("p", options);
  d.productionPlan.sourceSrtPath = sourceSrtPath;
  d.productionPlan.audioPath = audioPath;
  const saved = saveDocument(d, options),
    dir = join(saved.projectBinding.projectRoot, ".制作资料", "剪辑工程", "p");
  const manifest = JSON.parse(readFileSync(join(dir, "media-snapshot.json")));
  assert.equal(manifest.length, 2);
  rmSync(env.external, { recursive: true });
  const service = createProductionPlanService(options);
  const { job } = await service.createJob({
    projectId: "p",
    revision: loadDocument("p", options).revision,
    kind: "align",
  });
  assertInputs(JSON.parse(readFileSync(job.snapshotPath)), env);
  assert.equal(
    readFileSync(service.resolveFile("p", sourceSrtPath), "utf8"),
    srt,
  );
});
test("request-only inputs survive deletion, new jobs, migration, retry and actual worker launch", async () => {
  const env = setup(),
    { options, sourceSrtPath, audioPath, document } = env;
  let service = createProductionPlanService(options);
  const { job } = await service.createJob({
    projectId: "p",
    revision: document.revision,
    kind: "align",
    sourceSrtPath,
    audioPath,
  });
  service.cancel(job.id);
  rmSync(env.external, { recursive: true });
  assertInputs(JSON.parse(readFileSync(job.snapshotPath)), env);
  const next = await service.createJob({
    projectId: "p",
    revision: document.revision,
    kind: "align",
    sourceSrtPath,
    audioPath,
  });

  const oldRoot = loadDocument("p", options).projectBinding.projectRoot,
    newRoot = join(options.artifactRoot, "moved");
  service.action({
    projectId: "p",
    revision: document.revision,
    operation: { type: "relocate", projectRoot: newRoot },
  });
  rmSync(oldRoot, { recursive: true });
  const worker = join(options.root, "archive-worker.py");
  writeFileSync(
    worker,
    `import sys,json,pathlib,hashlib\na=sys.argv\ns=json.loads(pathlib.Path(a[a.index('--snapshot')+1]).read_text())\nfor i in s['inputs']:\n assert hashlib.sha256(pathlib.Path(i['path']).read_bytes()).hexdigest()==i['sha256']\nassert pathlib.Path(s['sourceSrtPath']).read_text()==${JSON.stringify(srt)}\nassert pathlib.Path(s['audioPath']).read_text()=='audio identity fixture'\no=pathlib.Path(a[a.index('--output-dir')+1]);o.mkdir(exist_ok=True)\n(o/'consumed.json').write_text(json.dumps(s))\n`,
  );
  service = createProductionPlanService({
    ...options,
    workerPath: worker,
    pollMs: 20,
  });
  const retried = await service.retry(job.id);
  assertInputs(JSON.parse(readFileSync(retried.job.snapshotPath)), env);
  await service.pump();
  for (
    let n = 0;
    n < 150 &&
    (!existsSync(join(retried.job.outputDir, "consumed.json")) ||
      !existsSync(
        join(service.getJob(next.job.id).outputDir, "consumed.json"),
      ));
    n++
  )
    await new Promise((r) => setTimeout(r, 10));
  assertInputs(
    JSON.parse(readFileSync(join(retried.job.outputDir, "consumed.json"))),
    env,
  );
  const relocatedQueued = service.getJob(next.job.id);
  assertInputs(
    JSON.parse(readFileSync(join(relocatedQueued.outputDir, "consumed.json"))),
    env,
  );
  assert.equal(
    existsSync(
      join(dirname(relocatedQueued.snapshotPath), "execution-snapshot.json"),
    ),
    true,
  );
  assert.equal(
    JSON.parse(readFileSync(join(relocatedQueued.outputDir, "consumed.json")))
      .document.projectBinding.projectRoot,
    newRoot,
  );
  service.close();
});

test("moving an archived plan while originals exist still restores older job references", async () => {
  const env = setup(),
    { options, sourceSrtPath, audioPath } = env;
  let d = loadDocument("p", options);
  d.productionPlan.sourceSrtPath = sourceSrtPath;
  d.productionPlan.audioPath = audioPath;
  d = saveDocument(d, options);
  const service = createProductionPlanService(options),
    { job } = await service.createJob({
      projectId: "p",
      revision: d.revision,
      kind: "align",
    });
  service.cancel(job.id);
  const oldRoot = d.projectBinding.projectRoot;
  service.action({
    projectId: "p",
    revision: d.revision,
    operation: {
      type: "relocate",
      projectRoot: join(options.artifactRoot, "new-home"),
    },
  });
  rmSync(oldRoot, { recursive: true });
  rmSync(env.external, { recursive: true });
  const { job: retry } = await service.retry(job.id);
  assertInputs(JSON.parse(readFileSync(retry.snapshotPath)), env);
});

test("missing originals never allow corrupted auxiliary archives to become new job inputs", async () => {
  const env = setup(),
    { options, sourceSrtPath, audioPath, document } = env,
    service = createProductionPlanService(options);
  const { job } = await service.createJob({
    projectId: "p",
    revision: document.revision,
    kind: "align",
    sourceSrtPath,
    audioPath,
  });
  const snapshot = JSON.parse(readFileSync(job.snapshotPath));
  rmSync(env.external, { recursive: true });
  writeFileSync(snapshot.sourceSrtPath, "corrupted");
  await assert.rejects(
    () =>
      service.createJob({
        projectId: "p",
        revision: document.revision,
        kind: "align",
        sourceSrtPath,
        audioPath,
      }),
    /hash mismatch/,
  );
  assert.equal(service.jobs("p").length, 1);
});
test("streaming auxiliary archives preserve CAS and file identity during concurrent changes", async () => {
  for (const kind of ["document", "input"]) {
    const env = setup(),
      { options, sourceSrtPath, document } = env,
      service = createProductionPlanService(options);
    writeFileSync(sourceSrtPath, Buffer.alloc(8 * 1024 * 1024, 3));
    let responsive = false;
    setImmediate(() => {
      responsive = true;
      if (kind === "input")
        writeFileSync(sourceSrtPath, Buffer.alloc(8 * 1024 * 1024, 4));
      else
        saveDocument(
          { ...loadDocument("p", options), name: "concurrent" },
          options,
        );
    });
    await assert.rejects(
      () =>
        service.createJob({
          projectId: "p",
          revision: document.revision,
          kind: "align",
          sourceSrtPath,
        }),
      kind === "input" ? /changed while hashing/ : /Revision conflict/,
    );
    assert.equal(responsive, true);
    assert.equal(service.jobs("p").length, 0);
  }
});

test("retry and explicit resume reject corrupted existing archived auxiliary inputs", async () => {
  for (const field of ["sourceSrtPath", "audioPath"]) {
    const env = setup(),
      { options, document } = env,
      service = createProductionPlanService(options);
    const { job } = await service.createJob({
      projectId: "p",
      revision: document.revision,
      kind: "align",
      [field]: env[field],
    });
    service.cancel(job.id);
    const snapshot = JSON.parse(readFileSync(job.snapshotPath)),
      before = readFileSync(job.snapshotPath, "utf8");
    writeFileSync(snapshot[field], "CORRUPTED ARCHIVE");
    await assert.rejects(() => service.retry(job.id), /hash mismatch/);
    await assert.rejects(
      () =>
        service.createJob({
          projectId: "p",
          revision: document.revision,
          kind: "align",
          resumeJobId: job.id,
        }),
      /hash mismatch/,
    );
    assert.equal(service.jobs("p").length, 1);
    assert.equal(readFileSync(job.snapshotPath, "utf8"), before);
  }
});
test("V1 and V2 at the same original path survive migration for old queued worker and retry", async () => {
  const env = setup(),
    { options, document, sourceSrtPath } = env;
  let service = createProductionPlanService(options);
  const request = {
    projectId: "p",
    revision: document.revision,
    kind: "align",
    sourceSrtPath,
  };
  const { job: v1 } = await service.createJob(request);
  service.cancel(v1.id);
  const { job: queued } = await service.createJob(request);
  writeFileSync(sourceSrtPath, srt.replace("真实字幕", "V2新字幕"));
  const { job: v2 } = await service.createJob(request);
  service.cancel(v2.id);
  const original = JSON.parse(readFileSync(v1.snapshotPath));
  assert.notEqual(
    original.inputs[0].sha256,
    JSON.parse(readFileSync(v2.snapshotPath)).inputs[0].sha256,
  );
  const oldRoot = document.projectBinding.projectRoot;
  service.action({
    projectId: "p",
    revision: document.revision,
    operation: {
      type: "relocate",
      projectRoot: join(options.artifactRoot, "versions-moved"),
    },
  });
  rmSync(oldRoot, { recursive: true });
  rmSync(env.external, { recursive: true });
  const worker = join(options.root, "version-worker.py");
  writeFileSync(
    worker,
    `import sys,json,pathlib,hashlib\na=sys.argv;s=json.loads(pathlib.Path(a[a.index('--snapshot')+1]).read_text())\nfor i in s['inputs']:assert hashlib.sha256(pathlib.Path(i['path']).read_bytes()).hexdigest()==i['sha256']\nassert pathlib.Path(s['sourceSrtPath']).read_text()==${JSON.stringify(srt)}\n(pathlib.Path(a[a.index('--output-dir')+1])/'consumed.json').write_text(json.dumps(s))\n`,
  );
  service = createProductionPlanService({
    ...options,
    workerPath: worker,
    pollMs: 20,
  });
  const { job: retry } = await service.retry(v1.id);
  const retried = JSON.parse(readFileSync(retry.snapshotPath));
  assert.equal(retried.inputs[0].sha256, original.inputs[0].sha256);
  assert.equal(readFileSync(retried.sourceSrtPath, "utf8"), srt);
  await service.pump();
  const markers = [
    join(retry.outputDir, "consumed.json"),
    join(service.getJob(queued.id).outputDir, "consumed.json"),
  ];
  for (let n = 0; n < 150 && !markers.every(existsSync); n++)
    await new Promise((r) => setTimeout(r, 10));
  for (const marker of markers) {
    const used = JSON.parse(readFileSync(marker));
    assert.equal(used.inputs[0].sha256, original.inputs[0].sha256);
    assert.equal(readFileSync(used.sourceSrtPath, "utf8"), srt);
  }
  assert.equal(existsSync(sourceSrtPath), false);
  service.close();
});
