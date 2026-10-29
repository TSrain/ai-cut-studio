import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDocument,
  saveDocument,
  loadDocument,
} from "../lib/editor-store.mjs";
const mod = await import("../lib/production-plan-jobs.mjs").catch(() => ({}));
function setup() {
  const root = mkdtempSync(join(tmpdir(), "plan-jobs-")),
    options = {
      root,
      rootDir: join(root, "index"),
      artifactRoot: join(root, "artifacts"),
      assetSourceRoot: root,
      autoStart: false,
    };
  mkdirSync(join(root, "templates/remotion-base/public"), { recursive: true });
  const document = saveDocument(
    createDocument({
      id: "p",
      name: "P",
      canvas: {
        width: 1920,
        height: 1080,
        fps: { num: 30, den: 1 },
        durationFrames: 300,
      },
      productionPlan: {
        approval: "approved",
        shots: [
          {
            id: "s",
            title: "演示",
            approval: "approved",
            visualRequirement: "展现",
            slots: [{ id: "v", type: "video", description: "素材" }],
            timing: {
              manual: true,
              status: "manual",
              ranges: [{ id: "r", startFrame: 30, durationFrames: 60 }],
            },
          },
        ],
      },
    }),
    options,
  );
  return {
    options,
    document,
    service: mod.createProductionPlanService?.(options),
  };
}
test("new package enables BGM and preserves explicit scope", async () => {
 for(const scope of [undefined,{bgm:false}]) {
  const {service,document}=setup();
  const {job}=await service.createJob({projectId:'p',revision:document.revision,kind:'package',...(scope?{scope}:{})});
  const snap=JSON.parse(readFileSync(job.snapshotPath));
  assert.equal(job.bgmPlanVersion,1);assert.equal(snap.bgmPlanVersion,1);
  if(scope)assert.equal(snap.scope.bgm,false);
  service.close?.();
 }
});
