import {
  open as openFile,
  rename as renameFile,
  rm as removeFile,
} from "node:fs/promises";
import { presetCatalogById } from "./preset-catalog.mjs";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  createReadStream,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  statSync,
  realpathSync,
  copyFileSync,
  cpSync,
  readdirSync,
  openSync,
  readSync,
  closeSync,
} from "node:fs";
import {
  join,
  resolve,
  relative,
  isAbsolute,
  dirname,
  extname,
  basename,
} from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
export const artifactRootDefault = () =>
  process.env.PRODUCTION_PLAN_ARTIFACT_ROOT ||
  fileURLToPath(new URL("../../../output/", import.meta.url));
export function safeProjectId(id) {
  if (
    typeof id !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) ||
    id === "." ||
    id === ".."
  )
    throw new Error("Invalid project ID");
  return id;
}
export function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
    renameSync(temp, path);
  } finally {
    if (existsSync(temp)) rmSync(temp);
  }
}
export function atomicText(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, value, { flag: "wx" });
    renameSync(temp, path);
  } finally {
    if (existsSync(temp)) rmSync(temp);
  }
}
export function withProjectLock(root, id, fn) {
  safeProjectId(id);
  mkdirSync(root, { recursive: true });
  const lock = join(root, `.${id}.lock`);
  let acquired = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      mkdirSync(lock);
      writeFileSync(
        join(lock, "owner.json"),
        JSON.stringify({ pid: process.pid, at: Date.now() }),
      );
      acquired = true;
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      let dead = false;
      try {
        const owner = JSON.parse(readFileSync(join(lock, "owner.json")));
        try {
          process.kill(owner.pid, 0);
        } catch (err) {
          dead = err.code === "ESRCH";
        }
      } catch {
        dead = Date.now() - statSync(lock).mtimeMs > 30000;
      }
      if (dead) {
        rmSync(lock, { recursive: true, force: true });
        continue;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  if (!acquired)
    throw new Error("Revision conflict: project is locked by another writer");
  try {
    return fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}
function inside(root, path) {
  const r = relative(resolve(root), resolve(path));
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
}
export function validateProjectRoot(
  path,
  { artifactRoot = artifactRootDefault() } = {},
) {
  if (
    typeof path !== "string" ||
    !isAbsolute(path) ||
    path.includes("\0") ||
    !inside(artifactRoot, path) ||
    resolve(path) === resolve(artifactRoot)
  )
    throw new Error("Project root must be inside the artifact directory");
  // Resolve the existing ancestor to stop symlink escapes before creating children.
  let ancestor = resolve(path);
  while (!existsSync(ancestor) && dirname(ancestor) !== ancestor)
    ancestor = dirname(ancestor);
  let rootAncestor = resolve(artifactRoot);
  while (!existsSync(rootAncestor) && dirname(rootAncestor) !== rootAncestor)
    rootAncestor = dirname(rootAncestor);
  const realExpected = resolve(
    realpathSync(rootAncestor),
    relative(rootAncestor, resolve(artifactRoot)),
  );
  const realTarget = resolve(
    realpathSync(ancestor),
    relative(ancestor, resolve(path)),
  );
  if (!inside(realExpected, realTarget))
    throw new Error("Project root escapes artifact directory through symlink");
  return resolve(path);
}
export function canonicalPath(binding) {
  safeProjectId(binding.projectId);
  return join(
    binding.projectRoot,
    ".制作资料",
    "剪辑工程",
    binding.projectId,
    "工程.json",
  );
}
export function indexedPath(rootDir, id, options = {}) {
  safeProjectId(id);
  const pointer = join(rootDir, id, "project-index.json");
  if (!existsSync(pointer)) return join(rootDir, id, "document.json");
  const index = JSON.parse(readFileSync(pointer));
  if (index.projectId !== id)
    throw new Error("Project index identity mismatch");
  validateProjectRoot(index.projectRoot, options);
  const expected = canonicalPath({
    projectRoot: index.projectRoot,
    projectId: id,
  });
  if (index.canonicalPath !== expected)
    throw new Error("Invalid project index");
  return expected;
}
export function referencedPaths(document) {
  const found = new Set();
  const visit = (v, key = "") => {
    if (
      typeof v === "string" &&
      (/(?:path|file|src|image|video|audio|poster|preview|background)$/i.test(
        key,
      ) ||
        /^(?:media|image|video|audio)[A-Z0-9_]/.test(key)) &&
      !/^https?:|^data:|^#/.test(v) &&
      v &&
      !v.includes("\0")
    )
      found.add(v);
    else if (Array.isArray(v)) v.forEach((x) => visit(x, key));
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) visit(x, k);
  };
  // Paths in effective render state plus keyframes/contracts, never arbitrary input instructions.
  visit(document.source);
  const catalog = presetCatalogById();
  const addReference = (value) => visit(value, "path");
  for (const instance of document.instances ?? []) {
    // Slot names are semantic (e.g. clip), not necessarily path-like. Resolve
    // native slots exactly as editor-props / stageCompositionMedia do.
    const slots = { ...instance.props?.slots };
    for (const [key, descriptor] of Object.entries(
      catalog.get(instance.assetId)?.slots ?? {},
    )) {
      if (!["image", "video"].includes(descriptor.type)) continue;
      const value = slots[key];
      if (typeof value === "string" && value) {
        const clean = value.replaceAll("\\", "/");
        addReference(
          clean.includes("/") || isAbsolute(clean)
            ? clean
            : `${descriptor.assetDir ? descriptor.assetDir + "/" : ""}${clean}`,
        );
      }
      delete slots[key];
    }
    visit({
      ...instance,
      props: { ...instance.props, slots },
      assetReferences: undefined,
    });
    for (const value of Object.values(instance.assetReferences ?? {}))
      addReference(value);
  }
  visit(document.audioClips);
  visit(document.cover);
  visit(document.styleReference);
  visit(document.productionPlan?.sourceSrtPath, "path");
  visit(document.productionPlan?.audioPath, "path");
  for (const s of document.productionPlan?.shots ?? []) {
    visit(s.keyframes);
    for(const candidate of s.aiVideoCandidates??[])visit(candidate.references);
    visit(s.bindings);
  }
  return [...found];
}
function fileHash(path) {
  const hash = createHash("sha256"),
    fd = openSync(path, "r"),
    buffer = Buffer.alloc(1024 * 1024);
  try {
    let n;
    while ((n = readSync(fd, buffer, 0, buffer.length, null)))
      hash.update(buffer.subarray(0, n));
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}
function mediaDirectory(dir) {
  return join(dirname(dirname(dir)), "项目素材");
}
export function archivedReference(reference, dir, { expectedHash } = {}) {
  if (expectedHash && !/^[a-f0-9]{64}$/.test(expectedHash))
    throw new Error("Invalid archived input hash");
  const manifest = join(dir, "media-snapshot.json");
  const records = existsSync(manifest)
    ? JSON.parse(readFileSync(manifest))
    : [];
  const item = records.find(
    (x) =>
      (!expectedHash || x.hash === expectedHash) &&
      (x.reference === reference ||
        x.mirror === reference ||
        x.path === reference ||
        (basename(dirname(reference)) === "项目素材" &&
          basename(x.path) === basename(reference))),
  );
  if (!item && !expectedHash) return undefined;
  // A verified immutable job snapshot is a version index in its own right.
  // The current source-reference manifest can point at V2 while this job owns V1.
  const path = join(
    mediaDirectory(dir),
    expectedHash ? `${expectedHash}${extname(reference)}` : basename(item.path),
  );
  if (!existsSync(path) || !statSync(path).isFile()) return undefined;
  const stat = statSync(path);
  return {
    ...(item ?? {
      reference,
      hash: expectedHash,
      mirror: reference,
      mirrorRelative: null,
      origin: "archive",
      bytes: stat.size,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
    }),
    path,
  };
}
export async function archiveInput(
  reference,
  source,
  dir,
  { assetSourceRoot = process.cwd(), expectedHash } = {},
) {
  const directory = mediaDirectory(dir);
  mkdirSync(directory, { recursive: true });
  const temporary = join(directory, `input-${randomUUID()}.tmp`);
  const before = statSync(source),
    digest = createHash("sha256");
  const handle = await openFile(temporary, "wx");
  let hashed;
  try {
    for await (const chunk of createReadStream(source)) {
      digest.update(chunk);
      await handle.writeFile(chunk);
    }
    const after = statSync(source);
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      throw new Error(`Input file changed while hashing: ${source}`);
    hashed = digest.digest("hex");
    if (expectedHash && hashed !== expectedHash)
      throw new Error("Archived input hash mismatch");
    if ((await handle.stat()).size !== before.size)
      throw new Error("Input archive size mismatch");
    await handle.close();
    const path = join(directory, `${hashed}${extname(reference)}`);
    // Content-addressed replacement is the exact verified stream, never an external destination.
    await renameFile(temporary, path);
    const mirror = resolve(assetSourceRoot, reference);
    return {
      reference,
      hash: hashed,
      path,
      mirror,
      mirrorRelative: inside(assetSourceRoot, mirror)
        ? relative(assetSourceRoot, mirror)
        : null,
      origin: inside(assetSourceRoot, mirror) ? "repository" : "external",
      bytes: before.size,
      mtimeMs: before.mtimeMs,
      ctimeMs: before.ctimeMs,
    };
  } finally {
    await handle.close().catch(() => {});
    await removeFile(temporary, { force: true });
  }
}
export function registerInputArchives(records, dir) {
  const path = join(dir, "media-snapshot.json");
  const manifest = existsSync(path) ? JSON.parse(readFileSync(path)) : [];
  for (const item of records) {
    const index = manifest.findIndex((x) => x.reference === item.reference);
    if (index < 0) manifest.push(item);
    else manifest[index] = item;
  }
  atomicJson(path, manifest);
}
export function snapshotReferences(
  document,
  dir,
  {
    assetSourceRoot = process.cwd(),
    rootDir = join(assetSourceRoot, "workspace/editor-projects"),
    verify = false,
  } = {},
) {
  const prior = join(dir, "media-snapshot.json"),
    manifest = existsSync(prior) ? JSON.parse(readFileSync(prior)) : [];
  const refs = new Set(referencedPaths(document)),
    registry = join(rootDir, document.id, "media.json");
  if (existsSync(registry)) {
    const registered = JSON.parse(readFileSync(registry));
    atomicJson(join(dir, "project-media-registry.json"), registered);
    for (const item of registered.items ?? [])
      for (const key of ["path", "stagedPath", "previewPublicPath"])
        if (typeof item[key] === "string" && !/^https?:/.test(item[key]))
          refs.add(item[key]);
  }
  for (const ref of refs) {
    if (ref.split(/[\\/]/).includes("..")) continue;
    const source = [
      ...(isAbsolute(ref) ? [ref] : []),
      join(assetSourceRoot, "templates/remotion-base/public", ref),
      join(assetSourceRoot, "public", ref),
      join(assetSourceRoot, ref),
    ].find((p) => existsSync(p) && statSync(p).isFile());
    if (!source) continue;
    const stat = statSync(source),
      index = manifest.findIndex((x) => x.reference === ref),
      old = manifest[index];
    const targetDir = mediaDirectory(dir);
    if (
      !verify &&
      old?.mirror === source &&
      old.bytes === stat.size &&
      old.mtimeMs === stat.mtimeMs &&
      old.ctimeMs === stat.ctimeMs &&
      existsSync(join(targetDir, basename(old.path)))
    ) {
      old.path = join(targetDir, basename(old.path));
      old.mirrorRelative = inside(assetSourceRoot, source)
        ? relative(assetSourceRoot, source)
        : null;
      old.origin = old.mirrorRelative === null ? "external" : "repository";
      continue;
    }
    const hash = fileHash(source),
      target = join(targetDir, `${hash}${extname(ref)}`);
    mkdirSync(targetDir, { recursive: true });
    if (!existsSync(target)) {
      const temp = `${target}.${randomUUID()}.tmp`;
      try {
        copyFileSync(source, temp);
        if (statSync(temp).size !== stat.size || fileHash(temp) !== hash)
          throw new Error("Media snapshot copy integrity failure");
        renameSync(temp, target);
      } finally {
        if (existsSync(temp)) rmSync(temp);
      }
    } else if (verify && fileHash(target) !== hash)
      throw new Error("Media snapshot integrity failure");
    const item = {
      reference: ref,
      hash,
      path: target,
      mirror: source,
      mirrorRelative: inside(assetSourceRoot, source)
        ? relative(assetSourceRoot, source)
        : null,
      origin: inside(assetSourceRoot, source) ? "repository" : "external",
      bytes: stat.size,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
    };
    if (index >= 0) manifest[index] = item;
    else manifest.push(item);
  }
  atomicJson(prior, manifest);
  atomicJson(join(dir, "media-recovery.json"), {
    missingReferences: [...refs].filter(
      (ref) =>
        !manifest.some(
          (item) =>
            item.reference === ref &&
            existsSync(join(mediaDirectory(dir), basename(item.path))),
        ),
    ),
    snapshotCount: manifest.length,
  });
  return manifest;
}
export function restoreReferences(
  dir,
  {
    assetSourceRoot = process.cwd(),
    rootDir = join(assetSourceRoot, "workspace/editor-projects"),
    verify = false,
  } = {},
) {
  const path = join(dir, "media-snapshot.json");
  if (!existsSync(path)) return;
  for (const item of JSON.parse(readFileSync(path))) {
    const snapshot = join(mediaDirectory(dir), basename(item.path));
    if (!existsSync(snapshot)) continue;
    // Repository moves never change the media's role. Resolve from the recorded repository-relative mirror.
    let mirrorRelative = item.mirrorRelative;
    if (mirrorRelative === undefined) {
      const renderMarker = "/templates/remotion-base/public/";
      if (item.mirror?.includes(renderMarker))
        mirrorRelative =
          "templates/remotion-base/public/" +
          item.mirror.split(renderMarker).at(-1);
      else if (!isAbsolute(item.reference))
        mirrorRelative = item.mirror?.endsWith("/public/" + item.reference)
          ? "public/" + item.reference
          : item.reference;
    }
    if (typeof mirrorRelative !== "string") continue;
    const target = resolve(assetSourceRoot, mirrorRelative);
    if (!inside(assetSourceRoot, target)) continue;
    if (existsSync(target) && !verify) continue;
    if (fileHash(snapshot) !== item.hash)
      throw new Error(`Media snapshot integrity failed: ${item.reference}`);
    if (!existsSync(target)) {
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(snapshot, target);
    }
  }
  const registry = join(dir, "project-media-registry.json"),
    target = join(rootDir, basename(dir), "media.json");
  if (existsSync(registry) && !existsSync(target))
    atomicJson(target, JSON.parse(readFileSync(registry)));
}

export function migrateDirectory(from, to) {
  if (from === to || !existsSync(from)) return;
  mkdirSync(to, { recursive: true });
  const oldMedia = mediaDirectory(from),
    newMedia = mediaDirectory(to);
  if (existsSync(oldMedia) && oldMedia !== newMedia) {
    mkdirSync(newMedia, { recursive: true });
    for (const file of readdirSync(oldMedia))
      if (!existsSync(join(newMedia, file)))
        copyFileSync(join(oldMedia, file), join(newMedia, file));
  }
  const oldPackages = join(dirname(dirname(from)), "package历史"),
    newPackages = join(dirname(dirname(to)), "package历史");
  if (
    existsSync(oldPackages) &&
    oldPackages !== newPackages &&
    !existsSync(newPackages)
  )
    cpSync(oldPackages, newPackages, { recursive: true });
  for (const entry of readdirSync(from)) {
    if (entry === "工程.json" || entry === "当前计划.md") continue;
    const source = join(from, entry),
      target = join(to, entry);
    if (existsSync(target))
      throw new Error(`Relocation target already contains ${entry}`);
    cpSync(source, target, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
  }
}
