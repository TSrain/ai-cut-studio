import test from "node:test";
import assert from "node:assert/strict";
const model = await import("../lib/production-plan-model.mjs").catch(
  () => ({}),
);
const shot = () => ({
  id: "s1",
  title: "镜头",
  narration: "原文",
  visualRequirement: "原要求",
  mediaDescription: "录屏",
  anchor: {
    sourcePath: "talk.mp4",
    startSeconds: 1,
    endSeconds: 5,
    confidence: 1,
  },
  slots: [{ id: "slot", type: "video", description: "演示" }],
});
const doc = () => ({
  id: "project",
  revision: 1,
  canvas: {
    fps: { num: 30, den: 1 },
    durationFrames: 600,
    width: 1920,
    height: 1080,
  },
  source: {
    path: "talk.mp4",
    startFrame: 0,
    clips: [
      { id: "a", startFrame: 0, durationFrames: 60, sourceInFrame: 0 },
      { id: "b", startFrame: 90, durationFrames: 90, sourceInFrame: 90 },
    ],
  },
  instances: [],
  productionPlan: { shots: [shot()] },
});
test("browser safe model exposes required interface", () =>
  assert.equal(typeof model.normalizePlan, "function"));
test("source split and removed interval map to separate ranges", () => {
  const ranges = model.planRanges(doc());
  assert.deepEqual(
    ranges.map((r) => [r.startFrame, r.durationFrames]),
    [
      [30, 30],
      [90, 60],
    ],
  );
  assert.equal(new Set(ranges.map((r) => r.shotId)).size, 1);
});
test("manual plan timing wins without moving actual media", () => {
  let d = doc();
  d.instances = [{ id: "i", startFrame: 50, durationFrames: 20 }];
  d = model.changePlan(d, {
    type: "move-shot",
    shotId: "s1",
    ranges: [{ id: "manual", startFrame: 200, durationFrames: 60 }],
  });
  assert.equal(model.planRanges(d)[0].startFrame, 200);
  assert.equal(d.instances[0].startFrame, 50);
});
test("estimated timing never masquerades as aligned", () => {
  const d = doc();
  delete d.productionPlan.shots[0].anchor;
  d.productionPlan.shots[0].timing = {
    status: "estimated",
    ranges: [{ id: "r", startFrame: 0, durationFrames: 60 }],
    estimatedSeconds: 2,
  };
  assert.deepEqual(model.planRanges(d), []);
});
test("three way merge keeps unrelated edits and exposes conflicting fields", () => {
  const base = model.normalizePlan({ shots: [shot()] });
  let current = structuredClone(base),
    incoming = structuredClone(base);
  current.shots[0].visualRequirement = "人工";
  incoming.shots[0].mediaDescription = "新素材";
  let merged = model.mergePlans(base, current, incoming);
  assert.equal(merged.shots[0].visualRequirement, "人工");
  assert.equal(merged.shots[0].mediaDescription, "新素材");
  incoming.shots[0].visualRequirement = "后台";
  merged = model.mergePlans(base, current, incoming);
  assert.equal(merged.shots[0].visualRequirement, "人工");
  assert.equal(merged.conflicts.length, 1);
});
test("candidate duplicate keeps read and ignored state", () => {
  let d = doc();
  d.productionPlan.shots[0].candidates = [
    {
      id: "c",
      slotId: "slot",
      url: "https://example.org/video",
      title: "v",
      reason: "r",
      readAt: "now",
    },
  ];
  const plan = structuredClone(d.productionPlan);
  plan.shots[0].candidates = [
    {
      id: "other",
      slotId: "slot",
      url: "https://example.org/video",
      title: "new",
      reason: "r",
    },
  ];
  d = model.changePlan(d, { type: "import-plan", plan });
  assert.equal(d.productionPlan.shots[0].candidates.length, 1);
  assert.equal(d.productionPlan.shots[0].candidates[0].readAt, "now");
});
test("requirement changes invalidate approval and related dependency only", () => {
  const d = doc();
  const fingerprint = model.dependencyFingerprint(d, "s1");
  const rename = { ...d, name: "unrelated" };
  assert.equal(model.dependencyFingerprint(rename, "s1"), fingerprint);
  const edited = model.changePlan(d, {
    type: "edit-shot",
    shotId: "s1",
    patch: { visualRequirement: "new" },
  });
  assert.notEqual(model.dependencyFingerprint(edited, "s1"), fingerprint);
  assert.equal(edited.productionPlan.shots[0].approval, "needs_design");
});
test("deleted applied instance records dismissal to prevent resurrection", () => {
  const d = doc();
  d.productionPlan.shots[0].bindings = [
    {
      id: "b",
      slotId: "slot",
      instanceId: "deleted",
      path: "m.mp4",
      resultId: "result",
      confirmed: true,
      requirementVersion: 1,
      sourceInSeconds: 0,
    },
  ];
  const reconciled = model.reconcilePlan(d);
  assert.equal(
    reconciled.productionPlan.shots[0].bindings[0].status,
    "removed",
  );
  assert.ok(reconciled.productionPlan.dismissedResultIds.includes("result"));
});
test("unsafe candidate schemes and non-json data rejected", () => {
  assert.throws(() =>
    model.normalizePlan({
      shots: [
        {
          ...shot(),
          candidates: [{ id: "c", slotId: "slot", url: "javascript:alert(1)" }],
        },
      ],
    }),
  );
  assert.throws(() => model.normalizePlan({ shots: [], other: Infinity }));
});

test("source replacement removes old automatic anchor ranges, but preserves manual", () => {
  const d = doc();
  d.productionPlan.shots[0].timing = {
    status: "aligned",
    manual: false,
    ranges: [{ id: "old", startFrame: 0, durationFrames: 30 }],
  };
  d.source.path = "different.mp4";
  assert.equal(model.planRanges(d).length, 0);
  d.productionPlan.shots[0].timing.manual = true;
  assert.equal(model.planRanges(d).length, 1);
});
test("imported changed design increments requirements and keeps old bindings visibly changed", () => {
  const d = doc();
  d.productionPlan.shots[0].approval = "approved";
  d.productionPlan.shots[0].bindings = [
    {
      id: "b",
      instanceId: "i",
      slotId: "slot",
      path: "v.mp4",
      requirementVersion: 1,
      sourceInSeconds: 0,
      confirmed: true,
    },
  ];
  d.instances = [{ id: "i", startFrame: 0, durationFrames: 30 }];
  const incoming = model.normalizePlan(d.productionPlan);
  incoming.shots[0].visualRequirement = "new design";
  const next = model.changePlan(d, { type: "import-plan", plan: incoming });
  assert.equal(next.productionPlan.shots[0].requirementVersion, 2);
  assert.equal(
    next.productionPlan.shots[0].bindings[0].status,
    "requirements_changed",
  );
});

test("timing approval is independent of storyboard approval", () => {
  const d = doc();
  const next = model.changePlan(d, {
    type: "approve",
    timing: {
      status: "approved",
      files: [{ path: "/tmp/timing.json", sha256: "abc" }],
    },
  });
  assert.equal(next.productionPlan.shots[0].approval, "draft");
  assert.equal(next.productionPlan.approvalRecord.timing.status, "approved");
});

test("malformed timing and slots cannot enter the project model", () => {
  assert.throws(() =>
    model.normalizePlan({
      shots: [
        {
          ...shot(),
          timing: { status: "pretend-complete", ranges: [], manual: false },
        },
      ],
    }),
  );
  assert.throws(() =>
    model.normalizePlan({
      shots: [
        { ...shot(), slots: [{ id: "bad", type: "script", description: 42 }] },
      ],
    }),
  );
  const sparse = [];
  sparse.length = 2;
  assert.throws(() => model.normalizePlan({ shots: [], data: sparse }));
});

for (const field of [
  "visualRequirement",
  "mediaDescription",
  "narration",
  "slots",
  "shot",
]) {
  test(`incoming ${field} conflict invalidates requirements and approvals`, () => {
    const d = doc();
    d.instances = [{ id: "i", startFrame: 0, durationFrames: 30 }];
    const s = model.normalizePlan(d.productionPlan).shots[0];
    s.approval = "approved";
    s.approvedRequirementVersion = 1;
    s.bindings = [
      {
        id: "b",
        instanceId: "i",
        slotId: "slot",
        path: "a.mp4",
        requirementVersion: 1,
        sourceInSeconds: 0,
        confirmed: true,
      },
    ];
    const value =
      field === "shot"
        ? { ...s, visualRequirement: "incoming" }
        : field === "slots"
          ? [{ ...s.slots[0], description: "incoming" }]
          : "incoming";
    d.productionPlan = {
      ...model.normalizePlan({ shots: [s] }),
      approval: "approved",
      approvalRecord: { status: "approved", requirementVersions: { s1: 1 } },
      conflicts: [{ id: "c", shotId: "s1", field, incoming: value }],
    };
    const next = model.changePlan(d, {
      type: "resolve-conflict",
      conflictId: "c",
      choice: "incoming",
    }).productionPlan;
    assert.equal(next.shots[0].requirementVersion, 2);
    assert.equal(next.shots[0].slots[0].requirementVersion, 2);
    assert.equal(next.shots[0].approval, "needs_design");
    assert.equal(next.approval, "needs_design");
    assert.equal(next.approvalRecord.status, "needs_design");
    assert.equal(next.shots[0].bindings[0].status, "requirements_changed");
  });
}
for (const field of ["script", "approval"]) {
  test(`top level ${field} conflicts can be saved and resolved`, () => {
    const base = model.normalizePlan({
        script: "base",
        approval: "draft",
        shots: [shot()],
      }),
      current = structuredClone(base),
      incoming = structuredClone(base);
    current[field] = field === "script" ? "local" : "approved";
    incoming[field] = field === "script" ? "incoming" : "waiting_approval";
    const merged = model.mergePlans(base, current, incoming);
    assert.equal(merged.conflicts.length, 1);
    assert.equal(Object.hasOwn(merged.conflicts[0], "shotId"), false);
    const next = model.changePlan(
      { ...doc(), productionPlan: merged },
      {
        type: "resolve-conflict",
        conflictId: merged.conflicts[0].id,
        choice: "incoming",
      },
    );
    assert.equal(next.productionPlan[field], incoming[field]);
    assert.equal(next.productionPlan.conflicts.length, 0);
  });
}

test("semantic package metadata merges into a legacy plan without copying unrelated incoming fields", () => {
  const base = model.normalizePlan({
    shots: [shot()],
    upstream: { package: { id: "legacy-package" } },
  });
  const current = structuredClone(base);
  current.upstream.localNote = "用户备注";
  const incoming = structuredClone(base);
  incoming.animationWorkflow = "semantic-template-v1";
  incoming.sourceSrtPath = "/tmp/current.srt";
  incoming.transcriptBinding = {
    sourceSha256: "source",
    transcriptSha256: "srt",
  };
  incoming.upstream.animationPackage = {
    summaryPath: "/tmp/summary.md",
    version: 1,
  };
  incoming.upstream.other = "不在本次合并范围";
  incoming.hoverEnabled = false;
  const merged = model.mergePlans(base, current, incoming);
  assert.equal(merged.animationWorkflow, "semantic-template-v1");
  assert.equal(merged.sourceSrtPath, "/tmp/current.srt");
  assert.deepEqual(merged.transcriptBinding, incoming.transcriptBinding);
  assert.deepEqual(merged.upstream, {
    package: { id: "legacy-package" },
    localNote: "用户备注",
    animationPackage: { summaryPath: "/tmp/summary.md", version: 1 },
  });
  assert.equal(merged.hoverEnabled, true);
});

for (const field of [
  "animationWorkflow",
  "sourceSrtPath",
  "transcriptBinding",
  "upstream.animationPackage",
  "upstream.completePackage",
])
  test(`metadata three way merge preserves and resolves concurrent ${field} changes`, () => {
    const base = model.normalizePlan({ shots: [shot()] });
    const current = structuredClone(base),
      incoming = structuredClone(base);
    if (field.startsWith("upstream.")) {
      const key=field.split(".")[1];
      current.upstream = {
        [key]: { summaryPath: "local.md" },
        localNote: "保留",
      };
      incoming.upstream = { [key]: { summaryPath: "incoming.md" } };
    } else if (field === "transcriptBinding") {
      current[field] = {
        sourceSha256: "local-source",
        transcriptSha256: "local-srt",
      };
      incoming[field] = {
        sourceSha256: "incoming-source",
        transcriptSha256: "incoming-srt",
      };
    } else {
      current[field] = "local";
      incoming[field] = "incoming";
    }
    const merged = model.mergePlans(base, current, incoming);
    assert.equal(merged.conflicts.length, 1);
    assert.equal(merged.conflicts[0].field, field);
    if (field.startsWith("upstream."))
      assert.deepEqual(merged.upstream, current.upstream);
    else assert.deepEqual(merged[field], current[field]);
    const resolved = model.changePlan(
      { ...doc(), productionPlan: merged },
      {
        type: "resolve-conflict",
        conflictId: merged.conflicts[0].id,
        choice: "incoming",
      },
    ).productionPlan;
    assert.equal(resolved.conflicts.length, 0);
    if (field.startsWith("upstream.")) {
      const key=field.split(".")[1];
      assert.deepEqual(
        resolved.upstream[key],
        incoming.upstream[key],
      );
      assert.equal(resolved.upstream.localNote, "保留");
      assert.equal(Object.hasOwn(resolved, field), false);
    } else assert.deepEqual(resolved[field], incoming[field]);
  });

test("metadata omitted by incoming results cannot remove current values or make conflicts", () => {
  const base = model.normalizePlan({
    shots: [shot()],
    animationWorkflow: "semantic-template-v1",
    sourceSrtPath: "base.srt",
    transcriptBinding: {
      sourceSha256: "base-source",
      transcriptSha256: "base-srt",
    },
    upstream: { animationPackage: { summaryPath: "base.md" } },
  });
  const current = structuredClone(base),
    incoming = structuredClone(base);
  current.sourceSrtPath = "local.srt";
  current.transcriptBinding = {
    sourceSha256: "local-source",
    transcriptSha256: "local-srt",
  };
  current.upstream.animationPackage.summaryPath = "local.md";
  delete incoming.animationWorkflow;
  delete incoming.sourceSrtPath;
  delete incoming.transcriptBinding;
  delete incoming.upstream.animationPackage;
  const merged = model.mergePlans(base, current, incoming);
  assert.equal(merged.animationWorkflow, current.animationWorkflow);
  assert.equal(merged.sourceSrtPath, current.sourceSrtPath);
  assert.deepEqual(merged.transcriptBinding, current.transcriptBinding);
  assert.deepEqual(merged.upstream, current.upstream);
  assert.deepEqual(merged.conflicts, []);
});

test('full package merges complete responsibilities without invalidating animation for camera or whitespace',()=>{
 const b=model.normalizePlan({shots:[{...shot(),narration:'原\n文',requirementVersion:3,slots:[{id:'slot',type:'video',description:'演示',requirementVersion:3}],bindings:[{id:'binding',slotId:'slot',instanceId:'i',requirementVersion:3,status:'current'}]}]});
 const incoming=structuredClone(b);incoming.animationWorkflow='semantic-template-v1';incoming.soundDesignVersion=1;incoming.upstream={completePackage:{fullPackageVersion:1,runId:'run',branches:{camera:'executed'}}};incoming.shots[0].cameraIntent={anchor:'原文',reason:'本轮重新设计真人镜头'};incoming.shots[0].narration='原文';incoming.shots[0].soundDesign={decision:'silence',reason:'人声',cues:[]};
 const out=model.mergePlans(b,b,incoming);assert.equal(out.upstream.completePackage.runId,'run');assert.equal(out.soundDesignVersion,1);assert.equal(out.shots[0].requirementVersion,3);assert.equal(out.shots[0].bindings[0].status,'current');
});
test('deleted plan can be restored without touching narration or placed media',()=>{
 const original=doc();original.instances=[{id:'keep',startFrame:40,durationFrames:20}];
 const deleted=model.changePlan(original,{type:'cancel-shot',shotId:'s1'});
 const restored=model.changePlan(deleted,{type:'restore-shot',shotId:'s1'});
 assert.equal(restored.productionPlan.shots[0].cancelled,false);
 assert.deepEqual(restored.instances,original.instances);
 assert.equal(restored.productionPlan.shots[0].narration,original.productionPlan.shots[0].narration);
});
