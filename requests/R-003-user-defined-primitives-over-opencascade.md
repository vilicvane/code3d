# R-003 User-defined primitives over OpenCascade

## Request

- Give users a supported path to build their own primitives from OpenCascade
  capabilities instead of waiting for code3d to wrap every modeling operation.
- This escape hatch is especially important while code3d's built-in primitive
  library is still incomplete.
- A custom primitive should behave like a built-in one: it must support normal
  composition, booleans, rendering, source tracing, parameters, and the object
  catalog.

## Architecture direction

- Put OpenCascade behind an explicit kernel/interoperability boundary. Do not
  expose a raw OpenCascade shape as the public `ModelObject` representation.
- Let a user-defined builder produce an opaque, code3d-owned geometry value,
  then adopt that value into a normal `ModelObject` with a fresh position
  relation.
- Keep geometry ownership and OpenCascade lifetime management inside code3d;
  raw handles must not escape a builder scope or be deleted by both user code
  and the runtime.
- Consider two layers: a stable, typed kernel facade for common topology and
  construction operations, plus a clearly marked low-level OpenCascade escape
  hatch for capabilities the facade does not yet cover.
- The API should work as ordinary JavaScript/TypeScript functions so custom
  primitives remain reusable modules rather than a separate plugin-only model.

Illustrative shape only; names are deliberately undecided:

```ts
const gear = definePrimitive(
  'gear',
  ({kernel}, teeth: number, radius: number) =>
    kernel.build(scope => {
      // Use the typed facade, or deliberately enter low-level OC here.
      return scope.adopt(/* kernel result */);
    }),
);

const driveGear = gear(24, 18);
```

## Required contracts

- Define exactly which returned topology types can become model geometry and
  how invalid, null, or non-solid results are reported.
- Ensure custom primitives run only after the OpenCascade kernel is ready and
  in the same worker/runtime boundary as built-in primitives.
- Preserve source and parameter provenance at the custom primitive call site;
  internal implementation details may optionally expose deeper diagnostics.
- Make meshing tolerance, serialization, caching, and geometry disposal follow
  the same policies as built-in primitives.
- Keep the interoperability layer versioned so upgrading OpenCascade does not
  silently break every user module.

## Open decisions

- Whether the first version exposes replicad's `Shape3D`, a code3d-owned
  `KernelShape`, or both through separate stable and unsafe APIs.
- Whether low-level builders may be asynchronous or must stay synchronous
  inside the compiler worker.
- How custom primitives publish editor types and documentation without
  requiring a full plugin system.
- Whether builder internals appear in the runtime lineage or collapse into one
  semantic primitive operation by default.
