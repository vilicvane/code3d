# R-006 Show spatial tools only in a relative-position context

## Request

- Tools that edit relative position should appear only when the current source
  occurrence supplies a meaningful relative-position context.
- Selecting the declaration `const posts = ...` should not show a position
  gizmo: at that point there is no composition context for interpreting the
  position as relative to another object.
- Selecting the `posts` input inside `union(...)` should show the relevant
  spatial tools because that operation-input occurrence provides the required
  context.

## Design implication

- Tool availability belongs to the selected source occurrence and its role in
  an operation, not merely to the runtime object's ability to carry a spatial
  relation.

## Resolution

The position gizmo and Inspector offset controls now require a composition
operation-input context. Value declarations and operation outputs therefore
remain free of relative-position tools, while Boolean and group inputs can
expose them when the selected occurrence supports the edit.
