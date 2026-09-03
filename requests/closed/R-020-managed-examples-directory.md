# R-020 Managed examples directory

## Request

- Separate bundled examples from persistent author files so real models can be
  maintained while the prototype examples continue to evolve.
- Put examples of the major supported capabilities under `/examples`.
- Rename the reset action to `Reset examples` and restrict it to that directory.
- Never let example reset modify `/model.ts`, `/lib`, or user-created paths.

## Product behavior

- `/model.ts` is an ordinary user-owned entry module. A fresh project initially
  re-exports bundled examples, but later application updates do not rewrite it.
- `/examples` is the only managed template boundary. Its files demonstrate
  primitives and derived geometry, Boolean operations, relations and typed
  elements, design-time function arguments, and the metric fastener library.
- When the bundled template revision changes, startup replaces `/examples`
  with that new version. Long-lived models belong in user-owned paths instead.
- Explicit reset replaces the complete `/examples` directory with the bundled
  version after confirmation. Open files outside that directory retain their
  Monaco models, view state, and undo history.
- If the active file is an example that still exists after reset, the editor
  stays on that path with the reset source. If it was removed by reset, the
  editor opens another bundled example.

## Architecture

- A content-versioned `ProjectDirectoryTemplate` describes the managed
  directory and remains independent of the storage backend. Its revision is
  derived from file paths and source, so updates cannot omit a manual bump.
- `ProjectFileSystem.syncDirectory()` replaces stale template revisions during
  startup; `resetDirectory()` performs the same replacement explicitly.
- The editor mirrors the same directory-scoped replacement rather than
  rebuilding the project, so unrelated documents and source history survive.

## Verification

- Production build and host-browser verification cover initial seeding, example
  compilation, directory-only reset, and preservation of user-owned source.
