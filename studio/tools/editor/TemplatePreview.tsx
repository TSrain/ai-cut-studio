import React, { useMemo } from "react";
import { Player } from "@remotion/player";
import { EditorComposition } from "../../templates/remotion-base/src/editor/EditorComposition";
import { makeEditorInstance } from "../../templates/remotion-base/src/editor/assets";
import { Icon } from "./Icon";
export function TemplatePreview({ asset, canvas, onAdd, onClose }: any) {
  const document = useMemo(() => {
    const document: any = {
      canvas: {
        ...canvas,
        fps: { num: 30, den: 1 },
        durationFrames: Math.max(
          30,
          Math.round((asset.duration.default || 10) * 30),
        ),
      },
      source: null,
      instances: [],
    };
    document.instances = [makeEditorInstance(asset.id, document, 0)];
    return document;
  }, [asset, canvas]);
  const inputProps = useMemo(
    () => ({ document, renderMode: "layer" as const }),
    [document],
  );
  return (
    <div className="temporary-preview">
      <div className="inspector-heading">
        <strong>{asset.name}</strong>
        <button aria-label="关闭模板预览" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <p>临时预览 · 尚未添加到时间轴</p>
      <Player
        key={asset.id + canvas.width + canvas.height}
        component={EditorComposition}
        inputProps={inputProps}
        durationInFrames={document.canvas.durationFrames}
        compositionWidth={canvas.width}
        compositionHeight={canvas.height}
        fps={30}
        controls
        autoPlay
        loop
        style={{
          width: "100%",
          maxHeight: "55vh",
          aspectRatio: `${canvas.width}/${canvas.height}`,
        }}
      />
      <button className="preview-add" onClick={() => onAdd(asset.id)}>
        <Icon name="plus" />
        添加到时间轴
      </button>
    </div>
  );
}
export function AspectControl({ value, onChange }: any) {
  return (
    <div className="aspect-control" aria-label="画幅比例">
      {[
        ["1920x1080", "16:9"],
        ["1080x1920", "9:16"],
        ["1080x1080", "1:1"],
      ].map(([v, label]) => (
        <button
          key={v}
          aria-label={"画幅 " + label}
          aria-pressed={value === v}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
