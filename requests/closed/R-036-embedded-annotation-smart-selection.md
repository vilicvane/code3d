# R-036 — Shared smart selection inside annotations

Status: complete

## Feedback

Enable smart selection inside annotations and make the capability reusable:
`@code3d.param` and `@code3d.arguments` should use the same implementation.
Commit the completed parameter editor support before beginning this work.

## Resolution

- The parameter editor support is checkpointed in `fd13cae`.
- Both annotation kinds use one embedded TypeScript selection pipeline.
  TypeScript supplies string, property, object, argument, call, and array
  selection ranges; Code3D maps them back to the actual source.
- `EmbeddedCodeProjection` is independent of annotation syntax. It projects
  a contiguous source fragment into generated code, maps completion spans,
  removes generated-wrapper selection ranges, and joins containing source
  ranges into a strictly nested selection chain.
- Parameter names and configuration values, and design argument expressions,
  supply their fragments to the same pipeline. Expansion proceeds through
  the value and complete annotation, then the original JSDoc/declaration/file
  parents. Shrink and multi-cursor behavior remain Monaco's native behavior.
- Parameter and design-argument completion now share the same projection
  offset/span mapping instead of maintaining separate arithmetic.
- Multiline JSDoc masking preserves UTF-16 offsets and line endings.
  Incomplete expressions remain selectable; ordinary code and positions
  outside embedded values retain their original TypeScript selections.
- Selection requests discard results if the model changes while awaiting the
  worker, rather than applying ranges from an obsolete source version.

## Verification

- Regression tests compare both annotation kinds with native TypeScript
  syntax ranges and cover embedding boundaries, helper exclusion, parameter
  names, nested expressions, empty and incomplete values, CRLF, Unicode,
  multiple positions, and ordinary-source behavior.
- Host Chrome checks exercise actual Alt+Shift+Right expansion,
  Alt+Shift+Left shrink, and simultaneous cursors in different annotation kinds.
- Existing annotation completion/validation and compiler/tooling regressions,
  workspace tests, app build, and formatting checks pass.
