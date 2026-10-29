import {Icon} from './Icon';
import {useBackdropDismiss} from './useBackdropDismiss';
import React, { useEffect, useRef, useState } from "react";
import type { StudioItem } from "./StudioLibrary";
export interface StudioPreviewProps {
  item: StudioItem;
  onClose(): void;
  onUse?(item: StudioItem): void;
  onPromote?(item:StudioItem):Promise<void>;
  onApply?(item:StudioItem):void;
  applyLabel?:string;
  adding?:boolean;
  useLabel?: string;
  onDeleted?(): void;
  onError?(message: string): void;
}
export function StudioPreview({
  item,
  onClose,
  onUse,
  onPromote,onApply,applyLabel,adding=false,
  useLabel,
  onDeleted,
  onError,
}: StudioPreviewProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fontFamily, setFontFamily] = useState("");
  const close = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setConfirming(false);
    setError("");
    close.current?.focus();
  }, [item.id]);
  useEffect(() => {
    if (confirming) cancel.current?.focus();
  }, [confirming]);
  useEffect(() => {
    setFontFamily("");
    if (item.kind !== "font") return;
    let disposed = false;
    const family = `StudioPreview_${item.id.replace(/[^a-zA-Z0-9]/g, "_")}`;
    const fonts = document.fonts as FontFaceSet & {
      add(face: FontFace): void;
      delete(face: FontFace): boolean;
    };
    const face = new FontFace(family, `url(${JSON.stringify(item.url)})`);
    face
      .load()
      .then((loaded) => {
        if (!disposed) {
          fonts.add(loaded);
          setFontFamily(family);
        }
      })
      .catch(() => {
        if (!disposed) setError("字体预览加载失败");
      });
    return () => {
      disposed = true;
      fonts.delete(face);
    };
  }, [item.id, item.kind, item.url]);
  const deleteDisabled = item.deletable === false || item.usageCount > 0;
  const deleteReason =
    item.deleteReason ||
    (item.usageCount > 0 ? "已被保存项目引用，无法删除" : "该素材不可删除");
  async function remove() {
    if (deleteDisabled) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/editor/library/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "删除失败");
      setConfirming(false);
      onDeleted?.();
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : "删除失败，请重试";
      setError(message);
      onError?.(message);
    } finally {
      setBusy(false);
    }
  }
  function dismissConfirmation() {
    setConfirming(false);
    deleteButton.current?.focus();
  }
  const confirmationBackdrop = useBackdropDismiss(dismissConfirmation, busy);
  return (
    <section
      className="studio-preview"
      aria-label={`${item.name}预览`}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) {
          event.stopPropagation();
          if (confirming) dismissConfirmation();
          else onClose();
        }
      }}
    >
      <header className="studio-preview-header">
        <h2>{item.name}</h2>
        <button ref={close} className="dialog-close" type="button" aria-label="关闭预览" title="关闭" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <div className="studio-preview-media">
        {(item.kind === "image" || item.kind === "reference") && (
          <img
            src={item.url}
            alt={item.name}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
            }}
          />
        )}
        {item.kind === "video" && (
          <video
            key={item.id}
            src={item.url}
            poster={item.thumbnail}
            controls
            preload="metadata"
            style={{ maxWidth: "100%", maxHeight: "100%" }}
          />
        )}
        {item.kind === "audio" && (
          <audio key={item.id} src={item.url} controls preload="metadata" />
        )}
        {item.kind === "font" && (
          <div
            className="studio-preview-font"
            style={{ fontFamily: fontFamily ? `"${fontFamily}"` : undefined }}
          >
            <p>山川湖海，光影之间</p>
            <p>ABCDEFGHIJKLMNOPQRSTUVWXYZ</p>
            <p>abcdefghijklmnopqrstuvwxyz 0123456789</p>
            {!fontFamily && !error && (
              <small role="status">正在加载字体…</small>
            )}
          </div>
        )}
      </div>
      <dl className="studio-preview-facts">
        <dt>文件</dt>
        <dd>{item.name}</dd>
        <dt>路径</dt>
        <dd title={item.path}>{item.path}</dd>
        <dt>大小</dt>
        <dd>
          {item.bytes < 1024 * 1024
            ? `${(item.bytes / 1024).toFixed(1)} KB`
            : `${(item.bytes / (1024 * 1024)).toFixed(1)} MB`}
        </dd>
        <dt>{item.scope ? "添加使用" : "项目引用"}</dt>
        <dd>{item.scope ? (item.useCount ?? 0) : item.usageCount} 次</dd>
      </dl>
      {error && (
        <p role="alert" className="studio-preview-error">
          {error}
        </p>
      )}
      <div className="studio-preview-actions">
        {onUse &&
          (item.kind === "audio" || item.kind === "image" ||
            item.kind === "video" ||
            item.kind === "reference") && (
            <button type="button" disabled={adding} onClick={() => onUse(item)}>
              {useLabel ||
                (item.kind === "video" ? "设为底片" : "应用到选中图像槽")}
            </button>
          )}
        {onApply&&<button type="button" disabled={adding} onClick={()=>onApply(item)}>{applyLabel||'替换选中素材'}</button>}
        {item.scope==='project' && onPromote && <button type="button" disabled={busy||!!item.sharedId} onClick={async()=>{setBusy(true);setError('');try{await onPromote(item);}catch(e:any){setError(e.message);}finally{setBusy(false);}}}>{item.sharedId?'已添加到素材库':busy?'正在添加…':'添加到素材库'}</button>}
        <a href={item.url} download={item.name}>
          下载原文件
        </a>
        {!item.scope && <><button
          ref={deleteButton}
          type="button"
          disabled={deleteDisabled || busy}
          title={deleteDisabled ? deleteReason : undefined}
          onClick={() => setConfirming(true)}
        >
          删除素材
        </button>
        {deleteDisabled && <small>{deleteReason}</small>}</>}
      </div>
      {confirming && (
        <div className="studio-confirm-backdrop" {...confirmationBackdrop}>
        <div
          className="studio-preview-confirm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="studio-delete-title"
          onKeyDown={(event) => {
            if (event.key === "Tab") {
              event.preventDefault();
              const buttons = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  "button:not(:disabled)",
                ),
              );
              const index = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              buttons[
                (index + (event.shiftKey ? buttons.length - 1 : 1)) %
                  buttons.length
              ]?.focus();
            }
          }}
        >
          <button ref={cancel} className="dialog-close" type="button" aria-label="关闭删除确认" title="关闭" disabled={busy} onClick={dismissConfirmation}><Icon name="close"/></button>
          <h3 id="studio-delete-title">删除“{item.name}”？</h3>
          <p>文件将移入隔离区，从素材库中移除。</p>
          <button
            type="button"
            disabled={busy}
            onClick={dismissConfirmation}
          >
            取消
          </button>
          <button type="button" disabled={busy} onClick={() => void remove()}>
            {busy ? "正在删除…" : "确认删除"}
          </button>
        </div>
        </div>
      )}
    </section>
  );
}
