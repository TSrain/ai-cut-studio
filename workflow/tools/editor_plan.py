#!/usr/bin/env python3
"""Read/change Motion Studio production plans through their shared CAS API."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode, quote, urlparse
from urllib.request import Request, urlopen

try:
    from . import editor_plan_runtime as runtime
except ImportError:
    import editor_plan_runtime as runtime


class APIError(RuntimeError):
    def __init__(self, status, body):
        super().__init__("HTTP " + str(status) + ": " + json.dumps(body, ensure_ascii=False))
        self.status = status
        self.body = body


def api(base, path, payload=None):
    parsed = urlparse(base)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("api-base must be http/https URL")
    request = Request(base.rstrip("/") + path, data=None if payload is None else json.dumps(payload, ensure_ascii=False, allow_nan=False).encode(),
                      headers={"Content-Type": "application/json"}, method="GET" if payload is None else "POST")
    try:
        with urlopen(request, timeout=30) as response:
            return json.load(response)
    except HTTPError as exc:
        body = exc.read().decode()
        try:
            body = json.loads(body)
        except ValueError:
            pass
        raise APIError(exc.code, body) from exc


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--api-base", default=os.environ.get("EDITOR_PLAN_API_BASE", "http://127.0.0.1:4358"))
    sub = p.add_subparsers(dest="command", required=True)
    for name in ("read", "current", "history", "edit", "import", "jobs", "approve", "apply", "ignore", "cancel", "retry", "action"):
        sp = sub.add_parser(name); sp.add_argument("--project-id", required=True)
        if name in {"edit", "import", "jobs", "approve", "apply", "ignore", "action"}:
            sp.add_argument("--revision", type=int)
        if name in {"edit", "jobs", "approve"}:
            sp.add_argument("--shot-id")
        if name == "edit":
            sp.add_argument("--visual-requirement"); sp.add_argument("--media-description")
        if name == "import":
            sp.add_argument("--plan", required=True); sp.add_argument("--base-plan"); sp.add_argument("--package")
        if name == "jobs":
            sp.add_argument("--kind", choices=["package", "broll", "recognize", "align", "footage"])
            for key in ("slot-id", "instance-id", "range-id", "candidate-id", "ai-video-candidate-id", "resume-job-id", "script", "instructions"):
                sp.add_argument("--" + key)
            sp.add_argument('--ai-video-prompt-version', type=int)
            sp.add_argument('--package-orchestration-version',type=int)
            sp.add_argument('--streaming-apply',action=argparse.BooleanOptionalAction,default=None)
            sp.add_argument('--reuse-policy',choices=['none','same-run','validated-project-artifacts'],default='same-run')
            sp.add_argument("--source-srt", help="existing shared raw transcript SRT")
            sp.add_argument("--delivery-manifest", help="animation-delivery.json: independent project timeline placement")
            sp.add_argument("--media-path", action="append", default=[])
            sp.add_argument("--media-id", action="append", default=[])
            sp.add_argument("--camera", action=argparse.BooleanOptionalAction, default=True)
            sp.add_argument("--sound", action=argparse.BooleanOptionalAction, default=True)
        if name == "approve":
            sp.add_argument("--selection", help="JSON selection object or @absolute/file.json")
            sp.add_argument("--timing", help="JSON timing approval object or @absolute/file.json")
        if name in {"apply", "ignore"}:
            sp.add_argument("--result-id", action="append", required=True)
            if name == "apply":
                sp.add_argument("--overrides")
        if name in {"cancel", "retry"}:
            sp.add_argument("--job-id", required=True)
        if name == "history":
            sp.add_argument("--version", required=True)
        if name == "action":
            sp.add_argument("--operation", required=True, help="JSON operation or @file")
    for name in ("list", "discover"):
        sp = sub.add_parser(name)
        if name == "discover":
            sp.add_argument("--script-id", required=True)
    worker = sub.add_parser("worker")
    worker.add_argument("--snapshot", required=True); worker.add_argument("--output-dir", required=True); worker.add_argument("--resume")
    return p


def json_arg(value):
    if value.startswith("@"):
        return runtime.read_json(value[1:])
    return json.loads(value)


def execute(args):
    if args.command == "worker":
        return runtime.worker(args.snapshot, args.output_dir, args.resume)
    if args.command in {"list", "discover"}:
        rows = api(args.api_base, "/api/editor/documents")
        projects = []
        for row in rows:
            pid = runtime.safe_id(row["id"], "projectId")
            if "scriptId" in row:
                script_id = row.get("scriptId")
            else:
                # Only read saved JSON metadata, never enumerate or decode private media.
                doc = api(args.api_base, "/api/editor/production-plan?" + urlencode({"projectId": pid}))["document"]
                script_id = (doc.get("projectBinding") or {}).get("scriptId")
            projects.append({"id": pid, "name": row.get("name", ""), "scriptId": script_id})
        if args.command == "list":
            return {"projects": projects}
        matches = [r for r in projects if r["scriptId"] == args.script_id]
        return {"status": "unique" if len(matches) == 1 else "ambiguous" if matches else "unbound",
                "projectId": matches[0]["id"] if len(matches) == 1 else None, "matches": matches, "scriptId": args.script_id}
    runtime.safe_id(args.project_id, "projectId")
    query = urlencode({"projectId": args.project_id})
    root = "/api/editor/production-plan"
    if args.command == "read":
        return api(args.api_base, root + "?" + query)
    if args.command in {"current", "history"}:
        if args.command == "history":
            query += "&" + urlencode({"version": args.version})
        return api(args.api_base, root + "/" + args.command + "?" + query)
    if args.command in {"cancel", "retry"}:
        runtime.safe_id(args.job_id, "jobId")
        return api(args.api_base, root + "/jobs/" + quote(args.job_id, safe="") + "/" + args.command, {"projectId": args.project_id})
    if args.command == "jobs" and not args.kind:
        return api(args.api_base, root + "/jobs?" + query)
    # Read latest exactly once; POST CAS reports 409 without silently rebasing user intent.
    current = api(args.api_base, root + "?" + query)["document"]
    revision = args.revision if args.revision is not None else current["revision"]
    payload = {"projectId": args.project_id, "revision": revision}
    if args.command == "jobs":
        payload["kind"] = args.kind
        if args.kind=='package' or args.package_orchestration_version is not None or args.streaming_apply is not None:
            if args.kind!='package':raise ValueError('package execution options require --kind package')
            version=runtime.orchestration_version({} if args.package_orchestration_version is None else {'packageOrchestrationVersion':args.package_orchestration_version})
            payload['packageOrchestrationVersion']=version
            payload['packageExecution']={'streamingApply':args.streaming_apply is not False,'reusePolicy':args.reuse_policy}
        for key in ("shot_id", "slot_id", "instance_id", "range_id", "candidate_id", "ai_video_candidate_id", "ai_video_prompt_version", "resume_job_id", "script", "instructions"):
            value = getattr(args, key)
            if value is not None:
                parts = key.split("_"); payload[parts[0] + "".join(p.title() for p in parts[1:])] = value
        if args.source_srt:
            payload["sourceSrtPath"] = args.source_srt
        if args.delivery_manifest:
            if args.kind != "recognize":
                raise ValueError("--delivery-manifest requires --kind recognize")
            payload["deliveryManifestPath"] = str(Path(args.delivery_manifest).resolve())
        payload["mediaPaths"] = args.media_path; payload["mediaIds"] = args.media_id
        payload["scope"] = {"camera": args.camera if not args.shot_id and not args.delivery_manifest else False,
                            "sound": args.sound if not args.shot_id and not args.delivery_manifest else False}
        runtime.validate_snapshot(dict(payload, jobId="cli-validation", document=current))
        return api(args.api_base, root + "/jobs", payload)
    if args.command == "edit":
        if not args.shot_id:
            raise ValueError("edit requires shotId")
        shot = next((s for s in current.get("productionPlan", {}).get("shots", []) if s["id"] == args.shot_id), None)
        if not shot:
            raise ValueError("unknown shotId")
        patch = {key: value for key, value in (("visualRequirement", args.visual_requirement), ("mediaDescription", args.media_description)) if value is not None}
        if not patch:
            raise ValueError("edit patch required")
        operation = {"type": "edit-shot", "shotId": args.shot_id, "patch": patch, "base": {key: shot.get(key) for key in patch}}
    elif args.command == "import":
        operation = {"type": "import-plan", "plan": runtime.read_json(args.plan)}
        if args.base_plan:
            operation["basePlan"] = runtime.read_json(args.base_plan)
        if args.package:
            operation["package"] = runtime.read_json(args.package)
    elif args.command == "approve":
        operation = {"type": "approve"}
        if args.shot_id:
            operation["shotIds"] = [args.shot_id]
        if args.selection:
            operation["selection"] = json_arg(args.selection)
        if args.timing:
            operation["timing"] = json_arg(args.timing)
    elif args.command in {"apply", "ignore"}:
        operation = {"type": args.command + "-results", "resultIds": args.result_id}
        if args.command == "apply" and args.overrides:
            operation["overrides"] = json_arg(args.overrides)
    else:
        operation = json_arg(args.operation)
    payload["operation"] = operation
    return api(args.api_base, root + "/action", payload)


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        value = execute(args)
        print(json.dumps(value, ensure_ascii=False, indent=2))
        if args.command == "worker":
            return 130 if value["state"] == "cancelled" else 1 if value["state"] in {"failed", "interrupted"} else 0
        return 0
    except (ValueError, OSError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
        return 2 if isinstance(exc, APIError) and exc.status == 409 else 1


if __name__ == "__main__":
    raise SystemExit(main())
