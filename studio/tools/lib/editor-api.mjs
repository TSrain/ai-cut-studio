import {roughcutApi} from './roughcut-api.mjs';
import {editorReviewApi} from './editor-review-api.mjs';
import {requestPreviewProxy} from './editor-preview-proxy.mjs';
import {startPresenterJob,getPresenterJob} from './presenter-jobs.mjs';
import {assertExportMediaReadable,assessProductionPlanExport} from './production-plan-export.mjs';
import {productionPlanApi} from './production-plan-api.mjs';
import {ensureAlphaPreview} from './alpha-media.mjs';
import {listProjectMedia,stageProjectMedia,promoteProjectMedia,useProjectMedia,cloneProjectMedia} from './project-media.mjs';
import {editorCoverApi} from './editor-cover-api.mjs';
import {startCaptionRecognition,getCaptionRecognition} from './editor-caption-jobs.mjs';
import {getTimelineMedia,getTimelinePeaks} from './editor-timeline-media.mjs';
import { listStudioLibrary, removeStudioAsset, stageStudioAsset } from "./studio-library.mjs";
import { validateEditorProps } from "./editor-props.mjs";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT } from "./panel-scan.mjs";
import { json, readBody } from "./panel-api.mjs";
import {
  createDocument,
  validateDocument,
  listDocuments,
  loadDocument,
  saveDocument,
  parseSrt,
  buildChapterPrompt,
  mapChapterSummary,
  hashAssetSources,
  validateChapters,
} from "./editor-store.mjs";
import {
  getEditorJob,
  startEditorExport,
  planEditorExport,
  prepareExportDocument,
  retryEditorExport,
  cancelEditorExport,
} from "./editor-export.mjs";
import { startChapterSummary, getChapterJob } from "./editor-chapters.mjs";
import { probeEditorMedia, stageEditorSource } from "./editor-media.mjs";
import { retimeEditorDocument, retimeEditorTarget } from "./editor-framerate.mjs";
import { importEditorFile } from "./editor-import.mjs";
import { chooseMacEditorFile } from "./editor-native-picker.mjs";
const rootDir = join(ROOT, "workspace/editor-projects");
function sourcePaths(dir = join(ROOT, "templates/remotion-base/src")) {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? sourcePaths(join(dir, e.name))
        : /\.(ts|tsx|mjs)$/.test(e.name)
          ? [relative(ROOT, join(dir, e.name))]
          : [],
    )
    .sort();
}
export async function editorApi(req, res, url) {
  const action = url.pathname.slice("/api/editor/".length);
  try {
    if (action === "timeline-media" && req.method === "GET") return json(res,200,await getTimelineMedia(url.searchParams.get("path"),{root:ROOT}));
    if (action === "timeline-peaks" && req.method === "GET") return json(res,200,await getTimelinePeaks(url.searchParams.get("path"),{root:ROOT,level:url.searchParams.get("level")??0,tile:url.searchParams.get("tile")??0}));
    if (action === "import" && req.method === "POST") {
      if (
        req.headers.origin &&
        req.headers.origin !== `http://${req.headers.host}`
      )
        return json(res, 403, { error: "只接受控制台自身的导入请求" });
      if (req.headers["x-editor-import"] !== "1")
        return json(res, 400, { error: "请选择要导入的文件" });
      const result = await importEditorFile(req, {
        root: ROOT,
        kind: url.searchParams.get("kind"),
        audioCategory: url.searchParams.get("audioCategory"),
        projectId: url.searchParams.get("projectId") || undefined,
        name: decodeURIComponent(req.headers["x-filename"] || ""),
      });
      return json(res, 200, result);
    }
    if (req.method === "POST") {
      if (
        !String(req.headers["content-type"] || "").startsWith(
          "application/json",
        )
      )
        return json(res, 415, { error: "请使用 JSON 请求" });
      if (
        req.headers.origin &&
        req.headers.origin !== `http://${req.headers.host}`
      )
        return json(res, 403, { error: "只接受控制台自身的编辑请求" });
    }
    const body =
      req.method === "POST" ? JSON.parse((await readBody(req)) || "{}") : {};
    if(action==='preview-proxy'&&req.method==='POST')return json(res,200,await requestPreviewProxy(body.path));
    if(action==='presenter/start'&&req.method==='POST'){validateDocument(body.document);return json(res,200,startPresenterJob(body.document,body.instanceId,{root:ROOT}));}
    if(action==='presenter/job'&&req.method==='GET')return json(res,200,getPresenterJob(url.searchParams.get('id')));
    if (await editorCoverApi(action,req,res,url,body,{root:ROOT})) return;
    if (action === "library" && req.method === "GET")
      return json(res, 200, url.searchParams.has("scope") ? listProjectMedia({root:ROOT, scope:url.searchParams.get("scope"),projectId:url.searchParams.get("projectId")}) : listStudioLibrary({ root: ROOT }));
    if (action === "library/stage" && req.method === "POST") {
      const staged=body.projectId && (body.scope || !listStudioLibrary({root:ROOT,onlyKinds:["audio"]}).items.some(item=>item.id===body.id)) ? stageProjectMedia(body.id,{root:ROOT,projectId:body.projectId,scope:body.scope}) : stageStudioAsset(body.id,{root:ROOT});
      if(staged.hasAlpha)Object.assign(staged,await ensureAlphaPreview(staged.path,{root:ROOT}));
      return json(res,200,staged);
    }
    if (action === "library/promote" && req.method === "POST")
      return json(res,200,promoteProjectMedia(body.id,{root:ROOT,projectId:body.projectId,scope:body.scope}));
    if (action === "library/use" && req.method === "POST")
      return json(res,200,useProjectMedia(body.id,{root:ROOT,projectId:body.projectId,scope:body.scope}));
    if (action === "library/delete" && req.method === "POST")
      return json(res, 200, removeStudioAsset(body.id, { root: ROOT }));
    const opts = {
      rootDir,
      assetSourceRoot: ROOT,
      assetSourcePaths: sourcePaths(),
    };
    if(await roughcutApi(action,req,res,url,body,{...opts,root:ROOT}))return;
    if(await editorReviewApi(action,req,res,url,body,{...opts,root:ROOT}))return;
    if(await productionPlanApi(action,req,res,url,body,{...opts,root:ROOT}))return;
    if (action === "documents" && req.method === "GET")
      return json(res, 200, listDocuments({ rootDir }));
    if (action === "load" && req.method === "GET")
      return json(
        res,
        200,
        loadDocument(url.searchParams.get("id"), { rootDir }),
      );
    if (action === "save" && req.method === "POST") {
      validateDocument(body.document);
      for (const instance of body.document.instances)
        validateEditorProps(instance, body.document.canvas.durationFrames, {fps:body.document.canvas.fps.num/body.document.canvas.fps.den});
      const doc = body.saveAs
        ? createDocument({
            ...body.document,
            id: randomUUID(),
            name: body.name || `${body.document.name} 副本`,
            revision: 0,
          })
        : body.document;
      const saved = saveDocument(doc, { ...opts, expectedRevision: doc.revision });
      if (body.saveAs) cloneProjectMedia(body.document.id,doc.id,{root:ROOT});
      return json(res,200,saved);
    }
    if (action === "choose-file" && req.method === "POST")
      return json(
        res,
        200,
        await chooseMacEditorFile({ root: ROOT, kind: body.kind, projectId:body.projectId }),
      );
    if (action === "media" && req.method === "POST")
      return json(res, 200, probeEditorMedia(body.path));
    if (action === "chapters/summarize" && req.method === "POST")
      return json(res, 200, startChapterSummary(body.srt, body.canvas));
    if (action === "captions/start" && req.method === "POST") return json(res,200,startCaptionRecognition(loadDocument(body.documentId,{rootDir}),{polish:body.polish===true}));
    if (action === "captions/job" && req.method === "GET") return json(res,200,getCaptionRecognition(url.searchParams.get("id")));
    if (action === "chapters/job" && req.method === "GET")
      return json(res, 200, getChapterJob(url.searchParams.get("id")));
    if (action === "chapters/prepare" && req.method === "POST") {
      const cues = parseSrt(body.srt, body.canvas);
      return json(res, 200, {
        cues,
        prompt: buildChapterPrompt(cues, body.canvas),
      });
    }
    if (action === "chapters/map" && req.method === "POST")
      return json(
        res,
        200,
        mapChapterSummary(body.summary, body.cues, body.canvas),
      );
    if (action === "export" && req.method === "POST") {
      const doc = loadDocument(body.documentId, {
        rootDir,
        expectedAssetSourceHash: hashAssetSources(opts.assetSourcePaths, ROOT),
      });
      for (const instance of prepareExportDocument(doc,body.mode,body.target).instances)
        validateEditorProps(instance, doc.canvas.durationFrames, {
          requireAssets: true, fps:doc.canvas.fps.num/doc.canvas.fps.den,
        });
      const planWarnings=assessProductionPlanExport(doc);
      if(planWarnings.requiresAcknowledgement&&body.planAcknowledged!==true)return json(res,409,{error:'制作计划仍有缺口，请确认继续导出',code:'PLAN_GAPS',warnings:planWarnings});
      await assertExportMediaReadable(doc,{root:ROOT,mode:body.mode,target:body.target});
      // Validate against the original clock before rounding, which can collapse adjacent frames.
      if(body.mode==='clip'&&body.target?.kind==='camera')planEditorExport(doc,body.mode,body.target);
      return json(
        res,
        200,
        startEditorExport(
          stageEditorSource(retimeEditorDocument(prepareExportDocument(doc,body.mode,body.target), body.fps ?? 30)),
          body.mode,
          {target:retimeEditorTarget(body.target,doc,body.fps??30)},
        ),
      );
    }
    if (action === "job" && req.method === "GET")
      return json(res, 200, await getEditorJob(url.searchParams.get("id")));
    if (action === "cancel" && req.method === "POST")
      return json(res,200,cancelEditorExport(body.id));
    if (action === "retry" && req.method === "POST")
      return json(res, 200, retryEditorExport(body.id));
    return json(res, 404, { error: "找不到编辑接口" });
  } catch (e) {
    return json(res, /revision conflict/i.test(e.message) ? 409 : 400, {
      error: e.message,
      ...(e.document?{document:e.document,conflicts:e.document.productionPlan?.conflicts??[]}:{}),
    });
  }
}
