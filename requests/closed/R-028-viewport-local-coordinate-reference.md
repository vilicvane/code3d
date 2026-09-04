# R-028 — Viewport local coordinate reference

Status: complete

## Feedback

Add an X, Y, Z coordinate reference to the viewport so the orientation of the
current local frame remains visible while inspecting and orbiting a model.

## Resolution

- The viewport shows a compact bidirectional axis triad in its lower-left
  corner. Positive ends retain the X, Y, and Z labels; negative ends use the
  corresponding outward arrowheads from the translation gizmo.
- Both controls share the same axis-color constants (`#ff665c`, `#70d98d`, and
  `#6c8cff`), so the reference cannot drift away from the active gizmo palette.
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
