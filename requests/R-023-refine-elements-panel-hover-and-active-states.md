# R-023 Refine Elements panel hover and active states

> Historical snapshot, frozen on 2026-09-05. Live requirement and discussion:
> [GitHub #4](https://github.com/vilicvane/code3d/issues/4).

## Bug

- When another element row is hovered or keyboard-focused, temporarily hide
  the model decoration for the source-active element. Show only the transient
  preview for the browsed element, then restore the active decoration when the
  transient preview ends.
- Keep the active source state visible in the list while its model decoration
  is temporarily suppressed; browsing another row must not change source or
  active-element identity.
- Replace the active row's nested rounded highlight with a color strip attached
  to the parent's left edge, following the visual treatment used by the file
  list.
- Adjust the row hover/focus treatment to work with the same left-strip layout
  so active and transient states remain distinct without overlapping rounded
  shapes.

## Open decisions

- The exact colors and priority when the hovered row is also the active row.
- Whether pointer hover and keyboard focus share one transient style or retain
  a small accessibility distinction such as a focus outline.
