---
title: Text and fonts
description: Build solid text with Google Fonts or local font files.
sidebar:
  order: 9
---

## Text and fonts

```ts
import {googleFont, text, originCenter, extrude, group} from '@code3d/core';

const face = await googleFont('Play');
export default group(extrude(originCenter(text('Hello', face, 10)), 1));
```

Await `googleFont(family, options?)` or `font(urlOrBytes)` to get a font, then
use `text()` synchronously. Family, weight, italic and remote URLs can be computed
at runtime. `font()` accepts local/remote URLs and TTF, OTF or WOFF2 bytes; Node
also reads local file URLs asynchronously.

Text returns ordinary planar faces with a common baseline. `originCenter(faces)`
puts the complete visible text bounds around zero, keeping glyph spacing, holes
and disconnected parts together. `extrude(faces, distance)` preserves their order
and placement. See the [text reference](api.md#text),
[runnable example](../../app/examples/text.ts) and [font notices](../THIRD_PARTY.md).

The App loads fonts when the model calls the async API. Compilation does not
fetch fonts, and saved modules can load them on their first execution. After a
successful download, each Google Font selection is cached with all its character
subsets. Edits and page reloads reuse it without requesting Google CSS again,
while the cache is available. First use and evicted caches require network access.

## Lettering on a curved surface

Use `wrap(profiles, surface)` to carry the complete text layout onto a smooth
surface, then `thicken(faces, thickness)` to raise or engrave it. Position the
planar text first: center the full array with `originCenter(profiles)`, then move
its plane outside the target. The operation locates the target from that finite region.

See [wrapping semantics and errors](api.md#curved-surface-wrapping) and the
[complete curved lettering example](../../app/examples/operations/wrap.ts),
which covers a cylinder, a sphere and a B-spline ellipsoid.
