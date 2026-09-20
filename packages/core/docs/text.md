---
title: Text and fonts
description: Build solid text with Google Fonts or local font files.
sidebar:
  order: 9
---

## Text and fonts

```ts
import {googleFont, text, originCenter, extrude, group} from '@code3d/core';

const face = googleFont('Play');
export default group(extrude(originCenter(text('Hello', face, 10)), 1));
```

In the App, `googleFont()` uses a static family name and optional weight/italic
settings; `font()` accepts a static font-file URL or TTF/OTF bytes. The engine
prepares remote resources before synchronous model execution. Text returns
ordinary planar faces with a common baseline. `originCenter(faces)` puts the
complete visible text bounds around zero, keeping glyph spacing, holes and
disconnected parts together. `extrude(faces, distance)` preserves
their order and placement. Node can read local file URLs or use downloaded,
decoded font bytes. See the [text reference](api.md#text),
[runnable example](../../app/examples/text.ts) and [font notices](../THIRD_PARTY.md).

## Lettering on a curved surface

Use `wrap(profiles, surface)` to carry the complete text layout onto a smooth
surface, then `thicken(faces, thickness)` to raise or engrave it. Position the
planar text first: center the full array with `originCenter(profiles)`, then move
its plane outside the target. The operation locates the target from that finite region.

See [wrapping semantics and errors](api.md#curved-surface-wrapping) and the
[complete curved lettering example](../../app/examples/operations/wrap.ts),
which covers a cylinder, a sphere and a B-spline ellipsoid.
