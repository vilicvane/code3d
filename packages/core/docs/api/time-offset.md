---
title: timeOffset
description: Read seconds from the playback origin as a fixed value for one model evaluation.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/core/src/library/time-offset.ts
      sha256: 246d6631b743c85e3e96b31ab12c660662f9cee7e63f5daaee6a736c0caca798
      commit: 025b3ce96b10249bda2ecc9cc475fb88f725187f
sidebar:
  hidden: true
head:
  - tag: title
    content: timeOffset — Code3D TypeScript API reference
---

`timeOffset` reads elapsed playback seconds. Derive positions and angles from that number to produce deterministic motion at any supplied time.

## Example

```ts
import {on, box, cylinder, group, timeOffset, rotate} from '@code3d/core';

// Seconds since playback started. One full turn takes six seconds.
const time = timeOffset();
const angle = (time * 60) % 360;

const base = cylinder(14, 6).material('#536675');
const arm = box(48, 4, 8)
  .originOffset(-20, 0, 0)
  .material('#d3b46c')
  .relate(() => [on(base.up), rotate(0, angle, 0)]);

// Select the complete assembly, then press Play below the viewport.
export default group([base, arm], 'Rotating arm');
```

Complete example: [App example](../../../app/examples/constraints/animation.ts).

## Signature

```ts
timeOffset(defaultValue?: number): number; // defaultValue = 0
```

Import the functions and named types from `@code3d/core`.

## Time values

The App supplies one time value for the entire evaluation, starting at zero.
It is an offset from the playback origin, not a date or wall-clock timestamp.
Repeated calls read the same hosted value, regardless of their defaults.
Without a host time scope, each call returns its own `defaultValue` (zero when
omitted). The selected value must be finite; negative offsets are supported.

The function returns a number and neither starts playback nor schedules updates.
The example turns the arm 60 degrees per second; `% 360` produces a repeating
angle. Use `Math.sin(time * angularFrequency)` for periodic linear motion.
Angles passed to Code3D rotations are in degrees, while JavaScript trigonometry
uses radians.

## Playback and caching

The App re-executes the compiled model for each accepted frame and reuses
geometry caches. Expensive geometry lowers the frame rate without queueing a
backlog. **Pause** keeps the accepted time; **Reset** returns to zero and stays
paused. See the [playback workflow](../runtime.md#time-offset) for source editing,
file changes and selection behavior.

Read time outside [cache](cache.md) and pass it as a computation argument. A
cache hit does not execute the body, so a captured time read cannot drive a new
result. Keep static expensive geometry outside a time-dependent computation
when only its placement changes.

This API does not preserve mutable simulation state, solver history or a
previous frame. Define motion as a function of time; timeline seeking and video
export are not provided by this reader. Hosts establish the scope with
`beginTimeOffset` from `@code3d/core/tooling`.

## Related APIs

[input](input.md) provides user-selected numeric parameters;
[rotate](rotate.md), [offset](offset.md) and [relate](relate.md) place moving parts.
[group](group.md) preserves the solved assembly.
