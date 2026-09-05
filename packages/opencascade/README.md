# @code3d/opencascade

The OpenCascade runtime selected by `@code3d/core`. It uses the `replicad-opencascadejs@1.0.0`
binding ABI and corrects native object destruction in the binding generator.
The dependency on `replicad-opencascadejs` supplies the matching declarations
used by Replicad and core. This package exports its own generated loader and WASM.

The upstream generator treats any two-argument `operator delete` as evidence
that a class cannot be destroyed. OCCT's allocation macros provide both ordinary
and placement delete, so this incorrectly emits empty destructors for shapes,
builders, and other owned native objects. JavaScript `.delete()` then invalidates
the handle while retaining its native allocation and referenced geometry.

The build patch checks whether the C++ delete expression is valid. Publicly
deletable objects run their actual destructor and deallocator. The existing
handling of objects whose destructor or deallocator is inaccessible is retained.

Run `npm run build --workspace @code3d/opencascade` with Docker available to
rebuild the checked-in runtime. The build pins the Linux amd64 toolchain image
by digest and includes the original binding configuration, native extractor
sources, and the generator patch. Rebuilding uses several gigabytes of disk and
can take tens of minutes. Ordinary repository builds use the checked-in files.

Upstream sources:

- Replicad binding configuration and extractors:
  [0180bf7384cd9f98b1b167e5ca19d2c9f6067fe4](https://github.com/sgenoud/replicad/tree/0180bf7384cd9f98b1b167e5ca19d2c9f6067fe4/packages/replicad-opencascadejs).
- Binding generator and toolchain:
  [ebd263f15337b440b391492af073662707e86482](https://github.com/taucad/opencascade.js/tree/ebd263f15337b440b391492af073662707e86482),
  built against OCCT 8.0.1.

See `LICENSE.LGPL-2.1` for the runtime license.
