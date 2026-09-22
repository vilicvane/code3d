---
title: Rigid transforms and quaternions
description: Compose and invert rigid frames, rotate vectors and convert Code3D XYZ angles to quaternions.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/core/src/library/spatial.ts
      sha256: 810c4fa69352c26c32fb04a0e7867f6327698e02f3212669f17d777784322a78
      commit: 69d231fb775befdb3cd098291b4097ccd52d8966
sidebar:
  hidden: true
head:
  - tag: title
    content: Rigid transforms and quaternions — Code3D TypeScript API reference
---

Tooling hosts use these APIs to compose and invert rigid frames, rotate vectors and convert Code3D XYZ angles to quaternions.
Ordinary models should use the [authoring reference](../api.md).

## Example

```ts
import {
  composeTransforms,
  identityRigidTransform,
  rotateVector,
  xyzRotation,
  relativeTransform,
  type RigidTransform,
} from '@code3d/core/tooling';

const frame: RigidTransform = {
  position: [10, 0, 0],
  quaternion: xyzRotation([0, 90, 0]),
};
const localX = rotateVector([1, 0, 0], frame.quaternion); // approximately [0, 0, -1]
const sameFrame = composeTransforms(frame, identityRigidTransform);
const backToLocal = relativeTransform(frame, frame);
```

## Signature

```ts
// Host integration entry point
import * as tooling from '@code3d/core/tooling';
```

Import host integration functions and named types from `@code3d/core/tooling`.

## Coordinate convention

`Vec3` is readonly `[x, y, z]`; `Quaternion` is readonly `[x, y, z, w]`.
`RigidTransform` contains `position` and `quaternion`, without scale. Supply
finite coordinates and unit quaternions. These are independent math helpers;
they neither solve model relations nor mutate model values.

| Export                                                   | Meaning                                                                                                                                            |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `identityRigidTransform`                                 | Zero translation and identity quaternion `[0, 0, 0, 1]`; treat this shared value as immutable.                                                     |
| `xyzRotation(angles)`                                    | Degrees about fixed X, then Y, then Z axes; returns a normalized quaternion.                                                                       |
| `rotateVector(vector, quaternion)`                       | Rotate a vector; no translation is applied.                                                                                                        |
| `composeTransforms(outer, inner)`                        | Apply inner first, then outer: rotate inner translation by outer and add outer translation.                                                        |
| `invertTransform(transform)`                             | Inverse rigid frame; assumes a unit quaternion.                                                                                                    |
| `relativeTransform(source, target)`                      | `inverse(target) * source`, expressing the source frame in target coordinates.                                                                     |
| `rotationAround(position, angles)`                       | Rigid rotation about a fixed point, including the compensating translation that keeps that point fixed.                                            |
| `quaternionAxisAngle(quaternion)`                        | Normalize and choose the canonical equivalent rotation, returning an axis and angle in degrees. Identity uses the X axis with zero angle.          |
| `transformsAreEquivalent(left, right, tolerance = 1e-7)` | Compare translation distance and `1 - abs(quaternion dot product)` with the same tolerance; opposite quaternion signs represent the same rotation. |

`quaternionAxisAngle` needs a nonzero quaternion. Equivalence assumes normalized
quaternions; its rotational tolerance is not an angle in degrees. These helpers
do not validate arbitrary malformed inputs or include nonuniform scale.
See [local coordinates](../local-coordinates.md) for owner/reference frames and
[model snapshots](tooling-snapshots.md) for the separate scaled `Transform` type.

## API contracts

The declarations below list the public fields, optional values and union branches.
Import these exports from `@code3d/core/tooling`. Referenced implementation types
that are not re-exported are inferred from function results; do not invent imports
for them. These signatures describe the contract rather than a standalone program.

### composeTransforms

```ts
function composeTransforms(
  outer: RigidTransform,
  inner: RigidTransform,
): RigidTransform;
```

### identityRigidTransform

```ts
const identityRigidTransform: RigidTransform;
```

### invertTransform

```ts
function invertTransform(transform: RigidTransform): RigidTransform;
```

### quaternionAxisAngle

```ts
function quaternionAxisAngle(quaternion: Quaternion): Readonly<{
  axis: Vec3;
  angleDegrees: number;
}>;
```

### relativeTransform

```ts
function relativeTransform(
  source: RigidTransform,
  target: RigidTransform,
): RigidTransform;
```

### rotateVector

```ts
function rotateVector(vector: Vec3, quaternion: Quaternion): Vec3;
```

### rotationAround

```ts
function rotationAround(position: Vec3, angles: Vec3): RigidTransform;
```

### transformsAreEquivalent

```ts
function transformsAreEquivalent(
  left: RigidTransform,
  right: RigidTransform,
  tolerance?: number,
): boolean;
```

### xyzRotation

```ts
function xyzRotation(angles: Vec3): Quaternion;
```

### Quaternion

```ts
type Quaternion = readonly [x: number, y: number, z: number, w: number];
```

### RigidTransform

```ts
type RigidTransform = Readonly<{
  position: Vec3;
  quaternion: Quaternion;
}>;
```

### Vec3

Re-exported authoring type. See [Vec3](model-types.md) for its complete contract and member behavior.
