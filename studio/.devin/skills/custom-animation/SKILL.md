---
name: custom-animation
description: Create optional custom B-roll for an existing local editor project using its original script and synchronized SRT.
---

Read `../workflow/docs/animation-design-standard.md` and
`../workflow/docs/animation-delivery-manifest.md` from the studio working directory.
The input is the original script, synchronized SRT, source video, actual canvas
and this user's requirements. No personal taste memory or reference library is
provided by this distribution.

Inspect the source at each segment's start, middle and end. Decide whether the
message benefits from animation; do not replace simple spoken content with slides.
Keep the presenter visible when required by the current contract. Use the shipped
Remotion template, or a separately configured HyperFrames environment. Keep every
render deterministic and assets local with documented reuse rights.

Create real previews, review the composite, then export actual media and the
`animation-delivery.json` manifest with project-time start and duration. Import
through the existing delivery-manifest API; preserve all previous media and manual
track settings. Report technical verification, frame inspection, continuous
playback and listening separately.

This is an optional user-invoked stage. Do not launch another model, assume access
to a specific subscription, or wait indefinitely for an external generation tool.
