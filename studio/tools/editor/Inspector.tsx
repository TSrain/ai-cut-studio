import {RecedeControls} from './RecedeControls';
import {SceneBackgroundControls} from './SceneBackgroundControls';
import {MediaControls} from './MediaControls';
import {SourcePipControls} from "./SourcePipControls";
import React, { useEffect, useState } from "react";
import { Slider, FontPicker, ColorSwatches } from "./Controls";
import { ContentFields } from "./TemplateLibrary";
import { Icon } from "./Icon";
export function Inspector({
  asset,
  instance,
  part,
  parts,
  onPartChange,
  selectedMediaItemId,
  onSelectMediaItem,
  style,
  onStyle,
  textValue,
  onText,
  onBackground,
  onProp,
  onPatchProps,
  onNested,
  onPatchTune,
  onPatchSlots,
  onInstance,
  onLayerChange,
  layerIndex,
  layerCount,
  canvas,
  source,
  onReset,
  onDelete,
}: any) {
  const [tab, setTab] = useState(part === "group" ? "scene" : "text");
  const [base, setBase] = useState<any>({});
  useEffect(
    () => setTab(part === "group" ? "scene" : "text"),
    [part, instance.id],
  );
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const node = document.querySelector(
        `.player-wrap [data-editor-instance="${CSS.escape(instance.id)}"] [data-editor-part="${CSS.escape(part)}"]`,
      );
      if (!node) {
        setBase({});
        return;
      }
      const s = getComputedStyle(node),
        size = parseFloat(s.fontSize);
      setBase({
        color: s.color,
        fontSize: size,
        fontWeight: parseFloat(s.fontWeight),
        lineHeight: parseFloat(s.lineHeight) / size,
        letterSpacing: parseFloat(s.letterSpacing) || 0,
        width: parseFloat(s.width),
      });
    });
    return () => cancelAnimationFrame(id);
  }, [instance.id, part]);
  const textParts = parts.filter(([id]) => !["bar", "panel"].includes(id));
  const field = (
    key: string,
    label: string,
    min: number,
    max: number,
    step: number,
    def: number,
    unit = "",
  ) => (
    <Slider
      key={key}
      label={label}
      value={style[key]}
      defaultValue={Number.isFinite(base[key]) ? base[key] : def}
      min={min}
      max={max}
      step={step}
      unit={unit}
      onChange={(v) => onStyle(key, v)}
      onReset={() => onStyle(key, undefined)}
    />
  );
  return (
    <>
      <div className="inspector-heading">
        <strong>{asset.name}</strong>
        <span>{asset.id === "chapter-progress" ? "全片进度" : "动画"}</span>
      </div>
      {onLayerChange && <div className="inspector-actions" aria-label="图层顺序">
        <button disabled={layerIndex>=layerCount-1} onClick={()=>onLayerChange(1)}>上移一层</button>
        <button disabled={layerIndex<=0} onClick={()=>onLayerChange(-1)}>下移一层</button>
      </div>}
      {instance.assetId!=='behind-title'&&<SceneBackgroundControls hasSource={!!(source?.path||source?.publicPath)} props={instance.props} onPatch={onPatchProps} defaultMode={instance.props.variant?.bg==='transparent'||['chapter-progress','source-pip'].includes(instance.assetId)?'transparent':'original'}/>}
      <div className="inspector-tabs">
        <button
          className={tab === "text" ? "active" : ""}
          onClick={() => {
            setTab("text");
            if (part === "group")
              onPartChange(textParts[0]?.[0] || parts[0]?.[0] || "group");
          }}
          disabled={!parts.length}
        >
          文字
        </button>
        <button
          className={tab === "scene" ? "active" : ""}
          onClick={() => {
            setTab("scene");
            onPartChange("group");
          }}
        >
          画面
        </button>
        <button
          className={tab === "content" ? "active" : ""}
          onClick={() => setTab("content")}
        >
          内容
        </button>
      </div>
      {tab === "text" && (
        <>
          <div className="part-chips" aria-label="选择要调整的文字">
            {textParts.length > 1 && (
              <button
                className={part === "all-text" ? "active" : ""}
                onClick={() => onPartChange("all-text")}
              >
                全部文字
              </button>
            )}
            {parts.map(([id, label]) => (
              <button
                key={id}
                className={part === id ? "active" : ""}
                onClick={() => onPartChange(id)}
                title={label}
              >
                {label}
              </button>
            ))}
          </div>
          {instance.assetId === 'recede' && <RecedeControls key={instance.id} instance={instance} canvas={canvas} onPatchSlots={onPatchSlots} onPatchProps={onPatchProps}/>}
          {instance.assetId !== 'recede' && textValue !== undefined && (
            <textarea
              className="selected-copy"
              aria-label="选中文字内容"
              rows={2}
              value={textValue}
              onChange={(e) =>
                onText(
                  typeof textValue === "number"
                    ? Number(e.target.value)
                    : e.target.value,
                )
              }
            />
          )}{" "}
          {!["bar", "panel"].includes(part) && (
            <FontPicker
              label="文字字体"
              mode="family"
              value={style.fontFamily || ""}
              onChange={(v) => onStyle("fontFamily", v)}
            />
          )}
          {!["bar", "panel"].includes(part) &&
            instance.assetId !== "recede" && field("fontSize", "字号", 8, 400, 1, 80, "px")}
          {field("x", "水平位置", -canvas.width, canvas.width, 1, 0, "px")}
          {field("y", "垂直位置", -canvas.height, canvas.height, 1, 0, "px")}
          {field("opacity", "不透明度", 0, 1, 0.01, 1)}
          <ColorSwatches
            label="文字颜色"
            value={style.color || base.color || "#ffffff"}
            onChange={(v) => onStyle("color", v)}
          />
          <details className="advanced-controls">
            <summary>字重、间距与边框</summary>
            {field("fontWeight", "字重", 100, 900, 100, 600)}
            {field("letterSpacing", "字间距", -10, 40, 0.5, 0, "px")}
            {field("lineHeight", "行距", 0.5, 3, 0.05, 1.2)}
            {field("width", "文字宽度", 20, canvas.width, 1, 400, "px")}
            {field("padding", "内边距", 0, 100, 1, 0, "px")}
            {field("borderRadius", "圆角", 0, 100, 1, 0, "px")}
            <ColorSwatches
              label="承托底色"
              value={style.backgroundColor || "#333333"}
              onChange={(v) => onStyle("backgroundColor", v)}
            />
          </details>
          <button className="quiet-reset" onClick={() => onReset("part")}>
            <Icon name="undo" size={13} />
            恢复文字默认样式
          </button>
        </>
      )}
      {tab === "scene" && (
        <>
          {["media-stack","media-split"].includes(instance.assetId) ? <MediaControls props={{...instance.props,durationSeconds:instance.durationFrames/(canvas.fps.num/canvas.fps.den)}} onProp={onProp} onPatch={onPatchProps} canvas={canvas} assetId={instance.assetId} selectedItemId={selectedMediaItemId} onSelectItem={onSelectMediaItem}/> : instance.assetId === "source-pip" ? <SourcePipControls props={instance.props} onProp={onProp} onPatch={onPatchProps} source={source} canvas={canvas} startFrame={instance.startFrame} /> : <>
          <ContentFields
            asset={asset}
            instance={instance}
            onChange={onNested}
            onPatchTune={onPatchTune}
            onPatchSlots={onPatchSlots}
            onPatchProps={onPatchProps}
            canvas={canvas}
            section="appearance"
          />
          <Slider
            label="整体大小"
            value={instance.props.tune?.scale ?? 1}
            defaultValue={1}
            min={0.1}
            max={3}
            step={0.01}
            onChange={(v) => onNested("tune", "scale", v)}
          />
          <Slider
            label="整体水平位置"
            value={instance.props.tune?.x ?? 0}
            defaultValue={0}
            min={-canvas.width}
            max={canvas.width}
            onChange={(v) => onNested("tune", "x", v)}
          />
          <Slider
            label="整体垂直位置"
            value={instance.props.tune?.y ?? 0}
            defaultValue={0}
            min={-canvas.height}
            max={canvas.height}
            onChange={(v) => onNested("tune", "y", v)}
          />
          </>}
          {instance.assetId === "chapter-progress" && (
            <>
              <label className="global-edit">
                <input
                  type="checkbox"
                  checked={instance.props.showLabels !== false}
                  onChange={(e) => onProp("showLabels", e.target.checked)}
                />
                显示章节标题
              </label>
              <Slider
                label="进度条粗细"
                value={instance.props.thickness ?? 8}
                min={1}
                max={50}
                defaultValue={8}
                onChange={(v) => onProp("thickness", v)}
              />
              <Slider
                label="章节间距"
                value={instance.props.gap ?? 6}
                min={0}
                max={80}
                defaultValue={6}
                onChange={(v) => onProp("gap", v)}
              />
              {[
                ["completedColor", "已完成颜色"],
                ["activeColor", "当前章节颜色"],
                ["futureColor", "待播放颜色"],
              ].map(([k, n]) => (
                <ColorSwatches
                  key={k}
                  label={n}
                  value={instance.props[k] || "#ffffff"}
                  onChange={(v) => onProp(k, v)}
                />
              ))}
            </>
          )}
          <details className="advanced-controls">
            <summary>时间与图层</summary>
            <Slider
              label="开始时间"
              unit="秒"
              value={instance.startFrame / (canvas.fps.num / canvas.fps.den)}
              min={0}
              max={
                (canvas.durationFrames - instance.durationFrames) /
                (canvas.fps.num / canvas.fps.den)
              }
              step={0.1}
              onChange={(v) =>
                onInstance(
                  "startFrame",
                  Math.round((v * canvas.fps.num) / canvas.fps.den),
                )
              }
            />
            <Slider
              label="持续时间"
              unit="秒"
              value={
                instance.durationFrames / (canvas.fps.num / canvas.fps.den)
              }
              min={1 / (canvas.fps.num / canvas.fps.den)}
              max={
                (canvas.durationFrames - instance.startFrame) /
                (canvas.fps.num / canvas.fps.den)
              }
              step={0.1}
              onChange={(v) =>
                onInstance(
                  "durationFrames",
                  Math.max(
                    1,
                    Math.round((v * canvas.fps.num) / canvas.fps.den),
                  ),
                )
              }
            />
            <p className="hint">图层顺序与时间轴轨道一致，可在上方升降所属轨道。</p>
          </details>
        </>
      )}
      {tab === "content" && ["media-stack","media-split"].includes(instance.assetId) ? <MediaControls props={{...instance.props,durationSeconds:instance.durationFrames/(canvas.fps.num/canvas.fps.den)}} onProp={onProp} onPatch={onPatchProps} canvas={canvas} assetId={instance.assetId} selectedItemId={selectedMediaItemId} onSelectItem={onSelectMediaItem}/> : tab === "content" && instance.assetId === "source-pip" ? <SourcePipControls props={instance.props} onProp={onProp} onPatch={onPatchProps} source={source} canvas={canvas} startFrame={instance.startFrame} /> : tab === "content" && (
        <ContentFields
          asset={asset}
          instance={instance}
          onChange={onNested}
          onPatchTune={onPatchTune}
          onPatchSlots={onPatchSlots}
          section="content"
        />
      )}
      <div className="inspector-actions">
        <button onClick={() => onReset("all")}>
          <Icon name="undo" size={14} />
          重置动画
        </button>
        <button onClick={onDelete}>
          <Icon name="trash" size={14} />
          删除
        </button>
      </div>
    </>
  );
}
