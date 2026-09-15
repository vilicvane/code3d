---
title: Runtime and integration
description: Cache computations, integrate native materials and embed the modeling runtime.
sidebar:
  order: 11
---

## Cached computations and custom primitives

`cache(fn)` memoizes synchronous, deterministic data computations;
`cache(fn, args)` immediately returns the cached result for an argument tuple.
Both forms share the same function identity and argument keys. Supply custom
codecs in the third argument: `cache(fn, undefined, options)` for a function or
`cache(fn, args, options)` for a value.
Pass changing captured state as arguments and treat returned data as immutable.
Memory hits reuse the retained result; optional `encoder` / `decoder` pairs only
run when saving to disk or restoring it. Newly computed entries are eligible
for disk storage when computation reaches the configured threshold (1 ms by
default). Faster results remain in memory and are not encoded or written on later
memory hits. Change the threshold in **Settings → Cache** in the App; it applies
to new computations and preserves existing cache entries. Existing
disk records can still be restored. The App fingerprints static definitions
and their dependencies for persistent reuse; dynamic closures and ordinary Node
calls use function identity for memory reuse. No author cache IDs are needed.

`definePrimitive(builder)` from `@code3d/core/replicad` also caches construction,
normalization and geometry analysis. Each call still creates fresh model metadata
and independently owned geometry handles. The builder transfers its returned
solid to Core and owns its intermediate resources. Screws uses this shared cache.
Read [cached computations](api.md#cached-computations)
and [custom primitives](custom-primitives.mdx)
for supported data, resource ownership and examples.

## Materials and entry points

`.material()` accepts a color or a native Three.js material. Use
`@code3d/core/three` when constructing native materials, and
[@code3d/materials](../../materials/README.md) for common presets. A model captures
its material value; changing the original Three.js object later does not change
that model. The renderer supplies lighting and environment reflections.

| Import                  | Responsibility                                                           |
| ----------------------- | ------------------------------------------------------------------------ |
| `@code3d/core`          | Public model authoring API; Node entry initializes the kernel            |
| `@code3d/core/three`    | Shared Three.js exports for material and geometry integration            |
| `@code3d/core/replicad` | Replicad access for custom primitive builders                            |
| `@code3d/core/tooling`  | Evaluation, inspection and resource lifetime integration used by the App |

Tooling integrations own evaluation lifetimes and disposal. Follow the existing
[tooling entry](../src/tooling/index.ts), [evaluation tests](../test/model-test.ts), and
[App compiler](../../app/src/model/compiler.ts) when embedding the runtime. Ordinary
model files should stay on the authoring API.

## Source and development

For changes to Core itself, start with the [modeling architecture](../../../.agents/docs/architecture/modeling.md)
and shared [development guide](../../../.agents/docs/development.md), then follow
the implementation and tests below.

- [Public exports](../src/library/index.ts), [model runtime](../src/library/runtime.ts),
  and [public type tests](../test/public-types.ts).
- [Spatial values](../src/library/spatial.ts), [relation solving](../src/library/relation-solver.ts),
  and [topology](../src/library/topology.ts).
- [Cached computations](../src/library/cached.ts), [fonts](../src/library/font.ts),
  [text geometry](../src/library/text.ts) and their [tests](../test).
- [Material values](../src/library/material.ts), [kernel cache](../src/library/kernel-cache.ts),
  and [Node entry](../src/node/index.ts).
- [Executable App examples](../../app/examples) and [runtime tests](../test).

Public JavaScript entries are prebundled ESM with shared chunks. Node, browser,
tooling and interop entries share the same kernel and cache instances. TypeScript
declarations, declaration maps and their sources remain available for editor
navigation. The build and npm `prepack` use the same package build script; see the
[development guide](../../../.agents/docs/development.md#公开包产物) for installed
tarball verification and CI publishing.

For a standalone TypeScript project, include `ESNext` and `DOM` in `compilerOptions.lib`.
Use `module: "ESNext"` and `moduleResolution: "Bundler"` when esbuild or another
bundler handles execution. Code3D's App uses this resolution mode, supports
extensionless relative imports and selects browser package exports.
The public packages are built and verified with `skipLibCheck: false`. NodeNext
currently needs `skipLibCheck` because the `manifold-3d@3.0.1` declarations omit
relative `.js` extensions. Core includes the declaration dependencies needed by
its HarfBuzz and Replicad integrations.

From the repository root:

```sh
npm run build:packages
npm test --workspace @code3d/core
```

Use the [agent entry](../../../docs/agents.md) to work on a project through the CLI,
or the [App README](../../app/README.md) to develop the editor and visualization.
