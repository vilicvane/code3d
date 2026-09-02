# R-004 Source-local modeling diagnostics

## Request

- Modeling errors should appear near the source expression where concrete
  evaluation failed, instead of only in a global error bar.
- For example, if constraints do not have a unique consistent solution while
  evaluating `union(...)`, `cut(...)`, or another composition boundary, mark
  that call site.
- Keep the marker compact. Hovering or clicking it should reveal the detailed
  diagnostic.

## Architecture direction

- Propagate structured modeling diagnostics with a source span, error kind,
  summary, and details; do not infer locations later from error strings.
- Attribute an evaluation failure to the nearest source-level operation that
  requested the solve. Related constraint expressions may be offered as
  secondary locations when they can be traced precisely.
- Render the primary diagnostic through Monaco markers or decorations while
  retaining a global summary for errors whose source cannot be identified.

## Open decisions

- Whether an inconsistent constraint system should mark only the composition
  boundary, every contributing constraint, or the boundary plus expandable
  secondary locations.
- Whether hover details are sufficient or clicking should also select and
  preview the related models and constraints.
