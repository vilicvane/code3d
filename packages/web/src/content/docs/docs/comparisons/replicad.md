---
title: Code3D vs Replicad
description: 'Use Replicad directly or build models in Code3D? Compare a browser CAD library with source inspection, visual tools and agent collaboration built around it.'
lastUpdated: 2026-09-15
head:
  - tag: title
    content: 'Code3D vs Replicad: CAD Library or Modeling App?'
sidebar:
  label: Replicad
  order: 5
---

Replicad gives you the geometry building blocks. Code3D gives you a place to
develop model programs with source inspection, graphical tools and connected
agents. In fact, Replicad is part of Code3D's geometry stack, and you can use it
when implementing a custom Code3D primitive.

_By Code3D. Reviewed September 15, 2026._

## A Replicad modeling environment, not a replacement kernel

If you are looking for a Replicad editor or a ready-to-use modeling environment, Code3D supplies source inspection, supported graphical edits and agent connections around its model API. Replicad is part of that stack, and custom Code3D primitives can use it directly. You can adopt the authoring environment without treating the underlying library as a rival.

## Build your application, or start building your model

Replicad is a JavaScript CAD library using OpenCascade. Its documentation
introduces both an online workbench and library integration, so using it does
not require building an editor before trying a model.
[Replicad introduction](https://replicad.xyz/docs/intro/).

For an application using the library, Replicad documents initialization of the
OpenCascade WebAssembly module, worker use, rendering helpers, and model export.
Those are building blocks for a product with its own user interface.
[Using Replicad as a library](https://replicad.xyz/docs/use-as-a-library/).

Code3D adds model values, named attachment references, relations and source-aware
tools around its geometry implementation. The App brings together the project,
TypeScript editor, visualization and agent connections. Its
[custom primitive guide](../../../../../../core/docs/custom-primitives.mdx) shows how
Replicad construction can return a Code3D model that participates in that workflow.

| Decision           | Replicad directly                                            | Code3D                                                            |
| ------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------- |
| Starting point     | Modeling library or Replicad workbench                       | Integrated model authoring App                                    |
| Custom application | Build the interaction around your chosen modeling operations | Reuse Code3D's source inspection and supported editing tools      |
| Extension path     | Construct geometry through Replicad APIs                     | Return Code3D models from reusable functions or custom primitives |

## Example: a product configurator

Suppose a customer should choose three dimensions and a finish, then download a
part. Replicad can sit behind a purpose-built form and viewer. If the customer
should never encounter model source, that narrow application interface may be
the right deliverable.

If the user is developing the part itself, Code3D offers a different starting
point: inspect the current expression, select geometry, adjust supported
parameters, and connect a coding agent to the same project. A complicated
construction can remain inside a function while its callers get meaningful
controls. [Reusable models and their tools](../guides/reusable-models.mdx).

## TypeScript and agents

Replicad itself is written in TypeScript and documents typed editor workflows.
Type information is not unique to Code3D.
[Replicad with TypeScript](https://replicad.xyz/docs/advanced-topics/typescript/).

Code3D's additional integration is the [live project connection](../guides/agents.mdx):
an agent can inspect source, types and geometry, make checked file updates, and
request images that you can also review in the App. A custom Replicad application
can build its own integration around the library; the comparison is how much
of that authoring environment you want supplied.

Try Code3D when your next task is to develop a model and you want the surrounding
authoring tools ready to use. The [custom primitive guide](../../../../../../core/docs/custom-primitives.mdx)
is a direct bridge from Replicad construction to a component with Code3D's model
interface and tools.

Choose Replicad directly when the deliverable is your own application and you
want control over its modeling and UI boundary. Shared geometry foundations do
not imply identical API coverage; check Code3D's
[current scope](../getting-started/limitations.md) for the operations you need.
