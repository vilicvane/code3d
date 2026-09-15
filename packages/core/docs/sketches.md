---
title: Editable sketches
description: Create constrained sketches and relate their planes to model geometry.
sidebar:
  order: 7
---

## Editable sketches

Sketches are immutable 2D definitions, separate from B-Rep model values. Entries
carry positive IDs within a layer; constraints express what should stay true.
A derived layer can reference its upstream geometry.

```ts
import {sketch} from '@code3d/core';

const profile = sketch(
  [
    ['point', 1, [0, 0]],
    ['circle', 2, [1, 8]],
  ],
  {
    constraints: [
      ['fixed', 1],
      ['radius', 2, 8],
    ],
  },
);

export const part = profile.face().extrude(3);
```

Closed regions bridge sketches to ordinary face and solid modeling. Read the
[sketch reference](api.md#editable-sketch-regions)
and [agent sketch workflow](../../../docs/agents/sketches.md) for constraints,
derived layers, observations, and failure diagnostics. Exact tuple types and
solver behavior live in [sketch.ts](../src/library/sketch.ts) and
[sketch-solver.ts](../src/library/sketch-solver.ts).

### Relating a sketch to a model plane

`s.relate(self => self.plane.align(target))` returns a new sketch with spatial
relations, leaving its shared 2D definition and the original sketch unchanged.
It works before a face exists, including `sketch()` and open contours.

```ts
import {box, sketch} from '@code3d/core';

const host = box(40, 20, 30).rotate(0, 0, 25);
const profile = sketch([
  ['point', 1, [0, 0]],
  ['circle', 2, [1, 4]],
]);
const opening = profile.relate(s => s.plane.align(host.surface(4)));
const result = host.cut([opening.face().extrude(-20)]);
const draft = sketch().relate(s => s.plane.align(host.surface(2)));
```

The target may be a named plane or a planar `host.surface(id)`. The sketch plane
normal is local `+Y`; alignment uses the same directed-plane alignment, composition-axis offset
and rotation semantics as model relations. It does not implicitly center the
sketch on a trimmed surface. An unbounded sketch plane cannot use `on()` to place
finite geometry against a bound; use `align()`. Topology-only pivots such as
`pivotVertex()` require a geometric model, not an empty sketch frame.

`derive()`, `face()` / `faces()` and extrusion inherit the relations. Boolean
operations and loft resolve their inputs in the shared composition context;
placement is not baked into tuple coordinates. A spatial copy shares point
identities with its original, so a derived layer can still use `profile.point(id)`.
References target the actual immutable model value: creating a later rotated or
repositioned model does not redirect existing sketch relations.
The `relate` callback parameter represents the new sketch frame; every returned
constraint must involve it. References to the original sketch's plane stay on
the original frame.

In the App, select the related value (`opening`) to edit against read-only model
outlines projected into the sketch's local plane. Select `profile` for its original
local view. Both edit the same source array, with ordinary undo; separate placements
of that geometry are not separate authoring definitions. Context outlines are
visual references only, not snapping targets or imported geometry constraints.
The select-surface-and-create UI is tracked separately within
[#114](https://github.com/vilicvane/code3d/issues/114).
Try [mounting-plate.ts](../../app/examples/sketches/mounting-plate.ts).
