# R-017 Completion-derived model preview

## Request

- While code completion is open, derive the rendered GUI state from the code
  that would exist if the focused completion were accepted.
- In particular, typing only part of a named element should preview the full
  focused element.
- Keep the real caret at the user's incomplete input instead of accepting or
  temporarily writing the completion into source.

## Confirmed behavior

- The Monaco-private suggestion adapter exposes the focused completion and its
  normalized edit coordinates through a code3d-owned boundary.
- A regular completion edit and its additional edits are applied to an
  in-memory project snapshot. The normal compiler evaluates that snapshot, and
  the projected post-completion cursor selects its viewport source context.
- Named-element focus still provides an immediate preview from the last
  accepted module while speculative compilation is pending.
- The viewport shows a prominent rendering indicator while that speculative
  compilation is pending, then removes it as soon as the preview resolves.
- Completion previews are debounced and superseded when the source or focused
  item changes. Closing completion restores the accepted module and resumes
  compilation from the real source revision.
- The speculative module never replaces the editor's source, persistence,
  undo history, diagnostics, accepted tool metadata, or caret. Picking and
  model-editing tools are disabled for this transient viewport state.

## Verification

- `npm run build` passes.
- In host Chrome, replacing `part.headBottom` with `part.hea` kept
  `headBottom` focused and reached `Preview · headBottom`, proving that the
  completed project snapshot compiled successfully.
- Chrome's EditContext retained `part.hea` with selection start/end both at 12
  before and after speculative compilation. Cancelling completion and restoring
  the fixture returned the project to its original ready state and exact source
  contents.
