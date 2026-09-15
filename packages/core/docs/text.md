---
title: Text and fonts
description: Build solid text with Google Fonts or local font files.
sidebar:
  order: 9
---

## Text and fonts

```ts
import {googleFont, text, extrude, group} from '@code3d/core';

const face = googleFont('Play');
export default group(extrude(text('Hello', face, 10), 1));
```

In the App, `googleFont()` uses a static family name and optional weight/italic
settings; `font()` accepts a static font-file URL or TTF/OTF bytes. The engine
prepares remote resources before synchronous model execution. Text returns
ordinary planar faces with a common baseline; `extrude(faces, distance)` preserves
their order and placement. Node can read local file URLs or use downloaded,
decoded font bytes. See the [text reference](api.md#text),
[runnable example](../../app/examples/text.ts) and [font notices](../THIRD_PARTY.md).
