import React, { useEffect, useRef, useState } from "react";
import { bindProjectMediaDrop } from "./project-media-drop.mjs";
import { useProjectMedia } from "./ProjectMediaContext";
import { Icon } from "./Icon";
export function ProjectMediaUpload({
  onImported,
  onFilesImported,
  label = "上传素材",
  dropTargetRef,
  analyzeAfterImport = true,
  dropOnly = false,
  onImportStart,
  videoOnly = false,
}: {
  onImported: () => void;
  onFilesImported?: (files: any[]) => Promise<any> | void;
  label?: string;
  dropTargetRef?: React.RefObject<HTMLElement>;
  analyzeAfterImport?: boolean;
  dropOnly?: boolean;
  onImportStart?: () => void;
  videoOnly?: boolean;
}) {
  const context = useProjectMedia(),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [errors, setErrors] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [summary, setSummary] = useState("");
  const latest = useRef({upload, projectId: context.projectId});
  latest.current = {upload, projectId: context.projectId};
  useEffect(() => {
    const target = dropTargetRef?.current;
    if (!target) return;
    return bindProjectMediaDrop(target, {
      isDisabled: () => inFlight.current || !latest.current.projectId,
      onActive: active => {
        target.classList.toggle("is-file-drop-target", active);
        setDragging(active);
      },
      onFiles: files => { void latest.current.upload(files); },
    });
  }, [dropTargetRef]);
  async function upload(files: File[]) {
    const projectId = context.projectId;
    if (inFlight.current || !projectId || !files.length) return;
    inFlight.current = true;
    setBusy(true);
    setSummary("");
    setErrors([]);
    const failed: string[] = [],
      imported: any[] = [];
    try {
      onImportStart?.();
      await context.prepareImport();
      for (let i = 0; i < files.length; i++) {
        if (context.getProjectId() !== projectId) {
          failed.push("项目已切换，剩余文件未导入，请在目标项目重新拖入");
          break;
        }
        const file = files[i];
        if (videoOnly ? !/\.(mp4|mov|m4v|webm)$/i.test(file.name) : !/\.(png|jpe?g|webp|mp4|mov|m4v|webm)$/i.test(file.name)) {
          failed.push(`${file.name}：${videoOnly ? "请使用 MP4、MOV、M4V、WebM 视频" : "不支持此格式，请使用 MP4、MOV、M4V、WebM 视频或 PNG、JPG、WebP 图片"}`);
          continue;
        }
        setProgress(`导入 ${i + 1} / ${files.length}`);
        try {
          const response = await fetch(
            "/api/editor/import?kind=media&projectId=" +
              encodeURIComponent(projectId),
            {
              method: "POST",
              headers: {
                "x-editor-import": "1",
                "x-filename": encodeURIComponent(file.name),
              },
              body: file,
            },
          );
          const result = await response.json();
          if (!response.ok) throw Error(result.error || "导入失败");
          imported.push(result);
        } catch (error: any) {
          failed.push(`${file.name}：${error.message}`);
        }
      }
    } catch (error: any) {
      failed.push(error.message);
    } finally {
      try {
        if (context.getProjectId() === projectId) {
          context.onImported();
          onImported();
          if (imported.length) {
            await (onFilesImported
              ? onFilesImported(imported)
              : analyzeAfterImport ? context.onAnalyzeImported?.(imported) : undefined);
          }
        }
      } catch (error: any) {
        failed.push((dropOnly ? "素材已入库，时间轴添加失败：" : "导入后处理：") + error.message);
      } finally {
        inFlight.current = false;
        setBusy(false);
        setSummary(imported.length ? `已导入 ${imported.length} 个素材到本项目` : "");
        setProgress("");
        setErrors(failed);
      }
    }
  }
  if (dropOnly) return busy || dragging || errors.length ? (
    <div className="timeline-file-drop-status">
      {(busy || dragging) && <p role="status">{busy ? progress || "准备导入…" : "松开：加入本项目素材，并从当前播放头依次添加到新轨道"}</p>}
      {errors.length > 0 && <div role="alert">{errors.join("；")}<button type="button" aria-label="关闭导入提示" onClick={() => setErrors([])}>×</button></div>}
    </div>
  ) : null;
  return (
    <div className="project-media-upload">
      <label className="direct-file-picker">
        <Icon name="folder" />
        {busy ? progress : label}
        <input
          ref={input}
          type="file"
          multiple
          accept={videoOnly?".mp4,.mov,.m4v,.webm":".png,.jpg,.jpeg,.webp,.mp4,.mov,.m4v,.webm"}
          aria-label={label}
          disabled={busy || !context.projectId}
          onChange={(e) => {
            const files = Array.from(e.currentTarget.files ?? []);
            e.currentTarget.value = "";
            if (files.length) void upload(files);
          }}
        />
      </label>
      {dropTargetRef && <p className="project-media-drop-hint" role="status">
        {busy ? progress : dragging ? "松开即可导入本项目" : summary || "拖拽视频或图片到此素材区，支持多选"}
      </p>}
      {errors.length > 0 && (
        <ul role="alert">
          {errors.map((error, i) => (
            <li key={i}>{error}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
