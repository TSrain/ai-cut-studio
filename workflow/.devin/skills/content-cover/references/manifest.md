# Cover helper and manifest contract

## Commands

```text
python3 tools/cover.py prepare --file <article.md> --slug <slug> [--groups 3] [--run-id <id>]
python3 tools/cover.py prepare --id SC-XXXX --slug <slug> [--groups 3]
python3 tools/cover.py validate --manifest <run>/manifest.json
```

`--groups` accepts 3–5 and defaults to 3. Prepare creates a new `workspace/covers/{slug}/{run-id}/`, never overwrites one, copies the source to `source.md`, writes provenance to `source.json`, refreshes the usable portrait inventory in `references.json`, and prints only the absolute run path to stdout. SC fetch uses `tools/package_io.py fetch` and does not mutate Feishu. Validation binds `source.md` to the SHA256 and `expected_groups` recorded in this run's `source.json`; the manifest must explicitly use the same expected group count.

## Required schema 2 `manifest.json`

```json
{
  "schema_version": 2,
  "expected_groups": 3,
  "status": "awaiting_selection",
  "content_brief": {
    "content_type": "AI婚礼纪念短片制作教程",
    "audience": "想为婚礼、求婚或纪念日制作纪念短片的人",
    "use_case": "把自己的照片做成有故事的纪念短片",
    "viewer_outcome": "看完能按三个步骤制作自己的AI纪念短片",
    "primary_promise": "教你三步做出AI婚礼纪念短片",
    "source_evidence": ["用 AI 做一支属于自己的婚礼纪念短片"]
  },
  "groups": [{
    "id": "A",
    "title": "三步做AI婚礼短片",
    "subject_mode": "person",
    "text_mode": "display",
    "cover_text": "三步做出\nAI婚礼短片",
    "references": ["/absolute/reference.png"],
    "source_excerpt": "用 AI 做一支属于自己的婚礼纪念短片",
    "hook": "三步完成自己的纪念短片",
    "images": {
      "3:4": "A/cover-3x4.png",
      "4:3": "A/cover-4x3.png"
    },
    "visual_review": {
      "passed": true,
      "notes": "Only fill after actual viewing"
    },
    "semantic_review": {
      "passed": true,
      "cover_readback": "这是教普通人制作AI婚礼纪念短片的教程",
      "title_cover_readback": "标题和画面共同承诺用三步教会制作",
      "notes": "受众、使用场景和观看结果与共享content_brief一致"
    }
  }]
}
```

`content_brief` is shared by the entire batch. `content_type`, `audience`, `use_case`, `viewer_outcome`, and `primary_promise` are required non-empty strings. `source_evidence` is a non-empty array whose entries are exact non-empty substrings of this run's `source.md`. Optional `method_summary` and `user_clarifications` may preserve secondary method details or explicit user corrections. Groups may vary expression and hook, but must not change the shared audience, use case, viewer outcome, or primary promise.

Use `subject_mode: "concept"` with an empty `references` array for concept groups. `text_mode: "none"` requires an empty `cover_text`; `short` and `display` require non-empty text. Group IDs and asset paths must be unique; the default run requires three complete groups. Image paths are relative to the run directory and must remain inside it. Every `source_excerpt` must be a non-empty exact substring of this run's `source.md`, and `hook` must be non-empty.

For a person group, `references` contains the original absolute portrait paths selected from this run's `references.json`. Each path must be present in that inventory and its current SHA256 must still match. If an original HEIC needs conversion for viewing or generation, keep the original HEIC path in `references` and record the derived PNG path separately in generation metadata; do not substitute the derived copy into the manifest reference list.

Titles are counted by visible characters: 10 or fewer is preferred, 11–15 produces a warning, and more than 15 fails. Every group requires exactly one 3:4 PNG and one 4:3 PNG. Both files must decode, have the exact ratio, and have a short side of at least 1080 pixels.

## Validation boundary

Each group requires `semantic_review` with boolean `passed` plus non-empty `cover_readback`, `title_cover_readback`, and `notes`. Set `passed: true` only after confirming that the cover alone and title-plus-cover both preserve the shared content promise. A strong misread blocks the group and requires a redesign; source text cannot rescue a misleading candidate.

The helper checks source snapshot hash and group-count binding, content brief fields and evidence, source excerpts, portrait inventory paths and hashes, schema consistency, containment, unique groups/assets, title limits, file presence, real decode, dimensions, exact ratio, minimum size, and text/reference compatibility. It uses ffprobe plus a real decode check and writes sibling `validation.json` with `machine_passed`, `agent_visual_attestation_passed`, `agent_semantic_attestation_passed`, `candidate_ready`, `user_approved: false`, `errors`, `warnings`, and `images`; exit code is 0 when machine checks pass and 1 on machine errors.

`visual_review.passed` is the current agent's attestation after actually opening the image, and `semantic_review.passed` is its attestation after the two readbacks. The helper reports them but cannot machine-prove aesthetics, identity, performance, legibility, semantic fidelity, or user approval. `candidate_ready` requires machine success plus all visual and semantic attestations; it never means the user selected or approved a candidate. Schema 1 manifests do not receive automatic compatibility or approval and existing runs remain unchanged.
