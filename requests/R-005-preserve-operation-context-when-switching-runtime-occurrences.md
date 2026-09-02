# R-005 Preserve operation context when switching runtime occurrences

## Bug

- Place the editor caret on `mountingHoles` as an input of `cut(...)`.
- In the viewport, switch from the selected hole to another one of the four
  runtime occurrences, then move it with the gizmo.
- The rendered source context incorrectly jumps outside `cut(...)`, leaving
  only the four cylinders visible.

## Expected behavior

- Selecting a different runtime occurrence refines which instance the tool
  edits; it must not replace the caret-selected operation-input context.
- During the edit, the viewport should remain in the same `cut(...)` context,
  including its peer inputs and operation-specific visualization.
