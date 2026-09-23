# Sketch modeling and observation

[Start here](../agents.md) · Read this when editing sketches or interpreting their solved geometry, constraints, layers and regions.

## Edit and observe sketches

Use the same full-source `apply` workflow for sketch entries and constraints. Read
the [sketch API](../../packages/core/docs/api/sketch.md) and inspect the
expression with `"type": true` before choosing operations. Keep useful intermediate
profiles named, use constraints to express design intent, and build faces or solids
from those profiles with the core API.

Reference curves use the `aux:` type prefix, such as
`['aux:line', 5, [1, 2]]`. `aux:line`, `aux:circle` and `aux:arc`
still solve and remain observable, but `face()` and `faces()` exclude them in all
layers. Remove the prefix to restore an ordinary boundary. Use it for diagonals, axes or other guides that must not change the material
regions. See [construction geometry](../../packages/core/docs/api/sketch-entities.md#construction-geometry).

For example, a derived profile can reuse an upstream center while adding its own
constrained circle. The source radius `3` is a starting value; the constraint
solves it to `8`:

```ts
import {sketch} from '@code3d/core';

const base = sketch([
  ['point', 1, [0, 0]],
  ['circle', 2, [1, 20]],
]);
const profile = base.derive(
  [
    ['point', 1, base.point(1)],
    ['circle', 2, [1, 3]],
  ],
  {constraints: [['radius', 2, 8]]},
);
const sleeve = profile.face().extrude(10);
```

Direct source edits can leave a successful constraint solution different from
the authored geometry inputs, as in this example. The App reports a source
mismatch warning and offers **Fix** when it can safely synchronize local literal
coordinates and radii. Preserve expressions and upstream geometry; do not choose
one solution to write back when the same definition has multiple independent
evaluations.

When a user changes or adds dimensions or geometric constraints in the sketch
editor, the App automatically applies that safe synchronization after a successful
solve. The constraint change and synchronized geometry share one Undo or Redo.
The edit also retains existing point-on-line, point-on-circle and finite
point-on-arc connections, including construction curves, in the resulting
coordinates. It does not persist extra constraint tuples. Direct source edits
still solve only the authored constraints. An incompatible connection or a repair
that would replace an expression reports an error and retains the previous view.
An unsafe synchronization leaves the warning in place; a failed solve retains
diagnostics and the last successful sketch, when available, as a read-only reference
in the editor.

For a source binding named `profile`, a cursor-only observation can be:

```json
{
  "operation": "apply",
  "input": {
    "cursor": {
      "file": "/model.ts",
      "regex": "const (profile) ="
    },
    "render": true,
    "topology": true,
    "type": true
  }
}
```

Sketch rendering uses the same three-dimensional inspect scene as the App. It
shows solved points and curves at their actual placement, including multiple
non-coplanar sketches and models together when an inspector returns them.
The 960×720 PNG supports every `render.view` and both Modeling and Render modes,
with perspective projection in `observation-scene` coordinates. Grid, constraint
labels and editing controls belong to the App's separate 2D sketch editor.
Function arguments and JSDoc fallback work for sketch observations too.

Sketch summaries have `kind: "sketch"`. For a single sketch, `s0` is the selected
layer; `s1`, `s2`, and so on are its ancestors, nearest first. Mixed scenes
continue these keys across their sketch instances and also include B-rep `mN`
models. Each summary gives its `layerId`, `base`, source location, available
upstream variable `references`, local entity counts and bounds, degrees of
freedom, and redundant constraint indices. Geometry stays in local 2D: map
sketch `[x, y]` to model `[x, 0, -y]`, then apply the summary's `geometryToScene`
transform to locate it in the screenshot. Upstream geometry is read-only in the
selected layer: edit its defining source or create a derived layer.

`topology.kind: "sketch"` distinguishes this response from B-rep topology. Items
are ordered as local entities, local constraints, then region summaries:

- Points, lines, circles and arcs retain layer-local IDs and explicit point
  addresses `{layer, id}`. Points include their solved `position` and any alias;
  curves include solved analytic `geometry` and optional `construction: true` for
  reference curves excluded from regions. Arc `start` / signed `sweep` use
  radians; angular constraint values use degrees. Units are model units.
- `authoredParameters`, when present, are evaluated source inputs, which may
  differ from the solved geometry. Preserve expressions and constraints when
  editing; do not blindly replace the source with solved coordinates.
  A library wrapper that supplies hidden constraint options remains inspectable,
  but has no editable definition or automatic source Fix action.
- Constraint items contain their evaluated `value` tuple and zero-based `index`,
  with a `redundant` flag. Constraint and region indices are snapshot-local,
  not persistent IDs. Entity IDs belong to their layer; two layers can use the
  same number. Runtime layer IDs also belong to the current snapshot.
- Region summaries include outer-curve counts, holes and bounds for the layer
  together with its upstream geometry. Empty and open-only sketches have zero
  regions. Intersections delimit closed regions; open tails do not invalidate them.
  Overlapping boundaries remain observable: `regions.available: false` includes
  the reason, and `counts.region` is `null`. Trim overlaps before creating a face.

Use actual source bindings for references such as `base.point(1)`; `references`
only lists upstream names available in the defining scope. B-rep `.edge()` and
`.vertex()` selectors do not address sketch entities.

Page with the existing `topology: {snapshotId, model: "s0", offset, limit}`
options; the same snapshot lifetime and page limits apply. Choose another `sN`
to inspect that ancestor. B-rep `kind` / `ids` filters return
`sketch_filter_unsupported` for sketches. When rendering a snapshot page, the
image retains the complete inspect scene; `model` selects topology data only.

A failure downstream of a valid sketch does not block that sketch's observation.
Failure to evaluate the selected sketch returns a model diagnostic. An inspector
can supply a diagnostic scene alongside that failure; no stale image is reused. Source acceptance and saving remain separate from evaluation success.

## Related reading

Start with the [Core README](../../packages/core/README.md) for the sketch authoring API. [Observation](observation.md) covers snapshot lifetime, while [cursor and arguments](cursor.md) controls the selected expression.
