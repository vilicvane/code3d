# R-028 — Viewport local coordinate reference

Status: complete

## Feedback

Add an X, Y, Z coordinate reference to the viewport so the orientation of the
current local frame remains visible while inspecting and orbiting a model.

## Resolution

- The viewport shows a compact positive-axis triad in its lower-left corner.
  Conventional red, green, and blue markers identify X, Y, and Z without
  competing with model geometry or viewport tools.
- The triad follows the selected occurrence's full world transform, including
  parent transforms, so it represents that occurrence's local coordinate frame.
  With no selected occurrence it falls back to the world frame.
- Axis projections and depth emphasis update every animation frame as the camera
  or selected model moves. The reference remains a fixed-size DOM overlay and is
  excluded from exported model images.

## Verification

- The app build passes in an independent worktree.
- Host Chrome shows the reference bound to the selected Box, and a real orbit
  gesture changes all projected axis endpoints consistently with the new view.
- The dedicated render-image viewport does not create the coordinate-reference
  overlay.
