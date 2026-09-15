---
title: Code3D vs Zoo Design Studio
description: 'Compare Zoo Design Studio and Code3D for AI-assisted CAD: KCL or TypeScript model source, graphical edits, reusable components and an agent workflow you can continue.'
lastUpdated: 2026-09-15
head:
  - tag: title
    content: 'Code3D vs Zoo Design Studio: AI CAD with Editable Code'
sidebar:
  label: Zoo Design Studio
  order: 6
---

If the appeal of AI-assisted CAD is a model you can keep developing after the
first prompt, Zoo Design Studio and Code3D share that ambition. Code3D brings
it into a TypeScript workflow: ordinary functions and imports, reusable npm
components, graphical edits to source, and agents working in your open project.

_By Code3D. Reviewed September 15, 2026._

## An AI CAD alternative built around your TypeScript workflow

Code3D is a Zoo Design Studio alternative for programmers who want TypeScript to remain the model source. You can reuse modules and browser-compatible npm packages, make supported graphical edits, and connect an existing coding agent. Both products combine code, geometry and agents; the choice is the language, model API and execution environment around that loop.

## Keep building with the programming tools you know

Zoo uses KCL as the source for parametric models. Point-and-click modeling and
Zookeeper can generate KCL, and users can edit the same code directly. Models
are stored as `.kcl` text files.
[Zoo Design Studio workflow](https://zoo.dev/docs/zoo-design-studio/getting-started).

KCL is a CAD language with functions, parameters, modules and geometric
operations. It supports reusable parts and ordinary text-based version control.
[KCL documentation](https://docs.zoo.dev/docs/kcl).

Zoo also provides a TypeScript SDK: its Engine API tutorial sends typed modeling
commands over a WebSocket, while a higher-level web-view helper can submit KCL.
That lets developers build applications on Zoo's services. It does not make
TypeScript the editable model language of Zoo Design Studio.
[Zoo's TypeScript Engine API tutorial](https://docs.zoo.dev/docs/developer-tools/tutorials/beginner-onboarding-js).

Code3D uses TypeScript source and the JavaScript module ecosystem. Source
inspection exposes intermediate model values; supported sketch, topology and
parameter tools write changes back to the program. Reuse can include a model's
named references and its parameter-tool annotations.
[Code and geometry](../concepts/code-and-geometry.md),
[reusable models](../guides/reusable-models.mdx).

| Decision             | Zoo Design Studio                                         | Code3D                                                 |
| -------------------- | --------------------------------------------------------- | ------------------------------------------------------ |
| Model source         | KCL files                                                 | TypeScript files                                       |
| Agent entry          | Integrated Zookeeper and external clients through Zoo MCP | Connect an existing local coding agent to the open App |
| Geometry environment | Zoo's cloud-native Engine API                             | OpenCascade WebAssembly evaluation in the browser App  |

Zoo documents its [Engine and Agent APIs](https://zoo.dev/docs), including their
role in the product. Code3D's [runtime documentation](../../../../../../core/docs/runtime.md)
describes its browser geometry execution.

## The next edit matters as much as the first generation

Zoo MCP lets external AI clients call Zoo modeling and CAD utilities. It is
therefore possible to keep an existing assistant and review the resulting
models in Zoo, rather than using only its embedded assistant.
[Zoo MCP](https://zoo.dev/docs/developer-tools/mcp).

Code3D connects an agent to the project already open in the App. Each agent has
its own identity and visible activity; source updates are checked against file
versions, and requested images appear in the interface. The
[agent guide](../guides/agents.mdx) covers that connection and review process.

## Try the handoff on a real enclosure

In either product, a useful evaluation is to ask an agent to resize an enclosure,
inspect the generated source and geometry, then adjust the result yourself.
Check how easily you can find the relevant sketch or expression and continue
editing after the agent's change.

For Code3D, also try moving a reusable part builder into another TypeScript file
or a browser-compatible npm package, with its annotations and attachment names
intact. The [practical models guide](../guides/practical-models.mdx) supplies actual
sketch and assembly sources for this exercise.

## Which workflow fits?

Try Code3D if you want your CAD model to participate in the same habits as your
other code: refactor a function, inspect its result, extract a reusable package,
and ask an agent to continue working on it. Source-aware graphical tools add a
spatial way to make supported edits within that workflow.

Consider Zoo when its KCL-based environment, integrated agent and hosted geometry
services are the stack you want to work with. Both products connect code,
graphics and agents; your choice should reflect the environment you want around
the model.

Browser execution does not make every Code3D workflow offline: loading the App,
installing packages, remote fonts and an agent's own provider can require a
network. Code3D is an early prototype with
[specific editing coverage](../getting-started/limitations.md). Start with the
[agent handoff on a mounting plate](../guides/agents.mdx#try-a-handoff-on-an-existing-model)
and try alternating between your changes and the agent's.
