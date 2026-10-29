#!/usr/bin/env node
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {generateEditorCatalog} from './generate-editor-catalog.mjs';
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const require = createRequire(
  join(root, "templates/remotion-base/package.json"),
);
export async function buildEditor() {
  await generateEditorCatalog();
  const outdir = join(root, "workspace/editor-app");
  mkdirSync(outdir, { recursive: true });
  await require("esbuild").build({
    entryPoints: [join(root, "tools/editor/main.tsx")],
    bundle: true,
    outdir,
    external: ["/fonts/*"],
    platform: "browser",
    format: "iife",
    target: ["chrome110"],
    sourcemap: true,
    nodePaths: [join(root, "templates/remotion-base/node_modules")],
    define: { "process.env.NODE_ENV": '"production"' },
    loader: { ".css": "css" },
  });
  writeFileSync(
    join(outdir, "index.html"),
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Motion Studio · 视觉工作室</title><link rel="icon" href="data:,"><link rel="stylesheet" href="/workspace/editor-app/main.css"></head><body><div id="root"></div><script src="/workspace/editor-app/main.js"></script></body></html>',
  );
  return outdir;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await buildEditor();
