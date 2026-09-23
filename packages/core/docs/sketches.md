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

### Drawing and snapping in the App

Select a sketch to draw continuous lines, rectangles, circles and arcs. **Snap**
includes existing points (endpoints and centers), intersections of lines, circles
and arcs, line and arc midpoints, and the four quadrant points of a circle.
Geometry features take priority over the grid. Hold **Alt** to bypass snapping,
or turn **Snap** off. Entered dimensions and X/Y direction locks remain in effect.
Computed snap positions do not add persistent constraints; snapping to an existing
point reuses that point's identity.

With focus on the drawing canvas, **Undo** returns to the previous drawing step.
Undoing a line segment restores its starting point so you can draw a replacement
segment immediately. Undoing an arc restores its center, start point, direction
and numeric inputs so you can choose a new endpoint. Unfinished steps, such as
choosing an arc's center or start, can also be undone. **Redo** restores these
steps and completed geometry. Circle and rectangle tools follow the same rule.
Inside a numeric field, Undo and Redo edit the text. **Escape** cancels the current
draft; switching tools or editing the source ends that drawing history.

### Construction geometry

Select one or more local lines, circles or arcs and click **Construction** in the
Modify toolbar group. They appear dashed in the editor and 3D view and stay available for snapping,
constraints and editing, but do not contribute boundaries to `face()`, `faces()`
or the filled region preview. For example, a rectangle can have a construction
diagonal without losing its single face. Click **Construction** again to restore
ordinary boundaries; a mixed selection first makes all selected curves construction.
The toggle affects each complete authored curve, even when you select one of its
displayed intervals. Selected points keep their identity and geometry.

The change is saved in source, and Undo/Redo restores it as one operation. Trimming
construction geometry preserves that role on the surviving pieces. Upstream curves
remain read-only; computed entity type names must be changed in code.

Authors use `['aux:line', 5, [1, 2]]`, `aux:circle` or `aux:arc`. Turning the toggle
off removes the `aux:` prefix and restores the ordinary type name. See
[construction geometry](api/sketch-entities.md#construction-geometry).

Closed areas are detected at line, circle and arc intersections, including an arc
endpoint that meets the middle of a line. Open line tails do not prevent a closed
area from becoming a face. An ordinary diagonal divides a rectangle into two
regions; making it auxiliary restores one. Nested contours retain their holes and
islands. Overlapping duplicate boundaries require trimming.

### Editing dimensions and constraints in the App

Click a dimension label, such as a circle's **R** label, to edit its value or
TypeScript expression. After you change or add a dimension or geometric
constraint in the sketch editor, a successful solve also synchronizes safely
writable local geometry inputs. One Undo or Redo restores both the constraint
and those geometry inputs.

Existing points on lines, circles and finite arcs stay connected during these
edits, including construction geometry. For example, making a line perpendicular
to a construction radius keeps their shared endpoint on the circle and moves
other free points as needed. These connections are preserved in the written
coordinates; the operation does not add extra constraint tuples.

Synchronization preserves expressions and upstream geometry. It does not choose
between independent evaluations of the same source definition. When the source
cannot be safely synchronized, the App keeps the source mismatch warning.
If keeping a connection conflicts with the new constraint or requires replacing
an expression, the edit reports an error and retains the last successful view.
Direct source edits also retain this warning and an explicit **Fix** action
where safe. A failed solve shows diagnostics and keeps the last successful
sketch, when available, as a read-only reference.

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
