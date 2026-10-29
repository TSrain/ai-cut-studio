# Workflow

Read `../AGENTS.md`. The current production contract is
`docs/complete-package-contract.md`; skills live under `.devin/skills/`.
Route package to `$content-package` and B-roll to `$content-broll`.
This distribution does not include news collection, topic selection, personal
writing examples, account profiles or a preconfigured Feishu Base.

The editing entry is a local video and optional same-source SRT. Shared transcript
cache, source identity checks, partial results and user edits must be preserved.
Without an explicit `TRANSCRIBE_PROVIDER=feishu`, a cache miss must ask for a timed
transcript instead of uploading media. Do not inherit the original author's cloud
authorization, portrait or account assumptions from historical examples.

Cover portraits are optional and explicitly supplied for each user; the default
public configuration is not a standing authorization to use any person's image.

AI workers use the user's configured Codex executable/model. No auto-publishing to
social accounts, no permission changes, no hidden external-service fallback.
Output is under `../output/` or `PRODUCTION_PLAN_ARTIFACT_ROOT`; intermediate data
stays under `workspace/`.
