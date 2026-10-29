import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { mkdtempSync, readdirSync, rmSync, readFileSync } from "node:fs";
import {execFileSync} from 'node:child_process';
import {listStudioLibrary} from '../lib/studio-library.mjs';
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importEditorFile } from "../lib/editor-import.mjs";
import { mediaMetadata } from "../lib/editor-media.mjs";
import { applyImportedSource } from "../editor/import-document.mjs";
const meta = (patch = {}) => ({
  streams: [
    {
      codec_type: "video",
      width: 1920,
      height: 1080,
      avg_frame_rate: "30000/1001",
      duration: "10",
      ...patch,
    },
  ],
});
test('audio imports validate decoding and persist chosen category across library reloads',async t=>{
  const root=mkdtempSync(join(tmpdir(),'editor-audio-import-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const sample=join(root,'sample.wav');
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.2',sample]);
  const result=await importEditorFile(Readable.from([readFileSync(sample)]),{root,kind:'audio',audioCategory:'music',name:'test.wav'});
  assert.ok(result.durationSeconds>0);
  assert.equal(listStudioLibrary({root}).items.find(i=>i.path===result.path).audioCategory,'music');
  await assert.rejects(importEditorFile(Readable.from(['bad']),{root,kind:'audio',audioCategory:'effect',name:'bad.wav'}));
  await assert.rejects(importEditorFile(Readable.from(['bad']),{root,kind:'audio',audioCategory:'invalid',name:'bad.wav'}));
  assert.equal(listStudioLibrary({root}).items.length,1);
});
test('uploading a 20-second effect returns and saves music category',async t=>{
  const root=mkdtempSync(join(tmpdir(),'editor-long-audio-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const sample=join(root,'sample.wav');
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','anullsrc=r=8000:cl=mono','-t','20',sample]);
  const result=await importEditorFile(Readable.from([readFileSync(sample)]),{root,kind:'audio',audioCategory:'effect',name:'long.wav'});
  assert.equal(result.audioCategory,'music');
  assert.equal(JSON.parse(readFileSync(join(root,result.path)+'.audio.json','utf8')).audioCategory,'music');
  assert.equal(listStudioLibrary({root}).items.find(x=>x.path===result.path).audioCategory,'music');
});
test("识别横竖屏与手机旋转，忽略封面轨并回退帧率", () => {
  assert.equal(mediaMetadata(meta()).aspectLabel, "16:9 横屏");
  const portrait = mediaMetadata(meta({ side_data_list: [{ rotation: -90 }] }));
  assert.equal(portrait.aspectLabel, "9:16 竖屏");
  assert.equal(portrait.canvas.width, 1080);
  assert.equal(portrait.canvas.height, 1920);
  assert.equal(
    mediaMetadata(meta({ avg_frame_rate: "0/0", r_frame_rate: "25/1" })).canvas
      .fps.num,
    25,
  );
  assert.throws(() => mediaMetadata(meta({ duration: "N/A" })));
});
test("导入换帧率保持已有动画秒位置，并继承画幅；短底片不静默裁掉动画", () => {
  const d = {
    canvas: {
      width: 1920,
      height: 1080,
      fps: { num: 30, den: 1 },
      durationFrames: 300,
    },
    source: null,
    instances: [
      {
        assetId: "title-reveal",
        startFrame: 60,
        durationFrames: 90,
        props: {},
      },
    ],
  };
  const m = {
    path: "assets/a.mp4",
    canvas: {
      width: 1080,
      height: 1920,
      fps: { num: 60, den: 1 },
      durationFrames: 600,
    },
  };
  const next = applyImportedSource(d, m);
  assert.equal(next.instances[0].startFrame, 60);
  assert.equal(next.instances[0].durationFrames, 90);
  assert.equal(next.instances[0].props.canvas, "1080x1920");
  assert.equal(d.instances[0].startFrame, 60);
  assert.throws(() =>
    applyImportedSource(d, {
      ...m,
      canvas: { ...m.canvas, durationFrames: 90 },
    }),
  );
});
test("拒绝伪装文件、超限与中断上传，清理临时文件", async () => {
  const root = mkdtempSync(join(tmpdir(), "editor-import-"));
  try {
    await assert.rejects(
      importEditorFile(Readable.from(["abc"]), {
        root,
        kind: "image",
        name: "bad.exe",
      }),
    );
    await assert.rejects(
      importEditorFile(Readable.from(["abc"]), {
        root,
        kind: "image",
        name: "bad.png",
      }),
    );
    await assert.rejects(
      importEditorFile(Readable.from(["123456"]), {
        root,
        kind: "video",
        name: "a.mp4",
        maxBytes: 3,
      }),
    );
    await assert.rejects(
      importEditorFile(
        Readable.from(
          (async function* () {
            yield "abc";
            throw new Error("连接中断");
          })(),
        ),
        { root, kind: "video", name: "interrupted.mp4" },
      ),
    );
    assert.deepEqual(
      readdirSync(join(root, "templates/remotion-base/public/editor-imports")),
      [],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

import {checkEditorImportCapacity,EDITOR_VIDEO_MAX_BYTES} from '../lib/editor-import.mjs';
test('large original import has bounded capacity, disk reserve and exact size validation',async t=>{
 assert.ok(EDITOR_VIDEO_MAX_BYTES>4975905962);
 assert.doesNotThrow(()=>checkEditorImportCapacity({expectedBytes:4975905962,maxBytes:EDITOR_VIDEO_MAX_BYTES,availableBytes:6*1024**3}));
 assert.throws(()=>checkEditorImportCapacity({expectedBytes:4975905962,maxBytes:EDITOR_VIDEO_MAX_BYTES,availableBytes:4*1024**3}),/空间/);
 assert.throws(()=>checkEditorImportCapacity({expectedBytes:EDITOR_VIDEO_MAX_BYTES+1,maxBytes:EDITOR_VIDEO_MAX_BYTES,availableBytes:100*1024**3}),/上限/);
 const root=mkdtempSync(join(tmpdir(),'editor-size-check-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 await assert.rejects(importEditorFile(Readable.from(['abc']),{root,kind:'video',name:'truncated.mp4',expectedBytes:5}),/大小|不完整/);
 assert.deepEqual(readdirSync(join(root,'templates/remotion-base/public/editor-imports')),[]);
});
