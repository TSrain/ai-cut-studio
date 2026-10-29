---
name: cut-studio
description: Operate the local AI Cut Studio editor, imported SRT, talking-head roughcut and editable production workflow.
---

Read the root AGENTS.md and README.md. Use the root launcher to configure paths.
Do not assume any cloud account, paid service, private source library or portrait.

For manual editing start `npm start` and use the local editor. For roughcut read
`workflow/docs/native-roughcut.md`; use the existing project service and preserve
the original clip, user edits and shared transcript. A same-source SRT can be
registered by `workflow/tools/transcribe.py --audio <media> --source-srt <srt>
--out <internal-prefix>` without uploading media.

For production, read `workflow/.devin/skills/content-package/SKILL.md` and its
complete contract; run Python commands from `workflow/`. B-roll and footage have
their own sibling skills. For camera/captions use
`studio/.devin/skills/aroll-enhance/SKILL.md`; run rendering tools from `studio/`.

Optional integrations missing on this machine must be reported as blocked, not
silently replaced with an unreviewed tool. Never claim a model, image generation,
visual review, listening review or export was performed unless it actually was.
