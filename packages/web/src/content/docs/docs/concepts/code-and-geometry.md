---
title: Code and geometry
description: Understand source expressions, model values, and visual edits.
---

## One durable model

The TypeScript program is the persistent model. GUI tools write their supported
changes back to that source, where they can be read, formatted, diffed, and
undone. Tools do not maintain a parallel hidden CAD document.

## Model values

A model operation produces a value. For example, `base.fillet(1)` returns
a rounded model without changing the observable geometry of `base`.
Relations and exposed elements follow the same value semantics.

A group composes values. A boolean operation evaluates its operands into new
geometry. These operations are distinct even when their viewport results look
similar.

## Runtime contexts

One source expression can execute multiple times, such as inside a loop or
function. The App tracks those runtime results and lets source and viewport
selection identify the relevant instance.

Inputs and outputs are separate contexts. In `part.rotate(0, 30, 0)`, the
`part` occurrence refers to the input model, while the method call refers to
the rotated result. Model-valued arguments are tracked through ordinary
function calls too; this inspection does not require tool annotations.
See [inspecting inputs and results](../../getting-started/app/#inspect-inputs-and-results).

A collection of models uses the members' resolved composition positions,
including arrays, sets, and map values. Even a one-element collection keeps
that placement; inspecting the member by itself uses its local frame. This
lets you inspect a `map(...)` result without its related parts collapsing onto
the same local origin. A collection is not a new group model or an implicit
group-level position tool.

Inside a relation chain, inspection stops at the selected call. For example,
`self.on(base.up).offset(6, 0, 0).rotate(0, 0, 25)` shows contact at `on`, the
translated pose at `offset`, and the rotated pose at `rotate`. Later calls do
not move an earlier preview. The highlighted references indicate which side
you are inspecting while the other related objects remain as context. See
[relation previews](../../guides/relations/#inspect-the-right-scope).

Selecting an intermediate expression is a way to inspect the model, not an
instruction to rewrite the program's entry point. Exporting a value is an
optional publishing boundary.

## Source provenance

To edit a parameter, a tool needs to know where its value came from. Code3D
follows TypeScript definitions when the chain leads uniquely to supported,
editable source. This includes some values reached through variables and
object properties.

Being able to evaluate an expression does not mean the App can invert it.
A function call might produce a number, but there may be no unique way to
change its inputs to obtain a requested result. A numeric panel can show that
result as a placeholder and replace the whole argument when you type a value.
A position or rotation drag can instead retain the expression and add an
increment. Neither operation solves for the expression's inputs.

These are source edits. If a loop or function uses the same call more than
once, changing its expression can affect every occurrence. Shared upstream
parameters can affect other call sites too. See
[parameter editing](../../guides/model-tools/#what-a-panel-can-edit) for examples.

## Geometry and topology

OpenCascade evaluates B-Rep geometry. The viewport displays the resulting
surfaces and edges, and the App connects those objects to source context.
Public models and topology references do not require you to manipulate an
OpenCascade object.

Topology IDs describe elements in a specific model. Named elements let you
publish the domain meaning of those elements to a caller.
