# R-021 Local folder projects

## Request

- Keep the browser prototype and its virtual filesystem abstraction rather than
  moving to Electron.
- Allow a project to directly read and write a user-selected real directory.
- Keep the default example/browser workspace available without letting one
  browser page's folder selection change another page.

## Product behavior

- The default URL opens the existing IndexedDB-backed browser workspace.
- `Open folder` selects a directory with read/write permission and switches only
  the current page to a URL-scoped local workspace.
- An empty selected directory receives the current project snapshot. A directory
  that already contains TypeScript or JavaScript files is adopted without
  overwriting them; `/model.ts` is preferred as its entry, otherwise the first
  source path is used.
- Local source edits, creation, rename, deletion, GUI write-back, and example
  reset operate directly on the selected directory. `.code3d/project.json`
  stores the entry and managed-example revision.
- Bundled examples remain visible alongside user files and retain their managed
  reset/update behavior in both storage modes.
- The directory handle is stored under the workspace ID carried in the page
  query string. Separate pages can therefore keep different local projects or
  the default browser project open concurrently.
- `Reconnect folder` requests a lost permission again. `Use browser storage`
  changes only the current page. `Reload folder` explicitly incorporates edits
  made by external tools because the browser API has no stable directory watch.

## Architecture

- `ZenProjectFileSystem` owns project semantics and receives its file operations
  and on-disk layout rather than depending on a global backend.
- IndexedDB keeps the existing `/workspace` layout. A ZenFS `WebAccess` context
  maps a selected directory to project `/`, making project paths real relative
  disk paths.
- Directory-handle persistence is separate from project contents. Its URL-scoped
  identity is UI session state, never model state.

## Verification

- Production TypeScript/Vite build passes.
- Host Chrome used independent handle-backed directories to verify empty-folder
  initialization, physical source writes, manifest creation, example syncing,
  reopening without seed overwrite, and creation through the project UI.
- Two simultaneous pages loaded different physical `model.ts` contents while a
  third retained Browser storage. Returning one page to Browser storage left the
  other local page unchanged.
