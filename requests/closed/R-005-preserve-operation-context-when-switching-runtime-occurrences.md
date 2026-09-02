# R-005 Preserve operation context when switching runtime occurrences

## Bug

- Place the editor caret on `mountingHoles` as an input of `cut(...)`.
- In the viewport, switch from the selected hole to another one of the four
  runtime occurrences, then move it with the gizmo.
- The rendered source context incorrectly jumps outside `cut(...)`, leaving
  only the four cylinders visible.

## Expected behavior

- When the current source target produces a collection of runtime occurrences,
  clicking any rendered focus occurrence makes it the active instance.
- Selecting a different runtime occurrence refines which instance the tool
  edits; it must not replace the caret-selected operation-input context.
- During the edit, the viewport should remain in the same `cut(...)` context,
  including its peer inputs and operation-specific visualization.

## Resolution

Viewport selection within a source view now changes only the selected runtime
occurrence. It does not navigate Monaco or replace the caret-selected source
target. Normal parameter write-back also carries the occurrence key across
recompilation, preserving both the operation context and selected instance.
The existing focus-only picking path provides direct switching for collections;
switching to a dimmed peer is the distinct source-target navigation described by
R-007.
