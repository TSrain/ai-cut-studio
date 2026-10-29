import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  validateBranchOperation,
  enqueueBranchOperation,
  drainBranchOperations,
  branchOperationId,
  branchValueHash,
} from "../lib/package-branch-application.mjs";
const fileHash = (p) =>
  createHash("sha256").update(readFileSync(p)).digest("hex");
function fixture() {
  const outputRoot = mkdtempSync(join(tmpdir(), "package-queue-"));
  let document = {
    id: "p",
    revision: 1,
    captions: { text: "old" },
    unrelated: 0,
    productionPlan: { changes: [] },
  };
  let active = 0,
    max = 0,
    saves = 0;
  const context = {
    outputRoot,
    projectId: "p",
    runId: "r",
    packageOrchestrationVersion: 2,
    load: async () => structuredClone(document),
    save: async (next, before) => {
      active++;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 2));
      active--;
      if (before !== document.revision) throw Error("Revision conflict");
      document = { ...next, revision: before + 1 };
      saves++;
      return structuredClone(document);
    },
    adapters: {
      captions: async (d, op) => {
        d.captions = op.payload.value;
        return d;
      },
    },
  };
  function operation(value = "new", kind = "captions") {
    const payload = { value: { text: value } },
      payloadSha256 = branchValueHash(payload),
      validationReceiptPath = join(outputRoot, `validation-${value}.json`);
    writeFileSync(
      validationReceiptPath,
      JSON.stringify({
        schemaVersion: 1,
        status: "passed",
        projectId: "p",
        runId: "r",
        branchId: kind,
        attemptId: "a",
        dependencyFingerprint: "d".repeat(64),
        payloadSha256,
      }),
    );
    const op = {
      schemaVersion: 1,
      packageOrchestrationVersion: 2,
      projectId: "p",
      runId: "r",
      branchId: kind,
      attemptId: "a",
      kind,
      dependencyFingerprint: "d".repeat(64),
      payload,
      payloadSha256,
      validationReceiptPath,
      validationReceiptSha256: fileHash(validationReceiptPath),
      files: [],
      readSet: [
        { path: ["captions"], beforeHash: branchValueHash(document.captions) },
      ],
      writeSet: [
        { path: ["captions"], beforeHash: branchValueHash(document.captions) },
      ],
      dependsOn: [],
    };
    op.operationId = branchOperationId(op);
    return op;
  }
  return {
    context,
    operation,
    get document() {
      return document;
    },
    set document(v) {
      document = v;
    },
    get saves() {
      return saves;
    },
    get max() {
      return max;
    },
  };
}
test("serial project queue applies once and records durable marker", async () => {
  const f = fixture(),
    op = f.operation();
  await Promise.all([
    enqueueBranchOperation(op, f.context),
    enqueueBranchOperation(op, f.context),
  ]);
  await Promise.all([
    drainBranchOperations("p", f.context),
    drainBranchOperations("p", f.context),
  ]);
  assert.equal(f.saves, 1);
  assert.equal(f.max, 1);
  assert.equal(f.document.captions.text, "new");
  assert.equal(f.document.productionPlan.changes[0].id, op.operationId);
});
test("target edit is preserved; unrelated CAS edit retries", async () => {
  const f = fixture(),
    op = f.operation();
  await enqueueBranchOperation(op, f.context);
  f.document = { ...f.document, captions: { text: "manual" } };
  let rows = await drainBranchOperations("p", f.context);
  assert.equal(rows[0].status, "stale");
  assert.equal(f.saves, 0);
  const g = fixture(),
    save = g.context.save;
  let first = true;
  g.context.save = async (d, r) => {
    if (first) {
      first = false;
      g.document = { ...g.document, revision: 2, unrelated: 7 };
      throw Error("Revision conflict");
    }
    return save(d, r);
  };
  await enqueueBranchOperation(g.operation(), g.context);
  rows = await drainBranchOperations("p", g.context);
  assert.equal(rows[0].status, "applied");
  assert.equal(g.document.unrelated, 7);
});
test("saved marker recovers journal crash without duplicate or restoring deletion", async () => {
  const f = fixture(),
    op = f.operation();
  await enqueueBranchOperation(op, f.context);
  f.context.afterSave = () => {
    throw Error("simulated crash");
  };
  await assert.rejects(
    drainBranchOperations("p", f.context),
    /simulated crash/,
  );
  delete f.context.afterSave;
  f.document = { ...f.document, captions: null };
  const rows = await drainBranchOperations("p", f.context);
  assert.equal(rows[0].status, "preserved_manual");
  assert.equal(f.saves, 1);
  assert.equal(f.document.captions, null);
});
test("dependency barrier and cancellation retain earlier results", async () => {
  const f = fixture(),
    op = f.operation();
  op.dependsOn = ["missing"];
  op.operationId = branchOperationId(op);
  await enqueueBranchOperation(op, f.context);
  assert.equal(
    (await drainBranchOperations("p", f.context))[0].status,
    "waiting_dependencies",
  );
  f.context.isCancelled = () => true;
  assert.equal(
    (await drainBranchOperations("p", f.context))[0].status,
    "cancelled",
  );
  assert.equal(f.saves, 0);
});
test("rejects unknown kinds, identity, tampering and path escape", async () => {
  const f = fixture(),
    op = f.operation();
  await assert.rejects(
    validateBranchOperation({ ...op, kind: "exec" }, f.context),
  );
  await assert.rejects(
    validateBranchOperation({ ...op, runId: "other" }, f.context),
  );
  await assert.rejects(
    validateBranchOperation({ ...op, payload: { value: 0 } }, f.context),
  );
  await assert.rejects(
    validateBranchOperation(
      { ...op, validationReceiptPath: "/tmp/no-proof" },
      f.context,
    ),
  );
  await assert.rejects(
    validateBranchOperation(
      {
        ...op,
        writeSet: [{ path: ["__proto__"], beforeHash: "0".repeat(64) }],
      },
      f.context,
    ),
  );
});
test("branch queue treats missing orchestration versions as v2 and rejects explicit v1", async () => {
  const retired = 'packageOrchestrationVersion=1 已下线（见 git tag v1-final），请新建 v2 package 任务';
  const f = fixture(), op = f.operation();
  delete f.context.packageOrchestrationVersion;
  await enqueueBranchOperation(op, f.context);
  const [row] = await drainBranchOperations('p', f.context);
  assert.equal(row.status, 'applied');
  await assert.rejects(validateBranchOperation({...op, packageOrchestrationVersion: 1}, f.context), {message: retired});
  await assert.rejects(enqueueBranchOperation(op, {...f.context, packageOrchestrationVersion: 1}), {message: retired});
  await assert.rejects(drainBranchOperations('p', {...f.context, packageOrchestrationVersion: 1}), {message: retired});
});
test("native adapter cannot change undeclared fields", async () => {
  const f = fixture(),
    op = f.operation();
  f.context.adapters.captions = async (d) => ({
    ...d,
    captions: { text: "new" },
    unrelated: 9,
  });
  await enqueueBranchOperation(op, f.context);
  const rows = await drainBranchOperations("p", f.context);
  assert.match(rows[0].error, /undeclared/);
  assert.equal(rows[0].status, "blocked");
  assert.equal(f.saves, 0);
});
test("declared nested write can create missing parents without authorizing siblings", async () => {
  for (const extra of [false, true]) {
    const f = fixture(), op = f.operation();
    op.writeSet = [{path:["productionPlan","upstream","packageCovers"],beforeHash:branchValueHash(undefined)}];
    op.operationId = branchOperationId(op);
    f.context.adapters.captions = async d => {
      d.productionPlan.upstream = {packageCovers:{ready:true},...(extra?{unrelated:9}:{})};
      return d;
    };
    await enqueueBranchOperation(op,f.context);
    const [row] = await drainBranchOperations("p",f.context);
    assert.equal(row.status,extra?"blocked":"applied");
    assert.equal(f.saves,extra?0:1);
  }
});
import { createDocument, saveDocument } from "../lib/editor-store.mjs";
import { createProductionPlanService } from "../lib/production-plan-jobs.mjs";
import { mkdirSync } from "node:fs";
test("host freezes explicit v2 execution options and rejects unknown versions", async () => {
  const root = mkdtempSync(join(tmpdir(), "package-host-"));
  mkdirSync(join(root, "templates/remotion-base/public"), { recursive: true });
  const options = {
    root,
    rootDir: join(root, "index"),
    artifactRoot: join(root, "artifacts"),
    assetSourceRoot: root,
    autoStart: false,
  };
  const d = saveDocument(
    createDocument({
      id: "p",
      name: "P",
      canvas: {
        width: 1920,
        height: 1080,
        fps: { num: 30, den: 1 },
        durationFrames: 300,
      },
    }),
    options,
  );
  const service = createProductionPlanService(options);
  const { job } = await service.createJob({
    kind: "package",
    projectId: "p",
    revision: d.revision,
    packageOrchestrationVersion: 2,
    packageExecution: { streamingApply: true, reusePolicy: "same-run" },
  });
  const snapshot = JSON.parse(readFileSync(job.snapshotPath, "utf8"));
  assert.equal(snapshot.packageOrchestrationVersion, 2);
  assert.equal(snapshot.bgmPlanVersion, 1);
  assert.deepEqual(snapshot.packageExecution, {
    streamingApply: true,
    reusePolicy: "same-run",
  });
  await assert.rejects(
    service.createJob({
      kind: "package",
      projectId: "p",
      revision: d.revision,
      packageOrchestrationVersion: 3,
    }),
    /version/,
  );
  service.close();
});
test("failed native adapter does not block an independent later operation", async () => {
  const f = fixture(),
    bad = f.operation("bad"),
    good = f.operation("good");
  f.context.adapters.captions = async (d, op) => {
    if (op.payload.value.text === "bad")
      throw Error("Invalid caption proposal");
    d.captions = op.payload.value;
    return d;
  };
  await enqueueBranchOperation(bad, f.context);
  await enqueueBranchOperation(good, f.context);
  const rows = await drainBranchOperations("p", f.context);
  assert.equal(rows[0].status, "blocked");
  assert.equal(rows[1].status, "applied");
  assert.equal(f.document.captions.text, "good");
});
import { DEFAULT_CAPTION_STYLE } from "../../templates/remotion-base/src/editor/captions.mjs";
test("real host ingests validated captions immediately without terminal package receipt", async () => {
  const root = mkdtempSync(join(tmpdir(), "package-ingest-"));
  mkdirSync(join(root, "templates/remotion-base/public"), { recursive: true });
  const options = {
    root,
    rootDir: join(root, "index"),
    artifactRoot: join(root, "artifacts"),
    assetSourceRoot: root,
    autoStart: false,
  };
  const d = saveDocument(
      createDocument({
        id: "p",
        name: "P",
        canvas: {
          width: 1920,
          height: 1080,
          fps: { num: 30, den: 1 },
          durationFrames: 300,
        },
      }),
      options,
    ),
    service = createProductionPlanService(options);
  const { job } = await service.createJob({
    kind: "package",
    projectId: "p",
    revision: d.revision,
    packageOrchestrationVersion: 2,
    packageExecution: { streamingApply: true, reusePolicy: "same-run" },
  });
  const payload = {
    value: {
      version: 1,
      enabled: true,
      style: { ...DEFAULT_CAPTION_STYLE },
      cues: [
        {
          id: "c1",
          startFrame: 0,
          endFrame: 30,
          text: "字幕",
          originalText: "字幕",
        },
      ],
    },
  };
  const operation = {
    schemaVersion: 1,
    packageOrchestrationVersion: 2,
    projectId: "p",
    runId: job.runId,
    branchId: "captions",
    attemptId: "a",
    kind: "captions",
    dependencyFingerprint: "d".repeat(64),
    payload,
    payloadSha256: branchValueHash(payload),
    readSet: [{ path: ["captions"], beforeHash: branchValueHash(undefined) }],
    writeSet: [{ path: ["captions"], beforeHash: branchValueHash(undefined) }],
    files: [],
    dependsOn: [],
  };
  operation.operationId = branchOperationId(operation);
  const validationReceiptPath = join(job.outputDir, "validation.json");
  writeFileSync(
    validationReceiptPath,
    JSON.stringify({
      status: "passed",
      projectId: "p",
      runId: job.runId,
      branchId: "captions",
      attemptId: "a",
      dependencyFingerprint: operation.dependencyFingerprint,
      operations: [operation],
    }),
  );
  operation.validationReceiptPath = validationReceiptPath;
  operation.validationReceiptSha256 = fileHash(validationReceiptPath);
  const result = await service.ingest({
    projectId: "p",
    jobId: job.id,
    results: [
      {
        id: "captions-result",
        projectId: "p",
        jobId: job.id,
        kind: "packageOperation",
        operation,
      },
    ],
    status: "running",
  });
  assert.equal(result.document.captions.cues[0].text, "字幕");
  assert.equal(result.job.status, "running");
  assert.equal(result.job.results[0].state, "applied");
  assert.equal(
    result.document.productionPlan.changes.filter(
      (x) => x.id === operation.operationId,
    ).length,
    1,
  );
  service.close();
});
test("save response alone cannot claim applied without durable project marker", async () => {
  const f = fixture();
  f.context.save = async (next) => ({ ...next, revision: 2 });
  await enqueueBranchOperation(f.operation(), f.context);
  const rows = await drainBranchOperations("p", f.context);
  assert.equal(rows[0].status, "blocked");
  assert.match(rows[0].error, /readback/);
});
test("resuming v2 cannot downgrade its frozen execution version", async () => {
  const root = mkdtempSync(join(tmpdir(), "package-resume-"));
  mkdirSync(join(root, "templates/remotion-base/public"), { recursive: true });
  const options = {
    root,
    rootDir: join(root, "index"),
    artifactRoot: join(root, "artifacts"),
    assetSourceRoot: root,
    autoStart: false,
  };
  const d = saveDocument(
    createDocument({
      id: "p",
      name: "P",
      canvas: {
        width: 1920,
        height: 1080,
        fps: { num: 30, den: 1 },
        durationFrames: 300,
      },
    }),
    options,
  );
  const service = createProductionPlanService(options);
  const { job } = await service.createJob({
    kind: "package",
    projectId: "p",
    revision: d.revision,
    packageOrchestrationVersion: 2,
  });
  const ended = await service.ingest({
    projectId: "p",
    jobId: job.id,
    results: [],
    status: "cancelled",
  });
  await assert.rejects(
    service.createJob({
      kind: "package",
      projectId: "p",
      revision: ended.document.revision,
      resumeJobId: job.id,
      packageOrchestrationVersion: 1,
    }),
    {message: 'packageOrchestrationVersion=1 已下线（见 git tag v1-final），请新建 v2 package 任务'},
  );
  service.close();
});
test("applied operation exposes a SHA-bound receipt with actual readback fields", async () => {
  const f = fixture();
  await enqueueBranchOperation(f.operation(), f.context);
  const [row] = await drainBranchOperations("p", f.context);
  assert.equal(fileHash(row.receiptPath), row.receiptSha256);
  const receipt = JSON.parse(readFileSync(row.receiptPath, "utf8"));
  assert.equal(receipt.projectId, "p");
  assert.equal(receipt.runId, "r");
  assert.equal(receipt.status, "applied");
  assert.equal(
    receipt.readback[0].sha256,
    branchValueHash(f.document.captions),
  );
});
test("branch barriers cannot trust a model complete claim without verified proposal and actual application", async () => {
  const f = fixture(),
    op = f.operation();
  op.dependencyBranches = ["templates"];
  op.operationId = branchOperationId(op);
  await enqueueBranchOperation(op, f.context);
  writeFileSync(
    join(f.context.outputRoot, "package-branches.json"),
    JSON.stringify({
      version: 2,
      projectId: "p",
      runId: "r",
      branches: {
        templates: {
          status: "complete",
          validation: { status: "passed" },
          application: { status: "applied" },
        },
      },
    }),
  );
  assert.equal(
    (await drainBranchOperations("p", f.context))[0].status,
    "waiting_dependencies",
  );
  assert.equal(f.saves, 0);
});
test("cancellation during native preparation stops the pending project save", async () => {
  const f = fixture();
  let cancelled = false;
  f.context.isCancelled = () => cancelled;
  f.context.adapters.captions = async (d, op) => {
    cancelled = true;
    d.captions = op.payload.value;
    return d;
  };
  await enqueueBranchOperation(f.operation(), f.context);
  const [row] = await drainBranchOperations("p", f.context);
  assert.equal(row.status, "cancelled");
  assert.equal(f.saves, 0);
});
test("historical frozen v2 applies BGM plan metadata while preserving owned music edits and all audio", async () => {
  const root = mkdtempSync(join(tmpdir(), "package-bgm-"));
  mkdirSync(join(root, "templates/remotion-base/public"), { recursive: true });
  const options = {
    root,
    rootDir: join(root, "index"),
    artifactRoot: join(root, "artifacts"),
    assetSourceRoot: root,
    autoStart: false,
  };
  const d = saveDocument(
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
          shots: [
            {
              id: "s",
              title: "S",
              bgmDesign: {
                decision: "silence",
                reason: "用户手调",
                requirementVersion: 1,
                manual: true,
              },
            },
          ],
          bgmPlanVersion: 1,
          bgmRecommendations: [],
        },
      }),
      options,
    ),
    service = createProductionPlanService(options);
  const { job } = await service.createJob({
    kind: "package",
    projectId: "p",
    revision: d.revision,
    packageOrchestrationVersion: 2,
    packageExecution: { streamingApply: true, reusePolicy: "same-run" },
  });
  // Historical snapshot fixture: no automatic execution flag, with a matching frozen hash.
  const frozen = JSON.parse(readFileSync(job.snapshotPath));
  delete frozen.bgmExecutionVersion;
  writeFileSync(job.snapshotPath, JSON.stringify(frozen));
  const storedPath = join(job.snapshotPath, "..", "job.json");
  const stored = JSON.parse(readFileSync(storedPath));
  delete stored.bgmExecutionVersion;
  stored.snapshotHash = fileHash(job.snapshotPath);
  writeFileSync(storedPath, JSON.stringify(stored));
  const current = service.read("p").document;
  const payload = {
    bgmPlanVersion: 1,
    sections: [
      {
        id: "s",
        requirementVersion: 1,
        bgmDesign: { decision: "silence", reason: "本轮建议" },
      },
    ],
    recommendations: [],
    recommendationGaps: ["没有使用音乐"],
  };
  const operation = {
    schemaVersion: 1,
    packageOrchestrationVersion: 2,
    projectId: "p",
    runId: job.runId,
    branchId: "bgm",
    attemptId: "a",
    kind: "bgm",
    dependencyFingerprint: "d".repeat(64),
    payload,
    payloadSha256: branchValueHash(payload),
    readSet: [
      {
        path: ["productionPlan"],
        beforeHash: branchValueHash(current.productionPlan),
      },
    ],
    writeSet: [
      {
        path: ["productionPlan"],
        beforeHash: branchValueHash(current.productionPlan),
      },
    ],
    files: [],
    dependsOn: [],
  };
  operation.operationId = branchOperationId(operation);
  const proof = join(job.outputDir, "bgm-validation.json");
  writeFileSync(
    proof,
    JSON.stringify({
      status: "passed",
      projectId: "p",
      runId: job.runId,
      branchId: "bgm",
      attemptId: "a",
      dependencyFingerprint: operation.dependencyFingerprint,
      operations: [operation],
    }),
  );
  operation.validationReceiptPath = proof;
  operation.validationReceiptSha256 = fileHash(proof);
  const result = await service.ingest({
    projectId: "p",
    jobId: job.id,
    results: [
      {
        id: "bgm-result",
        projectId: "p",
        jobId: job.id,
        kind: "packageOperation",
        operation,
      },
    ],
    status: "running",
  });
  assert.equal(result.job.results[0].state, "applied");
  assert.equal(
    result.document.productionPlan.shots[0].bgmDesign.reason,
    "用户手调",
  );
  assert.equal(result.document.productionPlan.bgmPlanVersion, 1);
  assert.deepEqual(result.document.audioClips, current.audioClips);
  assert.deepEqual(result.document.audioTracks, current.audioTracks);
  service.close();
});
test("host authorizes only SHA-bound canonical early Claude prompt before final outputs", async () => {
  const root = mkdtempSync(join(tmpdir(), "package-early-link-"));
  mkdirSync(join(root, "templates/remotion-base/public"), { recursive: true });
  const options = {
    root,
    rootDir: join(root, "index"),
    artifactRoot: join(root, "artifacts"),
    assetSourceRoot: root,
    autoStart: false,
  };
  const d = saveDocument(
      createDocument({
        id: "p",
        name: "P",
        canvas: {
          width: 1920,
          height: 1080,
          fps: { num: 30, den: 1 },
          durationFrames: 300,
        },
      }),
      options,
    ),
    service = createProductionPlanService(options);
  const { job } = await service.createJob({
    kind: "package",
    projectId: "p",
    revision: d.revision,
    packageOrchestrationVersion: 2,
  });
  const packageRoot = join(job.outputDir, "package");
  mkdirSync(packageRoot);
  const planPath = join(packageRoot, "plan.md"),
    receiptPath = join(packageRoot, "early-handoff.json");
  writeFileSync(planPath, "## 给 Claude 的动画提示词\n本轮需求");
  const storedPath = join(job.snapshotPath, "..", "job.json");
  const receipt = {
    version: 1,
    status: "ready",
    projectId: "p",
    runId: job.runId,
    planPath,
    planSha256: fileHash(planPath),
    currentPlanSha256: fileHash(planPath),
  };
  const publish = (value = receipt, overrides = {}) => {
    writeFileSync(receiptPath, JSON.stringify(value));
    const stored = JSON.parse(readFileSync(storedPath));
    stored.earlyHandoff = {
      ...value,
      receiptPath,
      receiptSha256: fileHash(receiptPath),
      ...overrides,
    };
    writeFileSync(storedPath, JSON.stringify(stored));
  };
  publish();
  assert.equal(service.resolveFile("p", planPath), realpathSync(planPath));
  writeFileSync(planPath, "tampered");
  assert.throws(() => service.resolveFile("p", planPath), /referenced/);
  writeFileSync(planPath, "## 给 Claude 的动画提示词\n本轮需求");
  publish({ ...receipt, projectId: "other" });
  assert.throws(() => service.resolveFile("p", planPath), /referenced/);
  publish(receipt, { receiptSha256: "0".repeat(64) });
  assert.throws(() => service.resolveFile("p", planPath), /referenced/);
  const otherPath = join(job.outputDir, "other.md");
  writeFileSync(otherPath, "not an early prompt");
  publish({
    ...receipt,
    planPath: otherPath,
    planSha256: fileHash(otherPath),
    currentPlanSha256: fileHash(otherPath),
  });
  assert.throws(() => service.resolveFile("p", otherPath), /referenced/);
  publish(receipt);
  assert.throws(() => service.resolveFile("p", receiptPath), /referenced/);
  const external = join(root, "outside.md");
  writeFileSync(external, "external private file");
  publish({
    ...receipt,
    planPath: external,
    planSha256: fileHash(external),
    currentPlanSha256: fileHash(external),
  });
  assert.throws(() => service.resolveFile("p", external), /referenced/);
  unlinkSync(planPath);
  symlinkSync(external, planPath);
  publish({
    ...receipt,
    planSha256: fileHash(external),
    currentPlanSha256: fileHash(external),
  });
  assert.throws(() => service.resolveFile("p", planPath), /referenced/);
  unlinkSync(planPath);
  writeFileSync(planPath, "final report");
  publish(receipt);
  const finalJob = JSON.parse(readFileSync(storedPath));
  finalJob.outputs = { planPath };
  writeFileSync(storedPath, JSON.stringify(finalJob));
  assert.equal(service.resolveFile("p", planPath), realpathSync(planPath));
  service.close();
});
