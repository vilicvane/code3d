# R-009 Persistent multi-file workspace

## Request

- Replace the single in-memory `model.ts` document with a browser-persistent
  virtual project filesystem and first-class multi-file authoring.
- Use an existing filesystem abstraction whose API can later be backed by a
  real filesystem without changing the compiler or editor project model.
- Treat reusable libraries, including the metric fastener library in R-010, as
  ordinary TypeScript files and folders in that filesystem.
- Preserve code3d's central invariant: source files are the only persistent
  model state, including edits made by GUI tools.

## Confirmed product behavior

- A project has an explicit entry file and a set of path-addressed source
  files. `/model.ts` is the initial entry, not a privileged compiler concept.
- The editor exposes files and open documents, maintains one Monaco model per
  source file, and resolves imports using project paths.
- Browser reload restores file contents and project structure.
- Source selection, Model Outline navigation, diagnostics, parameter editing,
  relation tools, and the source-edit popover remain correct when their target
  lives outside the active file.
- GUI write-back opens neither a second source of truth nor a generated shadow
  document: it edits the owning project file atomically and preserves the
  user's current caret/render context.

## Architecture direction

- Use ZenFS behind a small code3d-owned `ProjectFileSystem` boundary. Start
  with the IndexedDB backend from `@zenfs/dom`; keep backend choice out of the
  editor and compiler so a File System Access API, OPFS, desktop, or host-backed
  implementation can replace it later.
- Keep an in-memory immutable project snapshot for compilation and UI state.
  Persistence is an asynchronous boundary around that snapshot, not something
  compiler evaluation reaches into directly.
- Compile an explicit module graph rooted at the entry file. Support relative
  TypeScript/JavaScript imports, extension resolution, index modules, module
  caching, cycles with CommonJS semantics, and the virtual `code3d` runtime
  module.
- Make every `SourceRef` file-qualified. File identity must participate in
  source-target IDs, trace identities, diagnostics, edit transactions, and
  occurrence matching; numeric offsets are meaningful only within a file.
- Remove the old single-source compiler/editor contract once the project
  contract is in place. A one-time import of the existing localStorage source
  is allowed solely to avoid destroying a user's prototype on upgrade.

## Research notes

- ZenFS Core provides a Node-compatible `fs` API and configurable mount table:
  <https://zenfs.dev/core/>.
- `@zenfs/dom` supplies an IndexedDB backend for persistent browser storage and
  a `WebAccess` backend for browser file/directory handles:
  <https://zenfs.dev/dom/>.
- This makes IndexedDB a suitable first backend while preserving a clear path
  to user-selected real files. The project-facing interface still belongs to
  code3d so ZenFS does not become part of author code or the model runtime API.

## Acceptance criteria

- A fresh browser project contains an entry model plus the reusable library
  files required by R-010 and compiles through imports.
- Creating, editing, renaming, and deleting project files/folders is reflected
  in the project tree and persists across reload. Destructive UI operations
  must be explicit and must not silently retarget imports.
- Switching files preserves independent Monaco models, view state, undo
  history, diagnostics, and TypeScript language support.
- A model imported from another file appears in runtime tracing and the Model
  Outline; selecting it navigates to its actual defining/use site as
  appropriate.
- Inspector/gizmo edits against an imported value update the correct file and
  preserve the active caret-selected viewport context.
- Build, automated tests, and a browser reload/import/edit verification pass.

## Implementation checkpoints

- [x] Persistent project filesystem and default-project bootstrap.
- [x] Multi-model editor, file tree, tabs, and file operations. The project
      header keeps only New; rename and delete live in each file's context menu.
- [x] Multi-module compiler and TypeScript module resolution.
- [x] File-qualified tracing, diagnostics, navigation, and tool transactions.
- [x] Persistence, browser, and regression verification.

## Verification

- `npm run build` passes with the ZenFS browser backend included.
- Host Chrome verified nested file creation, relative imports, an imported
  `ModelObject`, cross-file Outline navigation, independent Monaco documents,
  context-menu rename/delete (including deleting the active document), and
  persistence after a full reload.
- The imported-library browser fixture was removed and the persistent project
  restored to the default example after verification.
