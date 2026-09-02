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
- A constraint target that is not a peer in the selected downstream operation
  is not added merely because it appears in the relation expression.
- Existing declaration, immutable-chain, and operation-input source scopes
  retain their current rendering semantics.
