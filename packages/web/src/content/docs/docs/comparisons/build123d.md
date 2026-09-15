---
title: Code3D vs build123d
description: 'Explore a build123d alternative for programmers: TypeScript parts with typed attachment geometry, reusable parameter tools, npm packages and live agent collaboration.'
lastUpdated: 2026-09-15
head:
  - tag: title
    content: 'Code3D vs build123d: Reusable Models and Visual Tools'
sidebar:
  label: build123d
  order: 3
---

A useful model function deserves a useful interface. Code3D lets a component
carry named attachment geometry and annotated parameter controls, so callers can
work with it without opening its construction code. For build123d users, that
combination of reusable code and interactive call sites is a good reason to try
a different authoring environment.

_By Code3D. Reviewed September 15, 2026._

## A build123d alternative for reusable model interfaces

Code3D is a build123d alternative when you want a reusable component to include its graphical editing interface. A TypeScript function can return named attachment geometry and expose call-site parameter tools through annotations. This is a change of modeling API and workflow, not a way to run an existing Python model unchanged.

## Reuse the component and its editing interface

build123d is a Python B-Rep modeling library built on OpenCascade. It provides
builder contexts for accumulating geometry and an algebra API for combining
objects and placements through expressions. Its explicit geometry types and
Python typing support are part of the programming interface.
[build123d introduction](https://build123d.readthedocs.io/en/latest/index.html),
[algebra concepts](https://build123d.readthedocs.io/en/latest/key_concepts_algebra.html).

Code3D uses TypeScript functions returning model values. You can reuse a model
without tool annotations, then add annotations to expose a parameter panel at
its call sites. Named references give other components a typed attachment
interface. [Building reusable models](../guides/reusable-models.mdx).

| Decision            | build123d                                | Code3D                                                       |
| ------------------- | ---------------------------------------- | ------------------------------------------------------------ |
| Construction style  | Python builders or algebraic composition | TypeScript functions, model operations and relations         |
| Editing environment | Python tooling with a chosen CAD viewer  | App editor and source-linked graphical tools                 |
| Placement interface | Locations and joint connections          | Named references and explicit relation/transform expressions |

The build123d documentation describes viewer options, including OCP CAD Viewer
and CQ-editor. Editor integration is already part of its ecosystem.
[Installation](https://build123d.readthedocs.io/en/latest/installation.html).

## Example: a box, lid and fasteners

In build123d, reusable Python functions can generate the parts. Joints then
describe connections between them. The library includes rigid, revolute, linear,
cylindrical and ball joints; connected joints can have positions or angles.
This is a meaningful assembly interface, not just absolute placement of solids.
[build123d joints](https://build123d.readthedocs.io/en/stable/joints.html).

In Code3D, expose the box's mounting references and relate the lid and screws
to them. Inspect the relevant relation step, select supported references, and
adjust its placement through tools that edit the expression. Try the screw-box
assembly in the [practical models guide](../guides/practical-models.mdx).

Code3D's placement relations should not be read as a promise of equivalent
joint or motion-simulation coverage. Its current analytic alignment and bound
contact behavior is described in the [capabilities guide](../getting-started/limitations.md).

## Which workflow fits?

Try Code3D when you want a component library that is convenient to use both in
code and through graphical controls. Put a builder behind a typed interface,
expose its attachment references, and share it as a module or npm package.

Prefer build123d when Python, its builder/algebra idioms or its joint workflows
are central to your project. The value of changing tools should be the authoring
experience you gain, not a translation of the same program into another language.

For agent-assisted work, the useful question is how edits get evaluated and
reviewed. In Code3D, [connected agents](../guides/agents.mdx) can inspect the same
open project, and their requested images and source activity are visible in the
App. Start with the [reusable component guide](../guides/reusable-models.mdx), then
let an agent change the component while you inspect a caller's geometry.
