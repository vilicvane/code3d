---
title: Material snapshots and colors
description: Capture supported native materials, parse color shorthand and read exportable base color and opacity.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/core/src/library/material.ts
      sha256: cf8dac7656597dfbbadb93e83fda8bb199500616a15820678d6ecf57fea610bb
      commit: 63b63837410721d7f9c44db1e721e5c52250f8d4
    - path: packages/core/src/library/model-color.ts
      sha256: 93be1c0d5df9c862d4ffc45ab88ff0ec3b0d5313466e553c62edc1675c112529
      commit: a7ca31b3b4369eb13e15604c281f99c7751ccc82
sidebar:
  hidden: true
head:
  - tag: title
    content: Material snapshots and colors — Code3D TypeScript API reference
---

Tooling hosts use these APIs to capture supported native materials, parse color shorthand and read exportable base color and opacity.
Ordinary models should use the [authoring reference](../api.md).

## Example

```ts
import {
  captureModelMaterial,
  modelMaterialColor,
  parseModelColor,
} from '@code3d/core/tooling';

const color = parseModelColor('rgb(80 160 200 / 50%)');
const snapshot = captureModelMaterial('#50a0c880');
const baseColor = modelMaterialColor(snapshot);
```

## Signature

```ts
// Host integration entry point
import * as tooling from '@code3d/core/tooling';
```

Import host integration functions and named types from `@code3d/core/tooling`.

## Capture and parse

`captureModelMaterial(input)` accepts a color string or supported native
Three.js material and returns `ModelMaterialSnapshot`. A color stays a validated
string. A native material becomes the captured JSON-compatible material value,
including copied texture pixels; it no longer depends on later mutation of the
original object. This is the same boundary used by [material](material.md).
Use classes from [@code3d/core/three](three.md) so runtime identity matches.
Unsupported shaders, textures, hooks and renderer-local state are rejected as
explained on that page.

`parseModelColor(value)` returns `ModelColor` with `rgb` (opaque hex color),
`alpha` (numeric opacity), and `hex` (color plus alpha when not fully opaque).
Invalid strings throw. See [color syntax](material.md) for exact RGB/hex and
legacy HSL support; modern HSL slash alpha is not a supported shorthand.

`modelMaterialColor(snapshot)` extracts the exportable base color and effective
opacity when represented by the captured material, or returns `undefined` when
there is no usable color. It does not bake lighting, shaders, texture pixels or
environment reflection into a color. Hosts use the complete snapshot for rendering
and the reduced color for formats that support only base appearance.

## Snapshot shape

`ModelMaterialSnapshot` is a string or the native Material JSON value type shown
below. Treat captured JSON as a value snapshot, not a live Three.js material.
Load supported snapshots through the matching shared material runtime and preserve
all fields instead of reconstructing only fields familiar to a particular renderer.

## API contracts

The declarations below list the public fields, optional values and union branches.
Import these exports from `@code3d/core/tooling`. Referenced implementation types
that are not re-exported are inferred from function results; do not invent imports
for them. These signatures describe the contract rather than a standalone program.

### captureModelMaterial

```ts
function captureModelMaterial(input: Material | string): ModelMaterialSnapshot;
```

### modelMaterialColor

```ts
function modelMaterialColor(snapshot: ModelMaterialSnapshot):
  | Readonly<{
      rgb: string;
      alpha: number;
      hex: string;
    }>
  | undefined;
```

### ModelMaterialSnapshot

```ts
type ModelMaterialSnapshot = string | Readonly<MaterialJSON>;
```

### parseModelColor

```ts
function parseModelColor(input: string): ModelColor;
```

### ModelColor

```ts
type ModelColor = Readonly<{
  rgb: string;
  alpha: number;
  hex: string;
}>;
```
