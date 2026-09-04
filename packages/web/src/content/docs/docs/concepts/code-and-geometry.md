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
change its inputs to obtain a requested result. In such cases, edit the
expression in code.

## Geometry and topology

OpenCascade evaluates B-Rep geometry. The viewport displays the resulting
surfaces and edges, and the App connects those objects to source context.
Public models and topology references do not require you to manipulate an
OpenCascade object.

Topology IDs describe elements in a specific model. Named elements let you
publish the domain meaning of those elements to a caller.
