# R-037 — Remove variable annotation metadata

Status: complete

## Feedback

Temporarily remove variable annotations: their benefit is limited, and showing
their `unit` in the tool panel without unit conversion is misleading.

## Resolution

- Only callable `@code3d.param` and design `@code3d.arguments` remain recognized
  Code3D annotations, including their editor highlighting, completion,
  validation, and shared smart selection. Callable variables retain the same
  parameter annotations as function declarations.
- Remove standalone `label`, `description`, `kind`, `unit`, `min`, `max`, and
  `step` metadata from numeric source resolution and runtime parameter targets.
  Existing user comments remain untouched and have no Code3D semantics.
- Derive parameter kinds and constraints from the callable signature, and
  presentation steps from the active tool context. Remove variable unit display
  from both contextual controls and viewport drag feedback.
- Preserve shared-variable tracing, sensitivity, and source write-back through
  unique TypeScript definitions. Source labels come from identifier names.
- Remove obsolete metadata parsing and propagation rather than keeping a
  compatibility path; migrate bundled examples and the prototype description.

## Verification

- Compiler regression covers all removed metadata together, checks exact
  runtime target fields, and confirms callable parameter constraints and
  upstream variable sensitivity remain intact.
- Source-resolution regression retains the same editable initializer while
  ignoring legacy metadata. Editor regression recognizes only the two retained
  tags and gives legacy comments ordinary TypeScript selection behavior.
- Full workspace build and all 80 app/core/screws tests pass.
- Host Chrome confirms the panel ignores legacy labels, units, steps, and
  bounds; editing a doubled argument from 80 to 82 writes its source variable
  from 40 to 41. The callable's own maximum rejects 101 without changing source.
