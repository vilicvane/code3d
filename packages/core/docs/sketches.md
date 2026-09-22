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
[sketch reference](api/sketch.md)
and [agent sketch workflow](../../../docs/agents/sketches.md) for constraints,
derived layers, observations, and failure diagnostics. Use the [entity](api/sketch-entities.md), [constraint](api/sketch-constraints.md),
[derived-layer](api/sketch-derive.md) and [region](api/sketch-faces.md) references
for complete API rules.

### Relating a sketch to a model plane

`s.relate(self => align(self.plane, target))` returns a new sketch with spatial
relations, leaving its shared 2D definition and the original sketch unchanged.
It works before a face exists, including `sketch()` and open contours.

```ts
import {align, box, sketch} from '@code3d/core';

const host = box(40, 20, 30).rotate(0, 0, 25);
const profile = sketch([
  ['point', 1, [0, 0]],
  ['circle', 2, [1, 4]],
]);
const opening = profile.relate(s => align(s.plane, host.surface(4)));
const result = host.cut([opening.face().extrude(-20)]);
const draft = sketch().relate(s => align(s.plane, host.surface(2)));
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

In the App, select the related value (`opening`) and choose **Edit sketch** to edit against read-only model
outlines projected into the sketch's local plane. Select `profile` and choose **Edit sketch** for its original
local view. Both edit the same source array, with ordinary undo; separate placements
of that geometry are not separate authoring definitions. Context outlines are
visual references only, not snapping targets or imported geometry constraints.
The select-surface-and-create UI is tracked separately within
[#114](https://github.com/vilicvane/code3d/issues/114).
Try [mounting-plate.ts](../../app/examples/sketches/mounting-plate.ts).

## Selection and dragging

In Select, an ordinary click or box selection replaces the selection, Ctrl
toggles elements, and Shift only adds them. Drag a box left-to-right for fully
enclosed geometry or right-to-left for intersecting geometry. A multi-selection
can remove any editable local constraint on its elements, while adding one
requires the entire selection to satisfy the tool's prerequisites. Parallel
accepts two or more local lines and creates pairwise relations; Perpendicular
and Angle between lines require exactly two. Rectangle tools still create
horizontal and vertical constraints by default.

Drag an arc endpoint to reshape it while preferring to keep its center in place.
Drag a circle or arc center to move it while preferring to keep its radius
unchanged. Hard constraints, expression-controlled values and read-only upstream
geometry take precedence; these preferences can keep the dragged point from
reaching the pointer. They apply only during the gesture and do not add persistent
fixed or radius constraints. To change an editable radius, drag the curve itself
or edit its source or dimension.
After the gesture-specific preferences, all other points prefer staying near
their gesture-start positions. This lowest-priority step only resolves remaining
freedom: it does not pull back a translated shape, weaken hard constraints or
add fixed-point constraints to the source.
