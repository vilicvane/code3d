# R-025 Show tools for incomplete calls

## Request

- Keep overload-specific JSDoc tool panels, but still show a useful panel when
  the current call matches no overload.
- In particular, let a newly written call with no arguments enter its tool.

## Confirmed behavior

- A valid call continues to use its resolved overload and only that overload's
  annotations.
- For an invalid call, an annotated TypeScript recovery candidate is retained;
  if the recovery candidate is not annotated, the first annotated overload in
  declaration order is used.
- Every reached annotated call has a source target even when it fails before
  producing a model value or has no renderable context object.
- Missing scalar parameters appear as empty controls. The next argument that
  can be appended without inventing earlier values is editable; writing it
  updates the call and lets the following parameter become editable after the
  next compile.

## Verification

- `npm run build --workspace @code3d/app` passes.
- A Host Chrome interaction starting from `box()` showed blank width, height,
  and depth controls, enabled them in source order, and produced
  `box(10, 20, 30)` without replacing the focused depth control when the call
  changed from a failed execution to a successful model result.
- One Monaco undo restored the whole panel edit to `box()` while retaining the
  panel and restoring the missing parameter controls to blank values.
- A synthetic overload probe confirmed that an invalid `make()` recovered the
  annotated numeric overload, an exact unannotated `make("x")` exposed no tool,
  and an exact annotated `make(2, 3)` exposed only that overload's parameters.
- An outer argument diagnostic spanning a valid `inner(1)` call did not make
  that call inherit a different annotated overload; a genuinely invalid
  `inner()` call still recovered it.
