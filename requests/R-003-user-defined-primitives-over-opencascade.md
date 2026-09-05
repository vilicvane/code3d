# R-003 User-defined primitives over OpenCascade

## Request

- Give users a supported path to build their own primitives from OpenCascade
  capabilities instead of waiting for code3d to wrap every modeling operation.
- A custom primitive should support normal composition, booleans, rendering,
  source tracing, parameters, and the object catalog.

## Confirmed interface

`definePrimitive(build)` is available from `@code3d/core/replicad`, together
with the Replicad API bound to core's kernel. It takes one synchronous builder
and infers the public constructor's parameters from that function:

```ts
import {definePrimitive, replicad} from '@code3d/core/replicad';

/**
 * @code3d.param radius {kind: 'length'}
 * @code3d.param y {kind: 'length'}
 */
export const column = definePrimitive((radius: number, y: number) =>
  replicad.makeCylinder(radius, y, [0, -y / 2, 0], [0, 1, 0]),
);

export const example = column(6, 12);
```

The root model API remains independent of Replicad shapes. The factory has no
definition options, opaque return token, or author-visible build scope.

## Implemented contracts

- The returned shape transfers to code3d and becomes a `SolidModel`.
  Intermediate resources remain the builder's responsibility under Replicad's
  ownership rules. Authors must not reuse or delete the transferred shape.
- The first implementation accepts exactly one solid. Single-solid aggregates
  from Replicad booleans are normalized; shells, multiple solids, and stray
  lower-dimensional topology are rejected. Rejected returned shapes are released.
- Builders run synchronously on every invocation, preserving validation and
  captured-state behavior. They are not memoized by arguments. Core identifies
  actual returned B-Rep content to reuse geometry, downstream operations, and
  meshes across evaluations while keeping each model independently disposable.
  The screws package privately caches deterministic thread B-Rep data with a
  bounded size; each use reads its own shape in the current kernel.
- Custom models use standard mesh tolerance and normal canonical anchors.
- Node imports initialize the shared kernel before author code executes;
  Studio waits for its worker kernel before evaluating models.
- `@code3d.param` annotations on the public callable variable are associated
  with the resolved call signature, including import aliases, re-exports, and
  emitted declarations. No wrapper or new annotation options are required.
- `@code3d.arguments` recognition is not expanded for primitive factories.
  An ordinary exported invocation supplies a standalone preview.
- `helicalThread` is a private consumer in `@code3d/screws`.
  `examples/fasteners.ts` consumes that implementation through the public screw
  generator. Tube and coil examples use the corresponding core primitives;
  they do not duplicate built-in geometry behind `definePrimitive`.
- `examples/custom-primitives.ts` is a separate runnable author example: a
  twisted knob with a D-shaped shaft bore, direct parameter annotations, a
  default twist angle, intermediate resource cleanup, and composed instances.
  A private package implementation does not replace this teaching example.

## Remaining decisions

- Versioning of the interoperability layer as Replicad/OpenCascade evolve.
- Whether separately installed Replicad versions can be connected safely.
- Whether future use cases justify additional topology dimensions or a distinct
  low-level OpenCascade entry; the current solid builder does not predeclare
  those APIs.
