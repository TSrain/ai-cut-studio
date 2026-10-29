import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {execFileSync} from 'node:child_process';
import {waitForAudioDurations} from '../lib/audio-duration-cache.mjs';
import { join, dirname } from "node:path";
import {
  listStudioLibrary,
  removeStudioAsset,
} from "../lib/studio-library.mjs";
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "studio-library-"));
  t.after(async () => {await waitForAudioDurations(root);rmSync(root, { recursive: true, force: true });});
  const put = (path, data = "asset") => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), data);
  };
  return { root, put };
}
test('20 seconds and above override effect categories; cached durations refresh after replacement',async t=>{
  const {root,put}=fixture(t);
  const paths=[19.99,20,20.01].map(seconds=>{
    const path=`assets/library/sfx/${seconds}.wav`;
    put(path);
    execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i',`anullsrc=r=8000:cl=mono`,'-t',String(seconds),join(root,path)]);
    put(path+'.audio.json',JSON.stringify({audioCategory:'effect'}));
    return path;
  });
  const initial=listStudioLibrary({root});
  assert.equal(initial.items.length,3);
  assert.equal(initial.audioIndexing,true);
  assert.equal(initial.items.some(x=>x.audioCategory==='effect'),false);
  await waitForAudioDurations(root);
  assert.deepEqual(listStudioLibrary({root}).items.map(x=>x.audioCategory),['effect','music','music']);
  execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','anullsrc=r=8000:cl=mono','-t','21',join(root,paths[0])]);
  assert.equal(listStudioLibrary({root}).audioIndexing,true);
  await waitForAudioDurations(root);
  assert.equal(listStudioLibrary({root}).items.find(x=>x.path===paths[0]).audioCategory,'music');
  const script=`import {listStudioLibrary} from ${JSON.stringify(new URL('../lib/studio-library.mjs',import.meta.url).href)}; console.log(JSON.stringify(listStudioLibrary({root:${JSON.stringify(root)}})));`;
  const fresh=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8'}));
  assert.equal(fresh.audioIndexing,false,'fresh process should reuse persisted duration cache');
  assert.equal(fresh.items.every(x=>x.audioCategory==='music'),true);
});
test("audio categories unify built-ins, staged copies and explicit imported categories", async (t) => {
  const {root,put}=fixture(t);
  put('assets/library/bgm/theme.mp3');
  put('assets/library/sfx/click.wav');
  const imported='templates/remotion-base/public/editor-imports/';
  put(imported+'12345678-1234-1234-1234-123456789abc--theme.mp3');
  put(imported+'custom.wav');
  put(imported+'custom.wav.audio.json',JSON.stringify({audioCategory:'music'}));
  put(imported+'voice.wav');
  listStudioLibrary({root});await waitForAudioDurations(root);
  const items=listStudioLibrary({root}).items;
  assert.deepEqual(items.filter(x=>x.audioCategory==='music').map(x=>x.name).sort(),['custom.wav','theme.mp3','theme.mp3']);
  assert.equal(items.find(x=>x.name==='click.wav').audioCategory,'effect');
  assert.equal(items.find(x=>x.name==='voice.wav').audioCategory,'other');
});
test("indexes nested real assets, imports and references with stable encoded URLs", (t) => {
  const { root, put } = fixture(t);
  for (const p of [
    "assets/library/images/中文 空格.png",
    "assets/library/footage/nested/a.mp4",
    "assets/library/bgm/a.mp3",
    "assets/library/fonts/a.woff2",
    "docs/reference/sample/a.jpg",
    "templates/remotion-base/public/editor-imports/import.jpg",
  ])
    put(p);
  put("assets/library/CATALOG.json", "{}");
  put("projects/huge/video.mp4");
  const a = listStudioLibrary({ root }),
    b = listStudioLibrary({ root });
  assert.equal(a.items.length, 6);
  assert.deepEqual(a.counts, {
    image: 2,
    video: 1,
    audio: 1,
    font: 1,
    reference: 1,
  });
  assert.deepEqual(
    a.items.map((x) => x.id),
    b.items.map((x) => x.id),
  );
  const image = a.items.find((x) => x.name === "中文 空格.png");
  assert.equal(
    image.url,
    "/assets/library/images/%E4%B8%AD%E6%96%87%20%E7%A9%BA%E6%A0%BC.png",
  );
  assert.equal(image.bytes, 5);
});
test("counts distinct documents including nested props and public aliases; blocks referenced deletion", (t) => {
  const { root, put } = fixture(t);
  const path = "templates/remotion-base/public/editor-imports/a.png";
  put(path);
  put(
    "workspace/editor-projects/one/document.json",
    JSON.stringify({
      source: { path },
      instances: [{ props: { nested: ["editor-imports/a.png", path] } }],
    }),
  );
  put(
    "workspace/editor-projects/two/document.json",
    JSON.stringify({
      instances: [{ props: { image: "/editor-imports/a.png" } }],
    }),
  );
  const item = listStudioLibrary({ root }).items[0];
  assert.equal(item.usageCount, 2);
  assert.throws(() => removeStudioAsset(item.id, { root }), /引用/);
  assert.ok(existsSync(join(root, path)));
});
test("moves unused assets to recoverable quarantine; rejects traversal and symlink escapes", (t) => {
  const { root, put } = fixture(t);
  put("templates/remotion-base/public/editor-imports/a.png");
  put("assets/library/CATALOG.json", "{}");
  put("outside/secret.png");
  symlinkSync(join(root, "outside"), join(root, "assets/library/escape"));
  symlinkSync(
    join(root, "outside/secret.png"),
    join(root, "assets/library/link.png"),
  );
  const items = listStudioLibrary({ root }).items;
  assert.equal(items.length, 1);
  assert.throws(() => removeStudioAsset("../outside/secret.png", { root }));
  const result = removeStudioAsset(items[0].id, { root });
  assert.equal(result.deleted, true);
  assert.ok(existsSync(join(root, result.trashPath)));
  assert.ok(!existsSync(join(root, items[0].path)));
  assert.ok(existsSync(join(root, "outside/secret.png")));
});
test("fails closed when saved document cannot be read as JSON", (t) => {
  const { root, put } = fixture(t);
  put("templates/remotion-base/public/editor-imports/a.png");
  put("workspace/editor-projects/one/document.json", "broken");
  const item = listStudioLibrary({ root }).items[0];
  assert.equal(item.deletable, false);
  assert.throws(() => removeStudioAsset(item.id, { root }), /项目/);
});
test("refuses deletion when documents or quarantine ancestors are symlinks", (t) => {
  const { root, put } = fixture(t);
  put("templates/remotion-base/public/editor-imports/a.png");
  put("elsewhere/document.json", "{}");
  mkdirSync(join(root, "workspace/editor-projects"), { recursive: true });
  symlinkSync(
    join(root, "elsewhere"),
    join(root, "workspace/editor-projects/linked"),
  );
  let item = listStudioLibrary({ root }).items[0];
  assert.equal(item.deletable, false);
  assert.throws(() => removeStudioAsset(item.id, { root }), /项目/);
  rmSync(join(root, "workspace/editor-projects/linked"));
  symlinkSync(join(root, "elsewhere"), join(root, "workspace/studio-trash"));
  item = listStudioLibrary({ root }).items[0];
  assert.throws(() => removeStudioAsset(item.id, { root }), /符号链接/);
  assert.ok(existsSync(join(root, item.path)));
});
test("built-in public assets and shared library files are protected without explicit references", (t) => {
  const { root, put } = fixture(t);
  put("templates/remotion-base/public/screens/sample-page-tall.jpg");
  put("assets/library/a.png");
  for (const item of listStudioLibrary({ root }).items) {
    assert.equal(item.deletable, false);
    assert.throws(() => removeStudioAsset(item.id, { root }), /内置|共享/);
  }
});
test("stages verified library images as public imports and reuses public items", async (t) => {
  const { stageStudioAsset } = await import("../lib/studio-library.mjs");
  const { root, put } = fixture(t);
  put("assets/library/screens/中文 空格.jpg");
  let item = listStudioLibrary({ root }).items[0];
  const staged = stageStudioAsset(item.id, { root });
  assert.ok(staged.publicPath.startsWith("editor-imports/"));
  assert.equal(
    staged.path,
    "templates/remotion-base/public/" + staged.publicPath,
  );
  assert.ok(existsSync(join(root, staged.path)));
  item = listStudioLibrary({ root }).items.find((x) => x.path === staged.path);
  assert.equal(stageStudioAsset(item.id, { root }).path, staged.path);
  assert.throws(() => stageStudioAsset("../bad", { root }));
  put("assets/library/audio.mp3");
  item = listStudioLibrary({ root }).items.find((x) => x.kind === "audio");
  assert.throws(() => stageStudioAsset(item.id, { root }), /ffprobe|音轨|时长/);
});
test("stages public-root images into a directory so template assetDir cannot rewrite their path", async (t) => {
  const { stageStudioAsset } = await import("../lib/studio-library.mjs");
  const { root, put } = fixture(t);
  put("templates/remotion-base/public/sample.png");
  const item = listStudioLibrary({ root }).items[0],
    staged = stageStudioAsset(item.id, { root });
  assert.ok(staged.publicPath.startsWith("editor-imports/"));
  assert.notEqual(staged.path, item.path);
  assert.ok(existsSync(join(root, staged.path)));
  assert.ok(existsSync(join(root, item.path)));
});
