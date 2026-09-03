# R-007 Switch operation focus from dimmed peers

## Request

When an operation such as `cut(a, [b])` renders one input as focus and the other
as dimmed context, clicking the dimmed input should switch the operation focus
to that input.

## Expected behavior

- Clicking a dimmed peer navigates Monaco to that exact operation argument.
- The clicked peer becomes focus and the previous focus becomes dimmed context.
- If the peer contains multiple runtime occurrences, the clicked occurrence is
  selected.
- The switch keeps the current camera framing.
- Dragging to orbit the viewport does not trigger a switch.
- Viewport decorations remain non-interactive.

## Resolution

Operation-input source targets now reference their peer targets explicitly.
Dimmed render objects carry that target identity separately from ordinary focus
occurrence selection. Picking one switches the rendered source target, selects
the clicked runtime node, and navigates Monaco to the corresponding argument
without refitting the camera. Picking is committed only after a primary-pointer
click gesture; movement beyond the click threshold and gizmo gestures cancel
selection.
