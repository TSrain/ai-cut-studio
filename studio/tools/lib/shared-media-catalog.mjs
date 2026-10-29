import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  realpathSync,
  readdirSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { resolve, join, relative, sep, basename, extname } from "node:path";
import { homedir } from "node:os";
import { ROOT } from "./panel-scan.mjs";

const kindFor = (path) =>
  /\.(mp4|mov|m4v|webm|mkv)$/i.test(path)
    ? "video"
    : /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(path)
      ? "image"
      : null;
function libraryRoot({ root = ROOT, contentRoot } = {}) {
  // Fixture/custom stores do not accidentally expose the user's real library.
  const configured =
    contentRoot ||
    process.env.CONTENT_WORKFLOW_ROOT ||
    (resolve(root) === resolve(ROOT)
      ? resolve(ROOT, "../workflow")
      : null);
  if (!configured) return null;
  const base = join(resolve(configured), "素材库");
  if (
    !existsSync(base) ||
    lstatSync(base).isSymbolicLink() ||
    !lstatSync(base).isDirectory()
  )
    return null;
  return realpathSync(base);
}
function usagePath(root) {
  return join(root, "workspace/shared-media-catalog/usage.json");
}
function usage(root) {
  const path = usagePath(root);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8"));
}
export function listExternalSharedMedia(options = {}) {
  const root = options.root || ROOT,
    base = libraryRoot(options);
  if (!base) return [];
  const counts = usage(root),
    items = [];
  let visited = 0;
  function walk(dir, depth = 0) {
    if (depth > 12 || visited > 20000) return;
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (++visited > 20000) break;
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path, depth + 1);
        continue;
      }
      const kind = kindFor(path);
      if (!entry.isFile() || !kind) continue;
      const rel = relative(base, path),
        id = createHash("sha256")
          .update("content-library\0" + base + "\0" + rel)
          .digest("hex"),
        stat = lstatSync(path);
      let meta = {};
      try {
        if (
          existsSync(path + ".media.json") &&
          !lstatSync(path + ".media.json").isSymbolicLink()
        )
          meta = JSON.parse(readFileSync(path + ".media.json", "utf8"));
      } catch {
        /* Bad optional labels never hide a recoverable original. */
      }
      items.push({
        id,
        path: rel,
        name: typeof meta.name === "string" ? meta.name : basename(path),
        kind,
        bytes: stat.size,
        scope: "shared",
        deletable: false,
        externalCatalog: true,
        catalogRoot: base,
        absolutePath: path,
        url: `/api/editor/production-plan/catalog-file?id=${id}`,
        addedAt:
          typeof meta.addedAt === "string"
            ? meta.addedAt
            : new Date(stat.mtimeMs).toISOString(),
        useCount:
          Number.isSafeInteger(counts[id]) && counts[id] >= 0 ? counts[id] : 0,
        description:
          typeof meta.description === "string" ? meta.description : undefined,
      });
    }
  }
  walk(base);
  return items;
}
export function resolveExternalSharedFile(id, options = {}) {
  if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id))
    throw new Error("无效公共素材标识");
  const item = listExternalSharedMedia(options).find((x) => x.id === id);
  if (!item) throw new Error("公共素材不存在");
  const actual = realpathSync(item.absolutePath);
  if (
    actual !== item.absolutePath ||
    !actual.startsWith(item.catalogRoot + sep) ||
    lstatSync(actual).isSymbolicLink()
  )
    throw new Error("公共素材路径已变化");
  return actual;
}
export function incrementExternalSharedUse(id, options = {}) {
  resolveExternalSharedFile(id, options);
  const root = options.root || ROOT,
    state = usage(root);
  state[id] =
    (Number.isSafeInteger(state[id]) && state[id] >= 0 ? state[id] : 0) + 1;
  const path = usagePath(root);
  mkdirSync(resolve(path, ".."), { recursive: true });
  const temp = path + "." + randomUUID() + ".tmp";
  writeFileSync(temp, JSON.stringify(state) + "\n", { flag: "wx" });
  renameSync(temp, path);
  return state[id];
}
