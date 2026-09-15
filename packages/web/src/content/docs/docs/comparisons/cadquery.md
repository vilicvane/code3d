---
title: Code3D vs CadQuery
description: 'Compare CadQuery with Code3D for programmable CAD: Python workplanes or TypeScript model functions, visual source editing, npm reuse and connected coding agents.'
lastUpdated: 2026-09-15
head:
  - tag: title
    content: 'Code3D vs CadQuery: Interactive CAD for Programmers'
sidebar:
  label: CadQuery
  order: 2
---

Once a model becomes a program, debugging geometry becomes part of programming.
Code3D lets you inspect the geometry at a source expression, then adjust supported
parameters and placements in that same context. If you use CadQuery, this is the
workflow to compare alongside the change from Python to TypeScript.

_By Code3D. Reviewed September 15, 2026._

## A CadQuery alternative with an integrated editing loop

Code3D is worth evaluating as a CadQuery alternative when you want the editor, intermediate geometry inspection and source-editing tools in one App. The main change is how you develop the model, alongside the move from Python to TypeScript. It does not execute existing CadQuery scripts.

## Bring the geometry into your editing context

CadQuery is a Python library using OpenCascade through OCP. Its fluent API builds
models through workplanes and selectors: select a face, establish a workplane,
and add the next feature. The library is deliberately separate from its GUI.
[CadQuery introduction](https://cadquery.readthedocs.io/en/latest/intro.html).

You can use CadQuery with CQ-editor or a notebook environment, as well as in
Python scripts. The relevant comparison is therefore your chosen CadQuery
editor and execution setup, not a claim that CadQuery offers no graphical view.
[Installation and editor options](https://cadquery.readthedocs.io/en/latest/installation.html).

Code3D's App supplies the editor, geometry view and source-editing tools together.
Moving through a model expression changes the inspected geometry. Supported
parameter panels, topology selection and relation tools act on the corresponding
source. [How source and geometry connect](../concepts/code-and-geometry.md).

| Decision                 | CadQuery                                           | Code3D                                                             |
| ------------------------ | -------------------------------------------------- | ------------------------------------------------------------------ |
| Program and dependencies | Python and its package environment                 | TypeScript and browser-compatible npm packages                     |
| Typical construction     | Workplanes, chained operations and selectors       | Model values, explicit sketches, topology references and relations |
| Execution setup          | Python runtime with an optional editor or notebook | Browser App with geometry evaluation in a worker                   |

Code3D's [project and package guide](../getting-started/files.md) describes its
browser and local-folder modes. The browser runtime does not provide Node native
addons or built-in Node APIs.

## Give a part family an interface people can use

If plate dimensions come from a Python data pipeline, a CadQuery function can
consume that data and construct each variant in the same environment. Its
workplane and selector idiom is especially relevant when the next feature is
defined relative to a face of the previous result.

In Code3D, keep a plate builder in a TypeScript module and give it parameter
annotations. A caller can then use its tool panel while inspecting that call's
geometry. Return named mounting references when another component needs to
attach to it. The [reusable models guide](../guides/reusable-models.mdx) demonstrates
both the function boundary and its graphical interface.

## Automation and the choice to make

CadQuery also defines a gateway for applications to parse and build model
scripts with parameters. It is an automation-capable library, not simply a
manual editor. [CadQuery gateway interface](https://cadquery.readthedocs.io/en/latest/cqgi.html).

Code3D's [agent connection](../guides/agents.mdx) lets an existing coding session
operate on the project open in the App and request types, geometry and images.
This is useful when you want to alternate your own visual edits with an agent's
code changes in the same environment.

Try Code3D when the appealing part of code-based CAD is building reusable
components, and you want to inspect and manipulate them inside the editing loop.
An [annotated model function](../guides/model-tools.mdx) is a useful first test:
change its implementation, edit a call visually, and reuse it elsewhere.

Prefer CadQuery when Python integration or its workplane API is central to your
project. Both use an OpenCascade-based geometry stack, but individual operations
and editing coverage differ. Check Code3D's [current limitations](../getting-started/limitations.md)
with a representative part.
