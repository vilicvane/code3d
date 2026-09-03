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
- Detailed layout and interaction are intentionally deferred until the source
  and completion element previews have established the useful information to
  expose.
