# `@code3d/core` package and Node-native project refactor

## Status and planning posture

Status: active. The fillet/chamfer edge-selection work is integrated and the
workspace/package-boundary portion of phase 1 is implemented. Project-local
package resolution, building, evaluation, and language-service loading remain
in progress.

This document is durable working memory, not a frozen implementation spec. It
separates confirmed product constraints from working technical choices. During
implementation, evidence from isolated experiments may refine or reorder the
steps. Ask the user when a choice would materially change author-facing syntax,
direct-Node semantics, supported dependency classes, or the package boundary.
Routine internal choices may be adjusted without stopping when they preserve
the confirmed constraints and improve the resulting abstraction.

The steps below describe one end-to-end refactor. They do not authorize leaving
temporary adapters, dual module paths, compatibility aliases, or duplicated
runtime implementations in the retained main path. If a technical choice is
still unclear, validate it in isolated disposable code before connecting it to
the product.

## Confirmed product constraints

- A real code3d project is an ordinary Node/TypeScript project.
- The project owns its `package.json`, lockfile, and `node_modules`.
- The project may install `@code3d/core` itself and may choose its compatible
  version. Studio does not secretly supply a replacement package.
- The same author source must be usable by Studio and directly executable in a
  supported Node runtime.
- Author modules use standard ESM imports and exports. code3d does not introduce
  a private module syntax.
- Reusable model libraries are normal packages and may be imported from local
  `node_modules`.
- Source files remain the only persistent model state. Packaging must not add a
  parallel model document or build-history format.
- Every source file remains eligible as the current Studio preview root.
- TypeScript language services and model execution are separate responsibilities:
  declarations drive editor intelligence; JavaScript implementations drive
  runtime evaluation.
- Prototype migration is a refactor, not a compatibility exercise. Existing
  examples and callers move to the new package in place, and the old path is
  removed.

## Current working choices

These are the preferred technical direction, but remain subject to evidence at
the explicit decision checkpoints below.

### Authoring and Node execution

- Use ESM-only projects with `"type": "module"`.
- Use TypeScript `module` and `moduleResolution` set to `NodeNext` so Monaco
  rejects imports that would fail under Node instead of accepting
  bundler-specific conveniences.
- Write explicit TypeScript extensions in relative source imports:

  ```ts
  import {mountingPlate} from './mounting-plate.ts';
  import {box} from '@code3d/core';
  ```

- Enable `rewriteRelativeImportExtensions` so ordinary TypeScript emit rewrites
  the first import to `./mounting-plate.js` while leaving package imports alone.
- Enable `erasableSyntaxOnly` and `verbatimModuleSyntax`; use `import type` for
  type-only imports. This keeps source compatible with Node's native TypeScript
  type stripping.
- Prefer a current Node release where native type stripping is stable. Confirm
  the exact minimum version immediately before implementation instead of
  prematurely freezing it in the public project contract.
- Do not rely on `tsconfig.json` `paths` for runnable imports. Standard package
  imports and `package.json` subpath imports are the portable mechanisms.
- Publish JavaScript and declarations from packages. Node does not type-strip
  TypeScript located under `node_modules`.

An intended project shape is:

```text
my-models/
  package.json
  package-lock.json
  tsconfig.json
  src/
    model.ts
    mounting-plate.ts
  node_modules/
    @code3d/
      core/
```

The target smoke test is both:

```sh
node src/model.ts
npm run build
```

where the emitted JavaScript can also run under Node.

### Package layout

Use an npm workspace during repository development:

```text
code3d/
  packages/
    app/
    core/
    screws/
  package.json
```

`@code3d/core` emits real JavaScript and `.d.ts` files. Its package exports have
two conceptual surfaces:

- `@code3d/core`: the author-facing modeling values, functions, anchors, and
  constraints.
- `@code3d/core/tooling`: the explicit, versioned boundary used by Studio to
  initialize an evaluation, attach trace metadata, finalize snapshots, and
  release resources.

The exact export names may change during extraction if the runtime dependency
graph shows a cleaner boundary. The important boundary is that Studio must not
classify values using its own copy of core classes. Project code and tooling
must operate on the same installed core instance, and Studio receives a
serializable result through a checked tooling-protocol version.

Reusable model packages should normally declare `@code3d/core` as a peer
dependency, with a development dependency for their own build and tests. This
avoids multiple core/kernel instances in one evaluated module graph.

`@code3d/screws` is the first such package. Standards are package namespaces,
for example `ISO4762.screw('M6', 18)`, so additional standards do not flatten
unrelated model and dimension names into the package root.

### Node and browser entries

The working package design uses conditional ESM entries with one shared public
type surface:

```json
{
  "name": "@code3d/core",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "node": "./dist/node.js",
      "browser": "./dist/browser.js",
      "default": "./dist/browser.js"
    },
    "./tooling": {
      "types": "./dist/tooling.d.ts",
      "import": "./dist/tooling.js"
    },
    "./open-cascade.wasm": "./dist/open-cascade.wasm"
  }
}
```

The Node entry should make ordinary top-level author code usable without an
author-visible initialization ceremony. The current candidate is an ESM entry
that completes OpenCascade initialization during module evaluation. Validate
top-level-await behavior, process shutdown, resource ownership, and the
OpenCascade loader in an isolated package spike before committing to that API.

Studio uses the browser/tooling entry from the project's installed package and
keeps the corresponding kernel alive across source evaluations. The installed
core version, not Studio's build-time dependency, owns the compatible geometry
runtime and kernel asset.

## Architectural boundaries

### 1. Project filesystem

Replace the eager source-only `ModelProject` snapshot at the compilation
boundary with a lazy project filesystem capable of at least:

- reading a file;
- reading a directory;
- distinguishing files and directories;
- observing content/version changes needed for cache invalidation;
- resolving project-relative paths without leaking host absolute paths.

The source tree UI continues to hide `node_modules`, `.git`, and internal
metadata. Hiding a directory in the UI must not make it invisible to module
resolution.

Keep IndexedDB/ZenFS for the browser-owned workspace. For a user-selected local
folder, prefer a direct lazy `FileSystemDirectoryHandle` adapter instead of
mounting and indexing the entire folder through the current WebAccess backend.
Module resolution must read only the files reached by the active graph.

Browser example projects must also observe the real package boundary. Seed a
built `@code3d/core` package artifact and package metadata into their managed
filesystem instead of restoring a compiler-owned magic module.

### 2. Module resolution

Create one explicit resolver service over the project filesystem. The current
candidate is `enhanced-resolve`, whose modern browser build accepts a custom
filesystem and implements package `exports`, `imports`, conditions, hierarchical
`node_modules`, and dependency tracking.

Use separate resolution intents over the same service:

- author/editor types: NodeNext-compatible type and declaration resolution;
- Studio runtime: browser/import/default package conditions and executable
  JavaScript;
- Node smoke tests: Node's own resolver is the authority.

This distinction is intentional. A package may expose different Node and
browser implementations, but their advertised public type contract must agree.
Studio build diagnostics catch dependencies that have no browser-compatible
implementation even if their declarations are valid.

Do not hand-code a growing `require` replacement or special-case arbitrary bare
imports. Do not fall back from a missing project `@code3d/core` to Studio's own
copy. Missing packages, blocked exports, and incompatible conditions become
located module diagnostics.

### 3. TypeScript language service

Remove the hand-maintained `authoringTypes` string and the synthetic
`file:///node_modules/code3d/index.d.ts` registration.

Monaco should see the project's real source files and the declaration closure
reachable from its imports. Load declarations lazily from the project
filesystem and update them as package metadata or lockfiles change. Monaco's
supported extra-library API is a viable first mechanism when supplied with the
real declaration graph; use a custom TypeScript worker only if an isolated
prototype shows it is necessary for correct resolution, scale, or request-on-
demand behavior.

Set compiler options from the project contract, initially NodeNext with the
native-TypeScript restrictions above. Completion-generated relative imports
must include the `.ts` extension expected by direct source execution.

Language-service loading never initializes or executes `@code3d/core`. It only
reads package metadata and declarations.

### 4. Build and instrumentation

Replace per-file `transpileModule` plus the custom CommonJS resolver with a
project builder. The current browser candidate is `esbuild-wasm` with async
`onResolve` and `onLoad` plugins backed by the project filesystem and resolver.

The existing code3d AST analysis and instrumentation remain a distinct source
transform applied before a project source file enters the builder. Do not apply
code3d source instrumentation indiscriminately to ordinary third-party
dependencies.

Expose a `ProjectBuilder` boundary so a future local CLI or Electron host can
use native tooling without changing package or authoring semantics. The browser
implementation may be slower than native; cache resolution and transformed
dependency artifacts against the lockfile, package metadata, file versions,
and build configuration rather than eagerly scanning `node_modules`.

### 5. Evaluation

Keep building separate from evaluation even if both initially remain worker-
backed. A superseded build can be discarded without disturbing the last valid
viewport or the currently initialized geometry kernel.

The working execution model is:

1. Resolve the project's installed `@code3d/core` and validate its tooling
   protocol.
2. Create a project-local runtime capsule and initialize its OpenCascade kernel
   once.
3. Build the selected source root and its reachable graph using ESM authoring
   semantics.
4. Execute a fresh instance of the user module graph for each accepted revision
   while reusing only the platform runtime capsule.
5. Let the installed tooling entry inspect its own model values and return a
   serializable model/trace snapshot to Studio.
6. Dispose model-owned kernel resources after the snapshot boundary while
   keeping the runtime ready for the next evaluation.

Studio must not use `instanceof` against a host-installed core to inspect values
from the project-installed core. Package or lockfile changes invalidate the
runtime capsule and cause a deliberate evaluator restart.

Native browser ESM remains an implementation option, not a requirement. Vite's
development model still transforms TypeScript, rewrites bare imports, and
pre-bundles dependencies. For code3d, a resettable bundled/module-registry
execution currently fits repeated whole-model evaluation better than an
ever-growing native ESM module cache. Revisit this only if a spike demonstrates
clean graph invalidation, worker import resolution, source maps, and persistent
kernel ownership.

## Implementation sequence

The sequence may be refined after the preflight experiments, but the completed
milestone must leave one coherent path.

### Phase 0: integrate the current topology work and run isolated spikes

- Finish and integrate the fillet/chamfer edge-selection milestone first.
- Record the exact runtime, compiler, filesystem, Monaco, example, and test
  dependency closure before moving files.
- Prove direct Node execution of a small multi-file `.ts` model using explicit
  `.ts` imports.
- Prove TypeScript emit rewrites those relative imports and emits usable
  declarations.
- Prove the proposed Node core entry initializes the packaged OpenCascade WASM
  without author-visible setup.
- Prove browser-side resolution and building of a package from a lazy filesystem
  adapter, including `exports`, a transitive ESM dependency, and a CommonJS
  dependency.
- Measure cold initialization, dependency build, incremental source build, and
  repeated evaluation independently.

Delete the spike after its conclusions are reflected in the retained design.

### Phase 1: establish the package boundary

- Convert the repository to a private workspace root with Studio and core
  packages at their best final locations.
- Move the true author runtime and its tests into `@code3d/core`.
- Generate JavaScript and declarations from one source instead of maintaining a
  parallel declaration string.
- Define explicit public and tooling exports and package the compatible kernel
  asset.
- Replace Studio runtime-class knowledge with serializable tooling protocol
  types and protocol-version checks.

### Phase 2: establish project filesystem and resolution

- Introduce the lazy project filesystem contract and direct local-directory
  adapter.
- Keep source-tree filtering as a presentation concern.
- Add the package resolver and resolution diagnostics.
- Track package metadata and lockfiles for invalidation without scanning all of
  `node_modules`.
- Verify npm installs first; test pnpm, workspace, and local-package symlink
  behavior before claiming support for them.

### Phase 3: replace model building and evaluation

- Add the browser `ProjectBuilder` implementation.
- Route transformed project sources and unmodified dependency sources through
  the builder.
- Initialize the installed core runtime capsule and evaluate fresh author
  graphs through its tooling entry.
- Preserve file-qualified source maps, inline runtime diagnostics, stale-build
  cancellation, source targets, operation context, and parameter write-back.
- Remove the old module-name injection and custom per-file CommonJS loader.

### Phase 4: connect project declarations to Monaco

- Load the actual installed declaration graph and package metadata.
- Switch the project language service to the selected NodeNext contract.
- Ensure completion, hover, signature help, definition navigation, source
  diagnostics, and generated import endings work across project files and
  installed packages.
- Remove the synthetic declaration module and every consumer of it.

### Phase 5: migrate examples and remove old semantics

- Give managed examples real package and TypeScript configuration files.
- Change all imports from `code3d` to `@code3d/core` directly.
- Seed the exact built package artifacts needed by browser-owned examples.
- Update the editable fastener library to exercise the same reusable-package
  boundary intended for external libraries.
- Do not add migration code, deprecated aliases, a host-core fallback, or dual
  module-resolution modes.

### Phase 6: verify the retained system

At minimum, verify:

- `node src/model.ts` executes a multi-file project using its installed core;
- ordinary TypeScript emit produces runnable JavaScript and valid declarations;
- the same source root produces equivalent geometry in Studio;
- every project source file can still be selected as a preview entry;
- imports from ESM and CommonJS browser-compatible dependencies build;
- a reusable model package shares the project's peer core instance;
- missing core, incompatible tooling protocol, blocked package export, missing
  file extension, and Node-only browser dependency errors are located and
  understandable;
- Monaco uses the installed package version for completion and navigation;
- changing a dependency or lockfile invalidates the right caches and runtime;
- opening a real project does not enumerate all of `node_modules`;
- independent browser page instances keep their project and dependency state
  isolated;
- existing source selection, outline, completion-derived preview, constraint
  tooling, topology selection, undo/redo, and parameter write-back behavior is
  retained through the new package boundary;
- production build, typecheck, focused unit tests, and host-browser interaction
  checks all pass.

## Decision checkpoints

No decision is currently required before the existing topology milestone
finishes. During the refactor, ask the user if evidence makes any of these
choices materially ambiguous:

1. The minimum supported Node release and whether native type stripping is a
   hard project requirement or `node --import=tsx` is acceptable.
2. Whether direct Node import must initialize OpenCascade invisibly, or a
   visible asynchronous runtime boundary is acceptable in author code.
3. Which package managers and local/workspace symlink layouts belong in the
   first supported contract.
4. Whether Studio must support arbitrary Node-oriented dependencies through
   polyfills, or should reject everything without a browser-compatible path.
5. Whether code3d-aware reusable dependencies expose only their public results
   to Studio tracing or also publish inspectable internal source metadata.
6. Whether evidence justifies native browser ESM evaluation despite its module
   lifetime constraints; the current preference is a resettable evaluator.
7. Resolved: the Studio package is `@code3d/app` at `packages/app`, alongside
   `packages/core` and reusable modeling packages such as `packages/screws`.

## Primary references

- [Node.js TypeScript execution](https://nodejs.org/api/typescript.html)
- [TypeScript module theory](https://www.typescriptlang.org/docs/handbook/modules/theory.html)
- [TypeScript `rewriteRelativeImportExtensions`](https://www.typescriptlang.org/tsconfig/rewriteRelativeImportExtensions.html)
- [Node.js package exports and conditions](https://nodejs.org/api/packages.html)
- [npm workspaces](https://docs.npmjs.com/cli/using-npm/workspaces/)
- [Vite dependency pre-bundling](https://vite.dev/guide/dep-pre-bundling)
- [esbuild browser API](https://esbuild.github.io/api/#browser)
- [esbuild plugin API](https://esbuild.github.io/plugins/)
- [`enhanced-resolve`](https://github.com/webpack/enhanced-resolve)
- [Monaco TypeScript language-service defaults](https://microsoft.github.io/monaco-editor/typedoc/interfaces/languages_features_typescript_register.LanguageServiceDefaults.html)
