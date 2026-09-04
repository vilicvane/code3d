# R-032 — Keep face and curve models visible

Status: closed

## Confirmed behavior

- Standalone face models such as `rectangle()` and `circle()` render their
  filled planar surface from either side of the plane.
- Standalone edge models such as `line()`, `arc()`, `bezier()`, and `spline()`
  render the curve in the model's painted color. Unpainted curves use the same
  neutral color as other unpainted model geometry.
- Curve visibility does not depend on increasing its line width.
- Solid surfaces retain their existing front-face culling, material, and dark
  boundary treatment.

## Closure

The model renderer now chooses the base material path by geometry kind instead
of treating solids, faces, and edges as the same surface-plus-boundary object.
Faces use double-sided surface material; edges skip the empty surface mesh and
use an opaque, untone-mapped curve material. Renderer tests cover face culling,
solid culling, unpainted curve visibility, and painted curve color.
