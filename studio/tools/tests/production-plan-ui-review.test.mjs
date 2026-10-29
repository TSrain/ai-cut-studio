import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import * as sync from "../editor/production-plan-sync.mjs";
const { syncPlanHistory, observeCandidateReads } = sync;
import { editHistory, undoHistory, redoHistory } from "../editor/history.mjs";
const require = createRequire(
  new URL("../../templates/remotion-base/package.json", import.meta.url),
);
const { build, transform } = require("esbuild"),
  React = require("react"),
  { renderToStaticMarkup } = require("react-dom/server");
const changes = {
  addedSections: [
    {
      cueIds: ["c1"],
      narration: "新增实际口播",
      reason: "新的论证",
      confidence: 0.9,
    },
    "旧字符串新增",
  ],
  removedSections: [
    { shotId: "s", reason: "实际录制删除", confidence: 1 },
    "旧字符串删除",
  ],
};
const doc = () => ({
  id: "A",
  revision: 1,
  canvas: { fps: { num: 30, den: 1 }, durationFrames: 300 },
  instances: [{ id: "a", props: { label: "before" } }],
  productionPlan: {
    shots: [
      {
        id: "s",
        title: "原镜头",
        narration: "原口播",
        visualRequirement: "要求",
        mediaDescription: "素材",
        timing: { ranges: [], status: "unaligned" },
        slots: [],
        bindings: [],
        candidates: [],
        keyframes: [],
      },
    ],
    conflicts: [],
    script: "正文",
  },
});
async function component(file, name, mockReact) {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL("../editor/" + file, import.meta.url))],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    external: ["react", "react-dom", "react-dom/*"],
    loader: { ".css": "empty" },
    nodePaths: [
      fileURLToPath(
        new URL("../../templates/remotion-base/node_modules", import.meta.url),
      ),
    ],
  });
  const module = { exports: {} };
  runInNewContext(compiled.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: mockReact
      ? (name) => (name === "react" ? mockReact : require(name))
      : require,
    innerHeight: 720,
    localStorage: {
      getItem() {
        return null;
      },
    },
    console,
    Object,
    structuredClone,
  });
  return module.exports[name];
}
test("job panel renders object-valued additions/removals and legacy strings", async () => {
  const Panel = await component(
    "ProductionPlanPanel.tsx",
    "ProductionPlanPanel",
  );
  const html = renderToStaticMarkup(
    React.createElement(Panel, {
      document: doc(),
      controller: {
        jobs: [{ id: "j", kind: "align", contentChanges: changes }],
        history: [],
        pendingResults: [],
        busy: false,
      },
      onSelect() {},
    }),
  );
  for (const text of [
    "新增实际口播",
    "新的论证",
    "原镜头",
    "实际录制删除",
    "旧字符串新增",
    "旧字符串删除",
  ])
    assert.ok(html.includes(text), text);
});
test("alignment result renders structured content changes safely", async () => {
  const Result = await component(
    "ProductionPlanResult.tsx",
    "ProductionPlanResult",
  );
  const html = renderToStaticMarkup(
    React.createElement(Result, {
      document: doc(),
      result: {
        kind: "alignment",
        shotId: "s",
        alignment: { contentChanges: changes },
      },
      onOverride() {},
      onApply() {},
      onIgnore() {},
      onChecked() {},
    }),
  );
  for (const text of [
    "新增实际口播",
    "新的论证",
    "原镜头",
    "实际录制删除",
    "旧字符串新增",
    "旧字符串删除",
  ])
    assert.ok(html.includes(text), text);
});
test("multiple undo never resurrects automatic media; explicit redo restores it", () => {
  const base = doc(),
    edited = structuredClone(base),
    remote = structuredClone(base);
  edited.instances[0].props.label = "after";
  remote.instances.push({ id: "b", props: {} });
  remote.productionPlan.shots[0].bindings = [
    {
      id: "binding-b",
      instanceId: "b",
      resultId: "result-b",
      status: "current",
    },
  ];
  remote.productionPlan.appliedResultIds = ["result-b"];
  remote.productionPlan.shots[0].candidates = [{ id: "candidate-new" }];
  const applied = syncPlanHistory(
    { past: [base], present: edited, future: [] },
    base,
    remote,
    true,
  );
  let h = undoHistory(applied);
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(
      h.present.instances.map((i) => i.id),
      ["a"],
    );
    assert.ok(h.present.productionPlan.dismissedResultIds.includes("result-b"));
    assert.equal(
      h.present.productionPlan.shots[0].candidates[0].id,
      "candidate-new",
    );
    if (i === 0) h = undoHistory(h);
  }
  assert.equal(h.present.instances[0].props.label, "before");
  h = redoHistory(h);
  assert.equal(h.present.instances[0].props.label, "after");
  assert.deepEqual(
    h.present.instances.map((i) => i.id),
    ["a"],
  );
  h = redoHistory(h);
  assert.deepEqual(
    h.present.instances.map((i) => i.id),
    ["a", "b"],
  );
  assert.ok(!h.present.productionPlan.dismissedResultIds?.includes("result-b"));
});
async function hookHarness(fetchImpl) {
  const code = await transform(
    readFileSync(
      new URL("../editor/useProductionPlan.ts", import.meta.url),
      "utf8",
    ),
    { loader: "ts", format: "cjs" },
  );
  const values = [],
    effects = [],
    deps = [];
  let cursor = 0,
    currentDoc = doc(),
    controller;
  const mockReact = {
    useState(initial) {
      const index = cursor++;
      if (!(index in values))
        values[index] = typeof initial === "function" ? initial() : initial;
      return [
        values[index],
        (v) => {
          values[index] = typeof v === "function" ? v(values[index]) : v;
        },
      ];
    },
    useRef(initial) {
      const index = cursor++;
      return values[index] ?? (values[index] = { current: initial });
    },
    useEffect(fn, next) {
      const index = cursor++;
      if (!deps[index] || next.some((v, i) => v !== deps[index][i])) {
        effects.push(() => {
          values[index]?.();
          values[index] = fn();
        });
        deps[index] = next;
      }
    },
  };
  const calls = [],
    events = [];
  const module = { exports: {} };
  runInNewContext(code.code, {
    module,
    exports: module.exports,
    require(name) {
      return name === "react" ? mockReact : { changePlan: (base) => base };
    },
    fetch: async (url, options) => {
      const body = options?.body ? JSON.parse(options.body) : undefined;
      calls.push({ url, body });
      return { ok: true, json: async () => fetchImpl(url, body, currentDoc) };
    },
    structuredClone,
    crypto: { randomUUID },
    setInterval: () => 1,
    clearInterval() {},
  });
  let save = async () => {
    events.push("save");
  };
  const render = () => {
    cursor = 0;
    controller = module.exports.useProductionPlan({
      document: currentDoc,
      getDocument: () => currentDoc,
      save: () => save(),
      onSync() {
        events.push("sync");
      },
      canSync: () => false,
    });
    while (effects.length) effects.shift()();
    return controller;
  };
  render();
  return {
    render,
    calls,
    events,
    get controller() {
      return controller;
    },
    setDoc(d) {
      currentDoc = d;
      return render();
    },
    setSave(fn) {
      save = fn;
    },
  };
}
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
test("queued actions stay bound to origin generation after project switch", async () => {
  const gate = deferred();
  const h = await hookHarness(async (url, body, d) => {
    if (body?.operation?.type === "hover") {
      await gate.promise;
      return { document: { ...d, id: body.projectId } };
    }
    return { document: d };
  });
  const a = h.controller.action({ type: "hover" }),
    b = h.controller.action({ type: "move-shot", shotId: "s" });
  const rejected = assert.rejects(b, /工程已切换/);
  await new Promise((r) => setImmediate(r));
  h.setDoc({ ...doc(), id: "B" });
  gate.resolve();
  await a;
  await rejected;
  assert.deepEqual(
    h.calls.map((c) => c.body.projectId),
    ["A"],
  );
  assert.equal(h.events.filter((x) => x === "save").length, 1);
});
test("late old-project job response does not enter current jobs", async () => {
  const gate = deferred();
  const h = await hookHarness(async (url, body) => {
    await gate.promise;
    return { job: { id: "old-job", projectId: body.projectId } };
  });
  const work = h.controller.startJob("package");
  await new Promise((r) => setImmediate(r));
  h.setDoc({ ...doc(), id: "B" });
  gate.resolve();
  await work;
  assert.equal(h.render().jobs.length, 0);
});
test("retry saves latest edit before snapshot request and retains original job", async () => {
  const h = await hookHarness(async (url, body, d) => {
    h.events.push("request");
    return {
      job: {
        id: url.endsWith("/retry") ? "new-job" : "old-job",
        projectId: d.id,
      },
    };
  });
  await h.controller.startJob("broll");
  h.render();
  h.events.length = 0;
  h.setSave(async () => h.events.push("save-latest-trim"));
  await h.controller.jobAction("old-job", "retry");
  assert.deepEqual(h.events, ["save-latest-trim", "request"]);
  assert.deepEqual(
    Array.from(h.render().jobs, (j) => j.id),
    ["new-job", "old-job"],
  );
});
test("only individually visible candidates in active simple view become read", () => {
  assert.equal(typeof observeCandidateReads, "function");
  let callback,
    disconnected = false,
    active = true,
    view = "simple";
  const reads = [];
  class Observer {
    constructor(fn, options) {
      callback = fn;
      assert.equal(options.root.id, "inspector");
    }
    observe() {}
    disconnect() {
      disconnected = true;
    }
  }
  const node = (id) => ({
      dataset: { shotId: "s", candidateId: id, unread: "true" },
    }),
    first = node("visible"),
    second = node("below");
  const stop = observeCandidateReads({
    root: { id: "inspector" },
    elements: [first, second],
    Observer,
    isActive: () => active && view === "simple",
    onRead: (rows) => reads.push(rows),
  });
  callback([
    { target: first, isIntersecting: true, intersectionRatio: 1 },
    { target: second, isIntersecting: false, intersectionRatio: 0 },
  ]);
  assert.deepEqual(reads, [[{ shotId: "s", candidateIds: ["visible"] }]]);
  view = "current";
  callback([{ target: second, isIntersecting: true, intersectionRatio: 1 }]);
  assert.equal(reads.length, 1);
  view = "simple";
  active = false;
  callback([{ target: second, isIntersecting: true, intersectionRatio: 1 }]);
  assert.equal(reads.length, 1);
  active = true;
  stop();
  assert.equal(disconnected, true);
  callback([{ target: second, isIntersecting: true, intersectionRatio: 1 }]);
  assert.equal(reads.length, 1);
});

test("generation also rejects old queued work after returning to same project ID", async () => {
  const gate = deferred(),
    h = await hookHarness(async (url, body, d) => {
      await gate.promise;
      return { document: { ...d, id: body.projectId } };
    });
  const a = h.controller.action({ type: "hover" }),
    b = h.controller.action({ type: "move-shot", shotId: "s" }),
    rejected = assert.rejects(b, /工程已切换/);
  await new Promise((r) => setImmediate(r));
  h.setDoc({ ...doc(), id: "B" });
  h.setDoc(doc());
  gate.resolve();
  await a;
  await rejected;
  assert.equal(h.calls.length, 1);
  assert.equal(h.events.filter((e) => e === "sync").length, 0);
});
test("manual semantic confirmation is bound to media hash, requirement and selected target", () => {
  const { contentConfirmationFor, mediaResultEligible } = sync;
  assert.equal(typeof contentConfirmationFor, "function");
  assert.equal(typeof mediaResultEligible, "function");
  const d = doc();
  d.productionPlan.shots[0].requirementVersion = 3;
  d.productionPlan.shots[0].slots = [{ id: "slot" }];
  const r = {
    kind: "match",
    shotId: "s",
    slotId: "slot",
    technical: { passed: true, details: { sha256: "a".repeat(64) } },
    contentReview: { passed: false, uncertainties: ["未采样连续性"] },
  };
  assert.equal(mediaResultEligible(r, d), false);
  const confirmation = contentConfirmationFor(
    r,
    d.productionPlan.shots[0],
    "slot",
  );
  assert.deepEqual(confirmation, {
    confirmed: true,
    mediaSha256: "a".repeat(64),
    requirementVersion: 3,
    shotId: "s",
    slotId: "slot",
  });
  const o = { shotId: "s", slotId: "slot", contentConfirmation: confirmation };
  assert.equal(mediaResultEligible(r, d, o), true);
  for (const patch of [
    { mediaSha256: "b".repeat(64) },
    { requirementVersion: 2 },
    { shotId: "other" },
    { slotId: "other" },
    { confirmed: false },
  ])
    assert.equal(
      mediaResultEligible(r, d, {
        ...o,
        contentConfirmation: { ...confirmation, ...patch },
      }),
      false,
    );
  assert.equal(
    mediaResultEligible({ ...r, technical: { passed: false } }, d, o),
    false,
  );
  assert.equal(r.contentReview.passed, false);
});
test("unverified semantic media panel shows uncertainty, preview, independent confirmation and disabled adoption", async () => {
  const Panel = await component(
      "ProductionPlanPanel.tsx",
      "ProductionPlanPanel",
    ),
    d = doc();
  d.productionPlan.shots[0].requirementVersion = 3;
  d.productionPlan.shots[0].slots = [{ id: "slot" }];
  const r = {
    id: "r",
    kind: "match",
    state: "pending",
    shotId: "s",
    slotId: "slot",
    media: { path: "/safe/test.mp4" },
    technical: { passed: true, details: { sha256: "a".repeat(64) } },
    contentReview: { passed: false, uncertainties: ["未采样连续性"] },
  };
  const html = renderToStaticMarkup(
    React.createElement(Panel, {
      document: d,
      controller: { jobs: [], history: [], pendingResults: [r], busy: false },
      onSelect() {},
    }),
  );
  assert.ok(html.includes("未采样连续性"));
  assert.ok(html.includes("我已预览并确认此素材符合当前要求"));
  assert.match(
    html,
    /<video[^>]*src="\/api\/editor\/production-plan\/file\?[^"]*browserPreview=1/,
  );
  assert.match(html, /<button disabled="">采用此结果<\/button>/);
});
test("undoing two automatic arrivals retains both dismissal intents in older snapshots", () => {
  const base = doc(),
    edited = structuredClone(base);
  edited.instances[0].props.label = "after";
  const first = structuredClone(base);
  first.instances.push({ id: "b", props: {} });
  first.productionPlan.shots[0].bindings = [
    {
      id: "binding-b",
      instanceId: "b",
      resultId: "result-b",
      status: "current",
    },
  ];
  let h = syncPlanHistory(
    { past: [base], present: edited, future: [] },
    base,
    first,
    true,
  );
  const second = structuredClone(first);
  second.instances.push({ id: "c", props: {} });
  second.productionPlan.shots[0].bindings.push({
    id: "binding-c",
    instanceId: "c",
    resultId: "result-c",
    status: "current",
  });
  h = syncPlanHistory(h, first, second, true);
  h = undoHistory(h);
  assert.deepEqual(
    h.present.instances.map((i) => i.id),
    ["a", "b"],
  );
  h = undoHistory(h);
  assert.deepEqual(
    h.present.instances.map((i) => i.id),
    ["a"],
  );
  assert.deepEqual(
    new Set(h.present.productionPlan.dismissedResultIds),
    new Set(["result-b", "result-c"]),
  );
  h = undoHistory(h);
  assert.deepEqual(
    new Set(h.present.productionPlan.dismissedResultIds),
    new Set(["result-b", "result-c"]),
  );
  h = redoHistory(redoHistory(redoHistory(h)));
  assert.deepEqual(
    h.present.instances.map((i) => i.id),
    ["a", "b", "c"],
  );
});

test("autosave and poll acknowledgements after undo preserve older edits and redo", () => {
  const initial = doc();
  initial.instances = [];
  let h = editHistory(
    { past: [], present: initial, future: [] },
    {
      ...structuredClone(initial),
      instances: [{ id: "preset", props: { label: "ordinary" } }],
    },
  );
  const serverBefore = structuredClone(h.present);
  const applied = structuredClone(serverBefore);
  applied.revision++;
  applied.instances.push({ id: "blue", props: { source: "/blue.mp4" } });
  applied.productionPlan.shots[0].bindings = [
    {
      id: "binding-blue",
      instanceId: "blue",
      resultId: "result-blue",
      status: "current",
      requirementVersion: 4,
      startFrame: 30,
      durationFrames: 60,
    },
  ];
  applied.productionPlan.appliedResultIds = ["result-blue"];
  h = syncPlanHistory(h, serverBefore, applied, true);
  h = undoHistory(h);
  assert.deepEqual(
    h.present.instances.map((i) => i.id),
    ["preset"],
  );
  const savedUndo = structuredClone(h.present);
  savedUndo.revision++;
  savedUndo.productionPlan.dismissedResultIds = ["result-blue"];
  savedUndo.productionPlan.shots[0].bindings[0].status = "removed";
  // The hook last saw the applied result; a poll now returns our own saved Undo.
  h = syncPlanHistory(h, applied, savedUndo, true);
  assert.equal(
    h.future.length,
    1,
    "a poll acknowledgement must not clear redo",
  );
  assert.equal(
    h.past.length,
    1,
    "a poll acknowledgement must not create a new edit",
  );
  h = undoHistory(h);
  assert.deepEqual(
    h.present.instances,
    [],
    "second Undo removes the earlier ordinary preset",
  );
  const savedSecond = structuredClone(h.present);
  savedSecond.revision++;
  h = syncPlanHistory(h, savedUndo, savedSecond, true);
  for (let n = 0; n < 3; n++)
    h = syncPlanHistory(
      h,
      savedSecond,
      { ...savedSecond, revision: savedSecond.revision + n },
      true,
    );
  assert.equal(h.past.length, 0);
  assert.equal(h.future.length, 2);
  h = redoHistory(h);
  assert.deepEqual(
    h.present.instances.map((i) => i.id),
    ["preset"],
  );
  h = redoHistory(h);
  assert.deepEqual(
    h.present.instances.map((i) => i.id),
    ["preset", "blue"],
  );
  assert.equal(h.present.productionPlan.shots[0].bindings[0].status, "current");
  assert.ok(
    !h.present.productionPlan.dismissedResultIds?.includes("result-blue"),
  );
});
test("browser media URLs retain external URLs and original downloads", () => {
  const original = sync.planMediaUrl("/safe/alpha.mov", "A");
  assert.equal(
    sync.planMediaUrl("/safe/alpha.mov", "A", true),
    original + "&browserPreview=1",
  );
  assert.equal(
    sync.planMediaUrl("https://example.com/alpha.mov", "A", true),
    "https://example.com/alpha.mov",
  );
  assert.ok(!original.includes("browserPreview"));
});

test("one-based and zero-based stored orders display consecutive sorted shot numbers", async () => {
  const Panel = await component(
    "ProductionPlanPanel.tsx",
    "ProductionPlanPanel",
  );
  const Track = await component(
    "ProductionPlanTrack.tsx",
    "ProductionPlanTrack",
  );
  for (const start of [0, 1]) {
    const d = doc();
    const a = {
      ...structuredClone(d.productionPlan.shots[0]),
      id: "first",
      order: start,
      title: "第一镜",
      animationNeed: "required",
      approval: "approved",
      timing: {
        ranges: [{ id: "r1", startFrame: 0, durationFrames: 30 }],
        manual: true,
        status: "manual",
      },
    };
    const b = {
      ...structuredClone(a),
      id: "second",
      order: start + 1,
      title: "第二镜",
      timing: {
        ranges: [{ id: "r2", startFrame: 30, durationFrames: 30 }],
        manual: true,
        status: "manual",
      },
    };
    d.productionPlan.shots = [b, a];
    const panel = renderToStaticMarkup(
      React.createElement(Panel, {
        document: d,
        controller: { jobs: [], history: [], pendingResults: [], busy: false },
        onSelect() {},
      }),
    );
    const track = renderToStaticMarkup(
      React.createElement(Track, {
        document: d,
        px: 1,
        labelWidth: 80,
        onSelect() {},
        onAction() {},
      }),
    );
    for (const html of [panel, track]) {
      assert.ok(html.includes("1. 第一镜"), html);
      assert.ok(html.includes("2. 第二镜"), html);
      assert.ok(!html.includes("3. 第二镜"));
    }
  }
});
test("approved alpha media preview link requests browser-compatible rendition", async () => {
  const Panel = await component(
    "ProductionPlanPanel.tsx",
    "ProductionPlanPanel",
  );
  const r = {
    id: "alpha",
    kind: "media",
    state: "pending",
    media: { path: "/safe/alpha.mov" },
    technical: { passed: true },
    contentReview: { passed: true },
  };
  const html = renderToStaticMarkup(
    React.createElement(Panel, {
      document: doc(),
      controller: { jobs: [], history: [], pendingResults: [r], busy: false },
      onSelect() {},
    }),
  );
  assert.ok(html.includes("path=%2Fsafe%2Falpha.mov&amp;browserPreview=1"));
  assert.ok(!html.includes("我已预览并确认"));
});

test("actual media-card HTML5 payload reaches ordinary track and empty-space frame handlers", async () => {
  const item = {
    id: "png",
    name: "图片",
    kind: "image",
    scope: "project",
    path: "/safe/test.png",
    url: "/safe/test.png",
  };
  const states = [
    "project",
    null,
    null,
    [item],
    "",
    "all",
    false,
    false,
    "",
    60,
    0,
  ];
  let cursor = 0;
  const mock = {
    ...React,
    useEffect() {},
    useLayoutEffect() {},
    useMemo(fn) { return fn(); },
    useState(initial) {
      return [
        cursor < states.length
          ? states[cursor++]
          : typeof initial === "function"
            ? initial()
            : initial,
        () => {},
      ];
    },
    useRef(initial) {
      return { current: initial };
    },
    useContext() {
      return { projectId: "A" };
    },
    useSyncExternalStore() {
      return 0;
    },
  };
  const Library = await component("StudioLibrary.tsx", "StudioLibrary", mock);
  const tree = Library({ category: "media", onPreview() {}, onManage() {} });
  const walk = (node, match) => {
    if (!node || typeof node !== "object") return undefined;
    if (match(node)) return node;
    for (const child of React.Children.toArray(node.props?.children)) {
      const found = walk(child, match);
      if (found) return found;
    }
  };
  const card = walk(tree, (n) =>
    n.props?.className?.startsWith("studio-library-card"),
  );
  assert.equal(card.props.draggable, true);
  const data = new Map(),
    transfer = {
      types: [],
      effectAllowed: "",
      setData(type, value) {
        data.set(type, value);
        this.types.push(type);
      },
      getData(type) {
        return data.get(type) || "";
      },
    };
  card.props.onDragStart({ dataTransfer: transfer });
  assert.deepEqual(JSON.parse(transfer.getData("application/x-motion-media")), {
    id: "png",
    kind: "image",
    scope: "project",
    projectId: "A",
  });
  assert.equal(transfer.effectAllowed, "copy");
  const Timeline = await component("Timeline.tsx", "Timeline", {
    ...mock,
    useState(initial) {
      return [typeof initial === "function" ? initial() : initial, () => {}];
    },
  });
  const d = doc();
  d.instances = [];
  d.tracks = [
    { id: "track", name: "轨道" },
    { id: "locked", name: "锁轨", locked: true },
  ];
  d.audioTracks = [];
  const calls = [];
  const timeline = Timeline({
    hoverPreview:{resolvePointerSeek(_x,raw){return raw;}},
    document: d,
    clock: {
      subscribe() {},
      getSnapshot() {
        return 0;
      },
    },
    zoom: 1,
    selection: [],
    nameOf() {
      return "";
    },
    onDropMedia(...args) {
      calls.push(args);
    },
  });
  const sc = walk(timeline, (n) => n.props?.className === "timeline-scroll");
  sc.ref.current = {
    scrollLeft: 40,
    scrollTop: 0,
    getBoundingClientRect() {
      return { left: 0, top: 100, bottom: 650 };
    },
    querySelectorAll() {
      return [];
    },
  };
  const e = (x, y = 350, plan = false) => ({
    dataTransfer: transfer,
    clientX: x,
    clientY: y,
    target: {
      closest() {
        return plan ? {} : null;
      },
    },
    preventDefault() {},
    stopPropagation() {},
  });
  const row = walk(timeline, (n) => n.props?.["data-track-id"] === "track");
  row.props.onDrop(e(600));
  const expected = Math.round((600 + 40 - 132) / ((1000 - 132 - 30) / 300));
  assert.equal(calls[0][1], expected);
  assert.equal(calls[0][2], "track");
  const locked = walk(timeline, (n) => n.props?.["data-track-id"] === "locked");
  locked.props.onDrop(e(600));
  assert.equal(calls.length, 1);
  const content = walk(
    timeline,
    (n) => n.props?.className === "timeline-content",
  );
  content.props.onDropCapture(e(710));
  assert.equal(
    calls[1][1],
    Math.round((710 + 40 - 132) / ((1000 - 132 - 30) / 300)),
  );
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1][2])), { newTrack: 0 });
  content.props.onDropCapture(e(710, 350, true));
  assert.equal(
    calls.length,
    2,
    "ordinary insertion does not consume plan-track drops",
  );
});

test('ruler omits presenter and sound-only segments while preserving visual timing', async () => {
  const Track = await component('ProductionPlanTrack.tsx', 'ProductionPlanTrack');
  const d=doc();
  d.productionPlan.shots=[0,1,2].map(i=>({id:'s'+i,order:i+1,title:['保留原片','添加音效','增加动画'][i],approval:'draft',
    animationNeed:i===2?'required':'none',
    timing:{status:'manual',manual:true,ranges:[{id:'r'+i,startFrame:i*90,durationFrames:30}]},
    upstream:{packageShot:{keepOriginal:i!==2,productionActions:i===1?['sound']:[]}}}));
  const before=structuredClone(d);
  const html=renderToStaticMarkup(React.createElement(Track,{document:d,px:1,labelWidth:80}));
  assert.ok(!html.includes('data-plan-shot="s0"'));
  assert.ok(!html.includes('data-plan-shot="s1"'));
  assert.ok(html.includes('data-plan-shot="s2"'));
  assert.ok(html.includes('3. 增加动画'));
  assert.ok(html.includes('left:260px'));
  assert.deepEqual(d,before);
  d.productionPlan.shots.pop();
  const empty=renderToStaticMarkup(React.createElement(Track,{document:d,px:1,labelWidth:80}));
  assert.ok(!empty.includes('data-plan-shot='));
  assert.ok(!empty.includes('未对齐计划'));
});

test('effect design details distinguish source time from hand-edited project timing', async()=>{
 const Detail=await component('PlanTimingDetails.tsx','PlanTimingDetails');
 const html=renderToStaticMarkup(React.createElement(Detail,{shot:{timing:{manual:true},effectTiming:{status:'draft',startSeconds:2,changeSeconds:2.4,holdSeconds:3.5,endSeconds:4,evidence:{reason:'只覆盖重点句'}},cameraIntent:{purpose:'强调结论'},presenterLayerIntent:{description:'文字在人物后方'}}}));
 assert.ok(html.includes('当前采用手动区间'));
 assert.ok(html.includes('效果时间草案'));
 assert.ok(html.includes('原视频位置'));
 assert.ok(html.includes('强调结论'));
 assert.ok(html.includes('文字在人物后方'));
});

test('legacy binding without source offset still opens plan sidebar',async()=>{
 const Panel=await component('ProductionPlanPanel.tsx','ProductionPlanPanel');
 const d=doc();d.instances[0].startFrame=0;d.instances[0].durationFrames=30;
 d.productionPlan.shots[0].bindings=[{id:'binding',instanceId:'a',slotId:'slot',status:'current'}];
 const html=renderToStaticMarkup(React.createElement(Panel,{document:d,selectedShot:'s',controller:{jobs:[],history:[],pendingResults:[],busy:false},onSelect(){}}));
 assert.ok(html.includes('0.00'));
});

test("semantic template workflow renders runnable broll without animation approvals", async () => {
  const Panel = await component("ProductionPlanPanel.tsx", "ProductionPlanPanel");
  const document = doc();
  document.source = {path: "voice.mov"};
  document.productionPlan.approval = "needs_design";
  document.productionPlan.animationWorkflow = "semantic-template-v1";
  const html = renderToStaticMarkup(React.createElement(Panel, {
    document,
    controller: {jobs: [{id:"old",kind:"package",status:"waiting_selection",choices:[],approvalRequests:[{type:"design",reason:"批准当前分镜内容",files:[]}]}], history:[],pendingResults:[],busy:false},
    onSelect() {},
  }));
  assert.ok(html.includes("全文需求已分析"));
  assert.ok(!html.includes("需更新设计"));
  assert.ok(!html.includes("本期分镜审批"));
  assert.ok(!html.includes("批准当前分镜并继续"));
  assert.ok(!html.includes("当前任务视觉方向"));
  assert.ok(!html.includes("批准当前分镜内容"));
  const button = html.match(/<button([^>]*)>运行整期 broll<\/button>/);
  assert.ok(button);
  assert.ok(!button[1].includes("disabled"));
});

function findElement(node, match) {
  if (!node || typeof node !== "object") return undefined;
  if (match(node)) return node;
  for (const child of React.Children.toArray(node.props?.children)) {
    const found = findElement(child, match);
    if (found) return found;
  }
}
async function deliveryPanelHarness() {
  const values = [];
  let cursor = 0;
  const Panel = await component("ProductionPlanPanel.tsx", "FullProductionPlanPanel", {
    ...React,
    useEffect() {},
    useRef(initial) { return { current: initial }; },
    useState(initial) {
      const index = cursor++;
      if (!(index in values)) values[index] = typeof initial === "function" ? initial() : initial;
      return [values[index], (value) => { values[index] = typeof value === "function" ? value(values[index]) : value; }];
    },
  });
  const calls = [];
  const document = doc();
  const controller = { jobs: [], history: [], pendingResults: [], busy: false,
    startJob(...args) { calls.push(args); return Promise.resolve(); } };
  return { calls, controller, document, render() { cursor = 0; return Panel({document, controller, onSelect() {}}); } };
}
test("delivery import sends the original absolute manifest path without a shot target or audio work", async () => {
  const h = await deliveryPanelHarness();
  delete h.document.productionPlan;
  let tree = h.render();
  const input = findElement(tree, n => n.props?.["aria-label"] === "动画交付清单绝对路径");
  assert.ok(input, "a local manifest path input is available");
  input.props.onChange({target: {value: "  /Users/example/动画/animation-delivery.json  "}});
  tree = h.render();
  const button = findElement(tree, n => n.type === "button" && n.props.children === "按交付清单导入");
  assert.equal(button.props.disabled, false);
  button.props.onClick();
  await Promise.resolve();
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [["recognize", {
    deliveryManifestPath: "/Users/example/动画/animation-delivery.json",
    scope: {camera: false, sound: false},
  }]]);
});
test("delivery import rejects relative paths instead of losing manifest-relative media locations", async () => {
  const h = await deliveryPanelHarness();
  const input = findElement(h.render(), n => n.props?.["aria-label"] === "动画交付清单绝对路径");
  assert.ok(input);
  input.props.onChange({target: {value: "animation-delivery.json"}});
  const button = findElement(h.render(), n => n.type === "button" && n.props.children === "按交付清单导入");
  button.props.onClick();
  await Promise.resolve();
  assert.equal(h.calls.length, 0);
  const error = findElement(h.render(), n => n.props?.role === "alert");
  assert.ok(error.props.children.includes("绝对路径"));
});
test("delivery results display project time and transparency without shot, replacement, or trim controls", async () => {
  const Panel = await component("ProductionPlanPanel.tsx", "ProductionPlanPanel");
  const delivery = {id: "delivery-1",kind: "delivery",state: "ready", technical: {passed: true},
    media: {path: "/animations/overlay.mov",sourceInSeconds: 0},
    target: {startFrame: 45,durationFrames: 75},
    delivery: {manifestPath: "/animations/animation-delivery.json",manifestSha256: "hash",entryIndex: 0,startSeconds: 1.5,durationSeconds: 2.5,transparent: true,timeBase: "project"}};
  const html = renderToStaticMarkup(React.createElement(Panel, {document: doc(),controller: {
    jobs: [],history: [],pendingResults: [delivery],busy: false},onSelect() {}}));
  assert.ok(html.includes("独立轨道"));
  assert.ok(html.includes("1.50–4.00 秒"));
  assert.ok(html.includes("透明叠加"));
  assert.ok(html.includes("待入轨"));
  assert.ok(!html.includes("待确认"));
  for (const text of ["目标镜头", "目标槽位", "采用位置", "素材入点", "素材出点", "我已预览并确认"]) assert.ok(!html.includes(text), text);
  assert.ok(html.includes("按清单自动追加"));
  assert.ok(!html.includes("采用此结果"));
  const failed = renderToStaticMarkup(React.createElement(Panel, {document: doc(),controller: {
    jobs: [],history: [],pendingResults: [{...delivery,technical: {passed: false}}],busy: false},onSelect() {}}));
  assert.ok(failed.includes("待核验"));
  assert.ok(!failed.includes("采用此结果"));
});

test("footage action reviews the complete project independently of legacy animation approval", async () => {
  const h = await deliveryPanelHarness();
  h.document.source = {path: "voice.mov"};
  h.document.productionPlan.approval = "waiting_approval";
  const tree = h.render();
  const button = findElement(tree, n => n.type === "button" && n.props.children === "真实素材审稿与搜集");
  assert.ok(button, "independent footage action exists");
  assert.equal(button.props.disabled, false);
  button.props.onClick();
  await Promise.resolve();
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [["footage", {
    scope: {camera: false, sound: false, footage: true},
  }]]);
});

test("footage records show project candidates and automatic placements without old slot controls", async () => {
  const Panel = await component("ProductionPlanPanel.tsx", "ProductionPlanPanel");
  const document = doc();
  const results = [
    {id:"candidate", kind:"footage", state:"ready", footage:{reviewPath:"/review.json",reviewSha256:"a".repeat(64),candidateId:"c1",placementId:null}, media:{path:"/source.mov"}, technical:{passed:true}},
    {id:"placement", kind:"footage", state:"pending", footage:{reviewPath:"/review.json",reviewSha256:"a".repeat(64),candidateId:"c1",placementId:"p1"}, media:{path:"/source.mov"}, technical:{passed:true}},
    {id:"placed", kind:"footage", state:"applied", footage:{reviewPath:"/review.json",reviewSha256:"a".repeat(64),candidateId:"c2",placementId:"p2"}, media:{path:"/source2.mov"}, technical:{passed:true}},
  ];
  document.productionPlan.upstream = {footagePackage:{summaryPath:"/latest/report.md"}};
  const html = renderToStaticMarkup(React.createElement(Panel, {document,
    controller:{jobs:[{id:"f",kind:"footage",status:"waiting_approval",approvalRequests:[{type:"design",reason:"STALE_FOOTAGE_APPROVAL"}],choices:[{id:"stale"}],outputs:{footageReviewPath:"/job/review.json",footageSummaryPath:"/job/report.md",allCandidateManifestPath:"/job/candidates.json"},results}],history:[],pendingResults:results,busy:false}, onSelect() {}}));
  for (const text of ["项目候选", "待入轨", "已入轨", "逐段素材审稿", "全部候选清单", "/latest/report.md", "/job/review.json", "/job/candidates.json"])
    assert.ok(html.includes(encodeURIComponent(text)) || html.includes(text), text);
  for (const text of ["STALE_FOOTAGE_APPROVAL", "批准本期分镜并继续", "当前任务视觉方向", "采用此结果", "我已预览并确认此素材符合当前要求", "选择镜头", "选择槽位"])
    assert.ok(!html.includes(text), text);
});

test("footage ready phase describes completed library and placement work while retaining partial status", async () => {
  const Panel = await component("ProductionPlanPanel.tsx", "ProductionPlanPanel");
  const html = renderToStaticMarkup(React.createElement(Panel, {
    document: doc(),
    controller: {jobs:[{id:"f",kind:"footage",status:"partial",stage:"footage_ready",processed:14,total:14,results:[]}],history:[],pendingResults:[],busy:false},
    onSelect() {},
  }));
  assert.ok(html.includes("部分完成"));
  assert.ok(html.includes("素材已入库并推荐入轨"));
  assert.ok(!html.includes("处理中"));
});


test("full package job shows complete responsibilities rather than legacy shot counts", async () => {
  const Panel = await component("ProductionPlanPanel.tsx", "ProductionPlanPanel");
  for (const version of [1, undefined]) {
  const html = renderToStaticMarkup(React.createElement(Panel, {
    document: doc(),
    controller: {jobs:[{id:"full",kind:"package",status:"complete",stage:"full_package_ready",processed:14,total:14,outputs:{fullPackageState:"complete",fullPackageBranches:Array.from({length:7},(_,i)=>({branch:String(i),status:"executed",changed:[]}))},results:[]},{id:"legacy",kind:"package",packageOrchestrationVersion:version,status:"complete",stage:"complete",processed:2,total:2,results:[]}],history:[],pendingResults:[],busy:false},
    onSelect() {},
  }));
  assert.ok(html.includes("完整package制作准备"));
  assert.ok(html.includes("完整package职责已执行"));
  assert.ok(html.includes("7 / 7 项职责"));
  assert.ok(!html.includes("14 / 14"));
  assert.ok(html.includes("分镜与关键帧"));
  }
});

test('organize button precedes hover preview, reads latest document and commits once without adding history for no-op', async () => {
  const mock = {...React, useEffect(){}, useLayoutEffect(){}, useMemo(fn){return fn();}, useState(initial){return [typeof initial==='function'?initial():initial,()=>{}];}, useRef(initial){return {current:initial};}, useSyncExternalStore(){return 0;}};
  const Timeline = await component('Timeline.tsx','Timeline',mock);
  const stale=doc();stale.instances=[];stale.tracks=[];stale.audioTracks=[];
  let current={...stale,tracks:[{id:'a',name:'a'},{id:'b',name:'b'}],instances:[{id:'a',assetId:'number-beat',startFrame:0,durationFrames:10,trackId:'a',zIndex:0,props:{}},{id:'b',assetId:'number-beat',startFrame:10,durationFrames:10,trackId:'b',zIndex:1000,props:{}}]};
  const calls=[];
  const tree=Timeline({document:stale,getDocument:()=>current,clock:{subscribe(){},getSnapshot(){return 0;}},zoom:1,selection:[],nameOf(){return '';},onCommit(base,next){calls.push([base,next]);current=next;}});
  const all=[];const walk=node=>{if(!node||typeof node!=='object')return;all.push(node);for(const child of React.Children.toArray(node.props?.children))walk(child);};walk(tree);
  const button=all.find(n=>n.props?.label==='整理轨道');assert.ok(button,'toolbar has an accessible organize button');
  assert.ok(all.indexOf(button)<all.findIndex(n=>n.props?.label==='悬停预览'));
  button.props.onClick();assert.equal(calls.length,1);assert.equal(calls[0][0].tracks.length,2);assert.equal(calls[0][1].tracks.length,1);
  button.props.onClick();assert.equal(calls.length,1);
});
test('focused sidebar provides current-version retry when a completed revision could not apply',async()=>{
 const Panel=await component('ProductionPlanPanel.tsx','ProductionPlanPanel');
 const d=doc();d.productionPlan.shots[0].timing={ranges:[{id:'r',startFrame:0,durationFrames:60}],status:'manual',manual:true};
 const html=renderToStaticMarkup(React.createElement(Panel,{document:d,selectedShot:'s',controller:{jobs:[{id:'j',kind:'revise',shotId:'s',status:'complete',results:[{id:'r',kind:'shot-revision',state:'stale',reason:'保留当前工程'}]}],history:[],pendingResults:[],busy:false},onSelect(){}}));
 assert.ok(html.includes('基于当前版本重试'));assert.ok(html.includes('修改未写回'));
 assert.ok(html.includes('更多：完整控制、生成与历史'));
});
test('plan annotations are editor text outside the player with no hover tooltip',async()=>{
 const Track=await component('ProductionPlanTrack.tsx','ProductionPlanTrack');const d=doc();d.productionPlan.shots[0].animationNeed='required';d.productionPlan.shots[0].timing={ranges:[{id:'r',startFrame:0,durationFrames:60}],status:'manual',manual:true};
 const html=renderToStaticMarkup(React.createElement(Track,{document:d,px:1,labelWidth:80,onSelect(){},onAction(){}}));
 assert.ok(html.includes('显示画布计划标注')||html.includes('隐藏画布计划标注'));
 assert.ok(!html.includes('role="tooltip"'));assert.ok(html.includes('plan-category-animation'));
});
test('focused feedback starts closed and drops time tags and explanation',async()=>{
 const Quick=await component('ProductionPlanShotInspector.tsx','ProductionPlanQuickView');const d=doc();
 d.productionPlan.shots[0].timing={ranges:[{id:'r',startFrame:0,durationFrames:60}],status:'manual',manual:true};
 const html=renderToStaticMarkup(React.createElement(Quick,{document:d,selectedShot:'s',resources:{},controller:{jobs:[],busy:false},onSelect(){}}));
 const details=html.match(/<details([^>]*)class="plan-feedback-section"([^>]*)>/);
 assert.ok(details);assert.ok(!details[0].includes(' open'));
 assert.ok(!html.includes('Codex 根据当前 package'));
 assert.ok(!html.includes('plan-kind-summary'));assert.ok(!html.replace(/<details class="plan-shot-evidence">.*?<\/details>/g,'').includes('0.00–2.00 秒'));
 assert.ok(!html.includes('这一段暂无候选'));assert.ok(html.includes('rows="2"'));
});
test('candidate preview uses inline video controls with one download action, no source prose',async()=>{
 const Candidate=await component('PlanCandidatePreview.tsx','PlanCandidatePreview');
 const html=renderToStaticMarkup(React.createElement(Candidate,{candidate:{id:'c',title:'手机支付',kind:'video',path:'/approved.mp4',previewPath:'/approved.jpg',license:'Pexels License',reason:'不能展示的冗余说明'},projectId:'p',shotId:'s'}));
 assert.ok(html.includes('<video'));assert.ok(html.includes('controls=""'));assert.ok(html.includes('aria-label="下载并入轨 手机支付"'));assert.ok(!html.includes('download=1'));
 assert.ok(!html.replace(/<details class="plan-candidate-evidence">.*?<\/details>/g,'').includes('不能展示的冗余说明'));assert.ok(!html.includes('Pexels License'));assert.ok(!html.includes('来源网页'));
});

test('same candidate id with new media remounts preview and isolates old responses',async()=>{
 const key=await component('PlanCandidatePreview.tsx','candidatePreviewKey');
 const c={id:'candidate',title:'标题',path:'old.mp4',downloadUrl:'https://example.com/old.mp4',sha256:'old'};
 const initial=key(c,'project','shot');
 assert.equal(key({...c,title:'新标题'},'project','shot'),initial);
 for(const patch of [{path:'new.mp4'},{localPath:'new.mp4'},{downloadUrl:'https://example.com/new.mp4'},{sha256:'new'}])assert.notEqual(key({...c,...patch},'project','shot'),initial);
 const source=readFileSync(new URL('../editor/ProductionPlanShotInspector.tsx',import.meta.url),'utf8');
 assert.ok(source.includes('key={candidatePreviewKey(c,doc.id,shot.id)}'));
});
test('feedback retry immediately shows progress while waiting for the fresh job response',async()=>{
 const states=[];let cursor=0,finish,calls=0;
 const mock={...React,useEffect(){},useRef(initial){return {current:initial};},useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],next=>{states[i]=typeof next==='function'?next(states[i]):next;}];}};
 const Quick=await component('ProductionPlanShotInspector.tsx','ProductionPlanQuickView',mock),d=doc();d.productionPlan.shots[0].timing={ranges:[{id:'range',startFrame:0,durationFrames:60}],manual:true,status:'manual'};
 const controller={busy:false,jobs:[{id:'retry',kind:'revise',shotId:'s',status:'partial',results:[{kind:'shot-revision',state:'applied',patches:[{before:'旧',after:'新'}],gaps:['尚缺素材']}]}],jobAction(){calls++;return new Promise(resolve=>{finish=resolve;});}};
 const render=()=>{cursor=0;const child=Quick({document:d,selectedShot:'s',resources:{},controller,onSelect(){}});return child.type(child.props);};
 const button=findElement(render(),n=>n.type==='button'&&n.props.children==='基于当前版本重试');const work=button.props.onClick();
 const html=renderToStaticMarkup(render());assert.ok(html.includes('修改中…'));assert.ok(!html.includes('尚缺素材'));
 const pending=findElement(render(),n=>n.type==='button'&&n.props.children==='基于当前版本重试');assert.equal(pending.props.disabled,true);pending.props.onClick();assert.equal(calls,1);
 finish();await work;
});

test('candidate download flushes local edits and immediately merges saved timeline result',async()=>{
 const h=await hookHarness(async(url,body,d)=>{h.events.push('request');return {path:'media.mp4',instanceId:'added',added:true,document:{...d,instances:[...d.instances,{id:'added'}]},jobs:[]};});
 const value=await h.controller.downloadCandidate({shotId:'s',candidateId:'candidate',rangeId:'range'});
 assert.equal(value.instanceId,'added');assert.deepEqual(h.events,['save','request','sync']);
 assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].body)),{shotId:'s',candidateId:'candidate',rangeId:'range',projectId:'A',revision:1,addToTimeline:true});
});
test('late candidate addition never syncs its response into a different project',async()=>{
 const gate=deferred();const h=await hookHarness(async(url,body)=>{await gate.promise;return {added:true,document:{...doc(),id:body.projectId}};});
 const work=h.controller.downloadCandidate({shotId:'s',candidateId:'candidate'});await new Promise(r=>setImmediate(r));h.setDoc({...doc(),id:'B'});gate.resolve();await work;
 assert.equal(h.events.includes('sync'),false);
});
test('retry after candidate adoption failure reruns adoption even when a local preview exists',async()=>{
 const states=[];let cursor=0,calls=0;const mock={...React,useEffect(){},useRef(value){return {current:value};},useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];}};
 const Preview=await component('PlanCandidatePreview.tsx','PlanCandidatePreview',mock);
 const props={candidate:{id:'c',title:'电脑操作',path:'/local.mp4'},projectId:'p',shotId:'s',onDownload:async()=>{calls++;if(calls===1)throw Error('暂时失败');return {path:'/local.mp4',kind:'video',url:'/local.mp4',added:true,instanceId:'actual'};}};
 const render=()=>{cursor=0;return Preview(props);};
 findElement(render(),n=>n.props?.['aria-label']==='下载并入轨 电脑操作').props.onClick();await new Promise(r=>setImmediate(r));
 assert.ok(renderToStaticMarkup(render()).includes('暂时失败'));
 findElement(render(),n=>n.type==='button'&&n.props.children==='重试').props.onClick();await new Promise(r=>setImmediate(r));
 assert.equal(calls,2);assert.ok(renderToStaticMarkup(render()).includes('已加入当前段'));
});
test('v2 proposal completion is separate from saved state and early Claude handoff',async()=>{
 const Panel=await component('ProductionPlanPanel.tsx','ProductionPlanPanel');
 const branch={id:'captions',status:'complete',validation:{status:'passed'},application:{status:'waiting_dependencies'},reuse:{status:'reused'}};
 const job={id:'j',kind:'package',status:'running',earlyHandoff:{status:'ready'},packageBranches:{version:2,branches:[branch],postStages:{sound:{id:'sound',status:'queued',application:{status:'waiting_dependencies'}}}}};
 const html=renderToStaticMarkup(React.createElement(Panel,{document:doc(),controller:{jobs:[job],history:[],pendingResults:[],busy:false},onSelect(){}}));
 assert.ok(html.includes('提案就绪'));assert.ok(html.includes('等待依赖'));assert.ok(html.includes('声音'));assert.ok(html.includes('Claude 动画提示词已就绪'));assert.ok(!html.includes('整期制作完成'));
});
test('new package button explicitly enables v2 streaming and same-run reuse',async()=>{
 const h=await deliveryPanelHarness();
 const button=findElement(h.render(),n=>n.type==='button'&&n.props.children==='更新计划与设计');
 assert.ok(button);assert.equal(button.props.disabled,false);button.props.onClick();await Promise.resolve();
 assert.equal(h.calls[0][0],'package');assert.equal(h.calls[0][1].packageOrchestrationVersion,2);assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0][1].packageExecution)),{streamingApply:true,reusePolicy:'same-run'});
});
test('ready early handoff exposes the usable project-bound Claude prompt link',async()=>{const Panel=await component('ProductionPlanPanel.tsx','ProductionPlanPanel');const html=renderToStaticMarkup(React.createElement(Panel,{document:doc(),controller:{jobs:[{id:'early',kind:'package',status:'running',earlyHandoff:{status:'ready',planPath:'/project/output/package/plan.md'}}],history:[],pendingResults:[],busy:false},onSelect(){}}));assert.ok(html.includes('打开 Claude 动画提示词'));assert.ok(html.includes('projectId=A'));assert.ok(html.includes(encodeURIComponent('/project/output/package/plan.md')));});
