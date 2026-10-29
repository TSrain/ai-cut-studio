import {useProjectMedia} from './ProjectMediaContext';
import React, { useRef, useState } from "react";
import { Icon } from "./Icon";
export function FilePicker({
  label,
  value,
  kind = "image",
  onImported,
  onText,
  onClear,
  disabled = false,
  compact = false,
  audioCategory,
}: any) {
  const projectMedia = useProjectMedia();
  const projectId = projectMedia.projectId;
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null),
    [error, setError] = useState("");
  const accept =
    kind === "video"
      ? ".mp4,.mov,.m4v,.webm"
      : kind === "audio" ? ".mp3,.wav,.ogg,.m4a,.aac,.flac,.aiff" : kind === "text"
        ? ".srt,.txt"
        : ".png,.jpg,.jpeg,.webp";
  async function select(file: File) {
    setError("");
    setProgress(0);
    try {
      if (kind === "text") {
        if (file.size > 10 * 1024 * 1024) throw new Error("字幕文件超过 10 MB");
        await onText(await file.text(), file.name);
        return;
      }
      if(projectId)await projectMedia.prepareImport();
      const result: any = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/editor/import?kind=" + kind + (projectId && kind !== "audio" ? "&projectId=" + encodeURIComponent(projectId) : "") + (kind === "audio" ? "&audioCategory=" + encodeURIComponent(audioCategory) : ""));
        xhr.setRequestHeader("x-editor-import", "1");
        xhr.setRequestHeader("x-filename", encodeURIComponent(file.name));
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable)
            setProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => {
          try {
            const data = JSON.parse(xhr.responseText);
            if (xhr.status >= 400) reject(new Error(data.error || "导入失败"));
            else resolve(data);
          } catch {
            reject(new Error("导入服务未响应，请重试"));
          }
        };
        xhr.onerror = () => reject(new Error("连接中断，请重新选择文件"));
        xhr.send(file);
      });
      if (projectMedia.getProjectId() !== projectId) return;
      projectMedia.onImported();
      await onImported(result);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setProgress(null);
    }
  }
  return (
    <div className={"file-picker"+(compact?" file-picker-compact":"")}>
      <label className="direct-file-picker">
        <Icon name="folder" />
        {progress !== null
          ? progress === 100
            ? "正在识别素材…"
            : `正在导入 ${progress}%`
          : label}
        <input
          ref={input}
          type="file"
          accept={accept}
          aria-label={label + "文件"}
          disabled={disabled || progress !== null}
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (file) void select(file);
          }}
        />
      </label>
      {kind !== "text" && !compact && (
        <button
          className="native-file-picker"
          disabled={disabled || progress !== null}
          onClick={async () => {
            setError("");
            setProgress(100);
            try {
              if(projectId)await projectMedia.prepareImport();
              const response = await fetch("/api/editor/choose-file", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ kind, projectId }),
              });
              const result = await response.json();
              if (!response.ok) throw new Error(result.error);
              if (!result.cancelled && projectMedia.getProjectId() === projectId) { projectMedia.onImported(); await onImported(result); }
            } catch (e: any) {
              setError(e.message);
            } finally {
              setProgress(null);
            }
          }}
        >
          在 Mac 系统中选择…
        </button>
      )}
      {value && (
        <small title={value}>
          {value
            .split(/[\\/]/)
            .pop()
            ?.replace(/^[0-9a-f-]{36}--/, "")}
        </small>
      )}
      {value && onClear && (
        <button
          className="clear-file"
          onClick={onClear}
          disabled={progress !== null}
        >
          移除素材
        </button>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
