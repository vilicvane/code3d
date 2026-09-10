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

`@code3d/solver` / OndselSolver remains an independent workspace package.
Current core/App directional-bound relations solve translations directly and
do not depend on or initialize that package.

# Fonts and text

Font parsing, shaping and variable-font outlines use `harfbuzzjs` 1.6.1 (MIT).
The Node entry and App model engine initialize its WebAssembly runtime; Code3D
owns immutable font values instead of Replicad's global font registry. Google CSS
subsets are resolved by the App, which uses `woff2-encoder` 2.0.0 (MIT), its
decompress-only entry and bundled WASM to decode downloaded WOFF2 files.

Overlapping glyph contours use `flo-boolean` 5.0.8 (MIT), preserving Bezier curves
and the non-zero winding rule with no minimum-area filtering. Version 5 avoids
the unconditionally used `Map.getOrInsert` in version 6, which is unavailable in
our Node runtime. Its transitive `squares-rng` 2.0.4 has a workspace patch in
`patches/squares-rng+2.0.4.patch`: its original window/Node test misclassifies Web
Workers, so base64 decoding now uses the shared `globalThis.atob` API. The RNG
algorithm and embedded WASM are unchanged. The built-in package file distribution
includes this patched module; independent package installations need the same fix
until upstream supports Worker environments.

The dependencies' distributed licenses accompany the built-in dependency closure.
Text contours use Replicad/OpenCascade curves. Code3D groups nested glyph contours
explicitly to avoid the multi-hole grouping bug tracked in Replicad PR 278 and
Code3D issue 85; this is not a patched Replicad distribution.

The App example includes unmodified DejaVu Sans with the adjacent Bitstream Vera
license notice. Tests also include Noto Sans CJK OTF and Roboto variable TTF subsets
under their adjacent SIL Open Font Licenses; see `test/fonts/README.md` for provenance.
