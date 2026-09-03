# R-014 Cross-file editor navigation

## Request

- Make normal editor definition navigation work across project files.
- Support the familiar Monaco gestures: Ctrl/Cmd+Click and F12.
- Opening a definition must switch the active project document, reveal the
  target, retain per-file view state, and let the new caret location drive the
  model preview normally.

## Implementation

- All project models are eagerly synchronized with Monaco's TypeScript and
  JavaScript language services.
- Monaco's editor opener is connected to the existing path-addressed document
  collection, so built-in definition providers retain their normal same-file
  behavior and can now open a different project model in the same editor.
- Non-project resources such as built-in declaration libraries remain outside
  this opener instead of being mistaken for editable project files.

## Verification

- [x] Ctrl+Click an imported symbol from `/model.ts` into its definition in
      `/lib/fasteners/metric.ts`.
- [x] Press F12 on a cross-file symbol and on a relative module specifier.
- [x] Confirm the target tab, selection, scroll position, model preview, and
      return to the original file.
- [x] Run the full build.

Host Chrome also used a temporary `/parts/navigation.ts` fixture to confirm
that Ctrl+Click selects its exported `ModelObject` at the definition site and
immediately renders that source value with editable Properties. Returning to
`/model.ts` restored its prior line and view state. Reset removed the fixture
and restored the default two-file project afterward.
