# Studio engineering and animation

Read `../AGENTS.md` first. The authoritative production contract is
`../workflow/docs/complete-package-contract.md`.

The editor is local-only. Keep loopback binding, same-origin checks and filesystem
boundaries; do not expose it with a public tunnel.

For talking-head camera/subtitle work read `.devin/skills/aroll-enhance/SKILL.md`.
For templates and B-roll read `.devin/skills/motion-broll/SKILL.md`; independent
animations use `.devin/skills/motion/SKILL.md`. External renderer skills are optional
knowledge sources, not bundled dependencies.

Use deterministic rendering and project-local assets. Preserve original media,
timeline, manual changes and track locks. Verify actual composite frames and
playback separately from automated technical tests. Do not silently change canvas
resolution or frame rate to improve speed.

New rendering work starts from `templates/remotion-base` or the optional
`templates/hyperframes-base`. Respect each renderer's license. Fonts are installed
by the root setup command with upstream licenses; personal media is never bundled.

Run `node --test tools/tests/*.test.mjs` from this directory for the extended suite.
Use the root `npm start` launcher so module and output paths are configured.
