# R-013 Drill from a composition preview to object source

## Request

- In a contextual `union`, `cut`, or similar composition preview, double-click
  the currently active object to navigate to that object's declaration or
  defining expression.
- Source navigation naturally changes the render scope to that source value,
  so the former composition peers are no longer rendered as dimmed context.

## Interaction contract

- A single click keeps its existing meaning: switch or refine the active
  runtime occurrence while retaining the current composition source context.
- A double-click on the already-active focus object is an explicit drill-down
  gesture. It resolves the best source target for that occurrence, reveals it
  in the correct project file, and lets the normal caret-driven source scope
  become authoritative.
- The navigation target should prefer the object's named declaration when one
  exists; otherwise use the narrowest defining expression that represents the
  selected immutable value.
- A drag, gizmo gesture, or camera gesture must never be interpreted as a
  double-click drill-down.
- Dimmed peers are not direct drill-down targets under this rule. They retain
  the existing single-click behaviour that first switches operation focus.

## Acceptance criteria

- Double-clicking the active operand in a `cut(a, [b])` preview opens its source
  declaration/expression and renders that value without `cut` peer context.
- The same behaviour works for collection occurrences and for sources in a
  different project file.
- Single click, dimmed-peer switching, dragging, and gizmo interaction remain
  unchanged.
