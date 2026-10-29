import {probeEditorMedia,probeEditorAudio} from './editor-media.mjs';
import {cachedAudioDuration} from './audio-duration-cache.mjs';
import { createHash, randomUUID } from "node:crypto";
import {
  readdirSync,
  readFileSync,
  lstatSync,
  realpathSync,
  mkdirSync,
  renameSync,
  writeFileSync,
  copyFileSync,
  constants,
} from "node:fs";
import {
  resolve,
  join,
  relative,
  extname,
  basename,
  dirname,
  sep,
} from "node:path";
import { ROOT } from "./panel-scan.mjs";
const ALLOWED = [
  "assets/library",
  "assets/inbox",
  "templates/remotion-base/public",
  "docs/reference",
];
const PUBLIC = "templates/remotion-base/public/";
const kinds = {
  image: [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif"],
  video: [".mp4", ".mov", ".m4v", ".webm", ".mkv"],
  audio: [".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac", ".aiff"],
  font: [".woff", ".woff2", ".ttf", ".otf"],
};
const urlFor = (path) =>
  "/" + path.split("/").map(encodeURIComponent).join("/");
const idFor = (path) => createHash("sha256").update(path).digest("hex");
const inside = (base, path) => path === base || path.startsWith(base + sep);
// Never follow symlinks, including any ancestor of an allowlisted directory.
function safePath(root, path) {
  const base = realpathSync(root),
    target = resolve(base, path);
  if (!inside(base, target)) throw new Error("素材路径越界");
  let cursor = base;
  for (const part of relative(base, target).split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    if (lstatSync(cursor).isSymbolicLink())
      throw new Error("不允许符号链接素材路径");
  }
  return target;
}
function walk(root, path, state, visit, depth = 0) {
  if (depth > 12 || state.entries >= 20000) {
    state.complete = false;
    return;
  }
  let dir;
  try {
    dir = safePath(root, path);
  } catch (e) {
    if (e.code !== "ENOENT") state.complete = false;
    return;
  }
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  } catch {
    state.complete = false;
    return;
  }
  for (const entry of entries) {
    if (++state.entries > 20000) {
      state.complete = false;
      return;
    }
    if (
      entry.name.startsWith(".") ||
      ["node_modules", ".git", "studio-trash", "editor-project-media"].includes(entry.name)
    )
      continue;
    const child = path + "/" + entry.name;
    if (entry.isSymbolicLink()) {
      if (state.strict) state.complete = false;
      continue;
    }
    if (entry.isDirectory()) {
      if (!state.directoryAllowed || state.directoryAllowed(child, depth))
        walk(root, child, state, visit, depth + 1);
    } else if (entry.isFile()) visit(child, join(dir, entry.name));
  }
}
function normalizeReference(value, root) {
  let text = value;
  try {
    text = decodeURIComponent(text);
  } catch {
    /* Literal invalid percent names remain comparable. */
  }
  text = text.replaceAll("\\", "/");
  if (text.startsWith(root.replaceAll("\\", "/") + "/"))
    text = text.slice(root.length + 1);
  return text.replace(/^\.\//, "").replace(/^\//, "");
}
function references(root) {
  // Saved documents are one directory below the project root. Exports contain
  // copied builds and dependencies, and must never be traversed for this index.
  const state = {
      entries: 0,
      complete: true,
      strict: true,
      directoryAllowed: (_path, depth) => depth === 0,
    },
    documents = [];
  walk(root, "workspace/editor-projects", state, (path, abs) => {
    if (basename(path) !== "document.json") return;
    try {
      if (lstatSync(abs).size > 8 * 1024 * 1024) throw new Error("oversized");
      const document = JSON.parse(readFileSync(abs, "utf8")),
        values = new Set();
      const collect = (value) => {
        if (typeof value === "string")
          values.add(normalizeReference(value, root));
        else if (value && typeof value === "object")
          for (const child of Object.values(value)) collect(child);
      };
      collect(document.source);
      for (const instance of document.instances || []) collect(instance.props);
      documents.push(values);
    } catch {
      state.complete = false;
    }
  });
  return { documents, complete: state.complete };
}
export function listStudioLibrary({ root = ROOT, directories = ALLOWED, onlyKinds } = {}) {
  root = realpathSync(root);
  const refs = references(root),
    state = { entries: 0, complete: true },
    items = [];
  for (const dir of directories.filter(dir => ALLOWED.includes(dir)))
    walk(root, dir, state, (path, abs) => {
      const ext = extname(path).toLowerCase();
      let kind = Object.keys(kinds).find((key) => kinds[key].includes(ext));
      if (!kind || (onlyKinds && !onlyKinds.includes(kind))) return;
      if (path.startsWith("docs/reference/")) kind = "reference";
      const publicPath = path.startsWith(PUBLIC)
        ? path.slice(PUBLIC.length)
        : undefined;
      const aliases = new Set([path, ...(publicPath ? [publicPath] : [])]);
      const usageCount = refs.documents.filter((values) =>
        [...aliases].some((value) => values.has(value)),
      ).length;
      const imported = path.startsWith(PUBLIC + "editor-imports/");
      const deletable = imported && refs.complete && usageCount === 0;
      const item = {
        id: idFor(path),
        name: basename(path).replace(/^[a-f0-9-]{36}--/i, ""),
        kind,
        path,
        url: urlFor(path),
        bytes: lstatSync(abs).size,
        usageCount,
        deletable,
        ...(publicPath ? { publicPath } : {}),
        ...(!deletable
          ? {
              deleteReason: !refs.complete
                ? "无法完整检查保存项目引用"
                : usageCount
                  ? "素材已被保存项目引用"
                  : "内置及共享素材只读，仅支持移除未引用的编辑器导入素材",
            }
          : {}),
      };
      if (
        kind === "image" ||
        (kind === "reference" && kinds.image.includes(ext))
      )
        item.thumbnail = item.url;
      items.push(item);
    });
  const musicNames = new Set(items.filter(i=>i.path.startsWith('assets/library/bgm/')).map(i=>i.name));
  const effectNames = new Set(items.filter(i=>i.path.includes('/sfx/')).map(i=>i.name));
  for (const item of items.filter(i=>i.kind==='audio')) {
    const absolute=safePath(root,item.path);
    const duration=cachedAudioDuration(root,absolute,lstatSync(absolute));
    item.durationSeconds=duration.duration;
    item.audioPending=duration.pending;
    let saved;
    try { saved=JSON.parse(readFileSync(safePath(root,item.path+'.audio.json'),'utf8')).audioCategory; } catch {}
    item.audioCategory = item.durationSeconds>=20 ? 'music' : ['music','effect'].includes(saved) ? saved :
      musicNames.has(item.name) ? 'music' : effectNames.has(item.name) ? 'effect' : 'other';
    if(item.audioPending&&item.audioCategory!=='music')item.audioCategory='other';
  }
  const counts = Object.fromEntries(
    Object.keys(kinds)
      .concat("reference")
      .map((kind) => [kind, items.filter((x) => x.kind === kind).length]),
  );
  return {
    items,
    counts,
    complete: state.complete,
    audioIndexing: items.some(item=>item.audioPending),
    deletionPolicy: {
      mode: "quarantine",
      scope: "editor-imports-only",
      referencesComplete: refs.complete,
    },
  };
}
export function removeStudioAsset(id, { root = ROOT } = {}) {
  if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id))
    throw new Error("无效素材标识");
  root = realpathSync(root);
  const library = listStudioLibrary({ root }),
    item = library.items.find((x) => x.id === id);
  if (!item) throw new Error("素材不存在或路径不在允许目录");
  if (!item.deletable) throw new Error(item.deleteReason);
  const source = safePath(root, item.path);
  if (!ALLOWED.some((dir) => item.path.startsWith(dir + "/")))
    throw new Error("素材路径越界");
  // Check the existing workspace ancestor before creating the quarantine tree.
  try {
    safePath(root, "workspace");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  mkdirSync(join(root, "workspace"), { recursive: true });
  try {
    safePath(root, "workspace/studio-trash");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  mkdirSync(join(root, "workspace/studio-trash"), { recursive: true });
  const dir = join(root, "workspace/studio-trash", randomUUID());
  mkdirSync(dir);
  const trashPath = relative(root, join(dir, item.path)).split(sep).join("/");
  mkdirSync(dirname(join(root, trashPath)), { recursive: true });
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({ id, originalPath: item.path, trashPath }, null, 2) + "\n",
    { flag: "wx" },
  );
  renameSync(source, join(root, trashPath));
  return { deleted: true, id, path: item.path, trashPath, recoverable: true };
}

/** Stage library visuals under public for templates and independent PiP layers. */
export function stageStudioAsset(id, { root = ROOT } = {}) {
  if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id))
    throw new Error("无效素材标识");
  root = realpathSync(root);
  const item = listStudioLibrary({ root }).items.find(
    (asset) => asset.id === id,
  );
  if (!item) throw new Error("素材不存在或路径不在允许目录");
  if (
    item.kind!=='video' && item.kind!=='audio' && (!["image", "reference"].includes(item.kind) ||
    !kinds.image.includes(extname(item.path).toLowerCase()))
  )
    throw new Error("只支持暂存图片、视频或音频素材");
  const source = safePath(root, item.path);
  const meta=item.kind==='video'?probeEditorMedia(item.path,{root}):item.kind==='audio'?probeEditorAudio(item.path,{root}):{};
  if (item.publicPath?.includes("/"))
    return {
      ...meta,
      id: item.id,
      name: item.name,
      path: item.path,
      publicPath: item.publicPath,
      bytes: item.bytes,
    };
  const folder = PUBLIC + "editor-imports";
  // Public is an existing allowlisted root, never create through an unchecked ancestor.
  let cursor = root;
  for (const part of PUBLIC.split("/").filter(Boolean)) {
    cursor = join(cursor, part);
    try {
      safePath(root, relative(root, cursor));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      mkdirSync(cursor);
    }
  }
  try {
    safePath(root, folder);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  mkdirSync(join(root, folder), { recursive: true });
  const filename =
    randomUUID() +
    "--" +
    basename(item.path)
      .replace(/[\x00-\x1f]/g, "")
      .slice(-140);
  const publicPath = "editor-imports/" + filename,
    path = PUBLIC + publicPath;
  copyFileSync(source, join(root, path), constants.COPYFILE_EXCL);
  return {
    ...meta,
    id: idFor(path),
    name: item.name,
    path,
    publicPath,
    bytes: item.bytes,
  };
}
