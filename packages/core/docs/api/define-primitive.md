---
title: definePrimitive and Replicad
description: Build custom Code3D solids with the shared Replicad runtime, typed constructors and explicit native-resource ownership.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/core/src/library/replicad.ts
      sha256: 937b1c0bcdd8389e9c3724bb8bf867c3703509400a6bebfcfbcc84c8683e17fe
      commit: 5058f1bbd8f9289ad89f0cf6cb19f7b5fa143eae
    - path: packages/core/src/library/runtime.ts
      sha256: 1caf8c92de983f0c22b4da70e0af4216472b9ff8fe8e2f0ebc34ec9a84e259b0
    - path: packages/core/src/library/kernel-shapes.ts
      sha256: 4b28f672f9c5ac43a1dfa04ced8d2f1eacce9a2c7eaaaac561d885f7efc95ac8
      commit: 1baef99a1318fc694825ec0a48d4d39635a3a130
    - path: packages/core/src/node/replicad.ts
      sha256: b53f513b10a84dfee7347593f8bbf1384eb7da4f89e9c69856aed16c1f4afc3a
      commit: 87d2dd4cb6c8cbb080fe4949868245eb34e8c6b1
sidebar:
  hidden: true
head:
  - tag: title
    content: definePrimitive and Replicad — Code3D TypeScript API reference
---

`definePrimitive` turns a synchronous Replicad solid builder into a Code3D constructor. The resulting model supports ordinary placement, named references, materials and solid operations.

## Example

```ts
import {definePrimitive, replicad} from '@code3d/core/replicad';

const peg = definePrimitive((radius: number, height: number) => {
  if (![radius, height].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('Peg dimensions must be positive finite numbers.');
  }
  return replicad.makeCylinder(radius, height, [0, -height / 2, 0], [0, 1, 0]);
});
export default peg(4, 20).material('#9bc7c5');
```

## Signature

```ts
// Import from @code3d/core/replicad.
definePrimitive<Builder extends (...args: never[]) => Shape3D>(
  build: Builder,
): (...args: Parameters<Builder>) => SolidModel;

type Replicad = Omit<typeof import('replicad'), 'getOC' | 'setOC'>;
const replicad: Replicad;
```

Import `definePrimitive`, `replicad`, `Replicad` and upstream types from
`@code3d/core/replicad`; `SolidModel` belongs to `@code3d/core`.

## Builder and result

The builder is synchronous and returns exactly one native solid. Its parameter
tuple, optional parameters and defaults are preserved by the returned function.
Validate your own dimensions and dependencies inside the builder. An async
builder, a model value, face, shell or multi-solid compound is not a valid result.
A compound/compsolid containing exactly one solid can be normalized only when
it has no stray lower-dimensional geometry outside that solid.

Each call returns a fresh `SolidModel` with canonical references and fresh model
identity. Core uses the builder's geometry coordinates; it does not automatically
center arbitrary native geometry. The example explicitly starts the cylinder at
`-height / 2` along Y. Choose coordinates and construction directions to match
[Code3D local coordinates](../local-coordinates.md).

For a complete twisted knob with a bore, parameter annotations, intermediate
cleanup and two instances, see the [custom primitive workflow](../custom-primitives.mdx)
and its [App source](../../../app/examples/primitives/custom-primitives.ts).

## Ownership

Returning the solid transfers ownership to Core. Do not delete, mutate or return
that same handle again. The builder still owns intermediate shapes and resources,
including resources created before an exception. Use `try` / `finally` and
Replicad's `localGC()` for intermediates. Do not register the final returned
shape with a cleanup scope that deletes it before Core receives it.

Some native operations consume their input; follow the specific Replicad
operation's ownership behavior. Core normalizes and owns the returned solid,
then its evaluation host disposes model resources. Ordinary model authors do not
need access to the OpenCascade instance.

## Caching

Deterministic construction, normalization, topology and geometry analysis are
cached by builder identity and encoded arguments. A hit skips the builder but
creates a fresh model with independently owned geometry handles and source
tracing. Pass changing captured state explicitly. The App fingerprints static
builders and their dependencies for persistent reuse; dynamic closures and
standalone Node calls use memory-only function identity.

The cache shares host budgets with Core's other operations. Use [cache](cache.md)
for ordinary data computations; native geometry needs the ownership-aware
primitive path. Do not depend on the builder running on every invocation for
side effects or external state updates.

## Replicad integration

`@code3d/core/replicad` exports `replicad`, `definePrimitive`, the `Replicad`
type, and upstream Replicad types such as `Shape3D` and `Sketch`. Runtime
functions and classes are properties of `replicad`; they are not individually
re-exported as value imports by this entry point.

`replicad` is a frozen API object using the same OpenCascade runtime as Code3D.
`getOC` and `setOC` are intentionally omitted; installing the kernel is a host
responsibility. Code3D also wraps `deserializeShape` so the returned native
handle follows its ownership convention. In Node, importing this subpath
initializes the shared runtime; browser hosts must initialize the runtime first.
Do not initialize a second kernel or mix native handles from separate instances.

For upstream operations, use the [Replicad API reference](https://replicad.xyz/docs/api/).
The cylinder example uses [makeCylinder](https://replicad.xyz/docs/api/functions/makeCylinder).
The [Shape reference](https://replicad.xyz/docs/api/classes/Shape/) documents native
transforms, serialization and deletion. These upstream APIs are not copied into
Code3D's authoring reference.
