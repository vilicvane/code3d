# `@code3d/solver`

An independent rigid-body constraint solver compiled from
[OndselSolver](https://github.com/FreeCAD/OndselSolver) to WebAssembly.
Current core/App directional-bound relations use a translation-only solver and
do not depend on or initialize this package.

The package is LGPL-2.1-or-later. It includes the code3d binding source and the
license text; upstream OndselSolver is copyright Ondsel, Inc. and contributors.
The unmodified upstream source is pinned to
`458510ddfd1a96f0afb4a045dc09b57dadd2617c` by `native/CMakeLists.txt`.

## Build

The checked-in `wasm/` artifacts are built with Emscripten **6.0.9** and CMake.
Regular TypeScript builds do not require a C++ toolchain. To regenerate them,
activate that Emscripten SDK and run from the repository root:

```sh
npm run build:solver
npm test --workspace @code3d/solver
```

`EMCMAKE` can name an absolute `emcmake` executable. To use a local checkout of
the pinned upstream source, pass
`-- -DFETCHCONTENT_SOURCE_DIR_ONDSEL=/path/to/OndselSolver` to the build script.
The build is static, single-threaded, and enables C++ exceptions. No OpenCascade
or browser dependency is linked into this module. `wasmBinary` and `locateFile`
are explicit initialization inputs, including inside a bundled Blob module.

## Solver boundary

`solve()` receives body poses, fixed-body flags, and relations between local
markers. Equations describe point-coordinate differences, displacement along
a marker axis, and direction cosines. Positions must use normalized units;
callers handle model-scale normalization and marker semantics. Quaternion order
is `[x, y, z, w]`.

Solving has two phases. All authored equations first participate in a least
squares feasibility solve, with fixed-body and quaternion equations retained
as hard conditions. Once feasible, the original equations become hard
conditions in Ondsel's Lagrange multiplier system, while centering and
orientation preferences form the secondary least squares objective. A small
pose regularizer selects otherwise undetermined freedoms.

This avoids treating a Jacobian dependency at an unassembled pose as proof of
nonlinear redundancy. Redundancy-removal retries are bounded. Every original
equation is retained and refreshed after solving, including equations removed
by Ondsel; a successful upstream return alone does not mean success. Callers
are responsible for any additional directed-frame semantics.

Results distinguish `solved`, `unsatisfied` residuals, and `failed` numerical
iteration. This is a local nonlinear solver: failure does not prove the
geometric system has no solution. Each call owns and releases its complete C++
system; JavaScript receives ordinary value objects and no native handles.
