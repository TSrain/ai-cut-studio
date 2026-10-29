import {RecedeControls} from './RecedeControls';
import {stageImportSlots} from '../../templates/remotion-base/src/presets/media-stage.mjs';
import {TemplateHoverPreview} from './TemplateHoverPreview';
import {HoverVideo} from './HoverVideo';
import { filterTemplates } from "./studio-state.mjs";
import { TEMPLATE_CATEGORIES, templateUse } from "./template-categories.mjs";
import { FilePicker } from "./FilePicker";
import { FontPicker, PalettePicker, Slider } from "./Controls";
import { labelForField, labelForOption } from "./labels";
import React, { useState } from "react";
import { Icon } from "./Icon";
export function TemplateLibrary({ assets, onAdd, onPreview, selectedId }: any) {
  const [hovered, setHovered] = useState<string|null>(null);
  const [focused, setFocused] = useState<string|null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const filtered = filterTemplates(assets, search, category);
  return (
    <div className="template-library">
      <div className="template-library-header">
        <strong>动画模板</strong>
        <div className="library-search">
        <Icon name="search" />
        <input
          aria-label="搜索模板"
          type="search"
          placeholder="搜索模板"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      </div>
      <div className="template-categories" aria-label="模板分类">
        {[{id:'all',label:'全部',description:'查看全部动画模板'}, ...TEMPLATE_CATEGORIES].map(({id, label, description}) => (
          <button
            key={id}
            aria-pressed={category === id}
            title={description}
            onClick={() => setCategory(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="template-grid">
        {filtered.map((a) => (
          <div
            className={
              "template-card" + (selectedId === a.id ? " preview-selected" : "")
            }
            key={a.id}
            onMouseEnter={()=>setHovered(a.id)}
            onMouseLeave={()=>setHovered(null)}
            onFocus={()=>setFocused(a.id)}
            onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setFocused(null);}}
            draggable
            onDragStart={e=>{e.dataTransfer.setData("application/x-motion-template",a.id);e.dataTransfer.effectAllowed="copy";}}
            onClick={() => onPreview(a.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPreview(a.id);
              }
            }}
            aria-label={"预览 " + a.name}
            title={a.name + ' · ' + templateUse(a.id).purpose}
          >
            <div className="template-preview">
              {a.preview ? <HoverVideo
                src={a.preview + (a.preview.includes('?') ? '&' : '?') + 'v=preset-exit-20261010#t=1'}
                poster={a.thumbnail}
                active={(hovered??focused)===a.id}
              /> : <TemplateHoverPreview assetId={a.id} active={(hovered??focused)===a.id}/>}
              <span className="template-duration">{a.id === "chapter-progress" ? "全片" : a.duration.default + "s"}</span>
              <button
                type="button"
                className="template-add"
                aria-label={"添加 " + a.name}
                onClick={(e) => {
                  e.stopPropagation();
                  onAdd(a.id);
                }}
              >
                <Icon name="plus" size={14} />
              </button>
            </div>
            <div className="template-name">{a.name}</div>
          </div>
        ))}
      </div>
      {!filtered.length && <p className="empty">没有匹配的模板，试试其他用途词或切换到「全部」。</p>}
    </div>
  );
}
export function ContentFields({
  asset,
  instance,
  onChange,
  onPatchTune,
  section = "all",
  onPatchSlots,
  onPatchProps,
  canvas,
}: any) {
  return (
    <>
      {section !== "content" && (
        <>
          {asset?.defaultProps?.tune?.font !== undefined && (
            <>
              <FontPicker
                label="整体字体"
                value={instance.props.tune?.font || "skin"}
                onChange={(v) => onChange("tune", "font", v)}
              />
              <PalettePicker
                tune={instance.props.tune}
                onChange={onPatchTune}
              />
              {[
                ["accentHue", "强调色相"],
                ["neutralHue", "背景色相"],
              ].map(([k, n]) => (
                <Slider
                  key={k}
                  label={n}
                  min={0}
                  max={360}
                  value={
                    instance.props.tune?.[k] ?? asset.defaultProps.tune[k] ?? 0
                  }
                  onChange={(v) => onChange("tune", k, v)}
                />
              ))}
            </>
          )}
          {Object.entries(asset.variantDescriptors || {}).map(
            ([key, meta]: any) => (
              <div className="field" key={key}>
                <label>{labelForField(asset.id, key, meta.label)}</label>
                <div className="option-segments">
                  {(meta.values || []).map((raw: any) => {
                    const v = typeof raw === "object" ? raw.value : raw;
                    return (
                      <button
                        key={v}
                        className={
                          (instance.props.variant?.[key] ?? meta.default) === v
                            ? "active"
                            : ""
                        }
                        onClick={() => onChange("variant", key, v)}
                      >
                        {labelForOption(asset.id, key, v)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ),
          )}
        </>
      )}
      {section !== "appearance" && asset.id === 'recede' && <RecedeControls key={instance.id} instance={instance} canvas={canvas} onPatchSlots={onPatchSlots} onPatchProps={onPatchProps}/>}
      {section !== "appearance" && asset.id !== 'recede' &&
        Object.entries(asset.slotDescriptors || {})
          .filter(([, meta]: any) => !meta.derivedFrom)
          .map(([key, meta]: any) => {
            const value = instance.props.slots?.[key],
              label = labelForField(asset.id, key, meta.label);
            return (
              <div className="content-control" key={key}>
                {!(
                  meta.type === "number" &&
                  Number.isFinite(meta.min) &&
                  Number.isFinite(meta.max)
                ) && <label>{label}</label>}
                {["image", "video", "asset", "footage"].includes(meta.type) ? (
                  <FilePicker
                    label={value ? "更换" + label : "选择" + label}
                    value={value}
                    onClear={
                      meta.required
                        ? undefined
                        : () => onChange("slots", key, "")
                    }
                    kind={
                      ["video", "footage"].includes(meta.type)
                        ? "video"
                        : "image"
                    }
                    onImported={(result) => {
                      const values: any = { [key]: result.publicPath };
                      for (const [field, descriptor] of Object.entries(
                        asset.slotDescriptors,
                      ) as any) {
                        if (descriptor.derivedFrom === key) {
                          if (/(W|Width)$/.test(field))
                            values[field] =
                              result.canvas?.width ?? result.width;
                          else if (/(H|Height)$/.test(field))
                            values[field] =
                              result.canvas?.height ?? result.height;
                          else if (/Dur/.test(field))
                            values[field] = result.durationSeconds;
                        }
                      }
                      onPatchSlots(asset.id==='media-stage'&&['image','clip'].includes(key)?stageImportSlots(key==='clip'?'video':'image',result):values);
                    }}
                  />
                ) : meta.type === "enum" ? (
                  <select aria-label={label} value={value ?? meta.default ?? meta.values?.[0] ?? ''} onChange={e=>onChange('slots',key,e.target.value)}>
                    {(meta.values??[]).map((choice:any)=><option key={choice} value={choice}>{meta.labels?.[choice]??choice}</option>)}
                  </select>
                ) : meta.type === "number" ? (
                  Number.isFinite(meta.min) && Number.isFinite(meta.max) ? (
                    <Slider
                      label={label}
                      value={value}
                      min={meta.min}
                      max={meta.max}
                      step={meta.integer ? 1 : 0.01}
                      onChange={(v) => onChange("slots", key, v)}
                    />
                  ) : (
                    <input
                      aria-label={label}
                      type="number"
                      value={value ?? ""}
                      onChange={(e) => onChange("slots", key, +e.target.value)}
                    />
                  )
                ) : (
                  <textarea
                    aria-label={label}
                    rows={meta.multiline || Array.isArray(value) ? 4 : 2}
                    value={
                      Array.isArray(value) ? value.join("\n") : (value ?? "")
                    }
                    onChange={(e) =>
                      onChange(
                        "slots",
                        key,
                        Array.isArray(value) || meta.type === "list"
                          ? e.target.value.split("\n")
                          : e.target.value,
                      )
                    }
                  />
                )}
              </div>
            );
          })}
    </>
  );
}
