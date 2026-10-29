import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  symlinkSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listProjectMedia,
  stageProjectMedia,
  useProjectMedia,
  promoteProjectMedia,
} from "../lib/project-media.mjs";
import { resolveExternalSharedFile } from "../lib/shared-media-catalog.mjs";
const fixture = () => {
  const base = mkdtempSync(join(tmpdir(), "shared-catalog-"));
  const root = join(base, "visual"),
    contentRoot = join(base, "content");
  mkdirSync(join(root, "assets/library"), { recursive: true });
  mkdirSync(join(contentRoot, "素材库"), { recursive: true });
  writeFileSync(
    join(contentRoot, "素材库/screen.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"></svg>',
  );
  return { root, contentRoot };
};
test("unified catalog lists content public library but never private project artifacts", () => {
  const opts = fixture();
  mkdirSync(join(opts.contentRoot, "workspace/private"), { recursive: true });
  writeFileSync(
    join(opts.contentRoot, "workspace/private/secret.png"),
    "private",
  );
  writeFileSync(join(opts.root, "assets/library/local.png"), "local");
  const shared = listProjectMedia({ ...opts, scope: "shared" }).items;
  assert.equal(shared.length, 2);
  const external = shared.find((x) => x.externalCatalog);
  assert.equal(external.name, "screen.svg");
  assert.match(external.url, /catalog-file\?id=/);
  assert.equal(
    resolveExternalSharedFile(external.id, opts),
    realpathSync(join(opts.contentRoot, "素材库/screen.svg")),
  );
  assert.throws(() => resolveExternalSharedFile("../secret", opts));
});
test("content library stage makes private project snapshot, promotion stays deduplicated, usage persists", () => {
  const opts = fixture();
  const shared = listProjectMedia({ ...opts, scope: "shared" }).items[0];
  const staged = stageProjectMedia(shared.id, {
    ...opts,
    projectId: "one",
    scope: "shared",
  });
  assert.equal(staged.width, 800);
  assert.equal(staged.height, 600);
  assert.ok(existsSync(join(opts.root, staged.path)));
  assert.equal(
    readFileSync(join(opts.root, staged.path), "utf8"),
    readFileSync(join(opts.contentRoot, "素材库/screen.svg"), "utf8"),
  );
  assert.equal(listProjectMedia({ ...opts, projectId: "two" }).items.length, 0);
  assert.equal(
    promoteProjectMedia(staged.id, { ...opts, projectId: "one" }).sharedId,
    shared.id,
  );
  useProjectMedia(staged.id, { ...opts, projectId: "one" });
  assert.equal(
    listProjectMedia({ ...opts, scope: "shared" }).items[0].useCount,
    1,
  );
  assert.equal(listProjectMedia({ ...opts, projectId: "one" }).items.length, 1);
});
test("external library refuses symlink escapes and catalog ids cannot resolve arbitrary files", () => {
  const opts = fixture();
  writeFileSync(join(opts.contentRoot, "outside.svg"), "<svg/>");
  symlinkSync(
    join(opts.contentRoot, "outside.svg"),
    join(opts.contentRoot, "素材库/escape.svg"),
  );
  assert.equal(listProjectMedia({ ...opts, scope: "shared" }).items.length, 1);
  assert.throws(() => resolveExternalSharedFile("0".repeat(64), opts));
});

test("updated shared original stages new bytes without rewriting earlier project snapshot", () => {
  const opts = fixture();
  const shared = listProjectMedia({ ...opts, scope: "shared" }).items[0];
  const first = stageProjectMedia(shared.id, {
    ...opts,
    projectId: "one",
    scope: "shared",
  });
  writeFileSync(
    join(opts.contentRoot, "素材库/screen.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="700"></svg>',
  );
  const second = stageProjectMedia(shared.id, {
    ...opts,
    projectId: "one",
    scope: "shared",
  });
  assert.notEqual(first.path, second.path);
  assert.equal(second.width, 900);
  assert.match(
    readFileSync(join(opts.root, first.path), "utf8"),
    /width="800"/,
  );
});
