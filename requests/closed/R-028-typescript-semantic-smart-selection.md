# R-028 — TypeScript semantic smart selection

Status: complete

## Feedback

Expanding the editor selection with `Alt+Shift+Right` was less precise than in
VS Code, especially across property access, call expressions, chained
operations, and declarations.

## Resolution

- TypeScript and JavaScript project models register a Monaco selection-range
  provider backed by TypeScript's `getSmartSelectionRange` syntax-tree query.
- One worker request resolves all active cursor positions and returns the
  complete parent chain for each, preserving Monaco's native multi-cursor,
  expand, and shrink behavior.
- Completion and selection providers share one typed custom-worker client.
  Monaco's generic word ranges remain available alongside TypeScript's semantic
  ranges; no Code3D-specific syntax hierarchy is introduced.

## Verification

- Host Chrome selection expansion over a chained model expression follows the
  same semantic range sequence returned by the TypeScript language service.
- The app build passes.
