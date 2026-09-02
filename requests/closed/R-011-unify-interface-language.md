# R-011 Unify the interface language

## Request

- Use English consistently throughout the prototype UI. The current mix of
  Chinese and English labels is visually and conceptually inconsistent.
- Cover all user-visible interface text: project/file actions, compilation
  state, panels, viewport hints, properties, tool feedback, confirmations,
  source-edit feedback, and errors produced by normal UI workflows.
- Do not rename author variables, sample model object names, or the public
  modeling API merely to satisfy the interface-language rule.

## Acceptance criteria

- No Chinese text remains in the normal application shell or interactive UI
  paths.
- Browser checks cover idle/compiling/success/error states, project context
  actions, Model Outline, Properties, viewport hints, and a tool commit.
- Runtime diagnostics shown through the UI are English where code3d owns the
  message; arbitrary exceptions thrown by author code remain verbatim.

## Implementation checkpoints

- [x] Translate static application and panel markup.
- [x] Translate dynamic controls, status, confirmations, and tool feedback.
- [x] Translate code3d-owned compiler/runtime/project diagnostics.
- [x] Verify representative UI states in the browser.

## Verification

- A Unicode search finds no Han-script text in `src` or `index.html`, and the
  document language is `en`.
- Host Chrome covered waiting/compiling/success/error states, the file context
  menu, Model Outline guidance, viewport guidance, Properties, a source-file
  switch, and a parameter commit with its source-edit popover.
- The parameter commit also confirmed that a completed input cannot emit a
  second stale commit while recompilation replaces the inspector.
