import { createReadStream, statSync } from "node:fs";
import { dirname, extname, join, basename } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { json } from "./panel-api.mjs";
import { createProductionPlanService } from "./production-plan-jobs.mjs";
import { listProjectMedia } from "./project-media.mjs";
import { resolveExternalSharedFile } from "./shared-media-catalog.mjs";
import { stageCompositionFile } from "./editor-compose-media.mjs";
import { ensureAlphaPreview } from "./alpha-media.mjs";
import { resolveEditorMedia } from "./editor-media.mjs";
const services = new Map(),
  exec = promisify(execFile);
export function productionPlanService(options) {
  const key = options.rootDir ?? options.root;
  if (!services.has(key))
    // Historical output may be a cloud placeholder. Only recover active jobs
    // and the queue on API startup; explicit service.recover() can scan history.
    services.set(key, createProductionPlanService({ ...options, recoverCompleted: false }));
  return services.get(key);
}
function stream(req, res, path, download=false) {
  const size = statSync(path).size,
    type =
      {
        ".json": "application/json",
        ".md": "text/plain; charset=utf-8",
        ".txt": "text/plain; charset=utf-8",
        ".svg": "image/svg+xml",
        ".avif": "image/avif",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".mov": "video/quicktime",
        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
      }[extname(path).toLowerCase()] ?? "application/octet-stream";
  const headers = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=60",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
  if(download) headers["Content-Disposition"] = `attachment; filename="media${extname(path)}"; filename*=UTF-8\'\'${encodeURIComponent(basename(path))}`;
  let start = 0,
    end = size - 1,
    status = 200;
  if (req.headers.range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!m || !size) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` });
      res.end();
      return;
    }
    if (!m[1]) start = Math.max(0, size - Number(m[2]));
    else {
      start = Number(m[1]);
      if (m[2]) end = Math.min(end, Number(m[2]));
    }
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end ||
      start >= size
    ) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` });
      res.end();
      return;
    }
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  }
  headers["Content-Length"] = Math.max(0, end - start + 1);
  res.writeHead(status, headers);
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  const file = createReadStream(path, { start, end });
  file.on("error", () => res.destroy());
  file.pipe(res);
}
export async function productionPlanApi(action, req, res, url, body, options) {
  if (!action.startsWith("production-plan")) return false;
  const service = productionPlanService(options),
    route = action.slice("production-plan".length),
    projectId =
      req.method === "GET" ? url.searchParams.get("projectId") : body.projectId;
  try {
    if (route === "" && req.method === "GET")
      json(res, 200, service.read(projectId));
    else if (route === "/action" && req.method === "POST") {
      const response =
        body.operation?.type === "apply-results"
          ? await service.applyResults(body)
          : service.action(body);
      const conflicting =
        response.conflicts?.length &&
        ["edit-shot", "import-plan"].includes(body.operation?.type);
      json(
        res,
        conflicting ? 409 : 200,
        conflicting
          ? { error: "同一字段有并发修改，请选择保留版本", ...response }
          : response,
      );
    } else if (route === "/jobs" && req.method === "GET")
      json(res, 200, { jobs: service.read(projectId).jobs });
    else if (route === "/jobs" && req.method === "POST")
      json(res, 200, await service.createJob(body));
    else if (
      /^\/jobs\/[^/]+\/(cancel|retry)$/.test(route) &&
      req.method === "POST"
    ) {
      const [, , id, operation] = route.split("/");
      json(
        res,
        200,
        operation === "cancel"
          ? { job: service.cancel(id) }
          : await service.retry(id),
      );
    } else if (route === "/results" && req.method === "POST")
      json(res, 200, await service.ingest(body));
    else if (route === "/history" && req.method === "GET")
      json(
        res,
        200,
        service.history(projectId, url.searchParams.get("version")),
      );
    else if (route === "/current" && req.method === "GET")
      json(res, 200, service.currentMarkdown(projectId));
    else if (route === "/candidate-media" && req.method === "GET")
      json(res,200,await service.candidateMedia({projectId,shotId:url.searchParams.get("shotId"),candidateId:url.searchParams.get("candidateId")}));
    else if (route === "/candidate-download" && req.method === "POST")
      json(res,200,await service.candidateDownload(body));
    else if (route === "/file" && ["GET", "HEAD"].includes(req.method)) {
      let path = service.resolveFile(
        url.searchParams.get("projectId"),
        url.searchParams.get("path"),
      );
      if (
        url.searchParams.get("browserPreview") === "1" &&
        extname(path).toLowerCase() === ".mov"
      ) {
        const staged = stageCompositionFile(
          { kind: "video", path },
          { root: options.root, base: dirname(path), quality: false },
        );
        if (staged.hasAlpha) {
          const preview = await ensureAlphaPreview(
            `templates/remotion-base/public/${staged.publicPath}`,
            { root: options.root },
          );
          if (!preview.previewPublicPath)
            throw new Error("透明浏览器预览生成失败");
          path = resolveEditorMedia(
            `templates/remotion-base/public/${preview.previewPublicPath}`,
            options.root,
          );
        }
      }
      stream(req, res, path, url.searchParams.get("download") === "1");
    } else if (route === "/catalog" && req.method === "GET") {
      service.read(projectId);
      json(res, 200, {
        project: listProjectMedia({
          ...options,
          root: options.root,
          projectId,
          scope: "project",
        }),
        shared: listProjectMedia({
          ...options,
          root: options.root,
          projectId,
          scope: "shared",
        }),
      });
    } else if (
      route === "/catalog-file" &&
      ["GET", "HEAD"].includes(req.method)
    )
      stream(
        req,
        res,
        resolveExternalSharedFile(url.searchParams.get("id"), {
          root: options.root,
        }),
      );
    else if (route === "/open-project" && req.method === "POST") {
      const { document } = service.read(projectId);
      if (!document.projectBinding) throw new Error("工程尚未关联产物目录");
      await exec(
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "explorer"
            : "xdg-open",
        [document.projectBinding.projectRoot],
      );
      json(res, 200, { opened: true });
    } else json(res, 404, { error: "找不到制作计划接口" });
  } catch (error) {
    json(
      res,
      error.status ?? (/revision conflict/i.test(error.message) ? 409 : 400),
      {
        error: error.message,
        ...(error.document
          ? {
              document: error.document,
              conflicts: error.document.productionPlan?.conflicts ?? [],
            }
          : {}),
      },
    );
  }
  return true;
}
