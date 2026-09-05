# Sketch solver

The 2D sketch runtime uses the unmodified JavaScript/WebAssembly distribution
of `@salusoft89/planegcs` **1.2.0**, pinned in this package's dependencies and
the workspace lockfile. Code3D directly adapts its numeric `GcsSystem` API;
the upstream JSON sketch wrapper is not Code3D's model format.

- Distribution: [npm package](https://www.npmjs.com/package/@salusoft89/planegcs/v/1.2.0).
- Corresponding wrapper/build sources: [Salusoft89/planegcs at ee9b156](https://github.com/Salusoft89/planegcs/tree/ee9b156da9827a91a56a888a53520f63d5cffaa6).
- Referenced FreeCAD PlaneGCS sources: [FreeCAD at 5f8eac4](https://github.com/FreeCAD/FreeCAD/tree/5f8eac49f31626354ee69bf40616bac801ca5560/src/Mod/Sketcher/App/planegcs).
- The distributed `LICENSE` and wrapper source headers specify GNU LGPL 2.1
  or later. npm metadata says LGPL-2.0-or-later; retain the actual distributed
  license and notices rather than replacing them with that metadata shorthand.
- Copyright notices include Miroslav Šerý and Jiří Hon, Salusoft89; FreeCAD
  source files retain their respective original notices.

The App's built-in package distribution includes the dependency's own LICENSE,
source files, README, JS loader and separate WASM asset through the ordinary
package file manifest. Installed projects resolve the same files from their
own dependencies; Node uses the dependency's unmodified module initializer.
The linked source revision contains the upstream native build scripts and
instructions. This change consumes the published artifact, not a locally
rebuilt binary. The archive SHA-1 is
`b43dae3ab1e8eabdc693a56682894b72db953558`; the lockfile pins its SHA-512 integrity.

The independent assembly backend remains `@code3d/solver` / OndselSolver.
