import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createReadStream, statSync } from "node:fs";
import { basename } from "node:path";
import { importEditorFile } from "./editor-import.mjs";
const exec = promisify(execFile);
let choosing = false;
export async function chooseMacEditorFile({ root, kind, projectId }) {
  if (process.platform !== "darwin")
    throw new Error("此入口仅支持 Mac，请使用上方文件选择按钮");
  const types = { video: "public.movie", image: "public.image", media: 'public.movie", "public.image' };
  if (!types[kind]) throw new Error("不支持的文件类型");
  if (choosing) throw new Error("文件选择器已经打开，请切换到 Finder 选择文件");
  choosing = true;
  let selected = false;
  let input;
  try {
    const script = `tell application "Finder"\nactivate\nset selectedFile to choose file with prompt "选择要导入的${kind === "media" ? "图片或视频" : kind === "video" ? "视频" : "图片"}" of type {"${types[kind]}"}\nreturn POSIX path of selectedFile\nend tell`;
    const { stdout } = await exec("osascript", ["-e", script], {
      timeout: 300000,
      maxBuffer: 1024 * 1024,
    });
    const path = stdout.trim();
    selected = true;
    const expectedBytes=statSync(path).size;
    input = createReadStream(path);
    return await importEditorFile(input, {
      root,
      kind,
      projectId,
      name: basename(path),
      expectedBytes,
    });
  } catch (error) {
    if (String(error.stderr || error.message).includes("(-128)"))
      return { cancelled: true };
    if(selected)throw error;
    throw new Error(
      "无法打开 Mac 文件选择器。请允许控制台访问 Finder，或使用上方文件选择按钮。",
    );
  } finally {
    input?.destroy();
    choosing = false;
  }
}
