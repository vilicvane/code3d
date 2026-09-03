# R-012 Render downstream context while editing relations

## Request

- When the caret or a GUI tool is adjusting a constraint inside `relate`, show
  dimmed context according to the objects that the constrained value actually
  participates with later in the program.
- Do not limit the context to the immediate relation expression or blindly
  assume that the constraint target is the complete composition context.

## Expected scope semantics

- The focused geometry is the immutable constrained value produced by the
  relevant `relate` evaluation.
- Dimmed objects come from the downstream operation occurrence that consumes
  that exact value, such as the other operands of a later `union` or `cut`.
- The relationship is directional: source tracing follows the constrained
  value forward to its actual consumers rather than treating every related
  model as an undirected scene neighbour.
- Repeated evaluations and reuse must remain distinct. If one constrained
  value participates in multiple downstream operations, the UI must preserve
  or expose the concrete runtime occurrence instead of merging unrelated
  contexts into one preview.
- Tool preview and commit keep this downstream context stable under the same
  rules as an operation-input source selection.

## Acceptance criteria

- Placing the caret in an `on()`/`offset()` constraint can render the related
  value as focus with the objects from its actual later composition dimmed.
- An object reused by two different combinations shows only the peers from the
  selected/evaluated downstream occurrence.
- The relation target remains visible as a relation participant, but does not
  replace or stand in for peers from the selected downstream operation.
- Existing declaration, immutable-chain, and operation-input source scopes
  retain their current rendering semantics.

## Resolution

- Constraint-returning source expressions are first-class source targets that
  retain the constrained object, exact constraint identity, and evaluation
  context.
- Each target resolves its concrete downstream composition inputs by runtime
  object identity. Those peers provide dimmed context independently of the
  relation target, which remains visible so the constraint itself can be read
  spatially.
- Separate downstream consumers remain separate target evaluations and appear
  as `Use` scopes when more than one exists. The selected use survives source
  edits and recompilation.
- Constraint targets enable the existing Inspector offset controls and position
  gizmo, including expression insertion when the selected constraint has no
  `offset()` yet. Boolean region emphasis continues through the generic source
  decoration provider.
- Arrays returned from `relate` keep each constraint as an independent source
  and tool scope. Inspector parameters are restricted to the selected member;
  the array expression itself does not invent a shared frame or combined gizmo.
