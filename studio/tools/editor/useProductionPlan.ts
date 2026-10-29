import { useEffect, useRef, useState } from "react";
import { changePlan } from "../lib/production-plan-model.mjs";
export async function productionPlanApi(path: string, body?: any) {
  const res = await fetch("/api/editor/production-plan" + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    const error: any = new Error(data.error || "制作计划请求失败");
    error.status = res.status;
    error.document = data.document;
    throw error;
  }
  return data;
}
export function useProductionPlan({
  document,
  getDocument,
  save,
  onSync,
  canSync,
}: any) {
  const [jobs, setJobs] = useState<any[]>([]),
    [history, setHistory] = useState<any[]>([]),
    [pendingResults, setPendingResults] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const latest = useRef<any>();
  latest.current = { getDocument, save, onSync, canSync };
  const server = useRef<any>(null),
    queue = useRef(Promise.resolve()),
    generation = useRef(0),
    active = useRef(0);
  const receive = (
    data: any,
    base: any,
    mode = "background",
    expected?: any,
  ) => {
    if (!data.document || data.document.id !== latest.current.getDocument().id)
      return;
    latest.current.onSync({ base, document: data.document, mode, expected });
    server.current = structuredClone(data.document);
    if (data.jobs) setJobs(data.jobs);
    if (data.history) setHistory(data.history);
    if (data.pendingResults) setPendingResults(data.pendingResults);
  };
  const refresh = async () => {
    const start = latest.current.getDocument();
    if (!start.projectBinding && !start.productionPlan) return;
    if (!latest.current.canSync() || active.current) return;
    const token = generation.current,
      base = structuredClone(
        server.current?.id === start.id ? server.current : start,
      );
    try {
      const data = await productionPlanApi(
        "?projectId=" + encodeURIComponent(start.id),
      );
      if (
        generation.current === token &&
        latest.current.canSync() &&
        !active.current
      ) {
        receive(data, base);
        setError("");
      }
    } catch (e: any) {
      if (generation.current === token) setError(e.message);
    }
  };
  useEffect(() => {
    generation.current++;
    server.current = null;
    setJobs([]);
    setHistory([]);
    setPendingResults([]);
    setError("");
    setBusy(false);
    void refresh();
    const timer = setInterval(() => void refresh(), 1600);
    return () => {
      generation.current++;
      clearInterval(timer);
    };
  }, [document.id]);
  type Origin = { projectId: string; generation: number };
  const isCurrent = (origin: Origin) =>
    origin.projectId === latest.current.getDocument().id &&
    origin.generation === generation.current;
  const assertOrigin = (origin: Origin) => {
    if (!isCurrent(origin)) throw Error("工程已切换，请在当前工程重新操作");
  };
  const enqueue = (fn: (origin: Origin) => Promise<any>) => {
    // Capture at the user's gesture, before waiting behind another request.
    const origin = {
      projectId: latest.current.getDocument().id,
      generation: generation.current,
    };
    const work = queue.current
      .catch(() => {})
      .then(async () => {
        assertOrigin(origin);
        active.current++;
        setBusy(true);
        setError("");
        try {
          return await fn(origin);
        } catch (e: any) {
          if (isCurrent(origin)) setError(e.message);
          throw e;
        } finally {
          active.current--;
          if (isCurrent(origin)) setBusy(active.current > 0);
        }
      });
    queue.current = work.catch(() => {});
    return work;
  };
  const prepare = async (origin: Origin) => {
    assertOrigin(origin);
    const id = origin.projectId;
    try {
      await latest.current.save();
    } catch (e: any) {
      assertOrigin(origin);
      if (e.document && e.document.id === id) {
        receive(
          { document: e.document },
          server.current ?? latest.current.getDocument(),
        );
        await latest.current.save();
      } else throw e;
    }
    assertOrigin(origin);
    return structuredClone(latest.current.getDocument());
  };
  const action = (operation: any) =>
    enqueue(async (origin) => {
      const base = await prepare(origin);
      let expected: any;
      try {
        expected = changePlan(base, operation);
      } catch {
        expected = null;
      }
      try {
        const result = await productionPlanApi("/action", {
          projectId: base.id,
          revision: base.revision,
          operation,
          operationId: crypto.randomUUID(),
        });
        if (isCurrent(origin))
          receive(
            result,
            base,
            ["read-candidates", "hover"].includes(operation.type)
              ? "metadata"
              : operation.type === "apply-results" &&
                  JSON.stringify(base.instances) !==
                    JSON.stringify(result.document.instances)
                ? "media-action"
                : "action",
            expected,
          );
        return result;
      } catch (e: any) {
        if (isCurrent(origin) && e.document)
          receive({ document: e.document }, base);
        throw e;
      }
    });
  const startJob = (kind: string, options: any = {}) =>
    enqueue(async (origin) => {
      const base = await prepare(origin);
      const result = await productionPlanApi("/jobs", {
        projectId: base.id,
        revision: base.revision,
        kind,
        ...options,
      });
      if (isCurrent(origin)) receive(result, base, "background");
      if (isCurrent(origin) && result.job)
        setJobs((rows) => [
          result.job,
          ...rows.filter((v) => v.id !== result.job.id),
        ]);
      return result;
    });
  const downloadCandidate = (options: any) => enqueue(async (origin) => {
    const base = await prepare(origin);
    const result = await productionPlanApi("/candidate-download", {
      ...options, projectId: base.id, revision: base.revision, addToTimeline: true,
    });
    if (isCurrent(origin)) receive(result, base, "media-action");
    return result;
  });
  const jobAction = (id: string, type: "cancel" | "retry") =>
    enqueue(async (origin) => {
      // Retry freezes a fresh server snapshot; flush the latest trim/move first.
      if (type === "retry") await prepare(origin);
      assertOrigin(origin);
      const result = await productionPlanApi(
        "/jobs/" + encodeURIComponent(id) + "/" + type,
        { projectId: origin.projectId },
      );
      if (isCurrent(origin) && result.job)
        setJobs((rows) =>
          type === "retry"
            ? [result.job, ...rows.filter((j) => j.id !== result.job.id)]
            : rows.map((j) => (j.id === id ? result.job : j)),
        );
      return result;
    });
  return {
    jobs,
    history,
    pendingResults,
    error,
    busy,
    action,
    startJob,
    downloadCandidate,
    jobAction,
    refresh,
  };
}
