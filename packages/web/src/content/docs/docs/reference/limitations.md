---
title: Current capabilities and limitations
description: What to expect from Code3D Prototype 01.
---

Code3D is Prototype 01. APIs and project behavior are still evolving.

## What works

- TypeScript model functions and relative imports across project files.
- B-Rep primitives, curves, profiles, lofts, boolean operations, fillets,
  chamfers, and threaded geometry.
- Source-context inspection, topology selection, supported parameter editing,
  and relative-position tools.
- Editable model origins and geometric rotation, with vertex picking,
  translation arrows, and rotation rings.
- Combined geometric relations between points, lines, planes, and complete
  frames, solved together when composing parts.
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

**Geometric operations can fail.** A fillet or chamfer must fit the input
geometry. Later operations must select topology from their own input model.

**Constraint solving is local and nonlinear.** Several relations can jointly
determine a part's placement. Remaining freedom is resolved using centering and
orientation preferences; an explicit offset adds a position condition.
A failed solve does not prove that no valid pose exists. See
[positioning with relations](../../guides/relations/#combine-conditions).

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
Rigid-body relations use OndselSolver through `@code3d/solver`, distributed
under LGPL-2.1-or-later. Code3D's interim license does not replace these
third-party licenses.
