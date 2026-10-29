import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDocument, saveDocument } from "../lib/editor-store.mjs";
import { createProductionPlanService } from "../lib/production-plan-jobs.mjs";
async function setup() {
  const root = mkdtempSync(join(tmpdir(), "script-patch-")),
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
          script: "真人开头。重复。重复。真人结尾。",
          shots: [],
        },
      }),
      options,
    ),
    service = createProductionPlanService(options);
  const { job } = await service.createJob({
    projectId: "p",
    revision: document.revision,
    kind: "align",
  });
  return { document, service, job };
}
test("ambiguous script patch preserves effective text and records a manual conflict", async () => {
  const { document, service, job } = await setup(),
    plan = structuredClone(document.productionPlan);
  const scriptPatch = {
    baseScript: plan.script,
    patches: [],
    candidateScript: "候选全文但定位有歧义",
    conflicts: [
      {
        shotId: "removed",
        type: "remove",
        narration: "重复。",
        reason: "重复出现，无法唯一定位",
      },
    ],
  };
  const result = {
    id: "delta",
    kind: "plan",
    jobId: job.id,
    projectId: "p",
    requiresConfirmation: true,
    plan,
    basePlan: plan,
    scriptPatch,
  };
  await service.ingest({ projectId: "p", jobId: job.id, results: [result] });
  const { document: next } = await service.applyResults({
    projectId: "p",
    revision: document.revision,
    operation: { type: "apply-results", resultIds: ["delta"] },
  });
  assert.equal(next.productionPlan.script, document.productionPlan.script);
  const conflict = next.productionPlan.conflicts.find(
    (c) => c.field === "script",
  );
  assert.equal(conflict.requiresManual, true);
  assert.equal(conflict.incoming, scriptPatch.candidateScript);
  assert.match(conflict.reason, /唯一定位/);
  assert.deepEqual(
    next.productionPlan.changes.find((c) => c.type === "confirm-content-delta")
      .scriptPatch,
    scriptPatch,
  );
});
test("script patch cannot claim a base other than the immutable snapshot", async () => {
  const { document, service, job } = await setup();
  const result = {
    id: "bad-delta",
    kind: "plan",
    jobId: job.id,
    projectId: "p",
    requiresConfirmation: true,
    plan: document.productionPlan,
    scriptPatch: {
      baseScript: "forged",
      candidateScript: "new",
      patches: [],
      conflicts: [],
    },
  };
  await service.ingest({ projectId: "p", jobId: job.id, results: [result] });
  await assert.rejects(
    () =>
      service.applyResults({
        projectId: "p",
        revision: document.revision,
        operation: { type: "apply-results", resultIds: [result.id] },
      }),
    /Script patch base/,
  );
  assert.equal(service.read("p").document.revision, document.revision);
});
