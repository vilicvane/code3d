# R-015 Function design arguments

## Request

- A model-producing function can declare candidate design-time argument sets in
  its JSDoc with repeated `@code3d.arguments [...]` annotations.
- Function-body source views expose both ordinary runtime calls and these
  design-time argument contexts, and the GUI can switch between them.
- A function with design arguments remains inspectable even when author code
  does not otherwise call it.
- Recognized `@code3d.*` annotations receive distinct syntax treatment in
  Monaco.

## Required semantics

- Each annotation value is a TypeScript array expression representing one
  positional argument list and is evaluated in the function's module scope.
- Design evaluation is a view concern. It must not change exports, fallback
  model selection, normal Model Outline contents, or persistent state outside
  source.
- Context selection follows the caret across traced expressions in the same
  function whenever the selected context evaluates that expression.
- Design contexts are selected from their own dock panel beside Properties. A
  context that requires evaluation shows its compile progress on that item.
- Annotation names are shared by the compiler and editor so recognized tags
  and highlighting cannot diverge.
- Invalid annotation values produce a source-located diagnostic instead of
  being silently ignored.

## Verification

- [x] Switch among a real call and multiple `@code3d.arguments` contexts.
- [x] Inspect a model-producing function that has no ordinary call.
- [x] Move the caret between expressions without losing the selected context.
- [x] Confirm design evaluations do not enter Overview or Model Outline.
- [x] Confirm valid annotations are highlighted and unknown annotations are
      left as ordinary comments.
- [x] Confirm invalid argument annotations report their source location.
- [x] Run the full build and host-browser verification.
