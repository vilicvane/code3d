# R-029 — Composition-scoped relation placement

Status: complete

## Feedback

Unless a model is being rendered as part of a composition, `relate()` should
not change the rendered result. A related value inspected by itself should
remain in its own local frame.

## Resolution

- Every root model snapshot exposes its intrinsic standalone transform
  separately from the transform resolved for use in a composition.
- A standalone value or operation result renders with its intrinsic transform.
  Group children and source views for composition inputs use the resolved
  composition transform.
- Boolean and loft evaluation continue resolving operand relations because
  those operations consume multiple values in a shared composition frame.
- Constraint metadata remains available for relation tools without making the
  constraint an implicit standalone placement operation.

## Verification

- Core tests assert that a related point remains at the origin when snapshotted
  alone and reaches its solved position as a group child.
- Loft tests assert intrinsic standalone section transforms while retaining
  distinct solved composition orientations and a valid generated solid.
- Package and app builds pass, and the relation example is checked in the host
  browser in both standalone and composition source scopes.
