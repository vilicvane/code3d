# R-019 Viewport compilation progress

## Request

- Replace the low-presence application-header run state with a noticeable
  compilation indicator inside the model viewport.
- Show it while editing waits for or runs compilation, including speculative
  completion rendering, without obstructing model interaction.

## Behavior

- One pointer-transparent progress card sits at the viewport's upper-right
  edge, away from the model's primary interaction area.
- Source changes show `Updating model` immediately during the debounce window;
  active compilation changes it to `Compiling model`.
- Completion-derived compilation uses the same card with the focused member in
  its label.
- Completion, failure, cancellation, or tool interruption removes the card.
- Ready/object-count state is not persisted as interface chrome, and the old
  header run-state implementation has been removed.
