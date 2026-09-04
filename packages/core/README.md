# `@code3d/core`

The code3d authoring runtime. Model projects install this package directly and
may execute the same ESM TypeScript source in code3d or a supported Node.js
runtime.

The public API includes solid primitives and Boolean operations, first-class
planar face models (`circle`, `ellipse`, `rectangle`, `regularPolygon`), 3D
curve models (`line`, `arc`, `bezier`, `spline`), point models, and
through-section or spine-guided `loft`. Every geometric model is immutable,
renderable, and relation-aware. Topology capabilities follow dimension:
vertices provide `.vertex(id)`, edges add `.edge(id)`, and faces and solids
add `.surface(id)`; only solids provide `fillet` and `chamfer`. Groups retain
the common relation, expose, and paint capabilities without pretending to
contain geometry. Stable topology references can be used as complete relation anchors.
`relate()` records placement for composition with other values; inspecting or
rendering the resulting value by itself keeps its intrinsic local frame.
