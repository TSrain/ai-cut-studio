# AI Cut Studio

This is a local-first editing application, not a hosted multi-user service.

- `studio/` owns the timeline UI, media, templates and rendering.
- `workflow/` owns transcription reuse, roughcut analysis, production contracts and orchestration.
- Start from the repository root with `npm start`. Do not require another checkout or a particular home directory.
- Imported media and output stay local and ignored. Never add user projects, private prompts, portraits, account configuration or transcripts to Git.
- `TRANSCRIBE_PROVIDER=feishu` explicitly enables cloud transcription. Without it, import a matching SRT; do not upload source media.
- AI workers currently use the public Codex CLI. Do not force a model unavailable to the user's account.
- Before package work, read `workflow/docs/complete-package-contract.md` and the corresponding skill under `workflow/.devin/skills/`. For rendering, read `studio/AGENTS.md`.
- `CONTENT_WORKFLOW_ROOT` and `VISUALIZATION_ROOT` are resolved by the launcher. Relative examples in imported workflow documents assume the corresponding module's working directory.
- Preserve source clips, manual edits, locked tracks, cancellation and revision/CAS checks.
- Build: `npm run build`. Release tests: `npm test`. Extended suites: `npm run test:studio` and `npm run test:workflow`.
- Before publishing: `npm run audit:release`. Review license notices independently of test results.
- Do not claim visual/listening acceptance from tests or successful rendering.
