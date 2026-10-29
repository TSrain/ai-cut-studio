import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDocument,
  saveDocument,
  loadDocument,
} from "../lib/editor-store.mjs";
const setup = () => {
  const root = mkdtempSync(join(tmpdir(), "plan-store-"));
  return {
    rootDir: join(root, "index"),
    artifactRoot: join(root, "artifacts"),
    assetSourceRoot: root,
  };
};
const doc = () =>
  createDocument({
    id: "p",
    name: "P",
    canvas: {
      width: 1920,
      height: 1080,
      fps: { num: 30, den: 1 },
      durationFrames: 300,
    },
    source: null,
    productionPlan: { shots: [] },
  });
test("plan document saves canonical, index is only pointer and history immutable", () => {
  const opts = setup();
  const one = saveDocument(doc(), opts);
  assert.ok(one.projectBinding);
  const file = join(
    one.projectBinding.projectRoot,
    ".制作资料",
    "剪辑工程",
    "p",
    "工程.json",
  );
  assert.ok(existsSync(file));
  assert.equal(
    JSON.parse(readFileSync(join(opts.rootDir, "p", "project-index.json")))
      .canonicalPath,
    file,
  );
  assert.equal(existsSync(join(opts.rootDir, "p", "document.json")), false);
  const two = saveDocument({ ...one, name: "new" }, opts);
  assert.equal(two.revision, 2);
  assert.equal(loadDocument("p", opts).name, "new");
  assert.equal(
    JSON.parse(
      readFileSync(
        join(
          one.projectBinding.projectRoot,
          ".制作资料",
          "剪辑工程",
          "p",
          "历史",
          "1.json",
        ),
      ),
    ).name,
    "P",
  );
  assert.throws(
    () => saveDocument({ ...one, name: "stale" }, opts),
    /Revision conflict/,
  );
});
test("media snapshot restores repository mirror after cache deletion", () => {
  const opts = setup();
  mkdirSync(join(opts.assetSourceRoot, "public", "media"), { recursive: true });
  writeFileSync(
    join(opts.assetSourceRoot, "public", "media", "a.mp4"),
    "actual bytes",
  );
  const d = doc();
  d.source = { path: "media/a.mp4", startFrame: 0 };
  const saved = saveDocument(d, opts);
  rmSync(join(opts.assetSourceRoot, "public", "media", "a.mp4"));
  loadDocument(saved.id, opts);
  assert.equal(
    readFileSync(
      join(opts.assetSourceRoot, "public", "media", "a.mp4"),
      "utf8",
    ),
    "actual bytes",
  );
});
test("relocation failure leaves canonical pointer and original intact", () => {
  const opts = setup();
  const d = saveDocument(doc(), opts);
  const before = readFileSync(
    join(opts.rootDir, "p", "project-index.json"),
    "utf8",
  );
  writeFileSync(join(opts.artifactRoot, "blocked"), "file");
  assert.throws(() =>
    saveDocument(
      {
        ...d,
        projectBinding: {
          ...d.projectBinding,
          projectRoot: join(opts.artifactRoot, "blocked", "nested"),
        },
      },
      opts,
    ),
  );
  assert.equal(
    readFileSync(join(opts.rootDir, "p", "project-index.json"), "utf8"),
    before,
  );
  assert.equal(loadDocument("p", opts).revision, 1);
});
test("canonical root escape rejected and clone isolates project identity", () => {
  const opts = setup();
  assert.throws(() =>
    saveDocument(
      {
        ...doc(),
        projectBinding: {
          version: 1,
          projectId: "p",
          projectRoot: "/etc/unsafe",
        },
      },
      opts,
    ),
  );
  const a = saveDocument(doc(), opts);
  const b = createDocument({ ...a, id: "copy", revision: 0 });
  assert.equal(b.projectBinding.projectId, "copy");
  const copy = saveDocument(b, opts);
  assert.notEqual(copy.projectBinding.projectId, a.id);
  assert.notEqual(
    copy.projectBinding.projectRoot,
    a.projectBinding.projectRoot,
  );
});

test("two independent writers cannot both commit the same revision", async () => {
  const { spawn } = await import("node:child_process");
  const opts = setup(),
    saved = saveDocument(doc(), opts),
    moduleUrl = new URL("../lib/editor-store.mjs", import.meta.url).href;
  const run = (name) =>
    new Promise((resolve) => {
      const code = `import {loadDocument,saveDocument} from ${JSON.stringify(moduleUrl)};const o=${JSON.stringify(opts)};const d=${JSON.stringify(saved)};try{saveDocument({...d,name:${JSON.stringify(name)}},o);process.stdout.write('saved')}catch(e){process.stdout.write(e.message)}`;
      const child = spawn(
        process.execPath,
        ["--input-type=module", "-e", code],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let out = "";
      child.stdout.on("data", (b) => (out += b));
      child.on("exit", () => resolve(out));
    });
  const results = await Promise.all([run("A"), run("B")]);
  assert.equal(results.filter((r) => r === "saved").length, 1);
  assert.equal(
    results.filter((r) => r.includes("Revision conflict")).length,
    1,
  );
  assert.equal(loadDocument("p", opts).revision, 2);
});

test("unadopted project uploads are recoverable and unchanged files reuse digest", () => {
  const opts = setup(),
    upload = join(opts.assetSourceRoot, "upload.mp4");
  writeFileSync(upload, "private unadopted bytes");
  mkdirSync(join(opts.rootDir, "p"), { recursive: true });
  writeFileSync(
    join(opts.rootDir, "p", "media.json"),
    JSON.stringify({ items: [{ id: "u", path: "upload.mp4" }] }),
  );
  const saved = saveDocument(doc(), opts);
  const dir = join(
    saved.projectBinding.projectRoot,
    ".制作资料",
    "剪辑工程",
    "p",
  );
  const manifest = JSON.parse(readFileSync(join(dir, "media-snapshot.json")));
  assert.equal(manifest.find((x) => x.reference === "upload.mp4").bytes, 23);
  assert.ok(manifest[0].path.includes("/.制作资料/项目素材/"));
  rmSync(upload);
  loadDocument("p", opts);
  assert.equal(readFileSync(upload, "utf8"), "private unadopted bytes");
});

test("moving the repository restores public previews and unadopted uploads at stable relative paths", async () => {
  const { cpSync } = await import("node:fs");
  const opts = setup();
  const publicFile = join(
    opts.assetSourceRoot,
    "templates/remotion-base/public/previews/a.png",
  );
  mkdirSync(join(publicFile, ".."), { recursive: true });
  writeFileSync(publicFile, "preview");
  const d = doc();
  d.productionPlan.shots = [
    { id: "s", keyframes: [{ path: "previews/a.png" }] },
  ];
  saveDocument(d, opts);
  const destination = mkdtempSync(join(tmpdir(), "relocated-repo-")),
    newIndex = join(destination, "index");
  cpSync(opts.rootDir, newIndex, { recursive: true });
  rmSync(join(opts.assetSourceRoot, "templates"), { recursive: true });
  loadDocument("p", {
    ...opts,
    rootDir: newIndex,
    assetSourceRoot: destination,
  });
  assert.equal(
    readFileSync(
      join(destination, "templates/remotion-base/public/previews/a.png"),
      "utf8",
    ),
    "preview",
  );
});

test("physically moved canonical project can be relinked without creating a new identity", async () => {
  const { renameSync } = await import("node:fs");
  const opts = setup(),
    saved = saveDocument(doc(), opts),
    nextRoot = join(opts.artifactRoot, "moved");
  renameSync(saved.projectBinding.projectRoot, nextRoot);
  const linked = saveDocument(
    {
      ...saved,
      projectBinding: { ...saved.projectBinding, projectRoot: nextRoot },
    },
    opts,
  );
  assert.equal(linked.id, saved.id);
  assert.equal(linked.revision, 2);
  assert.equal(loadDocument("p", opts).projectBinding.projectRoot, nextRoot);
});

test("native template slots and arbitrary assetReference keys restore without registry", async () => {
  const { referencedPaths, snapshotReferences, restoreReferences } =
    await import("../lib/production-plan-storage.mjs");
  const opts = setup(),
    root = opts.assetSourceRoot;
  const refs = ["footage/demo.mp4", "screens/still.png", "private/extra.bin"];
  for (const ref of refs) {
    mkdirSync(join(root, "public", ref, ".."), { recursive: true });
    writeFileSync(join(root, "public", ref), ref);
  }
  const d = {
    id: "p",
    instances: [
      {
        assetId: "media-stage",
        props: { slots: { clip: "demo.mp4", image: "still.png" } },
        assetReferences: {
          clip: "footage/demo.mp4",
          custom: "private/extra.bin",
        },
      },
    ],
  };
  const dir = join(opts.artifactRoot, "p", ".制作资料", "剪辑工程", "p");
  assert.deepEqual(new Set(referencedPaths(d)), new Set(refs));
  assert.equal(snapshotReferences(d, dir, opts).length, 3);
  rmSync(join(root, "public"), { recursive: true });
  restoreReferences(dir, opts);
  for (const ref of refs)
    assert.equal(readFileSync(join(root, "public", ref), "utf8"), ref);
  assert.deepEqual(
    JSON.parse(readFileSync(join(dir, "media-recovery.json")))
      .missingReferences,
    [],
  );
});
