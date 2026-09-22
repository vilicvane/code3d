---
title: Inspection recording and identity
description: Record per-call inspector data and map preview copies back to their source focus identities.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/app/src/model/inspection.ts
      sha256: 22de3db44e18aef80c032f550835e1cf74ad9bcd899abeb246eda1ad53778ebf
      commit: 257dac61457d3ec723fd8054ebcb2e12daceba85
    - path: packages/core/src/library/inspect.ts
      sha256: 41c720ebec3e0ebe941a3b6e7c18f0db08badec6e95021d5e29c59d88c13b5a8
      commit: 257dac61457d3ec723fd8054ebcb2e12daceba85
sidebar:
  hidden: true
head:
  - tag: title
    content: Inspection recording and identity — Code3D TypeScript API reference
---

Tooling hosts use these APIs to record per-call inspector data and map preview copies back to their source focus identities.
Ordinary models should use the [authoring reference](../api.md).

## Example

```ts
import {captureInspectData} from '@code3d/core';
import {recordInspectionCalls, inspectionIdentity} from '@code3d/core/tooling';

let data: unknown;
const finish = recordInspectionCalls(value => {
  data = value;
});
try {
  captureInspectData({length: 20});
} finally {
  finish();
}
const object = {};
const identity = inspectionIdentity(object); // same object when no remapping exists
```

## Signature

```ts
// Host integration entry point
import * as tooling from '@code3d/core/tooling';
```

Import host integration functions and named types from `@code3d/core/tooling`.

## Recording scope

`recordInspectionCalls(record)` installs the current invocation's data sink and
returns a function restoring the previous sink. Pair every scope with `finally`,
including thrown modeling calls and nested invocations. The helper only provides
the scope; the host must associate it with the correct evaluated call/getter or
closure record. Serialize executions sharing the same runtime context.

[captureInspectData](inspectors.md#call-data) calls the sink with the supplied
reference. Multiple writes use the last value when the host stores a single
`data` field. No recording scope means no-op capture. Values are not cloned;
retain immutable facts when later mutation must not affect inspection.

The host should suspend modeling capture while inspectors execute so inspection
work cannot overwrite the author's call records. Record thrown calls only if
they were actually entered; argument failures or optional-call short circuits
are not invocations of the outer function.

## Focus identity

`inspectionIdentity(value: object)` returns the original object identity retained
by a positioned preview, or the argument itself when no mapping exists. The
mapping is runtime-only and weakly held; do not serialize it or use it as a
persistent geometry identifier. The helper does not copy, transform or register
an identity. Core's [inspectGroupMembers](inspect-group-members.md) and annotation
helpers preserve the appropriate focus identity when making preview copies.
See [custom inspectors](inspectors.md) for complete scene/context types.

## API contracts

The declarations below list the public fields, optional values and union branches.
Import these exports from `@code3d/core/tooling`. Referenced implementation types
that are not re-exported are inferred from function results; do not invent imports
for them. These signatures describe the contract rather than a standalone program.

### recordInspectionCalls

```ts
function recordInspectionCalls(record: (data: unknown) => void): () => void;
```

### inspectionIdentity

```ts
function inspectionIdentity(value: object): object;
```
