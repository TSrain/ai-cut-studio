import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, realpathSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { planEditorExport, exportDocumentForItem } from "./editor-export.mjs";
import { presetCatalogById } from "./preset-catalog.mjs";
export { assessProductionPlanExport } from "./production-plan-export-model.mjs";
const run = promisify(execFile);
export async function assertExportMediaReadable(
  document,
  { root, mode = "full", target } = {},
) {
  const publicRoot = realpathSync(join(root, "templates/remotion-base/public")),
    rootReal = realpathSync(root),
    files = new Map(),
    presets = presetCatalogById();
  const add = (path, base, kind) => {
    if (!path) return;
    if (typeof path !== "string" || path.includes("://"))
      throw Error("实际素材必须使用本地文件");
    const p = resolve(base, path);
    if (!p.startsWith(base + sep) || !existsSync(p))
      throw Error("实际引用文件缺失：" + path);
    const actual = realpathSync(p);
    if (!actual.startsWith(base + sep) || !statSync(actual).isFile())
      throw Error("实际素材路径越界：" + path);
    files.set(actual, kind);
  };
  for (const item of planEditorExport(document, mode, target)) {
    const d = exportDocumentForItem(document, item);
    if (
      d.source &&
      (item.renderMode === "full" ||
        d.instances.some(
          (i) =>
            !i.disabled &&
            !d.tracks?.some((t) => t.id === i.trackId && t.disabled) &&
            i.assetId === "source-pip" &&
            i.props?.sourceMode !== "media",
        ))
    )
      add(
        d.source.publicPath || d.source.path,
        d.source.publicPath ? publicRoot : rootReal,
        "video",
      );
    if (item.renderMode === "full") {
      for (const a of d.audioClips ?? [])
        if (
          !a.muted &&
          !d.audioTracks?.some((t) => t.id === a.trackId && t.disabled) &&
          a.startFrame < item.rangeStartFrame + item.durationFrames &&
          a.startFrame + a.durationFrames > item.rangeStartFrame
        )
          add(
            a.publicPath || a.path,
            a.publicPath ? publicRoot : rootReal,
            "audio",
          );
      if (item.rangeStartFrame === 0 && d.cover?.publicPath)
        add(d.cover.publicPath, publicRoot, "image");
    }
    for (const instance of d.instances) {
      if (
        instance.disabled ||
        d.tracks?.some((t) => t.id === instance.trackId && t.disabled)
      )
        continue;
      const props = instance.props ?? {};
      if (props.sourceMode === "media" && props.media)
        add(props.media.publicPath, publicRoot, props.media.kind);
      for (const entry of props.items ?? [])
        if (entry.media)
          add(entry.media.publicPath, publicRoot, entry.media.kind);
      for (const [slot, definition] of Object.entries(
        presets.get(instance.assetId)?.slots ?? {},
      )) {
        if (
          !["image", "video"].includes(definition.type) ||
          !props.slots?.[slot]
        )
          continue;
        const path = props.slots[slot];
        add(
          path.includes("/") ? path : `${definition.assetDir}/${path}`,
          publicRoot,
          definition.type,
        );
      }
    }
  }
  for (const [path, kind] of files) {
    try {
      // SVG is decoded by the browser; ffprobe may accept even malformed XML.
      if (kind === "image" && extname(path).toLowerCase() === ".svg") {
        await run(
          "python3",
          [
            "-c",
            "import sys,xml.etree.ElementTree as ET; root=ET.parse(sys.argv[1]).getroot(); assert root.tag in ('svg','{http://www.w3.org/2000/svg}svg')",
            path,
          ],
          { timeout: 10000 },
        );
        continue;
      }
      const { stdout } = await run(
        "ffprobe",
        ["-v", "error", "-show_streams", "-show_format", "-of", "json", path],
        { timeout: 30000, maxBuffer: 2 * 1024 * 1024 },
      );
      const meta = JSON.parse(stdout),
        stream = meta.streams?.find(
          (s) => s.codec_type === (kind === "audio" ? "audio" : "video"),
        );
      if (
        !stream ||
        (kind === "video" &&
          !(Number(stream.duration ?? meta.format?.duration) > 0))
      )
        throw Error("no decodable stream");
    } catch {
      throw Error("实际素材不可解码，需修复、替换或停用：" + path);
    }
  }
  return { checked: files.size };
}
