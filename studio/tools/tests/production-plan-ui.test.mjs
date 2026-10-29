import test from "node:test";
import assert from "node:assert/strict";
const modulePath = "../editor/production-plan-sync.mjs";
const { mergeServerDelta, syncPlanHistory, adjustPlanRange, planMediaUrl } =
  await import(modulePath).catch(() => ({}));
const base = () => ({
  id: "p",
  revision: 1,
  canvas: { durationFrames: 300 },
  instances: [
    { id: "a", startFrame: 0, durationFrames: 100, props: { label: "before" } },
  ],
  productionPlan: {
    shots: [{ id: "s", visualRequirement: "before", candidates: [] }],
  },
});
test("poll applies candidates while preserving an unsaved requirement and moved instance", () => {
  assert.equal(typeof mergeServerDelta, "function");
  const old = base(),
    local = structuredClone(old),
    server = structuredClone(old);
  local.instances[0].startFrame = 33;
  local.productionPlan.shots[0].visualRequirement = "draft";
  server.revision = 2;
  server.productionPlan.shots[0].candidates.push({ id: "c" });
  const next = mergeServerDelta(old, local, server);
  assert.equal(next.instances[0].startFrame, 33);
  assert.equal(next.productionPlan.shots[0].visualRequirement, "draft");
  assert.deepEqual(next.productionPlan.shots[0].candidates, [{ id: "c" }]);
});
test("undo local edit preserves a candidate received after editing", () => {
  assert.equal(typeof syncPlanHistory, "function");
  const old = base(),
    edited = structuredClone(old),
    server = structuredClone(old);
  edited.instances[0].props.label = "after";
  server.productionPlan.shots[0].candidates.push({ id: "c" });
  const h = syncPlanHistory(
    { past: [old], present: edited, future: [] },
    old,
    server,
  );
  assert.equal(h.past[0].instances[0].props.label, "before");
  assert.deepEqual(h.past[0].productionPlan.shots[0].candidates, [{ id: "c" }]);
  assert.equal(h.present.instances[0].props.label, "after");
});
test("server instance additions can be undone without undoing unrelated edits", () => {
  assert.equal(typeof syncPlanHistory, "function");
  const old = base(),
    edited = structuredClone(old),
    server = structuredClone(old);
  edited.instances[0].props.label = "after";
  server.instances.push({ id: "b", startFrame: 110, durationFrames: 30 });
  const h = syncPlanHistory(
    { past: [old], present: edited, future: [] },
    old,
    server,
    true,
  );
  assert.deepEqual(
    h.present.instances.map((i) => i.id),
    ["a", "b"],
  );
  assert.deepEqual(
    h.past.at(-1).instances.map((i) => i.id),
    ["a"],
  );
  assert.equal(h.past.at(-1).instances[0].props.label, "after");
});
test("manual removal is not resurrected by polling and projects stay isolated", () => {
  assert.equal(typeof mergeServerDelta, "function");
  const old = base(),
    local = structuredClone(old),
    server = structuredClone(old);
  local.instances = [];
  server.instances[0].startFrame = 5;
  assert.equal(mergeServerDelta(old, local, server).instances.length, 0);
  assert.equal(
    mergeServerDelta(old, { ...local, id: "other" }, server).id,
    "other",
  );
});
test("plan trimming clamps to document while preserving range id", () => {
  assert.equal(typeof adjustPlanRange, "function");
  assert.deepEqual(
    adjustPlanRange(
      { id: "r", startFrame: 10, durationFrames: 20 },
      "left",
      100,
      300,
    ),
    { id: "r", startFrame: 29, durationFrames: 1 },
  );
  assert.deepEqual(
    adjustPlanRange(
      { id: "r", startFrame: 10, durationFrames: 20 },
      "move",
      -100,
      300,
    ),
    { id: "r", startFrame: 0, durationFrames: 20 },
  );
});
test("local preview URL never admits unsafe protocols", () => {
  assert.equal(typeof planMediaUrl, "function");
  assert.equal(planMediaUrl("javascript:alert(1)"), undefined);
  assert.ok(planMediaUrl("/safe.png").includes("safe.png"));
});
test("undo automatic result preserves removal intent against repeated ingestion", () => {
  const old = base(),
    server = structuredClone(old);
  server.instances.push({ id: "b", startFrame: 110, durationFrames: 30 });
  server.productionPlan.appliedResultIds = ["result-1"];
  server.productionPlan.shots[0].bindings = [
    {
      id: "binding-1",
      instanceId: "b",
      resultId: "result-1",
      status: "current",
    },
  ];
  const h = syncPlanHistory(
      { past: [], present: old, future: [] },
      old,
      server,
      true,
    ),
    undone = h.past.at(-1);
  assert.ok(undone.productionPlan.dismissedResultIds?.includes("result-1"));
  assert.equal(
    undone.productionPlan.shots[0].bindings.find((b) => b.id === "binding-1")
      .status,
    "removed",
  );
});
