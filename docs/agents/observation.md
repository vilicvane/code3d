# Rendering, types and topology

[Start here](../agents.md) · Read this to choose a camera or display mode, inspect types, identify geometry, or page through an observation.

## Render, types, and topology

```sh
npx --yes @code3d/cli@latest project.c3d.json --request-id inspect-001 < /tmp/inspect.json
```

`"render": true` requests a 960×720 PNG in Modeling mode with the default isometric
view. The image uses the App's inspect scene, including its target, ambient
geometry and passive annotations. Models and sketches can appear together.
`mode` and `view` are independently optional:

```json
{
  "operation": "apply",
  "input": {
    "render": {"mode": "render", "view": "front"}
  }
}
```

`mode` accepts `"modeling"` or `"render"`. Modeling shows the same selection
emphasis and helpers as the App's Modeling mode. Render uses authored materials
without modeling helpers, just like the App's Render mode. Omitting `mode`
defaults to Modeling **for each request**, including retained snapshots; it does
not inherit a previous request's mode. `observation.render.mode` reports the
actual mode. The example uses the agent's retained cursor; add `cursor` to select
a different model, and combine it with file changes or other outputs as needed.

Use `"render": {"view": "front"}` for a named view: `isometric`, `front`, `back`, `left`,
`right`, `top`, or `bottom`. A custom view uses
`"render": {"view": {"direction": [1, 1, 1], "up": [0, 1, 0]}}`. Direction points
from scene center toward the camera: +X right, +Y up, +Z front. The up vector must
not be parallel to direction. The scene is fitted with perspective projection.
When following that agent, explicitly supplied `view` and `mode` also update the
user's viewport. An omitted field does not force its screenshot default onto the
user's view. Without follow, both options only affect the returned image.

`"type": true` returns the selected expression's static TypeScript type, signatures,
documentation, and up to 100 members with `membersTotal`. It can run without
model evaluation and combine with other outputs. `observation.type` is `null`
when no suitable syntax is selected.

`"topology": true` returns model summaries and B-rep geometry from the same engine and
observation as the rendering. Input and result geometry have different ID
namespaces. Use returned model bindings and `.edge(id)`, `.surface(id)`, or
`.vertex(id)` suffixes in their real source scope; do not invent bindings, reuse
result IDs for operation inputs, assume IDs survive rebuilds, or assume millimeters.

Summaries include source context, counts, named elements, and kernel-enclosure
bounds. Faces include available area, center, boundary edges, and analytic
properties; edges include length, endpoints, adjacency, and analytic properties;
vertices include coordinates and adjacent edges. Curved-face normals identify
the sample location and whether it lies inside the trimmed surface is unverified.
Unavailable geometry is labeled explicitly. Coordinates use the observation
scene, with `geometryToScene` and `storedOrigin` identifying frames. Sketch
topology remains local 2D; its summary provides `geometryToScene` for locating
those values in the same screenshot. Inspector-generated geometry is queryable
within the observation snapshot too.

When modeling fails but the selected inspector produces a scene, the response
keeps `ok: false` and `error.code: "model_failed"`. Its
`error.details.observation` contains the modeling diagnostic together with the
available `snapshotId`, model summaries, topology and render metadata. Requested
PNG artifacts are returned normally. Use this scene to diagnose the failed call;
it does not mean the modeling operation succeeded. Paging that snapshot keeps
the same failure status and original diagnostic.

If inspection also fails, no earlier image is substituted. The modeling error
stays primary and `inspectionDiagnostic` describes the additional inspection
error. An inspector failure after successful modeling uses `inspect_failed`.

For additional entries, submit a separate apply payload:

```json
{
  "operation": "apply",
  "input": {
    "topology": {
      "snapshotId": "<returned snapshot>",
      "model": "m0",
      "kind": "edge",
      "offset": 48,
      "limit": 100
    }
  }
}
```

Use the returned `snapshotId`, model key, `nextOffset`, and optionally `ids`.
`limit` is 1–200. Defaults return up to 16 model summaries and 48 entries,
prioritizing operation inputs, then target geometry before ambient geometry. Snapshot queries cannot also change source or the
cursor. Snapshots expire after another observation, source/project changes,
worker restart, reload, or five minutes; `snapshot_expired` requires a fresh observation.

Model execution has no 15-second limit. Applying new source stops the old compiler
worker and supersedes its observation. Transport deadlines are independent and do
not roll back changes. A stuck compilation can be replaced by applying new source.

## Related reading

See [cursor and arguments](cursor.md) to choose the evaluation target, [sketches](sketches.md) for sketch topology, and [recovery](recovery.md) for superseded or failed observations.
