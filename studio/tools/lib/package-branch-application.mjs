/** Durable v2 operation queue. Only trusted, named native adapters may mutate documents. */
import { createHash, randomUUID } from "node:crypto";
import { resolvePackageOrchestrationVersion } from "./package-orchestration-version.mjs";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  realpathSync,
  existsSync,
  rmSync,
} from "node:fs";
import { resolve, relative, isAbsolute, join } from "node:path";
const canonical = (v) =>
  JSON.stringify(v, (_, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, x[k]]),
        )
      : x,
  );
export const branchValueHash = (value) =>
  createHash("sha256")
    .update(
      canonical(value === undefined ? { __package_missing__: true } : value),
    )
    .digest("hex");
const digest = (p) =>
  createHash("sha256").update(readFileSync(p)).digest("hex");
const kinds = new Set([
  "semanticPlan",
  "template",
  "footage",
  "camera",
  "captions",
  "cover",
  "aiVideo",
  "sound",
  "bgm",
]);
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
const chains = new Map();
const now = () => Date.now() / 1000;
export function branchOperationId(op) {
  return branchValueHash(
    Object.fromEntries(
      [
        "schemaVersion",
        "packageOrchestrationVersion",
        "projectId",
        "runId",
        "branchId",
        "attemptId",
        "kind",
        "dependencyFingerprint",
        "payloadSha256",
        "readSet",
        "writeSet",
        "dependsOn",
      ].map((k) => [k, op[k]]),
    ),
  );
}
function bound(root, path) {
  if (typeof path !== "string" || !isAbsolute(path))
    throw Error("Operation proof must be an absolute file");
  const p = realpathSync(path),
    rel = relative(root, p);
  if (rel === ".." || rel.startsWith("../") || isAbsolute(rel))
    throw Error("Operation proof escapes output root");
  return p;
}
function rootFor(context) {
  return realpathSync(context.outputRoot);
}
function field(document, path) {
  let v = document;
  for (const key of path) {
    if (v === null || typeof v !== "object" || !Object.hasOwn(v, key))
      return undefined;
    v = v[key];
  }
  return v;
}
function assertWrites(before, after, sets, path = []) {
  if (branchValueHash(before) === branchValueHash(after)) return;
  if (sets.some((x) => x.path.every((k, i) => path[i] === k))) return;
  // A declared leaf may need a new object container. Check each child rather
  // than treating the absent parent as an undeclared scalar replacement.
  if (before === undefined && after && typeof after === "object" && !Array.isArray(after) &&
      sets.some(x => path.every((k,i) => x.path[i] === k))) {
    for (const k of Object.keys(after)) assertWrites(undefined, after[k], sets, [...path,k]);
    return;
  }
  if (
    before &&
    after &&
    typeof before === "object" &&
    typeof after === "object"
  ) {
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)]))
      assertWrites(before[k], after[k], sets, [...path, k]);
    return;
  }
  throw Error("Native adapter changed undeclared field " + path.join("."));
}
function recoveryHash(value) {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Array.isArray(value.changes)
  )
    value = {
      ...value,
      changes: value.changes.filter(
        (c) => c.type !== "package-branch-application",
      ),
    };
  return branchValueHash(value);
}
function changed(document, op) {
  return [...op.readSet, ...op.writeSet].filter(
    (x) => branchValueHash(field(document, x.path)) !== x.beforeHash,
  );
}
function reconciliationBase(op, context) {
  if (!context.reconcile) return null;
  const root = rootFor(context);
  const validationPath = bound(root, op.validationReceiptPath);
  if (digest(validationPath) !== op.validationReceiptSha256) throw Error('Reconciliation validation proof changed');
  const receipt = JSON.parse(readFileSync(validationPath, 'utf8'));
  if (!receipt.reconciliationBasePath) return null;
  const path = bound(root, receipt.reconciliationBasePath);
  if (digest(path) !== receipt.reconciliationBaseSha256)
    throw Error('Reconciliation baseline proof changed');
  const value = JSON.parse(readFileSync(path, 'utf8'));
  const base = value.document ?? value;
  if (base.id !== op.projectId || changed(base, op).length)
    throw Error('Reconciliation baseline does not match frozen operation fields');
  return base;
}
function acceptedCaptionDocuments(journal, context) {
  if (!context.acceptCaptionReadback) return [];
  const root = rootFor(context), documents = [];
  for (const row of journal.operations) {
    const op = row.operation;
    if (op.payloadSha256 !== branchValueHash(op.payload) || op.operationId !== branchOperationId(op)) throw Error('Applied operation identity changed');
    if (op.kind !== 'captions' || row.status !== 'applied' || !row.receiptPath) continue;
    const receiptPath = bound(root, row.receiptPath);
    if (digest(receiptPath) !== row.receiptSha256) throw Error('Caption application receipt changed');
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    if (receipt.projectId !== context.projectId || receipt.runId !== context.runId ||
        receipt.operationId !== op.operationId || receipt.payloadSha256 !== op.payloadSha256)
      throw Error('Caption application receipt identity mismatch');
    const readbackPath = bound(root, receipt.readbackPath);
    if (digest(readbackPath) !== receipt.readbackSha256) throw Error('Caption application readback changed');
    const readback = JSON.parse(readFileSync(readbackPath, 'utf8'));
    if (readback.projectId !== context.projectId || readback.runId !== context.runId || readback.operationId !== op.operationId)
      throw Error('Caption readback identity mismatch');
    const base = reconciliationBase(op, context);
    if (!base) continue;
    documents.push(context.acceptCaptionReadback(base, {...structuredClone(base), captions: structuredClone(op.payload.value)}, readback.document));
  }
  return documents;
}
export async function validateBranchOperation(op, context) {
  resolvePackageOrchestrationVersion(context.packageOrchestrationVersion);
  if(op)resolvePackageOrchestrationVersion(op.packageOrchestrationVersion);
  if (
    !op ||
    op.schemaVersion !== 1 ||
    op.packageOrchestrationVersion !== 2 ||
    !kinds.has(op.kind)
  )
    throw Error("Unsupported package operation");
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(op.projectId ?? "") ||
    op.projectId !== context.projectId ||
    op.runId !== context.runId ||
    !op.branchId ||
    !op.attemptId
  )
    throw Error("Package operation identity mismatch");
  if (
    !/^[a-f0-9]{64}$/.test(op.dependencyFingerprint ?? "") ||
    op.payloadSha256 !== branchValueHash(op.payload) ||
    op.operationId !== branchOperationId(op)
  )
    throw Error("Operation identity/payload hash mismatch");
  for (const set of [op.readSet, op.writeSet]) {
    if (!Array.isArray(set) || !set.length)
      throw Error("Missing trusted field set");
    for (const x of set)
      if (
        !Array.isArray(x.path) ||
        !x.path.length ||
        x.path.some((k) => typeof k !== "string" || !k || forbidden.has(k)) ||
        !/^[a-f0-9]{64}$/.test(x.beforeHash ?? "")
      )
        throw Error("Invalid operation field set");
  }
  if (
    !Array.isArray(op.dependsOn) ||
    op.dependsOn.some((x) => typeof x !== "string")
  )
    throw Error("Invalid operation dependencies");
  const root = rootFor(context),
    proof = bound(root, op.validationReceiptPath);
  if (digest(proof) !== op.validationReceiptSha256)
    throw Error("Validation receipt SHA changed");
  const receipt = JSON.parse(readFileSync(proof, "utf8"));
  if (
    receipt.status !== "passed" ||
    [
      "projectId",
      "runId",
      "branchId",
      "attemptId",
      "dependencyFingerprint",
    ].some((k) => receipt[k] !== op[k])
  )
    throw Error("Validation receipt does not bind operation");
  const proofOperation = receipt.operations?.find(
    (x) => x.operationId === op.operationId,
  );
  if (receipt.operations) {
    if (
      !proofOperation ||
      [
        "operationId",
        "payloadSha256",
        "readSet",
        "writeSet",
        "kind",
        "dependsOn",
        "dependencyBranches",
      ].some((k) => canonical(proofOperation[k]) !== canonical(op[k]))
    )
      throw Error("Validation receipt operation changed");
  } else if (receipt.payloadSha256 !== op.payloadSha256)
    throw Error("Validation receipt payload changed");
  if (!Array.isArray(op.files)) throw Error("Operation file proofs missing");
  for (const f of op.files)
    if (digest(bound(root, f.path)) !== f.sha256)
      throw Error("Operation file SHA changed");
  if (context.validateOperation) await context.validateOperation(op, receipt);
  return op;
}
function branchDependenciesReady(op, context, j) {
  if (!op.dependencyBranches?.length) return true;
  if (!Array.isArray(op.dependencyBranches)) return false;
  const path = join(rootFor(context), "package-branches.json");
  if (!existsSync(path)) return false;
  const state = JSON.parse(readFileSync(bound(rootFor(context), path), "utf8"));
  if (
    state.version !== 2 ||
    state.projectId !== op.projectId ||
    state.runId !== op.runId
  )
    return false;
  return op.dependencyBranches.every((id) => {
    const branch =
      id === "sound" ? state.postStages?.sound : state.branches?.[id];
    if (branch?.status === "skipped") return context.scope?.[id] === false;
    if (branch?.status !== "complete" || branch.validation?.status !== "passed")
      return false;
    const proofPath = branch.validation.receiptPath,
      sha = branch.validation.receiptSha256 ?? branch.validation.sha256;
    if (!proofPath || !sha) return false;
    const proof = bound(rootFor(context), proofPath);
    if (digest(proof) !== sha) return false;
    const receipt = JSON.parse(readFileSync(proof, "utf8"));
    if (
      receipt.status !== "passed" ||
      receipt.projectId !== op.projectId ||
      receipt.runId !== op.runId ||
      receipt.branchId !== id
    )
      return false;
    if (branch.application?.status === "not_required")
      return !receipt.operations?.length;
    return j.operations.some(
      (row) =>
        row.operation.branchId === id &&
        row.status === "applied" &&
        row.receiptPath &&
        digest(bound(rootFor(context), row.receiptPath)) === row.receiptSha256,
    );
  });
}
function journalPath(context) {
  const root = rootFor(context),
    dir = join(root, "application-queue");
  mkdirSync(dir, { recursive: true });
  if (realpathSync(dir) !== dir)
    throw Error("Queue journal directory escapes output root");
  return join(dir, "journal.json");
}
function readJournal(context) {
  const p = journalPath(context);
  if (!existsSync(p))
    return {
      schemaVersion: 1,
      projectId: context.projectId,
      runId: context.runId,
      operations: [],
    };
  const j = JSON.parse(readFileSync(bound(rootFor(context), p), "utf8"));
  if (j.projectId !== context.projectId || j.runId !== context.runId)
    throw Error("Journal identity mismatch");
  return j;
}
function captureReadback(row, document, op, context) {
  const path = join(
    rootFor(context),
    "application-queue",
    op.operationId + "." + randomUUID() + ".readback.json",
  );
  writeFileSync(
    path,
    JSON.stringify(
      {
        schemaVersion: 1,
        projectId: op.projectId,
        runId: op.runId,
        operationId: op.operationId,
        capturedAt: now(),
        document,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  row.readbackPath = path;
  row.readbackSha256 = digest(path);
  row.readbackRevision = document.revision;
  row.readback = op.writeSet.map((x) => ({
    path: x.path,
    sha256: branchValueHash(field(document, x.path)),
  }));
}
function writeJournal(context, j) {
  const p = journalPath(context);
  if (existsSync(p)) bound(rootFor(context), p);
  for (const row of j.operations) {
    if (
      !["applied", "preserved_manual"].includes(row.status) ||
      row.receiptPath
    )
      continue;
    const op = row.operation,
      receiptPath = join(
        rootFor(context),
        "application-queue",
        op.operationId + "." + randomUUID() + ".receipt.json",
      );
    const receipt = {
      schemaVersion: 1,
      projectId: op.projectId,
      runId: op.runId,
      branchId: op.branchId,
      attemptId: op.attemptId,
      operationId: op.operationId,
      kind: op.kind,
      status: row.status,
      payloadSha256: op.payloadSha256,
      validationReceiptPath: op.validationReceiptPath,
      validationReceiptSha256: op.validationReceiptSha256,
      startedAt: row.startedAt ?? null,
      finishedAt: row.finishedAt ?? now(),
      savedRevision: row.savedRevision ?? null,
      readbackRevision: row.readbackRevision,
      readback: row.readback ?? [],
      readbackPath: row.readbackPath,
      readbackSha256: row.readbackSha256,
      files: row.readbackPath
        ? [{ path: row.readbackPath, sha256: row.readbackSha256 }]
        : [],
      recovered: row.recovered ?? false,
      ...(row.reconciliation ? {reconciliation: row.reconciliation} : {}),
    };
    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n", {
      flag: "wx",
    });
    row.receiptPath = receiptPath;
    row.receiptSha256 = digest(receiptPath);
  }
  const tmp = p + "." + randomUUID() + ".tmp";
  writeFileSync(tmp, JSON.stringify(j, null, 2) + "\n", { flag: "wx" });
  renameSync(tmp, p);
}
async function serial(projectId, context, fn) {
  const key = resolve(context.lockRoot ?? context.outputRoot) + "/" + projectId;
  const previous = chains.get(key) ?? Promise.resolve();
  const pending = previous
    .catch(() => {})
    .then(async () => {
      if (context.withProjectLock)
        return context.withProjectLock(projectId, fn);
      const dir = resolve(context.lockRoot ?? context.outputRoot),
        lock = join(dir, `.package-${projectId}.lock`);
      mkdirSync(dir, { recursive: true });
      try {
        mkdirSync(lock);
        writeFileSync(
          join(lock, "owner.json"),
          JSON.stringify({ pid: process.pid }),
        );
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
        let owner;
        try {
          owner = JSON.parse(readFileSync(join(lock, "owner.json"), "utf8"));
          process.kill(owner.pid, 0);
        } catch (err) {
          if (err.code === "ESRCH") {
            rmSync(lock, { recursive: true });
            return serialUnlocked();
          }
        }
        throw Error("Project application writer is busy");
      }
      async function serialUnlocked() {
        mkdirSync(lock);
        writeFileSync(
          join(lock, "owner.json"),
          JSON.stringify({ pid: process.pid }),
        );
        try {
          return await fn();
        } finally {
          rmSync(lock, { recursive: true });
        }
      }
      try {
        return await fn();
      } finally {
        rmSync(lock, { recursive: true });
      }
    });
  chains.set(key, pending);
  try {
    return await pending;
  } finally {
    if (chains.get(key) === pending) chains.delete(key);
  }
}
export async function enqueueBranchOperation(op, context) {
  await validateBranchOperation(op, context);
  return serial(op.projectId, context, async () => {
    const j = readJournal(context),
      old = j.operations.find(
        (x) => x.operation.operationId === op.operationId,
      );
    if (old) {
      if (canonical(old.operation) !== canonical(op))
        throw Error("Operation replay changed proof");
      return old;
    }
    const row = {
      operation: structuredClone(op),
      status: "queued",
      queuedAt: now(),
    };
    j.operations.push(row);
    writeJournal(context, j);
    return row;
  });
}
export async function drainBranchOperations(projectId, context) {
  resolvePackageOrchestrationVersion(context.packageOrchestrationVersion);
  if (projectId !== context.projectId) throw Error("Queue project mismatch");
  return serial(projectId, context, async () => {
    const j = readJournal(context);
    for (const row of j.operations) {
      if (
        ["applied", "preserved_manual", "stale", "cancelled"].includes(
          row.status,
        )
      )
        continue;
      const op = row.operation;
      let document = await context.load(projectId);
      const marker = (document.productionPlan?.changes ?? []).find(
        (c) =>
          c.id === op.operationId && c.type === "package-branch-application",
      );
      if (marker) {
        row.status = marker.fields?.some(
          (x) => recoveryHash(field(document, x.path)) !== x.sha256,
        )
          ? "preserved_manual"
          : "applied";
        row.recovered = true;
        row.savedRevision ??= marker.savedRevision ?? document.revision;
        captureReadback(row, document, op, context);
        row.finishedAt = now();
        writeJournal(context, j);
        continue;
      }
      if (await context.isCancelled?.()) {
        row.status = "cancelled";
        writeJournal(context, j);
        continue;
      }
      if (
        !branchDependenciesReady(op, context, j) ||
        op.dependsOn.some(
          (id) =>
            !j.operations.some(
              (x) => x.operation.operationId === id && x.status === "applied",
            ) &&
            !(document.productionPlan?.changes ?? []).some(
              (c) => c.id === id && c.type === "package-branch-application",
            ),
        )
      ) {
        row.status = "waiting_dependencies";
        writeJournal(context, j);
        continue;
      }
      if (!context.adapters?.[op.kind]) {
        row.status = "blocked";
        row.error = "Native operation adapter unavailable";
        writeJournal(context, j);
        continue;
      }
      try {
        await validateBranchOperation(op, context);
        for (let retry = 0; retry < 3; retry++) {
          document = await context.load(projectId);
          const needsReconcile = changed(document, op).length > 0;
          const base = needsReconcile ? reconciliationBase(op, context) : null;
          if (needsReconcile && !base) {
            row.status = "stale";
            row.error = "Current read/write fields changed; manual edits preserved";
            break;
          }
          if (await context.isCancelled?.()) {
            row.status = "cancelled";
            break;
          }
          row.status = "applying";
          row.startedAt ??= now();
          writeJournal(context, j);
          let next = await context.adapters[op.kind](
            structuredClone(base ?? document),
            op,
          );
          if (base) {
            // Keep the original business proof and payload immutable. Only the
            // host may project its resulting document onto current source time.
            assertWrites(base, next, op.writeSet);
            const reconciled = await context.reconcile(base, next, document, op, {acceptedCaptionDocuments: acceptedCaptionDocuments(j, context)});
            next = reconciled.document;
            row.reconciliation = {...reconciled.report, fromRevision: base.revision,
              toRevision: document.revision, originalPayloadSha256: op.payloadSha256};
          }
          if (context.validateDocument) await context.validateDocument(next);
          if (!next || next.id !== projectId)
            throw Error("Native adapter changed project identity");
          if (await context.isCancelled?.()) {
            row.status = "cancelled";
            break;
          }
          assertWrites(document, next, op.writeSet);
          next.productionPlan ??= {};
          next.productionPlan.changes ??= [];
          next.productionPlan.changes.push({
            id: op.operationId,
            type: "package-branch-application",
            runId: op.runId,
            branchId: op.branchId,
            createdAt: now(),
            savedRevision: document.revision + 1,
            fields: op.writeSet.map((x) => ({
              path: x.path,
              sha256: recoveryHash(field(next, x.path)),
            })),
          });
          try {
            const saved = await context.save(next, document.revision);
            try {
              await context.afterSave?.(saved, op);
            } catch (error) {
              error.packageQueueCrash = true;
              throw error;
            }
            const readback = await context.load(projectId);
            if (
              !(readback.productionPlan?.changes ?? []).some(
                (c) =>
                  c.id === op.operationId &&
                  c.type === "package-branch-application",
              )
            )
              throw Error("Saved operation missing durable project readback");
            captureReadback(row, readback, op, context);
            row.status = "applied";
            row.savedRevision = saved.revision;
            row.finishedAt = now();
            break;
          } catch (error) {
            if (!/Revision conflict|CAS/.test(error.message)) throw error;
            if (retry === 2) {
              row.status = "blocked";
              row.error = error.message;
            }
          }
        }
      } catch (error) {
        if (error.packageQueueCrash) throw error;
        row.status = "blocked";
        row.error = error.message;
      }
      writeJournal(context, j);
    }
    return j.operations.map(({ operation, ...row }) => ({
      ...row,
      operationId: operation.operationId,
      branchId: operation.branchId,
    }));
  });
}
