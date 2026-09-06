---
title: Current capabilities and limitations
description: What to expect from Code3D Prototype 01.
---

Code3D is Prototype 01. APIs and project behavior are still evolving.

## What works

- TypeScript model functions and relative imports across project files.
- B-Rep primitives, curves, profiles, lofts, boolean operations, fillets,
  chamfers, uniform-wall shells, and threaded geometry.
- Source-context inspection, topology selection, supported parameter editing,
  and relative-position tools.
- Editable model origins and geometric rotation, with vertex picking,
  translation arrows, and rotation rings.
- Directional bound contacts with combined positional conditions and explicit
  pivot, vertex, or axis rotations when composing parts.
- Geometric alignment of points, curves, and surfaces, including joint
  position and orientation solving for supported analytic geometry.
- Relation previews through each selected call, with distinct emphasis for
  the selected reference, its counterpart, and surrounding related objects.
- Topology source paths through lofts, booleans, fillets, chamfers, and shells,
  with face-to-edge-to-vertex queries and named exposed references.
- Browser-persistent projects and direct local-folder editing in supported
  browsers.
- Typed named elements and reusable metric fasteners.
- Browser-compatible npm packages from the project's installed dependencies.
- Custom solid primitives with parameter tools, built through Replicad.
- STEP, STL, and 3MF model export, plus PNG viewport images.

## What to account for

**GUI writeback changes source, not isolated instances.** The App can update a
unique upstream value, replace a numeric argument expression from a panel, or
adjust a spatial expression with a drag. It does not automatically invert
arbitrary functions. An edit to a shared call or variable can affect several
objects. See [parameter editing](../../guides/model-tools/#what-a-panel-can-edit).

**Geometric operations can fail.** A fillet, chamfer, or shell must fit the input
geometry. Shelling requires one connected solid and cannot remove every face.
Offsets through tight curvature, narrow features, or complex intersections can
fail even when the thickness looks reasonable. On some lofts between different
profile shapes, adding openings fails even though a closed cavity succeeds.
Closed cavities use a complete offset and subtraction; openings require
additional boundary construction. Smaller thicknesses may still fail.
Results without offset walls are rejected instead of returning the unchanged
solid. Later operations must select topology from their own input model.

**Bound relations only translate.** Multiple positional conditions solve together
and conflicting positions report errors. Rotation must be explicit. Directional
bounds are the only `on` targets; finite source geometry may be a whole model or
selected point, edge, or surface. See [positioning with relations](../../guides/relations/).

**Geometric alignment supports analytic geometry.** `align` supports points,
straight lines, circles, ellipses, planes, cylinders, and spheres. It uses the
underlying geometry beyond trimmed edges and face boundaries. Other curve and
surface types report unsupported. Proven incompatibility (such as different
circle radii) is distinguished from numerical nonconvergence. Multiple solutions
can remain; add point relations when a specific position matters.
For several relations involving align on one model, use numeric parameters or
source edits so each change resolves the joint system. Spatial drags are
available for a single align relation. See
[geometric alignment](../../guides/relations/#align-underlying-geometry).

**Intermediate relation stages have their own diagnostics.** Inspecting an
early call can expose a conflict with inherited constraints even when the
completed chain is valid. The preview reports that stage's error and leaves
the final model available for inspection.

**Installed packages must support browsers.** The App resolves packages from
the project's `node_modules`, but does not provide Node's built-in APIs or
native addons. Core and screws are built in until the project declares core;
after that, missing project packages are errors. See
[modeling packages](../../getting-started/files/#modeling-packages).

**Local-folder access depends on the browser.** File System Access and a secure
context are required. External edits need an explicit Reload folder.

**The geometry engine has a substantial initial download.** It loads with
App, while the website and documentation can be read independently.

**Export the intended context.** Model export uses the foreground geometry
currently being inspected, not every model in the file. STEP supports solids,
curves, and surfaces; STL and 3MF require solids. Check the output scale and
orientation in the receiving application. Exporting does not validate that
a part is printable or manufacturable. See [exporting models](../../guides/exporting/).

**A Worker is not a security sandbox.** It keeps modeling code off the UI
thread and can be terminated, but only run model source you trust.

## Licensing

Code3D uses the [Interim Community License](../../../license.txt).
Community use, modification, and sharing are permitted, as is ordinary
commercial design. Competing commercial software or services require written
permission. Your own designs and outputs do not have to be published or use
this license merely because you use Code3D.

Third-party components retain their own licenses.
The OpenCascade WASM dependency includes LGPL-licensed OCCT; redistributions
need to preserve its applicable license and source-availability information.
Code3D's interim license does not replace these
third-party licenses.
