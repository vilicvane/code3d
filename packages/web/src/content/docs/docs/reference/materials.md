---
title: Materials
description: Apply common plastic, metal, glass, ceramic and paint presets to models.
---

Common material presets for Code3D. Each factory returns a new native Three.js
material from `@code3d/core/three`, ready for a model's `.material()` call.

```ts
import {box} from '@code3d/core';
import {aluminum, glass, plastic} from '@code3d/materials';

const housing = box(30, 20, 12).material(aluminum());
const cover = box(30, 2, 12).material(plastic('#8ed5d1'));
const window = box(20, 2, 8).material(glass({thickness: 2}));

const polished = aluminum({finish: 'polished'});
const matte = plastic({color: '#e8e8e8', finish: 'matte'});
const custom = aluminum({finish: 'polished', roughness: 0.18});
```

## Presets

| Factory      | Default appearance         | Finishes                   |
| ------------ | -------------------------- | -------------------------- |
| `plastic()`  | Light gray, satin          | `matte`, `satin`, `glossy` |
| `rubber()`   | Dark gray, matte           | `matte`, `satin`           |
| `aluminum()` | Light neutral metal, satin | `satin`, `polished`        |
| `steel()`    | Gray metal, satin          | `satin`, `polished`        |
| `brass()`    | Yellow metal, satin        | `satin`, `polished`        |
| `copper()`   | Reddish metal, satin       | `satin`, `polished`        |
| `glass()`    | Clear, thin-walled         | `clear`, `frosted`         |
| `acrylic()`  | Clear, thin-walled         | `clear`, `frosted`         |
| `ceramic()`  | Warm white, glossy         | `matte`, `satin`, `glossy` |
| `paint()`    | Red, glossy clear coat     | `matte`, `satin`, `glossy` |

All factories accept no argument, a native Three.js color, or an options object.
Colors accept strings such as `'#8ed5d1'` and `'rgb(142, 213, 209)'`, numeric RGB
values, and `Color` instances from `@code3d/core/three`. Use `opacity` for alpha
transparency, for example `plastic({color: '#8ed5d1', opacity: 0.5})`.

Every options object supports `color`, `finish`, `roughness` and `opacity`.
Roughness ranges from 0 (smooth) to 1 (rough); explicit roughness overrides the
finish. Opacity defaults to 1, and a value below 1 enables alpha blending.
`paint` also accepts `clearcoat` and `clearcoatRoughness`; its finish controls
both base and coat roughness unless explicitly overridden.

`glass` and `acrylic` use `MeshPhysicalMaterial` transmission rather than alpha
fading. They additionally accept `transmission`, `ior`, `thickness`,
`attenuationColor` and `attenuationDistance`. Thickness defaults to 0 (thin-walled)
and uses model units; it is a rendering parameter, not a measurement of the
model's geometry. Keep opacity at 1 for ordinary glass. Frosted finishes increase
roughness. Glass uses an IOR of 1.5 and acrylic 1.49.

## Native materials and reuse

Glass, acrylic and paint return `MeshPhysicalMaterial`; the other presets return
`MeshStandardMaterial`. Advanced settings remain directly accessible:

```ts
const finish = aluminum();
finish.envMapIntensity = 0.8;
const first = box(10, 10, 10).material(finish);
finish.roughness = 0.1;
const second = box(10, 10, 10).material(finish);
// first keeps the material captured before the roughness change.
```

Presets describe solid and surface appearance. Lines and points use their native
Three.js material classes. Lighting and environment reflections belong to the
renderer, so the same preset responds to the environment in which it is shown.
The package does not load textures or require a browser/WebGL context to create
materials.

See also [native materials](../core/#materials) and
[modeling package resolution](../../getting-started/files/#modeling-packages).

The App includes this package for projects using its built-in Core. For Node or
a project with its own Core installation, install `@code3d/core` and
`@code3d/materials` together. The peer dependency keeps a shared Three.js instance.
See `/examples/material-presets.ts` in the App for all ten presets.
