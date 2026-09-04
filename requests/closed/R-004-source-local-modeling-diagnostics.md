# R-004 Source-local modeling diagnostics

## Request

- Show code and modeling errors through Monaco's inline diagnostics whenever a
  reliable source location exists, rather than merely placing feedback near the
  editor or in a global error bar.
- Attribute concrete evaluation failures such as invalid parameters,
  inconsistent constraints, and Boolean/kernel failures to the source
  expression that requested the evaluation.
- Keep the marker compact and use Monaco's native hover UI for details.
- Reserve the global error bar for failures that cannot be attributed to code.

## Confirmed behavior

- Compiler diagnostics carry a kind, summary, optional details, and an optional
  file-qualified source span across the worker boundary.
- A normal thrown error acquires the location of the innermost traced source
  evaluation that contains it. An already-located diagnostic keeps its more
  precise location through outer calls and design-time evaluation contexts.
- Runtime model calls, traced binding initializers, imported module specifiers,
  and model snapshot generation all supply source locations where available.
- Chained model calls retain their full expression span for model-value tracing
  while failures use the narrower concrete invocation span, such as
  `chamfer(2, [10])`, for the editor marker.
- Fillet and chamfer builders report an unfinished OpenCascade operation with
  its size, stable edge IDs, and any implicit tangent-contour expansion. Other
  native OpenCascade WebAssembly exceptions are decoded at the tooling boundary
  instead of degrading to `[object WebAssembly.Exception]`.
- Located diagnostics become `code3d` Monaco error markers. They remain visible
  while the replacement revision compiles and clear when that revision
  succeeds; they do not open a second error overlay or move editor focus.
- A failed evaluation appears in the viewport's bottom-left feedback stack only
  when its recorded model inputs intersect the object graph of the fallback
  model rendered by that compilation. This relation is independent of whether
  the failed operation exposes a tool. Syntax, module, and unrelated evaluation
  diagnostics remain editor-only. Source-edit notices share the viewport stack
  without overlapping model-related diagnostics, and a successful replacement
  compile clears the diagnostic.
- Parameter source references from failed fillet and chamfer evaluations remain
  tracked even though those operations have no output object, so the open tool
  can repair the failing size directly.
- A compile produces one primary diagnostic. Related constraint locations are
  not marked speculatively; they can be added later only when the solver emits
  structured contributing diagnostics.

## Verification

- `npm run build` passes.
- Host Chrome kept both `const broken = ;` and an invalid standalone `box()`
  evaluation out of the viewport feedback stack while retaining their Monaco
  diagnostics. A failed `chamfer()` consuming the rendered fallback model still
  appeared in the viewport.
- Host Chrome evaluated `box(-1, 20, 10)`: the full call expression received
  one Monaco error marker, its native hover displayed the evaluation message,
  and the global error bar remained hidden.
- Core integration tests reproduce a chamfer rejected after both cold and
  cache-hit fillet prefixes and verify raw OpenCascade exception decoding.
- Host Chrome's compiler worker evaluated the same chamfer and returned the
  readable summary and details with the exact `chamfer(...)` invocation span.
- In an isolated Host Chrome Studio project, selecting the marked call opened
  the Chamfer tool. Changing distance from `2` to `1` without blurring kept the
  input focused, rewrote the source after the input debounce, rebuilt
  successfully, and cleared both the marker and bottom-left diagnostic. The
  focused input selected its whole value and used the theme accent selection
  color.
- Changing the distance back to the failing value kept the source-edit notice
  and model diagnostic visible together, with the notice stacked 8 px above
  the diagnostic and the diagnostic anchored 14 px from the viewport edges.
- Restoring valid source returned the model to ready state and cleared the
  marker without changing the restored project contents.
