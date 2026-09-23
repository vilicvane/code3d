---
title: Tooling integration API
description: Browse every Core host integration API for evaluation, resources, snapshots, geometry, inspection and cache ownership.
sourceReview:
  packageVersion: 0.0.1-alpha.16
  sources:
    - path: packages/core/src/tooling/index.ts
      sha256: 60d91eaa40d822c84dca66e7792af9072bccc8e8c6a9c738f18011bf2174bf73
    - path: packages/core/src/node/index.ts
      sha256: 2c314699c2b47768bc4ae14b7713dc9eceb1111a3de7417820bdf4347bda3104
      commit: 5c8979f384280b644263a2d6ba3abacb69697c24
    - path: packages/core/src/library/index.ts
      sha256: 8f5784bccbc2f8a47139a71af3c3fbfe0c1e767dc9dcd61902fa06413dd40f54
      commit: b4fe7de02f59acbd2614a592a4b8ce0586243b22
sidebar:
  hidden: true
head:
  - tag: title
    content: Tooling integration API — Code3D TypeScript API reference
---

The `@code3d/core/tooling` entry serves execution hosts such as the Code3D App. It exposes runtime services, value guards and plain snapshot contracts; ordinary model files use `@code3d/core`.

## Example

```ts
import {box} from '@code3d/core';
import {
  isModelObject,
  modelObjectRuntimeInfo,
  disposeModelObjects,
} from '@code3d/core/tooling';

const model = box(20, 10, 8);
if (isModelObject(model)) {
  try {
    const {nodeId, name} = modelObjectRuntimeInfo(model);
  } finally {
    disposeModelObjects([model]);
  }
}
```

## Signature

```ts
import * as tooling from '@code3d/core/tooling';
```

Import host APIs from `@code3d/core/tooling`; author constructors remain in `@code3d/core`.

## Browse by responsibility

| Topic                                                       | Scope                                                                                                                 |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [Input, time and cache scopes](tooling-inputs.md)           | Establish serial host scopes for numeric inputs, playback time and compiler-supplied cache identities.                |
| [Runtime and resource installation](tooling-resources.md)   | Install a host runtime and resource loader, prepare Google Font requests and decode native exceptions.                |
| [Kernel cache integration](tooling-cache.md)                | Control shared cache budgets and persistence, inspect counters and implement a synchronous artifact store.            |
| [Sketch snapshots and solving](tooling-sketches.md)         | Snapshot sketch layers, retain point identities and run the same constrained solver used for evaluation and dragging. |
| [Sketch curves and regions](tooling-sketch-curves.md)       | Evaluate analytic sketch curves, find intersections and extract finite closed regions from snapshot layers.           |
| [Model evaluation and lifetimes](tooling-evaluation.md)     | Own serial evaluation scopes, identify model objects, retain geometry and dispose native resources.                   |
| [Relation preview and tracing](tooling-relations.md)        | Preview consumed placement stages, attach source provenance and interpret relation snapshots.                         |
| [Model operations and snapshots](tooling-snapshots.md)      | Capture model trees, source traces, reference geometry and batched mesh or bounds queries for host integration.       |
| [Rigid transforms and quaternions](tooling-spatial.md)      | Compose and invert rigid frames, rotate vectors and convert Code3D XYZ angles to quaternions.                         |
| [Topology IDs and retained inspection](tooling-topology.md) | Compare hierarchical topology IDs and query paged native geometry from a retained model snapshot.                     |
| [Material snapshots and colors](tooling-materials.md)       | Capture supported native materials, parse color shorthand and read exportable base color and opacity.                 |
| [Inspection recording and identity](tooling-inspection.md)  | Record per-call inspector data and map preview copies back to their source focus identities.                          |

## Host execution order

1. Initialize the compatible kernel, font engine and sketch solver once per runtime; install resource and artifact services before evaluating authors.
2. Serialize evaluations. Establish evaluation, input, time and recording scopes, retaining each exit function for `finally`.
3. Evaluate modules, collect the complete model/relation graph, finish snapshot queries and produce render/source snapshots while native geometry remains alive.
4. Retain geometry needed by later native inspection or export. End scopes and release author objects when their evaluation is no longer needed; dispose retained geometry separately.
5. Keep source traces, parameter records and preview identities local to their evaluation. Transfer encoded inputs and plain query results across Workers rather than native handles.

Each topic lists all its exported functions/types, inherited host members,
configuration fields and result branches. Shared authoring types link back to
their primary modeling reference. The public declaration inventory currently has
83 values and 73 types; implementation-only exports absent from this subpath
are not additional host APIs.

## Entry points

`@code3d/core` uses a Node entry that initializes its modeling runtime. The browser
entry and `@code3d/core/tooling` rely on host installation. Native builders use
[@code3d/core/replicad](define-primitive.md); appearance objects use the shared
[@code3d/core/three](three.md) exports. These entry points share runtime identity
and resource ownership within the same Core instance.

Independent frames are recognized by [isFrame](tooling-evaluation.md#isframe).
[modelOperationObject](tooling-snapshots.md#modeloperationobject) resolves model,
frame and sketch authoring results into runtime relation participants.
