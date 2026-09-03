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

## Implementation

- Pointer hit testing retains every semantic target along a ray so an active
  solid remains a valid drill target when a translucent context surface is in
  front of it.
- The double-click candidate is the stable runtime node rather than a rendered
  occurrence key. It therefore survives the context rerender caused by the
  first click.
- Source resolution prefers the earliest exact binding for that immutable
  value, then the narrowest exact value or operation-output source, and finally
  the runtime value's own primary source reference. All references remain
  file-qualified for cross-file navigation.
- Pointer movement, gizmo capture, cancellation, non-primary buttons, misses,
  and source rerenders outside the click sequence clear the pending gesture.

## Verification

- `npm run build`
- Host Chrome: `cut(stock, [bore])` keeps its operation context on a single
  click, opens and isolates the `bore` declaration on double-click, and does
  not navigate after repeated camera drags.
