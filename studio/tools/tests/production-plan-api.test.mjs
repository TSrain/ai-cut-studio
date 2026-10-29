import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  productionPlanApi,
  productionPlanService,
} from "../lib/production-plan-api.mjs";
import { createDocument, saveDocument } from "../lib/editor-store.mjs";
test("HTTP browser preview serves real transparent WebM for authorized Alpha MOV with ranges", async () => {
  const root = mkdtempSync(join(tmpdir(), "plan-api-alpha-"));
  const opts = {
    root,
    rootDir: join(root, "index"),
    artifactRoot: join(root, "artifacts"),
    assetSourceRoot: root,
    autoStart: false,
  };
  mkdirSync(join(root, "templates/remotion-base/public"), { recursive: true });
  const source = join(root, "overlay.mov"),
    denied = join(root, "unrelated.mov");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=red@0.25:s=160x90:r=10,format=rgba",
    "-t",
    "1",
    "-c:v",
    "prores_ks",
    "-profile:v",
    "4",
    "-pix_fmt",
    "yuva444p10le",
    source,
  ]);
  const original = readFileSync(source);
  writeFileSync(denied, original);
  saveDocument(
    createDocument({
      id: "alpha",
      name: "Alpha",
      canvas: {
        width: 160,
        height: 90,
        fps: { num: 10, den: 1 },
        durationFrames: 10,
      },
      productionPlan: { shots: [{ id: "s", keyframes: [{ path: source }] }] },
    }),
    opts,
  );
  const service = productionPlanService(opts),
    before = service.read("alpha");
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    await productionPlanApi("production-plan/file", req, res, url, {}, opts);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/file?projectId=alpha&path=${encodeURIComponent(source)}`;
  try {
    const attachment = await fetch(`${url}&download=1`, {method:"HEAD"});
    assert.equal(attachment.status,200);
    assert.match(attachment.headers.get("content-disposition"), /^attachment;/);
    assert.match(attachment.headers.get("content-disposition"), /filename\*=UTF-8/);
    let response = await fetch(`${url}&browserPreview=1`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "video/webm");
    const preview = Buffer.from(await response.arrayBuffer());
    const previewFile = join(root, "received.webm");
    writeFileSync(previewFile, preview);
    const decoded = execFileSync("ffmpeg", [
      "-v",
      "error",
      "-c:v",
      "libvpx-vp9",
      "-i",
      previewFile,
      "-frames:v",
      "1",
      "-vf",
      "alphaextract",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "gray",
      "-",
    ]);
    assert.ok(decoded.length > 0);
    assert.ok(
      decoded.some((value) => value > 0 && value < 255),
      "preview must retain real translucent pixels",
    );
    response = await fetch(`${url}&browserPreview=1`, {
      headers: { range: "bytes=2-17" },
    });
    assert.equal(response.status, 206);
    assert.equal(
      response.headers.get("content-range"),
      `bytes 2-17/${preview.length}`,
    );
    assert.deepEqual(
      Buffer.from(await response.arrayBuffer()),
      preview.subarray(2, 18),
    );
    response = await fetch(`${url}&browserPreview=1`, { method: "HEAD" });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "video/webm");
    assert.equal(
      Number(response.headers.get("content-length")),
      preview.length,
    );
    response = await fetch(url);
    assert.equal(response.headers.get("content-type"), "video/quicktime");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), original);
    for (const method of ["GET", "HEAD"]) {
      response = await fetch(
        url.replace(encodeURIComponent(source), encodeURIComponent(denied)) +
          "&browserPreview=1",
        { method },
      );
      assert.equal(response.status, 400);
    }
    assert.deepEqual(service.read("alpha"), before);
    assert.deepEqual(readFileSync(source), original);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await service.close();
  }
});
test("HTTP plan routes expose current state, protect draft conflicts and support bounded file ranges", async () => {
  const root = mkdtempSync(join(tmpdir(), "plan-api-")),
    opts = {
      root,
      rootDir: join(root, "workspace/editor-projects"),
      artifactRoot: join(root, "artifacts"),
      assetSourceRoot: root,
      autoStart: false,
    };
  mkdirSync(join(root, "templates/remotion-base/public"), { recursive: true });
  writeFileSync(join(root, "preview.png"), "0123456789");
  const d = saveDocument(
    createDocument({
      id: "api",
      name: "API",
      canvas: {
        width: 1280,
        height: 720,
        fps: { num: 30, den: 1 },
        durationFrames: 90,
      },
      productionPlan: {
        shots: [
          {
            id: "s",
            visualRequirement: "base",
            slots:[{id:"media",type:"animation",description:"候选"}],
            candidates:[{id:"lead",slotId:"media",title:"未下载候选",url:"https://example.com/page",reason:"展示"}],
            keyframes: [{ path: join(root, "preview.png") }],
          },
        ],
      },
    }),
    opts,
  );
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    const url = new URL(req.url, "http://localhost");
    await productionPlanApi(
      url.pathname.slice("/api/editor/".length),
      req,
      res,
      url,
      raw ? JSON.parse(raw) : {},
      opts,
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/api/editor/production-plan`;
  try {
    let response = await fetch(`${base}?projectId=api`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).document.id, "api");
    response = await fetch(`${base}/candidate-media?projectId=api&shotId=s&candidateId=lead`);
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{candidateId:"lead",available:false});
    response = await fetch(`${base}/candidate-download`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({projectId:"api",shotId:"s",candidateId:"lead",downloadUrl:"https://example.com/injected.mp4"})});
    assert.equal(response.status,400);
    assert.match((await response.json()).error,/直接下载地址/);
    response = await fetch(`${base}/catalog?projectId=api`);
    assert.equal(response.status, 200);
    assert.ok(Array.isArray((await response.json()).project.items));
    const post = (body) =>
      fetch(`${base}/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    response = await post({
      projectId: "api",
      revision: d.revision,
      operation: {
        type: "edit-shot",
        shotId: "s",
        base: { visualRequirement: "base" },
        patch: { visualRequirement: "first" },
      },
    });
    const updated = await response.json();
    response = await post({
      projectId: "api",
      revision: updated.document.revision,
      operation: {
        type: "edit-shot",
        shotId: "s",
        base: { visualRequirement: "base" },
        patch: { visualRequirement: "second" },
      },
    });
    assert.equal(response.status, 409);
    const conflict = await response.json();
    assert.equal(
      conflict.document.productionPlan.shots[0].visualRequirement,
      "first",
    );
    assert.equal(conflict.conflicts[0].incoming, "second");
    response = await fetch(
      `${base}/file?projectId=api&path=${encodeURIComponent(join(root, "preview.png"))}`,
      { headers: { range: "bytes=2-5" } },
    );
    assert.equal(response.status, 206);
    assert.equal(await response.text(), "2345");
    response = await fetch(`${base}/file?projectId=api&path=/etc/passwd`);
    assert.equal(response.status, 400);
  } finally {
    productionPlanService(opts).close();
    await new Promise((r) => server.close(r));
  }
});
