"""Production worker boundary tests. No network or model required here."""
import copy
import json
import os
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from tools import editor_plan
from tools import editor_plan_runtime as runtime


def document():
    return {"id": "project-a", "revision": 8,
            "canvas": {"width": 1280, "height": 720, "fps": {"num": 30, "den": 1}, "durationFrames": 900},
            "source": None, "instances": [],
            "productionPlan": {"schemaVersion": 1, "revision": 3, "script": "当前正文。",
                "approval": "draft", "coverage": "hybrid", "shots": [{
                    "id": "stable-shot", "order": 1, "title": "当前镜头", "narration": "当前正文。",
                    "visualRequirement": "当前画面要求", "mediaDescription": "当前素材说明",
                    "requirementVersion": 4, "approval": "draft", "keyframes": [],
                    "timing": {"status": "unaligned", "ranges": [], "manual": False},
                    "slots": [{"id": "stable-slot", "type": "video", "description": "画面", "requirementVersion": 4}],
                    "bindings": [], "candidates": [], "upstream": {"packageShot": {
                        "镜号": "old-number", "锚点口播": "旧正文。", "功能": "具象", "形式": "🤖图库",
                        "动作": "实录", "必要性": "展示实际动作", "理想画面": "旧画面", "创意方案": "旧方案",
                        "素材路由": {"route": "个人素材", "source": "用户提供", "status": "planned"}}}}]}}


def snapshot(kind="package"):
    return {"jobId": "job-a", "projectId": "project-a", "kind": kind, "workflowMode": "legacy-visual-v1", "document": document()}


class BoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_new_package_disables_templates_but_keeps_media_and_prompts(self):
        data = snapshot(); data.pop('workflowMode')
        data['scope'] = {'templates': True, 'sound': False}
        data['templateReviewVersion'] = 1
        request = runtime.prepare_external_job(data, self.root / 'no-templates')
        self.assertFalse(request['scope']['templates'])
        self.assertTrue(request['scope']['footage'])
        self.assertTrue(request['scope']['aiVideo'])
        self.assertTrue(request['scope']['cover'])
        self.assertFalse(request['scope']['sound'])
        self.assertNotIn('templateReviewVersion', request)
        self.assertNotIn('templateCatalogPath', request)
        frozen = json.loads(Path(request['projectSnapshotPath']).read_text())
        self.assertFalse(frozen['scope']['templates'])
        self.assertNotIn('templateReviewVersion', frozen)
        self.assertEqual(data['scope']['templates'], True)

    def test_snapshot_identity_and_selector_must_be_explicit(self):
        bad = snapshot(); bad["projectId"] = "other"
        with self.assertRaisesRegex(ValueError, "project"):
            runtime.validate_snapshot(bad)
        bad = snapshot("broll"); bad["slotId"] = "stable-slot"
        with self.assertRaisesRegex(ValueError, "shotId"):
            runtime.validate_snapshot(bad)
        bad = snapshot("broll"); bad.update(shotId="stable-shot", scope={"camera": True})
        with self.assertRaisesRegex(ValueError, "scope"):
            runtime.validate_snapshot(bad)

    def test_repeated_actual_uses_require_target_and_use_actual_duration(self):
        data = snapshot("broll"); data["shotId"] = "stable-shot"
        shot = data["document"]["productionPlan"]["shots"][0]
        shot["bindings"] = [{"instanceId": "use-1"}, {"instanceId": "use-2"}]
        data["document"]["instances"] = [
            {"id": "use-1", "startFrame": 100, "durationFrames": 120},
            {"id": "use-2", "startFrame": 300, "durationFrames": 60}]
        with self.assertRaisesRegex(ValueError, "instanceId|rangeId"):
            runtime.target_range(data)
        data["instanceId"] = "use-1"
        target = runtime.target_range(data)
        self.assertEqual(target["durationFrames"], 120)
        self.assertEqual(target["durationSeconds"], 4.0)
        self.assertEqual(target["startFrame"], 100)

    def test_export_uses_latest_plan_not_original_package_and_keeps_ids(self):
        old = self.root / "old"; old.mkdir()
        (old / "shots.json").write_text('{"old":true}')
        data = snapshot(); data["basePackageRoot"] = str(old)
        original = (old / "shots.json").read_bytes()
        request = runtime.prepare_external_job(data, self.root / "output")
        current = json.loads(Path(request["projectPlanPath"]).read_text())
        canonical = json.loads((Path(request["packageRoot"]) / "shots.json").read_text())
        self.assertEqual(current, data["document"]["productionPlan"])
        self.assertEqual(canonical["shots"][0]["镜号"], "stable-shot")
        self.assertEqual(canonical["shots"][0]["理想画面"], "当前画面要求")
        self.assertEqual(canonical["shots"][0]["锚点口播"], "当前正文。")
        self.assertEqual(Path(request["finalScriptPath"]).read_text(), "当前正文。")
        self.assertEqual((old / "shots.json").read_bytes(), original)
        self.assertIsNone(request["videoPath"])

    def test_worker_exposes_snapshot_project_and_shared_catalog(self):
        data = snapshot(); data["catalog"] = {"project": [{"id": "owned", "scope": "project"}], "shared": [{"id": "shared", "scope": "shared"}]}
        request = runtime.prepare_external_job(data, self.root / "catalog-output")
        self.assertEqual(request["materialCatalog"], data["catalog"])
        self.assertEqual(json.loads(Path(request["projectSnapshotPath"]).read_text())["catalog"], data["catalog"])

    def test_command_is_argv_and_full_skill_invocation(self):
        request = self.root / "input $(touch danger).json"
        command = runtime.workflow_command("package", request, self.root, self.root)
        self.assertIn("exec", command)
        self.assertTrue(command[-1].startswith("调用 $content-package，external_job: " + str(request)))
        self.assertNotIn("shell", command)

    def test_package_cli_defaults_to_v2_streaming_and_rejects_v1(self):
        from unittest.mock import patch
        base = ['jobs', '--project-id', 'project-a', '--kind', 'package']
        for extra, streaming in (([], True), (['--no-streaming-apply'], False)):
            with self.subTest(extra=extra), patch.object(editor_plan, 'api',
                    side_effect=[{'document': document()}, {'ok': True}]) as api:
                editor_plan.execute(editor_plan.parser().parse_args(base + extra))
                payload = api.call_args.args[2]
                self.assertEqual(payload['packageOrchestrationVersion'], 2)
                self.assertIs(payload['packageExecution']['streamingApply'], streaming)
                self.assertEqual(payload['packageExecution']['reusePolicy'], 'same-run')
        with patch.object(editor_plan, 'api', return_value={'document': document()}) as api:
            with self.assertRaises(ValueError):
                editor_plan.execute(editor_plan.parser().parse_args(
                    base + ['--package-orchestration-version', '1']))
            self.assertEqual(api.call_count, 1)  # Read is allowed; no job POST occurred.

    def test_atomic_results_stable_ids_and_rejected_identity(self):
        store = runtime.ResultStore(self.root, snapshot())
        item = {"kind": "candidate", "shotId": "stable-shot", "slotId": "stable-slot",
                "candidate": {"url": "https://example.com/item", "title": "候选", "reason": "动作匹配"}}
        first = store.publish(item); second = store.publish(item)
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(len(list((self.root / "results").glob("*.json"))), 1)
        self.assertEqual(first["state"], "pending")
        self.assertEqual(first["requirementVersion"], 4)
        self.assertFalse(list(self.root.rglob("*.tmp")))
        with self.assertRaisesRegex(ValueError, "identity"):
            store.publish(dict(item, projectId="other"))

    def test_model_claim_cannot_mark_unprobed_media_ready(self):
        store = runtime.ResultStore(self.root, snapshot())
        with self.assertRaisesRegex(ValueError, "probe|evidence"):
            store.publish({"kind": "media", "shotId": "stable-shot", "slotId": "stable-slot",
                "media": {"path": str(self.root / "not-real.mp4"), "sourceInSeconds": 0},
                "state": "ready", "technical": {"passed": True},
                "contentReview": {"passed": True, "evidence": "looks fine", "frames": []}})

    def test_resume_does_not_invent_approval_and_binds_current_versions(self):
        data = snapshot()
        out = self.root / "prior"
        runtime.prepare_external_job(data, out)
        runtime.atomic_json(out / "manifest.json", {"jobId": "job-a", "projectId": "project-a", "state": "waiting_approval", "results": []})
        request = runtime.prepare_external_job(data, self.root / "next", resume=out)
        self.assertNotIn("storyboardApprovalPath", request)
        data["document"]["productionPlan"]["shots"][0]["approval"] = "approved"
        request = runtime.prepare_external_job(data, self.root / "approved", resume=out)
        approval = json.loads(Path(request["storyboardApprovalPath"]).read_text())
        self.assertEqual(approval["status"], "approved")
        self.assertEqual(approval["requirementVersions"], {"stable-shot": 4})
        data["approval"] = {"status": "approved", "requirementVersions": {"stable-shot": 3}}
        with self.assertRaisesRegex(ValueError, "approval"):
            runtime.prepare_external_job(data, self.root / "stale", resume=out)

    def test_resume_pre_input_failure_skips_empty_outputs_but_missing_snapshot_cannot_reuse(self):
        prior = self.root / "pre-input-failure"; prior.mkdir()
        manifest = {"jobId": "old-job", "projectId": "project-a", "state": "failed", "stage": "failed", "results": [], "error": "missing input file"}
        runtime.atomic_json(prior / "manifest.json", manifest)
        store = runtime.ResultStore(self.root / "recognize-retry", snapshot("recognize"))
        self.assertEqual(runtime.resume_results(prior, store), [])
        skipped = runtime.read_json(store.root / "inputs/resume-view/skip.json")
        self.assertIn("no outputs", skipped["reason"])
        request = runtime.prepare_external_job(snapshot(), self.root / "package-retry", resume=prior)
        self.assertNotIn("resume", request)
        self.assertEqual(runtime.read_json(prior / "manifest.json"), manifest)
        manifest["results"] = [{"id": "old-result", "kind": "candidate"}]
        runtime.atomic_json(prior / "manifest.json", manifest)
        with self.assertRaisesRegex(ValueError, "snapshot"):
            runtime.resume_results(prior, store)
        manifest["results"] = []; runtime.atomic_json(prior / "manifest.json", manifest)
        runtime.atomic_json(prior / "result-manifest.json", {"files": [{"path": "/old.png", "sha256": "abc"}]})
        with self.assertRaisesRegex(ValueError, "snapshot"):
            runtime.prepare_external_job(snapshot(), self.root / "unsafe-retry", resume=prior)

    def test_mapping_split_cut_speed_and_manual_preservation(self):
        doc = document(); doc["source"] = {"path": "/voice.mp4", "startFrame": 0, "clips": [
            {"id": "a", "startFrame": 0, "durationFrames": 60, "sourceInFrame": 30},
            {"id": "b", "startFrame": 100, "durationFrames": 30, "sourceInFrame": 120}]}
        ranges = runtime.map_source_interval(doc, "/voice.mp4", 1.5, 4.5, "stable-shot")
        self.assertEqual([(r["startFrame"], r["durationFrames"]) for r in ranges], [(15, 45), (100, 15)])
        shot = doc["productionPlan"]["shots"][0]
        shot["timing"] = {"manual": True, "status": "manual", "ranges": [{"id": "mine", "startFrame": 9, "durationFrames": 17}]}
        self.assertEqual(runtime.alignment_result(doc, shot, {"start": 1.5, "end": 4.5, "confidence": 1}, "/voice.mp4")["alignment"]["timing"], shot["timing"])
        self.assertEqual(runtime.map_source_interval(doc, "/wrong.mp4", 1, 2, "stable-shot"), [])

    def test_cancel_stops_child_before_status_cancelled(self):
        store = runtime.ResultStore(self.root, snapshot())
        (self.root / "cancel.request").write_text("cancel")
        with self.assertRaises(runtime.WorkerCancelled):
            runtime.run_process(["python3", "-c", "import time; time.sleep(20)"], self.root, store)
        self.assertEqual(json.loads((self.root / "status.json").read_text())["state"], "cancelled")

    def test_recognition_decodes_frames_and_unknown_match_stays_pending(self):
        video = self.root / "misleading-name.mp4"
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "color=blue:s=1280x720:d=2", "-c:v", "libx264", str(video)], check=True)
        evidence = runtime.probe_and_sample(video, self.root / "evidence")
        self.assertEqual(evidence["width"], 1280)
        self.assertEqual(len(evidence["frames"]), 3)
        self.assertEqual(evidence["sha256"], runtime.digest(video))
        data = snapshot("recognize")
        data["mediaPaths"] = [str(video)]
        suggestion = {"shotId": "stable-shot", "slotId": "stable-slot", "sourceInSeconds": 0,
                      "sourceOutSeconds": 1, "evidence": "三帧均是蓝色", "uncertainties": [], "passed": True}
        item = runtime.recognition_result(data, video, evidence, suggestion)
        self.assertEqual(item["state"], "pending")
        data.update(shotId="stable-shot", slotId="stable-slot")
        self.assertEqual(runtime.recognition_result(data, video, evidence, suggestion)["state"], "ready")
        suggestion["sourceOutSeconds"] = 20
        with self.assertRaisesRegex(ValueError, "interval"):
            runtime.recognition_result(data, video, evidence, suggestion)

    def test_workflow_manifest_waiting_approval_imports_plan_without_faking_ready(self):
        data = snapshot(); out = self.root / "workflow"
        request = runtime.prepare_external_job(data, out)
        package = Path(request["packageRoot"])
        final = package / "final.md"; final.write_text("当前正文。")
        plan = package / "plan.md"; plan.write_text("逐句设计与真人保留")
        files = [final, plan, package / "shots.json"]
        manifest = {"state": "waiting_approval", "outputs": {"finalScriptPath": str(final), "planPath": str(plan), "shotsPath": str(package / "shots.json")},
                    "files": [{"path": str(p), "sha256": runtime.digest(p)} for p in files]}
        store = runtime.ResultStore(out, data)
        runtime.ingest_workflow_manifest(manifest, store)
        result = list(store.results.values())[0]
        self.assertEqual(result["kind"], "plan")
        self.assertEqual(result["plan"]["shots"][0]["id"], "stable-shot")
        self.assertEqual(result["plan"]["approval"], "waiting_approval")
        self.assertEqual(result["plan"]["shots"][0]["timing"]["ranges"], [])
        self.assertEqual(result["plan"]["shots"][0]["keyframes"], [])

    def test_progressive_candidates_survive_independent_failure(self):
        data = snapshot("broll"); store = runtime.ResultStore(self.root, data)
        progress = self.root / "progress"; progress.mkdir()
        runtime.atomic_json(progress / "candidate.json", {"kind": "candidate", "shotId": "stable-shot", "slotId": "stable-slot",
                     "candidate": {"url": "https://example.com/a", "title": "A", "reason": "动作一致"}})
        runtime.ingest_progress(store)
        runtime.atomic_json(progress / "bad.json", {"kind": "media", "shotId": "unknown", "media": {"path": "/missing"}, "state": "ready"})
        runtime.ingest_progress(store)
        manifest = store.finish("partial")
        self.assertEqual(len(manifest["results"]), 1)
        self.assertTrue((self.root / "progress-errors.json").exists())

    def test_resume_media_requires_matching_snapshot_dependencies_and_inputs(self):
        from unittest.mock import patch
        old = snapshot("broll"); old.update(dependencies={"stable-shot":"old-target"}, inputs=[{"path":"/old/source.mp4","sha256":"source-v1"}])
        prior = self.root / "prior-resume"; prior.mkdir()
        runtime.atomic_json(prior / "input-snapshot.json", old)
        runtime.atomic_json(prior / "manifest.json", {"projectId":"project-a", "results":[{"id":"old-media", "kind":"media", "shotId":"stable-shot", "slotId":"stable-slot", "requirementVersion":4,"state":"ready","media":{"path":"/test.mov"}}]})
        variants = [("unchanged", {}, True), ("target", {"dependencies":{"stable-shot":"trimmed-target"}}, False), ("source", {"inputs":[{"path":"/new/source.mp4","sha256":"source-v2"}]}, False), ("relocated", {"inputs":[{"path":"/relocated/source.mp4","sha256":"source-v1"}]}, True), ("missing", {"dependencies":{}}, False)]
        for name, patch_data, allowed in variants:
            with self.subTest(name=name), patch.object(runtime,"require_media_evidence"):
                data = copy.deepcopy(old); data.update(patch_data, jobId="new-job")
                store=runtime.ResultStore(self.root / name, data)
                self.assertEqual(bool(runtime.resume_results(prior,store)),allowed)
                self.assertEqual(bool(store.results),allowed)

    def test_old_review_revalidated_at_progress_and_manifest_entries(self):
        from unittest.mock import patch
        video = self.root / "previous.mp4"
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "color=blue:s=1280x720:d=2", "-c:v", "libx264", str(video)], check=True)
        old = snapshot("broll"); old.update(shotId="stable-shot", slotId="stable-slot", dependencies={"stable-shot": "old"})
        old["document"]["productionPlan"]["shots"][0]["timing"] = {"status": "aligned", "manual": False, "ranges": [{"id": "r", "startFrame": 30, "durationFrames": 30}]}
        probe = runtime.probe_and_sample(video, self.root / "previous-evidence")
        suggestion = {"shotId": "stable-shot", "slotId": "stable-slot", "sourceInSeconds": 0, "sourceOutSeconds": 2, "passed": True, "evidence": "synthetic fixture", "uncertainties": []}
        item = runtime.recognition_result(old, video, probe, suggestion)
        item["contentReview"]["mediaSha256"] = probe["sha256"]
        current = copy.deepcopy(old); current["jobId"] = "new"; current["dependencies"]["stable-shot"] = "current"
        current["document"]["productionPlan"]["shots"][0]["timing"]["ranges"][0].update(startFrame=120,durationFrames=45)
        for entry in ("progress", "manifest"):
            store = runtime.ResultStore(self.root / entry, current)
            with patch.object(runtime, "model_json", side_effect=lambda store,prompt,schema,frames: {"passed": True, "evidence": "new reviewed fixture", "uncertainties": []} if "passed" in schema["properties"] else {"observations": [], "uncertainties": [], "samplingRequests": []}) as model:
                if entry == "progress":
                    runtime.atomic_json(store.root / "progress/media.json", item);runtime.ingest_progress(store)
                else:
                    # Independent output root: matching cache belongs to that job's parent.
                    runtime.ingest_workflow_manifest({"results": [item], "files": []}, store)
            self.assertGreater(model.call_count, 0)
            result = next(iter(store.results.values()))
            self.assertEqual(result["target"]["startFrame"],120)
            self.assertEqual(result["target"]["durationFrames"],45)
            self.assertTrue(result["reviewHistory"])
            self.assertNotEqual(result["contentReview"]["dependencyFingerprint"],item["contentReview"]["dependencyFingerprint"])

    def test_migrated_resume_uses_hash_verified_view_without_rewriting_history(self):
        import shutil
        old = self.root / "old/output"; data = snapshot(); runtime.prepare_external_job(data, old)
        preview = old / "preview.png"; preview.write_bytes(b"preview-fixture")
        timeline = old / "timeline.json"; timeline.write_text("{}")
        workflow = {"state": "waiting_selection", "files": [{"path": str(p), "sha256": runtime.digest(p)} for p in (preview,timeline)],
                    "choices": [{"id": "picked", "previewPath": str(preview)}], "outputs": {"timelinePath": str(timeline)}}
        runtime.atomic_json(old / "manifest.json", {"projectId": "project-a", "state": "waiting_selection", "results": []})
        runtime.atomic_json(old / "result-manifest.json", workflow)
        original = (old / "result-manifest.json").read_bytes()
        moved = self.root / "moved/output";shutil.copytree(old,moved);shutil.rmtree(old)
        data["jobId"] = "resume-new"; data["approval"] = {"selection": {"id": "picked", "previewPath": str(preview)}, "timing": {"status": "approved", "files": [{"path": str(timeline), "sha256": runtime.digest(moved / "timeline.json")} ]}}
        request = runtime.prepare_external_job(data,self.root / "new/output",resume=moved)
        self.assertEqual((moved / "result-manifest.json").read_bytes(),original)
        self.assertEqual(runtime.read_json(request["visualSelectionPath"])["selected"]["previewPath"],str((moved / "preview.png").resolve()))
        self.assertEqual(runtime.read_json(request["timingApprovalPath"])["files"][0]["path"],str((moved / "timeline.json").resolve()))
        self.assertTrue(Path(request["resume"]["workflowManifestPath"]).is_file())
        (moved / "preview.png").write_bytes(b"tampered")
        with self.assertRaisesRegex(ValueError,"hash"):
            runtime.prepare_external_job(data,self.root / "tampered/output",resume=moved)

    def test_progress_then_final_same_media_review_excludes_reason_and_derived_target(self):
        media = self.root / "identity.png"
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "color=blue:s=1280x720:d=0.1", "-frames:v", "1", str(media)],check=True)
        data = snapshot("broll");data.update(shotId="stable-shot",slotId="stable-slot")
        data["document"]["productionPlan"]["shots"][0]["timing"] = {"status":"aligned","manual":False,"ranges":[{"id":"r","startFrame":30,"durationFrames":120}]}
        store = runtime.ResultStore(self.root / "identity",data)
        item = {"kind":"media","shotId":"stable-shot","slotId":"stable-slot","state":"pending","requirementVersion":4,
                "media":{"path":str(media),"sourceInSeconds":0,"sourceOutSeconds":None},"reason":"progress explanation",
                "target":{"rangeId":"r","startFrame":30,"durationFrames":120,"durationSeconds":4},
                "technical":{"passed":True},"contentReview":{"passed":False,"evidence":"first explanation"}}
        first = store.publish(item); second = copy.deepcopy(item);second["target"].pop("durationSeconds");second["reason"]="final explanation";second["contentReview"]["evidence"]="same conclusion, final explanation"
        final = store.publish(second)
        self.assertEqual(first["id"],final["id"])
        self.assertEqual(first,final)
        self.assertEqual(len(store.results),1)
        self.assertNotIn("durationSeconds",first["target"])
        self.assertTrue(list((store.root / "result-updates").glob("*.json")))
        media.write_bytes(b"changed actual file identity")
        self.assertNotEqual(store.publish(second)["id"],first["id"])

    def test_ready_media_is_probed_by_adapter_not_trusted_boolean(self):
        video = self.root / "tiny.mp4"
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "color=red:s=1280x720:d=1", "-c:v", "libx264", str(video)], check=True)
        data = snapshot("broll"); store = runtime.ResultStore(self.root / "out", data)
        item = runtime.verify_result({"kind": "media", "shotId": "stable-shot", "slotId": "stable-slot", "media": {"path": str(video), "sourceInSeconds": 0},
                          "state": "ready", "contentReview": {"passed": True, "evidence": "未经目检的自称通过", "frames": []}}, store)
        self.assertFalse(item["contentReview"]["passed"])
        self.assertEqual(item["state"], "pending")
        self.assertTrue(item["technical"]["details"]["probePath"])

    def test_resume_rejects_changed_ready_file_and_preserves_current_requirements(self):
        data = snapshot(); prior = self.root / "prior"
        runtime.prepare_external_job(data, prior)
        missing = self.root / "missing.mp4"
        runtime.atomic_json(prior / "manifest.json", {"jobId": "job-a", "projectId": "project-a", "state": "partial", "results": [{"id": "old", "jobId": "job-a", "projectId": "project-a", "kind": "media", "shotId": "stable-shot", "requirementVersion": 4, "state": "ready", "media": {"path": str(missing), "sourceInSeconds": 0}, "technical": {"passed": True}, "contentReview": {"passed": True}}]})
        store = runtime.ResultStore(self.root / "next", data)
        recovered = runtime.resume_results(prior, store)
        self.assertEqual(recovered, [])
        self.assertEqual(len(store.results), 0)

    def test_opaque_video_recognition_cannot_be_ready_for_current_overlay_slot(self):
        video = self.root / "opaque.mp4"
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "color=blue:s=1280x720:d=1", "-c:v", "libx264", str(video)], check=True)
        probe = runtime.probe_and_sample(video, self.root / "opaque-evidence")
        data = snapshot("recognize"); data.update(shotId="stable-shot", slotId="stable-slot")
        data["document"]["productionPlan"]["shots"][0]["slots"][0]["presentationMode"] = "overlay"
        suggestion = {"shotId": "stable-shot", "slotId": "stable-slot", "sourceInSeconds": 0, "sourceOutSeconds": 1,
                      "passed": True, "evidence": "Technical gate fixture: known blue image", "uncertainties": []}
        item = runtime.recognition_result(data, video, probe, suggestion)
        self.assertFalse(item["technical"]["passed"])
        self.assertEqual(item["state"], "pending")
        self.assertFalse(item["technical"]["details"]["hasAlpha"])
        self.assertTrue(item["technical"]["details"]["alphaWarning"])
        self.assertTrue(item["contentReview"]["passed"])  # Semantic boolean never overrides Alpha.
        with self.assertRaisesRegex(ValueError, "probe and visual evidence"):
            runtime.require_media_evidence(item)

    def test_transparent_image_overlay_allowed_in_recognition_and_generation(self):
        png = self.root / "transparent.png"
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "color=blue@0.35:s=1280x720:d=0.1,format=rgba", "-frames:v", "1", str(png)], check=True)
        webp = self.root / "transparent.webp"
        subprocess.run(["cwebp", "-quiet", "-lossless", str(png), "-o", str(webp)], check=True)
        data = snapshot("broll"); data.update(shotId="stable-shot", slotId="stable-slot")
        data["document"]["productionPlan"]["shots"][0]["slots"][0].update(type="image", presentationMode="overlay")
        store = runtime.ResultStore(self.root / "image-job", data)
        for image in (png, webp):
            with self.subTest(extension=image.suffix):
                probe = runtime.probe_and_sample(image, self.root / (image.suffix[1:] + "-evidence"))
                self.assertEqual(probe["kind"], "image")
                self.assertTrue(probe["hasAlpha"])
                suggestion = {"shotId": "stable-shot", "slotId": "stable-slot", "sourceInSeconds": 0, "sourceOutSeconds": None,
                              "passed": True, "evidence": "Technical gate fixture: known transparent blue image", "uncertainties": []}
                item = runtime.recognition_result(data, image, probe, suggestion)
                self.assertTrue(item["technical"]["passed"])
                item["contentReview"].update(mediaSha256=probe["sha256"])
                verified = runtime.verify_result(item, store)
                self.assertTrue(verified["technical"]["passed"])
                self.assertIsNone(verified["technical"]["details"]["alphaWarning"])
                self.assertEqual(verified["state"], "ready")
                runtime.require_media_evidence(verified)

    def test_palette_png_uses_decoded_transparency(self):
        import struct, zlib
        def chunk(kind, payload):
            return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xffffffff)
        for opacity in (100, 255):
            with self.subTest(opacity=opacity):
                image = self.root / ("palette-%s.png" % opacity)
                image.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB",1280,720,8,3,0,0,0)) + chunk(b"PLTE", b"\x00\x00\xff") + chunk(b"tRNS", bytes([opacity])) + chunk(b"IDAT", zlib.compress((b"\x00" + bytes(1280)) * 720)) + chunk(b"IEND", b""))
                probe = runtime.probe_and_sample(image, self.root / ("palette-evidence-%s" % opacity))
                self.assertEqual(probe["streams"][0]["pix_fmt"], "pal8")
                self.assertEqual(probe["hasAlpha"], opacity < 255)
                self.assertEqual(probe["alphaMin"], opacity)
                data = snapshot("broll"); data.update(shotId="stable-shot", slotId="stable-slot")
                data["document"]["productionPlan"]["shots"][0]["slots"][0].update(type="image", presentationMode="overlay")
                suggestion = {"shotId":"stable-shot", "slotId":"stable-slot", "sourceInSeconds":0, "sourceOutSeconds":None, "passed":True,"evidence":"Known indexed PNG fixture", "uncertainties":[]}
                item = runtime.recognition_result(data, image, probe, suggestion)
                self.assertEqual(item["technical"]["passed"], opacity < 255)
                item["contentReview"].update(mediaSha256=probe["sha256"])
                verified = runtime.verify_result(item, runtime.ResultStore(self.root / ("palette-job-%s" % opacity), data))
                self.assertEqual(verified["technical"]["passed"], opacity < 255)
                if opacity < 255:
                    runtime.require_media_evidence(verified)

    def test_rgba_opaque_image_has_no_actual_transparency(self):
        png = self.root / "opaque-rgba.png"
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "color=red@1:s=1280x720:d=0.1,format=rgba", "-frames:v", "1", str(png)], check=True)
        probe = runtime.probe_and_sample(png, self.root / "opaque-image-evidence")
        self.assertFalse(probe["hasAlpha"])
        self.assertTrue(probe["alphaChannel"])
        self.assertEqual(probe["alphaMin"], 255)

    def test_overlay_requires_actual_alpha_not_container_name(self):
        video = self.root / "opaque.mov"
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "color=red:s=1280x720:d=1", "-c:v", "libx264", str(video)], check=True)
        data = snapshot("broll")
        data["document"]["productionPlan"]["shots"][0]["slots"][0]["presentationMode"] = "overlay"
        store = runtime.ResultStore(self.root / "output", data)
        item = runtime.verify_result({"kind": "media", "shotId": "stable-shot", "slotId": "stable-slot", "media": {"path": str(video), "sourceInSeconds": 0}, "state": "ready"}, store)
        self.assertFalse(item["technical"]["passed"])
        self.assertFalse(item["technical"]["details"]["hasAlpha"])
        self.assertEqual(item["state"], "pending")

    def test_backend_inputs_hash_is_authoritative(self):
        path = self.root / "input.bin"; path.write_bytes(b"original")
        data = snapshot(); data["inputs"] = [{"path": str(path), "sha256": "0" * 64}]
        with self.assertRaisesRegex(ValueError, "hash"):
            runtime.verify_inputs(data)

    def test_package_draft_uses_bound_srt_cues_for_preview_without_approval(self):
        data = snapshot(); source = self.root / "talk.mov"; source.write_bytes(b"fixture")
        srt = self.root / "talk.srt"
        srt.write_text("1\n00:00:01,000 --> 00:00:02,000\n当前\n\n2\n00:00:02,100 --> 00:00:03,000\n正文。\n")
        data.update(videoPath=str(source), sourceSrtPath=str(srt), inputs=[{"path": str(srt), "sha256": runtime.digest(srt)}])
        data["document"]["source"] = {"path": str(source), "clips": [{"id": "cut", "startFrame": 0, "sourceInFrame": 45, "durationFrames": 45}]}
        canonical = runtime.canonical_package(data["document"]["productionPlan"])
        canonical["shots"][0]["sourceCueIds"] = [1, 2]
        store = runtime.ResultStore(self.root / "preview", data)
        plan = runtime.plan_from_package(canonical, store, "waiting_approval")
        shot = plan["shots"][0]
        self.assertEqual(shot["timing"]["status"], "review")
        self.assertEqual([(r["startFrame"], r["durationFrames"]) for r in shot["timing"]["ranges"]], [(0, 45)])
        self.assertEqual(shot["anchor"]["startSeconds"], 1)
        self.assertEqual(shot["anchor"]["endSeconds"], 3)
        self.assertEqual(shot["anchor"]["transcriptHash"], runtime.digest(srt))
        self.assertEqual(shot["approval"], "waiting_approval")
        self.assertFalse(shot["keyframes"])
        self.assertIsNone(runtime.target_range(dict(data, shotId="stable-shot", document=dict(data["document"], productionPlan=plan))))
        self.assertEqual(data["document"]["productionPlan"]["shots"][0]["timing"]["ranges"], [])
        for change in ["manual", "mismatch", "wrong-cues", "changed-hash", "different-video", "missing-srt"]:
            current = copy.deepcopy(data); rows = copy.deepcopy(canonical)
            old = current["document"]["productionPlan"]["shots"][0]
            if change == "manual": old["timing"] = {"status": "manual", "manual": True, "ranges": [{"id": "manual", "startFrame": 200, "durationFrames": 60}]}
            if change == "mismatch": rows["shots"][0]["锚点口播"] = "数字已改成两百"
            if change == "wrong-cues": rows["shots"][0]["sourceCueIds"] = [1, 99]
            if change == "changed-hash": current["inputs"][0]["sha256"] = "0" * 64
            if change == "different-video": current["videoPath"] = str(self.root / "different.mov")
            if change == "missing-srt": current.pop("sourceSrtPath")
            got = runtime.plan_from_package(rows, runtime.ResultStore(self.root / change, current), "waiting_approval")["shots"][0]
            self.assertEqual(got["timing"], old["timing"], change)
            self.assertNotIn("anchor", got, change)

    def test_narration_alignment_cannot_expand_or_confirm_draft_effect(self):
        doc = document(); video = self.root / "voice.mov"; video.write_bytes(b"recording")
        doc["source"] = {"path": str(video), "durationFrames": 150}
        srt = self.root / "voice.srt"; srt.write_text("1\n00:00:01,000 --> 00:00:03,000\n当前正文。\n")
        data = {"document": doc, "videoPath": str(video), "sourceSrtPath": str(srt), "inputs": [{"path": str(srt), "sha256": runtime.digest(srt)}]}
        shot = doc["productionPlan"]["shots"][0]
        shot["effectTiming"] = {"status": "draft", "sourcePath": str(video), "startSeconds": 1.5,
            "changeSeconds": 1.8, "holdSeconds": 2, "endSeconds": 2.5,
            "evidence": {"sourceSha256": runtime.digest(video), "transcriptHash": runtime.digest(srt), "sourceCueIds": [1], "reason": "强调"}}
        shot["timing"] = {"status": "review", "manual": False, "ranges": runtime.map_source_interval(doc, str(video), 1.5, 2.5, shot["id"])}
        row = {"start": 1, "end": 3, "confidence": 1}
        result = runtime.alignment_result(doc, shot, row, str(video), runtime.digest(srt), data=data)["alignment"]
        self.assertEqual(result["anchor"]["startSeconds"], 1)
        self.assertEqual(result["timing"], shot["timing"])
        shot["effectTiming"]["status"] = "confirmed"
        result = runtime.alignment_result(doc, shot, row, str(video), runtime.digest(srt), data=data)["alignment"]
        self.assertEqual(result["timing"]["status"], "aligned")
        self.assertEqual(result["timing"]["ranges"][0]["durationFrames"], 30)
        video.write_bytes(b"replaced recording")
        result = runtime.alignment_result(doc, shot, row, str(video), runtime.digest(srt), data=data)["alignment"]
        self.assertEqual(result["timing"]["status"], "review")

    def test_explicit_range_selector_cannot_render_draft_preview(self):
        data = snapshot("broll"); data.update(shotId="stable-shot", rangeId="draft-effect")
        shot = data["document"]["productionPlan"]["shots"][0]
        shot["timing"] = {"status": "review", "manual": False, "ranges": [{"id": "draft-effect", "startFrame": 30, "durationFrames": 60}]}
        self.assertIsNone(runtime.target_range(data))
        for kind in ("align", "package", "recognize", "broll"):
            current = dict(data, kind=kind)
            self.assertEqual(runtime.validate_snapshot(current)["rangeId"], "draft-effect")
            self.assertIsNone(runtime.target_range(current))
        from unittest.mock import patch
        media = self.root / "draft.png"; media.write_bytes(b"fixture")
        probe = {"kind": "image", "durationSeconds": 0, "width": 1280, "height": 720, "hasAlpha": False,
                 "probePath": str(self.root / "probe.json"), "sha256": runtime.digest(media)}
        with patch.object(runtime, "probe_and_sample", return_value=probe):
            verified = runtime.verify_result({"kind": "media", "shotId": "stable-shot", "slotId": "stable-slot",
                "media": {"path": str(media)}, "state": "ready"}, runtime.ResultStore(self.root / "draft-media", data))
        self.assertFalse(verified["technical"]["passed"])
        self.assertEqual(verified["state"], "pending")
        shot["timing"]["status"] = "aligned"
        self.assertEqual(runtime.target_range(data)["durationFrames"], 60)

    def test_effect_window_separate_from_narration_and_preserves_manual(self):
        data = snapshot()
        source = self.root / "talk.mov"; source.write_bytes(b"recording")
        srt = self.root / "talk.srt"
        srt.write_text("1\n00:00:01,000 --> 00:00:03,000\n当前正文。\n")
        data.update(videoPath=str(source), sourceSrtPath=str(srt), inputs=[
            {"path": str(srt), "sha256": runtime.digest(srt)},
            {"path": str(source), "sha256": runtime.digest(source)}])
        data["document"]["source"] = {"path": str(source), "clips": [{"id": "cut", "startFrame": 0, "sourceInFrame": 0, "durationFrames": 150}]}
        rows = runtime.canonical_package(data["document"]["productionPlan"])
        row = rows["shots"][0]
        effect = {"sourcePath": str(source), "status": "draft",
                  "startSeconds": 1.5, "changeSeconds": 1.8, "holdSeconds": 2, "endSeconds": 2.5,
                  "evidence": {"sourceSha256": runtime.digest(source), "transcriptHash": runtime.digest(srt), "sourceCueIds": [1], "reason": "关键词强调"}}
        row.update(effectTiming=effect, cameraIntent={"action": "push", "anchor": "当前"},
                   presenterLayerIntent={"placement": "behind-presenter", "reason": "保持人脸可见"})
        plan = runtime.plan_from_package(rows, runtime.ResultStore(self.root / "effect", data), "waiting_approval")
        shot = plan["shots"][0]
        self.assertEqual(shot["anchor"]["startSeconds"], 1)
        self.assertEqual(shot["timing"]["ranges"][0]["durationFrames"], 30)
        self.assertEqual(shot["timing"]["ranges"][0]["startFrame"], 45)
        self.assertEqual(shot["effectTiming"], effect)
        self.assertEqual(runtime.canonical_package(plan)["shots"][0]["cameraIntent"], row["cameraIntent"])
        for status in ("manual", "aligned"):
            current = copy.deepcopy(data)
            existing = current["document"]["productionPlan"]["shots"][0]
            existing["timing"] = {"status": status, "manual": status == "manual", "ranges": [{"id": "edited", "startFrame": 5, "durationFrames": 10}]}
            result = runtime.plan_from_package(rows, runtime.ResultStore(self.root / status, current), "waiting_approval")
            if status == "manual":
                self.assertEqual(result["shots"][0]["timing"], existing["timing"])
            else:
                self.assertEqual(result["shots"][0]["timing"]["status"], "review")
                self.assertEqual(result["shots"][0]["timing"]["ranges"][0]["startFrame"], 45)
        inherited = copy.deepcopy(data)
        old = inherited["document"]["productionPlan"]["shots"][0]
        old["anchor"] = {"sourcePath": str(source), "startSeconds": 1, "endSeconds": 3, "confidence": 1}
        old["timing"] = {"status": "aligned", "manual": False, "ranges": [{"id": "narration", "startFrame": 30, "durationFrames": 60}]}
        updated = runtime.plan_from_package(rows, runtime.ResultStore(self.root / "inherited", inherited), "waiting_approval")
        self.assertEqual(updated["shots"][0]["anchor"], old["anchor"])
        self.assertEqual(updated["shots"][0]["timing"]["ranges"][0]["durationFrames"], 30)
        old["bindings"] = [{"instanceId": "actual-use"}]
        inherited["document"]["instances"] = [{"id": "actual-use", "startFrame": 30, "durationFrames": 60}]
        bound = runtime.plan_from_package(rows, runtime.ResultStore(self.root / "bound", inherited), "waiting_approval")
        self.assertEqual(bound["shots"][0]["timing"], old["timing"])
        for key, value in (("sourceSha256", "0" * 64), ("endSeconds", 1), ("changeSeconds", float("nan"))):
            invalid = copy.deepcopy(rows); invalid["shots"][0]["effectTiming"]["evidence" if key == "sourceSha256" else key] = value if key != "sourceSha256" else dict(effect["evidence"], sourceSha256=value)
            with self.assertRaisesRegex(ValueError, "effectTiming"):
                runtime.plan_from_package(invalid, runtime.ResultStore(self.root / key, data), "waiting_approval")

    def test_canonical_intent_deletion_does_not_resurrect_upstream(self):
        data = snapshot(); shot = data["document"]["productionPlan"]["shots"][0]
        for key in ("effectTiming", "cameraIntent", "presenterLayerIntent"):
            shot["upstream"]["packageShot"][key] = {"old": True}
        canonical = runtime.canonical_package(data["document"]["productionPlan"])
        row = canonical["shots"][0]
        for key in ("effectTiming", "cameraIntent", "presenterLayerIntent"):
            self.assertNotIn(key, row)
        self.assertEqual(set(row["deletedPlanningFields"]), {"effectTiming", "cameraIntent", "presenterLayerIntent"})
        # A concurrent/current value cannot be resurrected by historical transport data.
        shot["cameraIntent"] = {"old": True}
        plan = runtime.plan_from_package(canonical, runtime.ResultStore(self.root / "deletion", data), "plan_only")
        self.assertNotIn("cameraIntent", plan["shots"][0])
        self.assertNotIn("cameraIntent", runtime.canonical_package(plan)["shots"][0])
        # Missing optional fields in an old package do not request deletion.
        row.pop("deletedPlanningFields")
        plan = runtime.plan_from_package(canonical, runtime.ResultStore(self.root / "legacy-absence", data), "plan_only")
        self.assertEqual(plan["shots"][0]["cameraIntent"], {"old": True})

    def test_plan_only_never_invents_approved_or_reuses_unverified_keyframe(self):
        store = runtime.ResultStore(self.root, snapshot())
        canonical = runtime.canonical_package(store.snapshot["document"]["productionPlan"])
        canonical["shots"][0]["keyframe"] = "/missing.png"
        plan = runtime.plan_from_package(canonical, store, "plan_only")
        self.assertEqual(plan["approval"], "draft")
        self.assertFalse(plan["shots"][0]["keyframes"])

    def test_media_result_pending_ready_change_gets_new_id(self):
        store = runtime.ResultStore(self.root, snapshot())
        item = {"kind": "candidate", "shotId": "stable-shot", "slotId": "stable-slot", "candidate": {"url": "https://example.com/a"}, "state": "pending"}
        first = store.publish(item)
        item["state"] = "ignored"
        changed = store.publish(item)
        self.assertNotEqual(first["id"], changed["id"])

    def test_worker_missing_manifest_is_failed_without_erasing_progress(self):
        executable = self.root / "fake-codex"
        executable.write_text('#!/bin/sh\nexit 0\n'); executable.chmod(0o755)
        source = self.root / "source.json"; runtime.atomic_json(source, snapshot())
        from unittest.mock import patch
        with patch.dict(os.environ, {"EDITOR_PLAN_CODEX_BIN": str(executable)}):
            result = runtime.worker(source, self.root / "output")
        self.assertEqual(result["state"], "failed")
        self.assertIn("result-manifest", result["error"])

    def test_model_prompt_separated_from_variadic_images(self):
        from unittest.mock import patch
        store = runtime.ResultStore(self.root, snapshot())
        commands = []
        def execute(command, cwd, actual_store):
            commands.append(command)
            runtime.atomic_json(actual_store.root / "model-response.json", {"ok": True})
        with patch.object(runtime, "run_process", execute):
            runtime.model_json(store, "真实提示", {"type": "object"}, [{"path": "/sample.png"}])
        self.assertEqual(commands[0][-2:], ["--", "真实提示"])

    def test_alignment_full_worker_outputs_structural_delta_and_reorder(self):
        from unittest.mock import patch
        data = snapshot("align"); doc = data["document"]
        doc["source"] = {"path": "/voice.mov", "startFrame": 0}
        srt = self.root / "real.srt"
        srt.write_text("1\n00:00:08,600 --> 00:00:10,000\n当前\n\n2\n00:00:10,000 --> 00:00:12,560\n正文。\n\n3\n00:00:20,000 --> 00:00:22,000\n新增录音句。\n")
        data["sourceSrtPath"] = str(srt)
        review = {"shots": [{"shotId": "stable-shot", "actualNarration": "当前正文。", "change": "moved", "confidence": 1,
                             "critical": False, "reason": "准确重排", "cueIds": ["cue-00001", "cue-00002"]}],
                  "addedSections": [{"cueIds": ["cue-00003"], "narration": "新增录音句。", "confidence": 1, "reason": "新增"}], "removedSections": []}
        output = {"degraded": False, "warnings": ["单调对齐置信不足"], "shots": [{"镜号": "stable-shot", "start": 24, "end": 29, "confidence": .2}]}
        store = runtime.ResultStore(self.root / "job", data)
        with patch("tools.broll_timeline.build", return_value=output), patch.object(runtime, "model_json", return_value=review):
            result = runtime.align_plan(store)
        alignment = next(r for r in result["results"] if r["kind"] == "alignment")
        self.assertEqual(alignment["alignment"]["anchor"]["startSeconds"], 8.6)
        self.assertEqual(alignment["alignment"]["anchor"]["endSeconds"], 12.56)
        self.assertEqual(alignment["alignment"]["anchor"]["confidence"], 1)
        self.assertEqual(result["processed"], 1)
        self.assertEqual(len(result["contentChanges"]["addedShots"]), 1)
        self.assertTrue(next(r for r in result["results"] if r["kind"] == "plan")["requiresConfirmation"])

    def test_align_job_passes_existing_srt_explicitly(self):
        from unittest.mock import patch
        with patch.object(editor_plan, "api", side_effect=[{"document": document()}, {}]) as call:
            editor_plan.execute(editor_plan.parser().parse_args(["jobs", "--project-id", "project-a", "--kind", "align", "--source-srt", "/known.srt"]))
        self.assertEqual(call.call_args_list[-1].args[2]["sourceSrtPath"], "/known.srt")

    def test_timing_approval_request_uses_real_manifest_files(self):
        data = {"state": "waiting_approval", "outputs": {"timelinePath": "/timeline.json", "shotsPath": "/shots.json"},
                "files": [{"path": "/timeline.json", "sha256": "a" * 64}, {"path": "/shots.json", "sha256": "b" * 64}]}
        requests = runtime.approval_requests(data)
        self.assertEqual(requests[0]["type"], "timing")
        self.assertEqual(requests[0]["files"], data["files"])

    def test_manifest_output_cannot_escape_task_without_declared_source(self):
        external = self.root / "outside.txt"; external.write_text("actual")
        out = self.root / "out"; out.mkdir()
        manifest = {"outputs": {"planPath": str(external)}, "files": [{"path": str(external), "sha256": runtime.digest(external)}]}
        with self.assertRaisesRegex(ValueError, "outputRoot"):
            runtime.verify_manifest_files(manifest, out)

    def test_terminal_status_clears_model_pid(self):
        store = runtime.ResultStore(self.root, snapshot())
        store.update(pid=900)
        self.assertIsNone(store.finish("complete")["pid"])

    def test_empty_v2_log_evidence_is_valid_but_empty_deliverables_are_not(self):
        log = self.root / 'alignment.log'; log.write_bytes(b'')
        record = {'path': str(log), 'sha256': runtime.digest(log), 'role': 'package-v2-evidence'}
        runtime.verify_manifest_files({'files': [record]}, self.root)
        for change in ({'role': 'production-plan'}, {'sha256': '0' * 64}):
            with self.assertRaisesRegex(ValueError, 'file/hash'):
                runtime.verify_manifest_files({'files': [{**record, **change}]}, self.root)

    def test_reordered_cross_cue_exact_text_uses_real_srt_bounds(self):
        cues = [{"id": "cue-1", "start": 8.6, "end": 10, "text": "移动的这句，"},
                {"id": "cue-2", "start": 10, "end": 12.56, "text": "现在先说。"},
                {"id": "cue-3", "start": 20, "end": 23, "text": "最后结尾。"}]
        located = runtime.locate_actual_narration(cues, "移动的这句现在先说")
        self.assertEqual(located["start"], 8.6)
        self.assertEqual(located["end"], 12.56)
        self.assertEqual(located["cueIds"], ["cue-1", "cue-2"])
        self.assertIsNone(runtime.locate_actual_narration(cues + cues[:2], "移动的这句现在先说"))

    def test_alignment_delta_preserves_media_and_requires_explicit_confirmation(self):
        data = snapshot("align"); doc = data["document"]
        doc["source"] = {"path": "/voice.mov", "startFrame": 0}
        doc["productionPlan"]["shots"][0]["bindings"] = [{"id": "actual", "path": "/original.mov"}]
        cues = [{"id": "cue-1", "start": 2, "end": 4, "text": "新增录音句。"}]
        review = {"shots": [{"shotId": "stable-shot", "actualNarration": "", "change": "removed", "confidence": .99}],
                  "addedSections": [{"cueIds": ["cue-1"], "narration": "新增录音句。", "confidence": .99, "reason": "新增"}],
                  "removedSections": [{"shotId": "stable-shot", "confidence": .99, "reason": "删除"}]}
        original = copy.deepcopy(doc["productionPlan"])
        delta = runtime.alignment_plan_delta(data, review, cues, "transcript-hash", "/review.json")
        self.assertTrue(delta["requiresConfirmation"])
        self.assertEqual(delta["basePlan"], original)
        added = next(s for s in delta["plan"]["shots"] if s["id"] != "stable-shot")
        self.assertEqual(added["approval"], "needs_design")
        self.assertEqual(added["anchor"]["startSeconds"], 2)
        self.assertEqual(added["slots"], [])
        removed = next(s for s in delta["plan"]["shots"] if s["id"] == "stable-shot")
        self.assertTrue(removed["cancelled"])
        self.assertEqual(removed["bindings"], original["shots"][0]["bindings"])
        self.assertEqual(doc["productionPlan"], original)
        again = runtime.alignment_plan_delta(data, review, cues, "transcript-hash", "/review.json")
        self.assertEqual(added["id"], again["contentChanges"]["addedShots"][0]["shotId"])
        review["shots"][0].update(change="moved", actualNarration="当前正文。", confidence=.4)
        self.assertNotIn("stable-shot", runtime.alignment_plan_delta(data, review, cues, "transcript-hash", "/review.json")["contentChanges"]["removedShotIds"])

    def test_script_delta_keeps_unrepresented_talking_head_and_replaces_deleted_section(self):
        data = snapshot("align"); data["audioPath"] = "/voice.wav"
        plan = data["document"]["productionPlan"]; plan["script"] = "## 完整口播脚本\n\n开场真人。当前正文。结尾真人。"
        cues = [{"id": "cue-1", "start": 0, "end": 1, "text": "开场真人。"},
                {"id": "cue-2", "start": 1, "end": 2, "text": "新增录音句。"},
                {"id": "cue-3", "start": 2, "end": 3, "text": "结尾真人。"}]
        review = {"shots": [{"shotId": "stable-shot", "actualNarration": "", "change": "removed", "confidence": 1}],
                  "addedSections": [{"cueIds": ["cue-2"], "narration": "新增录音句。", "confidence": 1}],
                  "removedSections": [{"shotId": "stable-shot", "confidence": 1}]}
        delta = runtime.alignment_plan_delta(data, review, cues, "rawhash", "/review.json")
        self.assertEqual(delta["plan"]["script"], "## 完整口播脚本\n\n开场真人。\n新增录音句。\n结尾真人。")
        self.assertFalse(delta["scriptPatch"]["conflicts"])
        self.assertEqual(delta["scriptPatch"]["baseScript"], plan["script"])
        request = runtime.prepare_external_job(dict(data, kind="package", audioPath=None, document=dict(data["document"], productionPlan=delta["plan"])), self.root / "next")
        self.assertEqual(request["phase"], "package")
        self.assertEqual(Path(request["finalScriptPath"]).read_text(), delta["plan"]["script"])

    def test_actual_python_delta_backend_confirmation_next_worker_script(self):
        import wave
        backend = runtime.ROOT.parent / "visualization/tools/lib"
        if not (backend / "production-plan-jobs.mjs").is_file():
            self.skipTest("isolated backend checkout unavailable")
        media = self.root / "fixture.wav"
        with wave.open(str(media), "wb") as wav:
            wav.setparams((1, 2, 8000, 0, "NONE", "not compressed")); wav.writeframes(b"\0\0" * 24000)
        fixture = document(); fixture["revision"] = 0; fixture["name"] = "Synthetic script delta"; fixture["productionPlan"]["script"] = "## 完整口播脚本\n\n开场真人。当前正文。结尾真人。"
        (self.root / "document-input.json").write_text(json.dumps(fixture))
        imports = 'import {createDocument,saveDocument} from ' + json.dumps((backend / "editor-store.mjs").as_uri()) + ';import {createProductionPlanService} from ' + json.dumps((backend / "production-plan-jobs.mjs").as_uri()) + ';'
        setup = imports + """
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import {join} from 'node:path';
const root=process.argv[1],options={root,rootDir:join(root,'index'),artifactRoot:join(root,'artifacts'),assetSourceRoot:root,autoStart:false};
mkdirSync(join(root,'templates/remotion-base/public'),{recursive:true});
const document=saveDocument(createDocument(JSON.parse(readFileSync(join(root,'document-input.json')))),options),service=createProductionPlanService(options);
const {job}=await service.createJob({projectId:document.id,revision:document.revision,kind:'align',audioPath:process.argv[2]});
writeFileSync(join(root,'test-state.json'),JSON.stringify({options,job}));process.stdout.write(readFileSync(job.snapshotPath));
"""
        prepared = subprocess.run(["node", "--input-type=module", "-e", setup, str(self.root), str(media)], capture_output=True, text=True)
        self.assertEqual(prepared.returncode, 0, prepared.stderr)
        data = json.loads(prepared.stdout)
        cues = [{"id": "c1", "start": 0, "end": 1, "text": "开场真人。"}, {"id": "c2", "start": 1, "end": 2, "text": "新增录音句。"}, {"id": "c3", "start": 2, "end": 3, "text": "结尾真人。"}]
        review = {"shots": [{"shotId": "stable-shot", "actualNarration": "", "change": "removed", "confidence": 1}], "addedSections": [{"cueIds": ["c2"], "narration": "新增录音句。", "confidence": 1}], "removedSections": [{"shotId": "stable-shot", "confidence": 1}]}
        delta = runtime.ResultStore(self.root / "worker", data).publish(runtime.alignment_plan_delta(data, review, cues, "raw", "/review.json"))
        (self.root / "delta.json").write_text(json.dumps(delta))
        apply = imports + """
import {readFileSync} from 'node:fs';import {join} from 'node:path';
const root=process.argv[1],{options,job}=JSON.parse(readFileSync(join(root,'test-state.json'))),service=createProductionPlanService(options),result=JSON.parse(readFileSync(join(root,'delta.json')));
let {document}=await service.ingest({projectId:job.projectId,jobId:job.id,results:[result]});const before=document.productionPlan.script;
({document}=await service.applyResults({projectId:job.projectId,revision:document.revision,operation:{type:'apply-results',resultIds:[result.id]}}));
const next=await service.createJob({projectId:job.projectId,revision:document.revision,kind:'package'});process.stdout.write(JSON.stringify({before,document,snapshot:JSON.parse(readFileSync(next.job.snapshotPath))}));
"""
        result = json.loads(subprocess.run(["node", "--input-type=module", "-e", apply, str(self.root)], check=True, capture_output=True, text=True).stdout)
        self.assertIn("当前正文", result["before"])
        self.assertNotIn("当前正文", result["snapshot"]["document"]["productionPlan"]["script"])
        self.assertIn("开场真人。\n新增录音句。\n结尾真人。", result["document"]["productionPlan"]["script"])
        request = runtime.prepare_external_job(result["snapshot"], self.root / "next-worker")
        self.assertEqual(Path(request["finalScriptPath"]).read_text(), result["document"]["productionPlan"]["script"])

    def test_consecutive_recorded_additions_same_offset_keep_cue_order(self):
        base = document()["productionPlan"]; base["script"] = "开场真人。结尾真人。"
        cues = [{"id": "c1", "start": 0, "end": 1, "text": "开场真人。"},
                {"id": "c2", "start": 1, "end": 2, "text": "新增甲。"},
                {"id": "c3", "start": 2, "end": 3, "text": "新增乙。"},
                {"id": "c4", "start": 3, "end": 4, "text": "结尾真人。"}]
        changes = {"removedShotIds": [], "addedShots": [
            {"shotId": "new-b", "cueIds": ["c3"], "narration": "新增乙。"},
            {"shotId": "new-a", "cueIds": ["c2"], "narration": "新增甲。"}]}
        patch = runtime.recorded_script_patch(base, changes, cues, {})
        self.assertFalse(patch["conflicts"])
        self.assertEqual(patch["candidateScript"], "开场真人。\n新增甲。\n新增乙。\n结尾真人。")
        changes["addedShots"].reverse()
        self.assertEqual(runtime.recorded_script_patch(base, changes, cues, {})["candidateScript"], patch["candidateScript"])

    def test_recorded_reorder_keeps_uncovered_prose_and_separates_added_paragraphs(self):
        data = snapshot("align"); plan = data["document"]["productionPlan"]
        plan["script"] = "## 完整口播脚本\n\n开场真人\n段落甲\n中间真人\n段落乙\n结尾真人\n\n## 备注\n仅给制作人员看"
        plan["shots"] = [dict(plan["shots"][0], id="a", narration="段落甲"),
                         dict(plan["shots"][0], id="b", narration="段落乙", order=2)]
        texts = ["开场真人", "段落乙", "中间真人", "段落甲", "新增甲", "新增乙", "结尾真人"]
        cues = [dict(id=f"c{i}", start=i, end=i+1, text=text) for i, text in enumerate(texts)]
        review = {"shots": [dict(shotId="a", actualNarration="段落甲", cueIds=["c3"], change="moved", confidence=1),
                             dict(shotId="b", actualNarration="段落乙", cueIds=["c1"], change="moved", confidence=1)],
                  "removedSections": [], "addedSections": [dict(cueIds=["c5"], narration="新增乙", confidence=1),
                                                               dict(cueIds=["c4"], narration="新增甲", confidence=1)]}
        delta = runtime.alignment_plan_delta(data, review, cues, "hash", "/review.json")
        expected = "## 完整口播脚本\n\n开场真人\n段落乙\n中间真人\n段落甲\n新增甲\n新增乙\n结尾真人\n\n## 备注\n仅给制作人员看"
        self.assertFalse(delta["scriptPatch"]["conflicts"])
        self.assertEqual(delta["plan"]["script"], expected)
        candidate = plan["script"]
        for patch in sorted(delta["scriptPatch"]["patches"], key=lambda p: p["start"], reverse=True):
            self.assertEqual(candidate[patch["start"]:patch["end"]], patch["before"])
            candidate = candidate[:patch["start"]] + patch["after"] + candidate[patch["end"]:]
        self.assertEqual(candidate, expected)

    def test_reorder_only_emits_delta_and_ambiguous_uncovered_prose_conflicts(self):
        data = snapshot("align"); plan = data["document"]["productionPlan"]
        plan["script"] = "开场真人\n段落甲\n未被录音定位的真人全文\n段落乙\n结尾真人"
        plan["shots"] = [dict(plan["shots"][0], id="a", narration="段落甲"), dict(plan["shots"][0], id="b", narration="段落乙", order=2)]
        cues = [dict(id=f"c{i}", start=i, end=i+1, text=text) for i, text in enumerate(["段落乙", "段落甲"])]
        review = {"shots": [dict(shotId="a", actualNarration="段落甲", cueIds=["c1"], change="moved", confidence=1),
                             dict(shotId="b", actualNarration="段落乙", cueIds=["c0"], change="moved", confidence=1)], "addedSections": [], "removedSections": []}
        delta = runtime.alignment_plan_delta(data, review, cues, "hash", "/review.json")
        self.assertIsNotNone(delta)
        self.assertTrue(delta["scriptPatch"]["conflicts"])
        self.assertEqual(delta["plan"]["script"], plan["script"])
        plan["script"] = "开场真人\n段落甲\n段落乙\n结尾真人"
        delta = runtime.alignment_plan_delta(data, review, cues, "hash", "/review.json")
        self.assertFalse(delta["scriptPatch"]["conflicts"])
        self.assertEqual(delta["plan"]["script"], "开场真人\n段落乙\n段落甲\n结尾真人")
        plan["script"] = "开场真人\n段落甲\n段落甲\n段落乙\n结尾真人"
        delta = runtime.alignment_plan_delta(data, review, cues, "hash", "/review.json")
        self.assertTrue(delta["scriptPatch"]["conflicts"])
        self.assertEqual(delta["plan"]["script"], plan["script"])

    def test_script_delta_ambiguous_original_keeps_explicit_conflict(self):
        data = snapshot("align"); data["audioPath"] = "/voice.wav"
        data["document"]["productionPlan"]["script"] = "当前正文。真人。当前正文。"
        review = {"shots": [{"shotId": "stable-shot", "actualNarration": "", "change": "removed", "confidence": 1}],
                  "addedSections": [], "removedSections": [{"shotId": "stable-shot", "confidence": 1}]}
        delta = runtime.alignment_plan_delta(data, review, [], "hash", "/review.json")
        self.assertEqual(delta["plan"]["script"], data["document"]["productionPlan"]["script"])
        self.assertTrue(delta["scriptPatch"]["conflicts"])

    def test_source_media_trim_maps_to_timeline_zero(self):
        doc = document(); doc["source"] = {"path": "/voice.mov", "startFrame": 60}
        self.assertEqual(runtime.map_source_interval(doc, "/voice.mov", 2, 3, "stable-shot")[0]["startFrame"], 0)

    def test_timing_approval_is_separate_from_design_approval(self):
        from unittest.mock import patch
        timing = {"status": "approved", "files": [{"path": "/timing.json", "sha256": "a" * 64}]}
        with patch.object(editor_plan, "api", side_effect=[{"document": document()}, {}]) as call:
            editor_plan.execute(editor_plan.parser().parse_args(["approve", "--project-id", "project-a", "--timing", json.dumps(timing)]))
        operation = call.call_args_list[-1].args[2]["operation"]
        self.assertEqual(operation["timing"], timing)
        self.assertNotIn("shotIds", operation)
        self.assertNotIn("selection", operation)

    def test_discover_unique_binding_never_picks_most_recent(self):
        from unittest.mock import patch
        responses = [[{"id": "project-a", "name": "A"}, {"id": "project-b", "name": "B"}],
                     {"document": {"projectBinding": {"scriptId": "SC-1234"}}},
                     {"document": {"projectBinding": {"scriptId": "SC-9999"}}}]
        with patch.object(editor_plan, "api", side_effect=responses) as calls:
            result = editor_plan.execute(editor_plan.parser().parse_args(["discover", "--script-id", "SC-1234"]))
        self.assertEqual(result["projectId"], "project-a")
        self.assertEqual(len(calls.call_args_list), 3)
        responses[2]["document"]["projectBinding"]["scriptId"] = "SC-1234"
        with patch.object(editor_plan, "api", side_effect=responses):
            result = editor_plan.execute(editor_plan.parser().parse_args(["discover", "--script-id", "SC-1234"]))
        self.assertEqual(result["status"], "ambiguous")
        self.assertIsNone(result["projectId"])

    def test_alignment_critical_changes_require_review_but_not_unrelated_shots(self):
        result = {"kind": "alignment", "shotId": "stable-shot", "alignment": {"timing": {"status": "aligned", "ranges": [{"id": "r", "startFrame": 0, "durationFrames": 30}], "manual": False}}}
        decision = {"shotId": "stable-shot", "critical": True, "reason": "口播从五个改成六个", "actualNarration": "有六个。"}
        runtime.apply_alignment_review(result, decision)
        self.assertEqual(result["alignment"]["timing"]["status"], "review")
        self.assertEqual(result["alignment"]["suggestedRanges"][0]["durationFrames"], 30)
        self.assertFalse(result["alignment"]["timing"]["ranges"])

    def test_project_cache_reuses_media_analysis_separately_from_changed_requirements(self):
        from unittest.mock import patch
        video = self.root / "source.mp4"
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "color=blue:s=1280x720:d=2", "-c:v", "libx264", str(video)], check=True)
        first = snapshot("recognize"); first["analysisCacheDir"] = str(self.root / "shared")
        second = copy.deepcopy(first); second["jobId"] = "job-b"
        second["document"]["productionPlan"]["shots"][0]["visualRequirement"] = "新要求"
        calls = []
        response = {"observations": [{"startSeconds": 0, "endSeconds": 2, "description": "纯蓝色"}], "uncertainties": [], "samplingRequests": []}
        with patch.object(runtime, "model_json", lambda *args: calls.append(args) or response):
            a = runtime.media_analysis(runtime.ResultStore(self.root / "one", first), video)
            b = runtime.media_analysis(runtime.ResultStore(self.root / "two", second), video)
        self.assertEqual(len(calls), 1)
        self.assertEqual(a[0]["frames"], b[0]["frames"])
        self.assertNotEqual(runtime.requirement_fingerprint(first), runtime.requirement_fingerprint(second))
        second["document"]["productionPlan"]["shots"][0]["visualRequirement"] = "当前画面要求"
        second["document"]["productionPlan"]["shots"][0]["candidates"] = [{"readAt": "now"}]
        second["document"]["productionPlan"]["shots"][0]["timing"]["ranges"] = [{"startFrame": 30}]
        self.assertEqual(runtime.requirement_fingerprint(first), runtime.requirement_fingerprint(second))

    def test_long_screen_recording_sampling_is_bounded_and_can_refine_segments(self):
        self.assertEqual(len(runtime.sample_times(2)), 3)
        moments = runtime.sample_times(180)
        self.assertGreater(len(moments), 3)
        self.assertLessEqual(len(moments), 20)
        self.assertLess(max(moments), 180)
        expanded = runtime.sample_times(180, [{"startSeconds": 21, "endSeconds": 24}])
        self.assertIn(22.5, expanded)
        self.assertLessEqual(len(expanded), 38)

    def test_multiple_long_video_segments_keep_distinct_result_ids(self):
        store = runtime.ResultStore(self.root, snapshot("recognize"))
        item = {"kind": "match", "shotId": "stable-shot", "slotId": "stable-slot", "media": {"path": "/long.mp4", "sourceInSeconds": 1, "sourceOutSeconds": 3}, "state": "pending"}
        first = store.publish(item)
        item["media"].update(sourceInSeconds=10, sourceOutSeconds=12)
        second = store.publish(item)
        self.assertNotEqual(first["id"], second["id"])

    def test_per_shot_design_selection_is_distinct_from_visual_style_selection(self):
        data = snapshot()
        shot = data["document"]["productionPlan"]["shots"][0]
        shot["alternatives"] = [{"id": "animation", "description": "文字动画"}, {"id": "realFootage", "description": "真实动作"}]
        data["approval"] = {"status": "approved", "requirementVersions": {"stable-shot": 4}, "selection": {"choices": {"stable-shot": "both"}}}
        request = runtime.prepare_external_job(data, self.root / "out")
        self.assertEqual(request["designSelection"]["stable-shot"], "both")
        self.assertNotIn("visualSelectionPath", request)
        options = runtime.read_json(request["visualOptionsPath"])
        self.assertEqual(options["shots"][0]["selection"], "both")
        data["approval"]["selection"]["choices"]["stable-shot"] = "imaginary"
        with self.assertRaisesRegex(ValueError, "selection"):
            runtime.prepare_external_job(data, self.root / "bad")

    def test_codex_runtime_prefers_explicit_and_then_bundled_current_cli(self):
        from unittest.mock import patch
        with patch.dict(os.environ, {"EDITOR_PLAN_CODEX_BIN": "/explicit/codex"}):
            self.assertEqual(runtime.codex_binary(), "/explicit/codex")
        with patch.dict(os.environ, {}, clear=True), patch("shutil.which", return_value="/usr/local/bin/codex"):
            self.assertEqual(runtime.codex_binary(), "/usr/local/bin/codex")

    def test_motion_receipt_accepts_only_explicit_isolated_visualization_root(self):
        from unittest.mock import patch
        from tools.package_contract import validate_motion_receipt, design_digest, PackageContractError
        out = self.root / "package"; out.mkdir()
        package = runtime.canonical_package(document()["productionPlan"])
        package["visual_contract"] = str(out / "visual-contract.json")
        runtime.atomic_json(out / "shots.json", package)
        runtime.atomic_json(out / "visual-contract.json", {})
        brief = out / "keyframe-brief.md"; brief.write_text("test")
        isolated = str((self.root / "visualization").resolve())
        receipt = {"state": "succeeded", "exitCode": 0, "cwd": isolated, "command": ["codex", "exec", "-C", isolated, "调用 $motion-broll，TEST"], "briefPath": str(brief), "briefSha256": runtime.digest(brief),
                   "phase": "keyframes-only", "designSha256": design_digest(package), "files": [{"path": str(out / "visual-contract.json"), "sha256": runtime.digest(out / "visual-contract.json")}]}
        runtime.atomic_json(out / "motion-execution-receipt.json", receipt)
        with patch.dict(os.environ, {"VISUALIZATION_ROOT": isolated}):
            validate_motion_receipt(out / "motion-execution-receipt.json", out / "shots.json")
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(PackageContractError):
                validate_motion_receipt(out / "motion-execution-receipt.json", out / "shots.json")

    def test_produced_media_gets_independent_actual_frame_review_before_ready(self):
        from unittest.mock import patch
        video = self.root / "blue.mp4"
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "color=blue:s=1280x720:d=1", "-c:v", "libx264", str(video)], check=True)
        store = runtime.ResultStore(self.root / "job", snapshot("broll"))
        observed = {"observations": [{"startSeconds": 0, "endSeconds": 1, "description": "蓝色背景"}], "uncertainties": [], "samplingRequests": []}
        reviews = []
        def review(actual_store, prompt, schema, frames):
            reviews.append(frames)
            return observed if "observations" in schema["properties"] else {"passed": True, "evidence": "实际帧满足当前指定需求", "uncertainties": []}
        with patch.object(runtime, "model_json", review):
            item = runtime.verify_result({"kind": "media", "shotId": "stable-shot", "slotId": "stable-slot", "media": {"path": str(video), "sourceInSeconds": 0}, "state": "ready"}, store, verify_content=True)
        self.assertEqual(len(reviews), 2)
        self.assertEqual(item["state"], "ready")
        self.assertTrue(item["contentReview"]["passed"])
        self.assertEqual(item["contentReview"]["mediaSha256"], runtime.digest(video))
        runtime.require_media_evidence(item)

    def test_recording_only_package_reuses_explicit_srt_without_own_asr(self):
        import wave
        from unittest.mock import patch
        audio = self.root / "voice.wav"
        with wave.open(str(audio), "wb") as stream:
            stream.setparams((1, 2, 16000, 0, "NONE", "not compressed")); stream.writeframes(b"\0\0" * 32000)
        srt = self.root / "voice.srt"; srt.write_text("1\n00:00:00,000 --> 00:00:02,000\n这是实际口播。\n")
        data = snapshot(); data["document"]["productionPlan"]["script"] = ""; data.update(audioPath=str(audio), sourceSrtPath=str(srt))
        with patch.dict(os.environ, {"TRANSCRIPT_CACHE_ROOT": str(self.root / "transcripts")}):
            request = runtime.prepare_external_job(data, self.root / "output")
        self.assertTrue(request["recordedScriptUnconfirmed"])
        self.assertIn("这是实际口播。", Path(request["finalScriptPath"]).read_text())
        self.assertEqual(data["document"]["productionPlan"]["script"], "")
        self.assertTrue(Path(request["sourceSrtPath"]).exists())

    def test_backend_absolute_video_takes_priority_over_relative_document_source(self):
        video = self.root / "voice.mp4"; video.write_bytes(b"actual-fixture")
        data = snapshot("align")
        data["videoPath"] = str(video)
        data["document"]["source"] = {"path": "editor-imports/voice.mp4", "startFrame": 0}
        data["inputs"] = [{"path": str(video), "sha256": runtime.digest(video)}]
        self.assertEqual(runtime.recording_path(data), str(video))
        self.assertEqual(runtime.input_files(data), [str(video)])
        self.assertTrue(runtime.verify_inputs(data))

    def test_cancel_running_process_retains_stop_receipt_and_no_live_child(self):
        import time
        store = runtime.ResultStore(self.root, snapshot())
        marker = self.root / "child-pid"
        def cancel_after_started():
            for _ in range(100):
                if marker.exists():
                    (self.root / "cancel.request").touch(); return
                time.sleep(.02)
        thread = threading.Thread(target=cancel_after_started, daemon=True); thread.start()
        script = "import os,time; from pathlib import Path; Path(" + repr(str(marker)) + ").write_text(str(os.getpid())); time.sleep(20)"
        with self.assertRaises(runtime.WorkerCancelled):
            runtime.run_process(["/opt/homebrew/bin/python3", "-c", script], self.root, store)
        thread.join(2)
        receipt = runtime.read_json(self.root / "cancellation-receipt.json")
        self.assertEqual(receipt["pid"], int(marker.read_text()))
        with self.assertRaises(ProcessLookupError):
            os.kill(receipt["pid"], 0)
        self.assertEqual(runtime.read_json(self.root / "status.json")["state"], "cancelled")

    def test_successful_motion_package_requires_native_handoff_and_receipt(self):
        data = snapshot(); out = self.root / "out"
        request = runtime.prepare_external_job(data, out)
        path = Path(request["packageRoot"]) / "shots.json"
        package = runtime.read_json(path); package["shots"][0]["形式"] = "🤖动效"
        runtime.atomic_json(path, package)
        manifest = {"state": "succeeded", "outputs": {"shotsPath": str(path)}, "files": [{"path": str(path), "sha256": runtime.digest(path)}]}
        with self.assertRaisesRegex(ValueError, "合同|回执|receipt"):
            runtime.ingest_workflow_manifest(manifest, runtime.ResultStore(out, data))

    def test_candidate_collector_hashes_recursive_files_never_directories(self):
        from tools.dispatch_motion_broll import collect_candidate_outputs
        preview = self.root / "preview"; (preview / "stills").mkdir(parents=True)
        (preview / "stills" / "shot.png").write_bytes(b"fixture")
        (preview / "contact-sheet.png").write_bytes(b"sheet")
        paths = collect_candidate_outputs(self.root)
        self.assertTrue(all(p.is_file() for p in paths))
        self.assertIn(preview / "stills" / "shot.png", paths)


class HttpTests(unittest.TestCase):
    def test_cli_read_edit_uses_target_cas_and_no_document_overwrite(self):
        calls = []
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                calls.append(("GET", self.path, None)); self.send_response(200); self.end_headers()
                self.wfile.write(json.dumps({"document": document()}).encode())
            def do_POST(self):
                payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                calls.append(("POST", self.path, payload)); self.send_response(200); self.end_headers()
                self.wfile.write(b'{"ok":true}')
            def log_message(self, *args):
                pass
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            with self.assertRaises(SystemExit):
                editor_plan.parser().parse_args(["read"])
            args = editor_plan.parser().parse_args(["--api-base", "http://127.0.0.1:" + str(server.server_port), "edit", "--project-id", "project-a", "--shot-id", "stable-shot", "--visual-requirement", "新画面"])
            editor_plan.execute(args)
            self.assertIn("projectId=project-a", calls[0][1])
            payload = calls[-1][2]
            self.assertEqual(payload["revision"], 8)
            self.assertEqual(payload["operation"]["type"], "edit-shot")
            self.assertEqual(payload["operation"]["base"]["visualRequirement"], "当前画面要求")
            self.assertNotIn("document", payload)
        finally:
            server.shutdown(); server.server_close(); thread.join()


if __name__ == "__main__":
    unittest.main()
