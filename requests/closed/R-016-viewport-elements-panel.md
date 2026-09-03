# R-016 Viewport Elements panel

## Request

- Add an on-demand Elements panel in the viewport as a supplementary way to
  inspect the named point, line, face, and frame elements available on the
  current model.
- Keep source code primary for model editing. The panel is information and
  discovery UI, not a parallel persistent model editor.

## Confirmed boundary

- The panel complements source selection and TypeScript completion; it does not
  replace either one.
- Opening or browsing the panel must not change source or create hidden model
  state.

## Interaction contract

- Elements is a fourth viewport dock panel with the same collapsed, hover-peek,
  pinned, and keyboard behavior as the other panels (`Alt+4`).
- The panel follows the currently selected runtime occurrence and lists its
  exact exposed element names and point, line, face, or frame kinds.
- The element under the source caret is marked in the list when it belongs to
  the current occurrence.
- Hovering or keyboard-focusing a row adds a transient decoration scoped to
  that occurrence. Leaving the row removes it. Rows do not navigate, insert
  code, or retain a separate selection.
- Element previews reuse the same decoration construction as source and
  completion previews, including exact B-Rep face highlighting.

## Verification

- `npm run build`
- Host Chrome: default collapsed state, `Alt+4` pinning, hover peek/collapse,
  source-active marking, selected-object updates, and transient point, line,
  face, and frame previews.
