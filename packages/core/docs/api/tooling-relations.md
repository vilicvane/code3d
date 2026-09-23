---
title: Relation preview and tracing
description: Preview consumed placement stages, attach source provenance and interpret relation snapshots.
sourceReview:
  packageVersion: 0.0.1-alpha.16
  sources:
    - path: packages/core/src/library/runtime.ts
      sha256: dcee3d2388a9b7b3819bb4897edd894463daa0e5b519e832a3349fac98c3bff8
sidebar:
  hidden: true
head:
  - tag: title
    content: Relation preview and tracing — Code3D TypeScript API reference
---

Tooling hosts use these APIs to preview consumed placement stages, attach source provenance and interpret relation snapshots.
Ordinary models should use the [authoring reference](../api.md).

## Example

```ts
import {box, on, offset} from '@code3d/core';
import {
  isRelationExpression,
  relationTraceReference,
} from '@code3d/core/tooling';

const base = box(30, 4, 30);
export const part = box(8, 8, 8).relate(() => {
  const contact = on(base.up);
  if (isRelationExpression(contact)) {
    const trace = relationTraceReference(contact);
  }
  return [contact, offset(4, 0, 0)];
});
```

## Signature

```ts
// Host integration entry point
import * as tooling from '@code3d/core/tooling';
```

Import host integration functions and named types from `@code3d/core/tooling`.

## Expressions and source traces

`isConstraint` recognizes actual constraint values. `isRelationExpression` also
recognizes transformation expressions and unfinished pivot/axis selectors used
by source tooling. The runtime `Constraint` and `RelationExpression` classes are re-exported only
as types from this entry. They are opaque identity types; author [on](on.md), [align](align.md),
[coupleRotation](couple-rotation.md) and transforms through their public factories.

`instrumentRelation(expression, sourceRef, parameters)` attaches the current
execution's source provenance. `SourceRef` and `ParameterUsage` are described by
[model snapshots](tooling-snapshots.md). Provenance belongs to the evaluation,
not persistent geometry. `relationTraceReference(expression)` returns either a
constraint reference (constraintId, source, target, optional self) or a
transformation reference (transformationId, optional self).

`currentRelationSelf()` returns the active authoring callback's relation
participant, or `undefined` outside such a callback. It remains available to a
host while a free selector fails, allowing diagnostics to identify its receiver.
Do not retain it as a global notion of the selected model.

## Preview stages

`relationPreview(expression, preceding?)` asks for that expression's recorded
preview and can return `undefined`. `preceding` is the ordered expression prefix.
`relationSelectionPreview(self, preceding, context?)` previews an insertion or
selector prefix while retaining only placements inherited by its callback.
Supply expressions from the actual execution, in authored order; unrelated
expressions do not provide a meaningful placement stage.

`RelationPreview.object` is the node ID, composition transform, constraints,
transformations and relation stages needed for the scene; optional `spatial`
describes a selected spatial operation. Preview data is a snapshot of that stage,
not a write to the author's model and not a new persistent constraint.

## Constraint and transformation records

The complete readonly structures are listed below. `ConstraintSnapshot` has a
shared identity, source/target anchor identities and element snapshots, source
references and parameters. Its discriminated branches are:

- `'on'`: adds finite `sourceBounds` in the contact frame, local to the source node.
- `'align'`: no extra configuration.
- `'coupleRotation'`: adds ratio/optional phase configuration.

`TransformationSnapshot` retains offsets with their frames/source references,
rotations with their spatial data/source references, and the resulting
`offsetFrame`. `RelationStageSnapshot` records ordered stage constraint and
transformation IDs, `compositionTransform` and `offsetFrame`.

`RelationSpatialReference` associates a node with the selected pivot, axis,
offset or rotation operation. `RotationReferenceSnapshot` stores authored offset,
explicitness flags, rotation and displacement frame, plus one of pivot point,
pivot vertex ID, axis edge ID, or external pivotPoint/axisLine node/name.
Coordinates and transforms belong to the recorded operation stage. See
[spatial helpers](tooling-spatial.md) and [local coordinates](../local-coordinates.md).

## API contracts

The declarations below list the public fields, optional values and union branches.
Import these exports from `@code3d/core/tooling`. Referenced implementation types
that are not re-exported are inferred from function results; do not invent imports
for them. These signatures describe the contract rather than a standalone program.

### relationPreview

```ts
function relationPreview(
  value: RelationExpression,
  preceding?: readonly RelationExpression[],
): RelationPreview | undefined;
```

### currentRelationSelf

```ts
function currentRelationSelf(): RelationObject | undefined;
```

### relationSelectionPreview

```ts
function relationSelectionPreview(
  self: RelationObject,
  preceding: readonly RelationExpression[],
  context?: RelationExpression,
): RelationPreview;
```

### relationTraceReference

```ts
function relationTraceReference(
  constraint: RelationExpression,
): RelationTraceReference;
```

### instrumentRelation

```ts
function instrumentRelation(
  constraint: RelationExpression,
  sourceRef: SourceRef,
  parameters: readonly ParameterUsage[],
): void;
```

### isConstraint

```ts
function isConstraint(value: unknown): value is Constraint;
```

### isRelationExpression

```ts
function isRelationExpression(value: unknown): value is RelationExpression;
```

### Constraint

Re-exported authoring type. See [Constraint](relate.md) for its complete contract and member behavior.

### ConstraintAnchorSnapshot

```ts
type ConstraintAnchorSnapshot = Readonly<{
  nodeId: string;
  name: string;
  kind: ElementKind;
}>;
```

### RelationExpression

```ts
abstract class RelationExpression {}
```

### RelationPreview

```ts
type RelationPreview = Readonly<{
  object: Pick<
    ModelSnapshotObject,
    | 'nodeId'
    | 'compositionTransform'
    | 'constraints'
    | 'transformations'
    | 'relationStages'
  >;
  spatial?: RelationSpatialReference;
}>;
```

### ConstraintSnapshot

```ts
type ConstraintSnapshot = Readonly<{
  id: string;
  source: ConstraintAnchorSnapshot;
  target: ConstraintAnchorSnapshot;
  sourceElement: ElementSnapshot;
  targetElement: ElementSnapshot;
  sourceRefs: readonly SourceRef[];
  parameters: readonly ParameterUsage[];
}> &
  (
    | Readonly<{
        kind: 'on';
        /** Finite source extent in the contact frame, local to the source node. */
        sourceBounds: Readonly<{
          size: Vec3;
          transform: Transform;
        }>;
      }>
    | Readonly<{
        kind: 'align';
      }>
    | Readonly<{
        kind: 'coupleRotation';
        config: RotationCouplingConfig;
      }>
  );
```

### TransformationSnapshot

```ts
type TransformationSnapshot = Readonly<{
  id: string;
  sourceRefs: readonly SourceRef[];
  parameters: readonly ParameterUsage[];
  offsets: readonly Readonly<{
    value: Vec3;
    frame: Transform;
    sourceRefs: readonly SourceRef[];
  }>[];
  rotations: readonly Readonly<{
    spatial: ModelSpatialOperation;
    sourceRefs: readonly SourceRef[];
  }>[];
  offsetFrame: Transform;
}>;
```

### RelationStageSnapshot

```ts
type RelationStageSnapshot = Readonly<{
  constraintIds: readonly string[];
  transformationIds: readonly string[];
  compositionTransform: Transform;
  offsetFrame: Transform;
}>;
```

### RelationSpatialReference

```ts
type RelationSpatialReference = Readonly<{
  nodeId: string;
  kind:
    | 'pivot'
    | 'pivotVertex'
    | 'pivotPoint'
    | 'axisEdge'
    | 'pivotOffset'
    | 'axisLine'
    | 'axisOffset'
    | 'rotate'
    | 'offset';
  spatial: ModelSpatialOperation;
}>;
```

### ConstraintTraceReference

```ts
type ConstraintTraceReference = Readonly<{
  kind: 'constraint';
  constraintId: string;
  source: RelationObject;
  target: RelationObject;
  self?: RelationObject;
}>;
```

### RelationTraceReference

```ts
type RelationTraceReference =
  | ConstraintTraceReference
  | Readonly<{
      kind: 'transformation';
      transformationId: string;
      self?: RelationObject;
    }>;
```

### RotationReferenceSnapshot

```ts
type RotationReferenceSnapshot = Readonly<{
  offset: Vec3;
  offsetExplicit: boolean;
  explicit: boolean;
  /** Rotation in the displacement frame, including reversed axes. */
  rotation: Vec3;
  /** Reference displacement axes, in the result model's local coordinates. */
  frame: RigidTransform;
}> &
  (
    | Readonly<{
        kind: 'pivot';
        point: Vec3;
      }>
    | Readonly<{
        kind: 'pivotVertex';
        id: VertexId;
      }>
    | Readonly<{
        kind: 'axisEdge';
        id: EdgeId;
      }>
    | Readonly<{
        kind: 'pivotPoint' | 'axisLine';
        nodeId: string;
        name: string;
      }>
  );
```
