# `@code3d/core` package and Node-native project refactor

## Implementation and acceptance

The project package boundary, lazy dependency resolution, native ESM evaluation,
and Monaco declaration loading are implemented and accepted in
[#6](https://github.com/vilicvane/code3d/issues/6) and
[#12](https://github.com/vilicvane/code3d/issues/12). The final integration is
[`162497e`](https://github.com/vilicvane/code3d/commit/162497e3887dc5cd5b7936307353d68b4ba5d73f).
Acceptance covers ordinary Windows npm projects, direct Node execution, actual
directory handles, repeated Worker compilation, and native resource release.
The supported layouts and measured lifetime limits are recorded below.

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
  version. Until the root package metadata declares core, App supplies
  built-in core/screws for zero-install authoring. Declaring core transfers the
  entire runtime to the project; App never replaces a missing declared package.
- The same author source must be usable by App and directly executable in a
  supported Node runtime.
- Author modules use standard ESM imports and exports. code3d does not introduce
  a private module syntax.
- Reusable model libraries are normal packages and may be imported from local
  `node_modules`.
- Source files remain the only persistent model state. Packaging must not add a
  parallel model document or build-history format.
- Every source file remains eligible as the current App preview root.
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
- `@code3d/core/tooling`: the explicit internal boundary used by the App to
  initialize an evaluation, attach trace metadata, finalize snapshots, and
  release resources.

The exact export names may change during extraction if the runtime dependency
graph shows a cleaner boundary. The important boundary is that App must not
classify values using its own copy of core classes. Project code and tooling
must operate on the same installed core instance, and the App receives a
serializable result through tooling. App and core evolve together during
prototyping; this internal integration surface does not promise API stability.

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

App uses the browser/tooling entry from the project's installed package and
keeps the corresponding kernel alive across source evaluations. The installed
core version, not App's build-time dependency, owns the compatible geometry
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

Browser examples and loose local models use the same read-only built-in package
view. App distributes the actual npm-published files and fetches reached
bytes lazily; it no longer preinstalls the full distribution or creates dependency
metadata in the project. Existing user-owned package files remain untouched.

### 2. Module resolution

Create one explicit resolver service over the project filesystem. The current
candidate is `enhanced-resolve`, whose modern browser build accepts a custom
filesystem and implements package `exports`, `imports`, conditions, hierarchical
`node_modules`, and dependency tracking.

Use separate resolution intents over the same service:

- author/editor types: NodeNext-compatible type and declaration resolution;
- App runtime: browser/import/default package conditions and executable
  JavaScript;
- Node smoke tests: Node's own resolver is the authority.

This distinction is intentional. A package may expose different Node and
browser implementations, but their advertised public type contract must agree.
App build diagnostics catch dependencies that have no browser-compatible
implementation even if their declarations are valid.

Select the effective package filesystem before resolving any imports:

- If root `package.json` declares `@code3d/core` in dependencies,
  devDependencies, peerDependencies or optionalDependencies, use only project
  packages. Missing core or screws must not load their built-in counterparts.
- Otherwise expose built-in core and screws at their root package paths. Their
  internal closure lives under `/node_modules/@code3d/node_modules`, using normal
  hierarchical resolution to isolate it from the project's replicad/kernel.
  Do not expose another core/screws copy inside that private closure or from
  nested project packages. All consumers must reach the same core instance.
- Other package imports continue to use the project's normal `node_modules`.
- Loose models default to ESM through a read-only package metadata view; an
  explicit project `type` is respected. No files are written to a local folder.
- Both persisted and unsaved manifest changes select the new view and invalidate
  the runtime. Source-only edits retain the selected kernel and dependency caches.

This user-confirmed default replaces the earlier blanket prohibition on built-in
packages. It is not a resolver-error fallback or a hand-coded `require` shim.
Blocked exports, malformed metadata and missing declared packages remain errors.
Direct Node execution still requires installing dependencies in the project.

### 3. TypeScript language service

Remove the hand-maintained `authoringTypes` string and the synthetic
`file:///node_modules/code3d/index.d.ts` registration.

Monaco should see the project's real source files and the declaration closure
reachable from its imports. Load declarations lazily from the same selected
package view as model evaluation, and update them as metadata or lockfiles change. Monaco's
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

1. Resolve the project's installed `@code3d/core` and its tooling entry.
2. Create a project-local runtime capsule and initialize its OpenCascade kernel
   once.
3. Build the selected source root and its reachable graph using ESM authoring
   semantics.
4. Execute a fresh instance of the user module graph for each accepted revision
   while reusing only the platform runtime capsule.
5. Let the installed tooling entry inspect its own model values and return a
   serializable model/trace snapshot to App.
6. Drop evaluation-owned object references after the snapshot boundary while
   keeping dependency-owned model values and the kernel ready for reuse.
   Do not forcibly dispose models that an installed package may cache privately.
   Unreachable Replicad wrappers release native resources through finalizers.

Tooling initializes OpenCascade and `@code3d/solver` from the same
selected package graph, including each module's own WASM asset.
The core package selects `@code3d/opencascade`, whose checked-in runtime is
rebuilt from a pinned toolchain and binding configuration. Its generator patch
restores native destruction for classes that provide both ordinary and placement
delete. Upstream 1.0.0 and 1.1.0 incorrectly emit empty destructors for these
classes; invalidating JavaScript handles alone did not free their native geometry.
Topology traversal also releases every owned explorer result, including duplicate
occurrences, and consumes raw handles when creating independent Replicad wrappers.
The core Replicad interface also consumes the native B-Rep reader result before
returning an independent shape, so repeated screw-cache reads release their
geometry. Box construction owns and releases its temporary native point.
See [the kernel package](../packages/opencascade/README.md) for the source pins
and reproducible build command.

Node's core entry performs both installations; App installs both through the selected
tooling entry before evaluating author code.

Call `beginModelEvaluation(): void` before each serial source
evaluation. Source locations, parameter provenance, and operation traces live
in per-evaluation weak maps, separate from model geometry and stored relations.
Reusing a dependency's model must not reuse the previous revision's source
offsets. Completed snapshots remain independent of the next evaluation.

App must not use `instanceof` against a host-installed core to inspect values
from the project-installed core. Package or lockfile changes invalidate the
runtime capsule and rebuild it from the changed installed artifacts.

Model exports use the selected runtime's geometry snapshot and Replicad functions
as well; no host-initialized kernel participates in STEP/STL/3MF export. The latest
snapshot survives repeated exports and is released on recompilation, runtime
invalidation, or project disposal. Worker export requests identify the completed
compile revision so an older preview cannot export a newer model accidentally.

The execution layer now uses native ESM following the isolated experiments in
[#12](https://github.com/vilicvane/code3d/issues/12). esbuild handles TypeScript,
CommonJS interop, linking, and source-module cycles. Closed bundles export an
internally generated async execution function, so old native module exports do
not retain per-run models. Authors still write ordinary ESM, without factories.
Dependency execution scopes and module namespaces are retained separately from
fresh source execution scopes; literal dynamic imports remain demand-driven.
There is no Babel/SystemJS stage or host-package substitution.

Cached ESM dependencies keep an ESM re-export facade over the retained namespace;
an internal CommonJS getter carrier preserves live bindings. Generated facade and
carrier paths have their own module-format extensions, while dependency identity
remains the original resolved path. In particular, a cached `.mjs` must not carry
CommonJS source under its original extension, or default exports disappear.
The facade explicitly preserves the original default-export presence, including
for `.mjs`/`.mts` consumers; actual CommonJS dependencies retain CommonJS interop.
Regression tests include the published `just-range@4.2.0` artifact with builtin
core, declaration loading, and repeated model edits retaining dependency identity.

Compiled native functions are deduplicated by content hash within the project
Worker. Revoking a Blob URL releases its mapping, not the native module record.
Distinct compiled code remains until the Worker ends (project close, execution
cancellation, or timeout). Ordinary completed source edits retain that Worker
and its expensive kernel caches. The 360-edit isolated natural-GC experiment
released obsolete model wrappers and kept geometry caches hot; full project
Worker acceptance now also covers a real Windows npm directory through the native
picker and a `DirectoryFileReader`. The full Worker reads only reached package
files, without enumerating `node_modules`.

Dependency graph preparation is serialized only until its unevaluated static
modules are reserved. Execution runs outside that lock; each completed module
publishes its namespace and wakes imports waiting for that module. This preserves
shared dependency identity under concurrent imports, including when a parent
uses top-level await to import a second graph that shares an already initialized
child. Failed graphs release waiters and retain their evaluation error for the
runtime lifetime. Unrelated imports remain usable.

The supported local-project baseline is ordinary npm installations in Windows
Chromium and Node 24 (verified with win32 Node 24.13.1). Browser execution requires
browser-compatible packages; Node built-ins and native addons are diagnosed,
without automatic polyfills. Symbolic-link layouts used by pnpm or workspace
links have no support claim in this baseline. Dynamic imports must have a string
literal specifier; computed specifiers receive a source diagnostic. Relative
resource URLs use `new URL(literal, import.meta.url)`.

Build diagnostics retain the original file and UTF-16 source range, including
imports preceded by multibyte UTF-8 text. Resolver errors use the importing source
location rather than plugin implementation stacks. Runtime package preparation
errors identify an author import when one exists.

Full-Worker acceptance on Windows Chrome 152 uses a multi-file plate fillet
plus ISO4762 screw project installed with npm. Measurements distinguish the
kernel's `wasmMemory.buffer.byteLength` from JavaScript heap and CDP backing
storage: backing storage alone did not reveal the native geometry leak. The
corrected kernel passes 10,000 owned-shape release cycles and 1,200 distinct
fillet/mesh operations with its linear memory remaining at 100 MiB. The same
owned-shape regression fails against the upstream 1.0.0 kernel.

With the final package graph, 360 distinct edits plus five identical repeats in
one Worker kept WASM linear memory at 208,732,160 bytes (about 199 MiB). All 366
observed plate WeakRefs were empty after GC. The cold compilation took 5.52 s;
subsequent edits had a 458 ms median and 588 ms p95. Only 46 distinct package
files were read. The bounded operation cache reached 256 entries.

Compiled ESM code grew from 924,325 to 3,918,531 bytes, about 8.3 KB per distinct
variant; the five identical recompilations added no code. JS used heap after GC
grew from 46.0 MB to 56.4 MB.

Distinct compiled ESM code remains until the Worker ends; source variants are
content-deduplicated. These measurements do not claim zero JS growth for
unlimited distinct edits. Closing the project or terminating its Worker releases
the complete native-module cache. Full acceptance details are tracked in #12.

## Implementation sequence (historical)

The phases below preserve the migration plan and its verification criteria.
They are not pending work; the retained implementation and support boundaries
above and below describe the completed system.

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

- Convert the repository to a private workspace root with App and core
  packages at their best final locations.
- Move the true author runtime and its tests into `@code3d/core`.
- Generate JavaScript and declarations from one source instead of maintaining a
  parallel declaration string.
- Define explicit public and tooling exports and package the compatible kernel
  asset.
- Replace App runtime-class knowledge with serializable tooling protocol types.

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

- Let managed examples start without installing packages or writing configuration.
- Change all imports from `code3d` to `@code3d/core` directly.
- Expose the exact built package artifacts lazily through the built-in package view.
- Update the editable fastener library to exercise the same reusable-package
  boundary intended for external libraries.
- Do not add migration code, deprecated aliases or resolver-error fallback.
  Both package selections feed the same resolver, builder and language service.

### Phase 6: verify the retained system

At minimum, verify:

- `node src/model.ts` executes a multi-file project using its installed core;
- ordinary TypeScript emit produces runnable JavaScript and valid declarations;
- the same source root produces equivalent geometry in App;
- every project source file can still be selected as a preview entry;
- imports from ESM and CommonJS browser-compatible dependencies build;
- a reusable model package shares the project's peer core instance;
- missing core, blocked package export, missing file extension, and Node-only
  browser dependency errors are located and understandable;
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

## Confirmed support boundaries

- Node 24 is the documented runtime; the native Windows acceptance used
  Node 24.13.1 for direct TypeScript, TypeScript emit, and emitted JavaScript.
  Authors do not need `tsx` or an initialization function.
- The Node core entry initializes both OpenCascade and the constraint solver
  before author module execution. App initializes the selected browser
  package through its tooling entry.
- Ordinary npm installations are the verified local layout. No support claim
  is made for pnpm/workspace symlinks or paths outside the selected directory.
- Browser dependencies must provide a browser-compatible implementation.
  Node built-ins and native addons are rejected without polyfills.
- Reusable packages are uninstrumented dependencies. Their public model values
  participate in App snapshots; their private implementation source is not
  transformed into author traces.
- Native ESM with internal source execution scopes and persistent dependency
  scopes replaces Babel/SystemJS. The lifetime and measurements above describe
  the retained implementation.
- The repository packages are `@code3d/app`, `@code3d/core`, `@code3d/solver`,
  `@code3d/opencascade`, and `@code3d/screws`.

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
