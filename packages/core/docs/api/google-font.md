---
title: googleFont
description: Load one Google Fonts family and style, including its returned Unicode subsets.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/core/src/library/google-font.ts
      sha256: e1e24d5a321cedec7c9468fa193ce91f11909a21114db040f0212ef3f08ab1e2
    - path: packages/core/src/library/google-font-sources.ts
      sha256: 1a2e70c6081b9293c376351250fdb4fc45f860f4b56fb97b7c0825f0c8734f71
    - path: packages/core/src/library/font.ts
      sha256: 7e10fa6ffcdf125a653dd31136cdaace384dbeb00e79cef3515304a84b604087
    - path: packages/core/src/library/resources.ts
      sha256: 22390e8729628faadf6e2cf0ecea78661d269d5e7c06e2430e7f0b8fa2b389aa
      commit: 5c8979f384280b644263a2d6ba3abacb69697c24
    - path: packages/app/src/model/resource-cache.ts
      sha256: 476b3de3cd43071b5b5dcdc123cedf018c818960e742a32f5155df1cb1326b0d
      commit: 5c8979f384280b644263a2d6ba3abacb69697c24
sidebar:
  hidden: true
head:
  - tag: title
    content: googleFont — Code3D TypeScript API reference
---

Load one Google Fonts family and style, including its returned Unicode subsets.

## Example

```ts
import {googleFont, text, extrude, group} from '@code3d/core';

const sans = await googleFont('Play');
export const lettering = group(extrude(text('Code3D', sans, 10), 1));
```

Complete example: [text example](../../../app/examples/text.ts).

## Signature

```ts
function googleFont(family: string, options?: GoogleFontOptions): Promise<Font>;
type GoogleFontOptions = Readonly<{
  weight?: number;
  italic?: boolean;
}>;
```

Import the functions and named types from `@code3d/core`.

## Family and options

`family` is a nonempty name, trimmed before the request. Options default to `{}`.
`weight`, when supplied, must be finite and between 1 and 1000 inclusive; fractional
and intermediate variable-font weights are accepted by Code3D. `italic` must be
a boolean when supplied. Each family must actually support the requested style;
local range validation does not guarantee Google will return it.

Unspecified axes are omitted from the CSS request, leaving that family's defaults
to Google. Explicit `false` requests the normal italic-axis position; it is not
identical to omitting the option. The request and parsed variable-font instance
use the same selected weight and italic values. See the
[Google Fonts CSS API](https://developers.google.com/fonts/docs/css2#individual_styles_such_as_weight)
for upstream family/style request behavior.

Family and options may be computed at runtime, including inside imported modules.
The API requests one family/style selection; it has no `text` subset filter,
axis-range or arbitrary variation-axis options. Use [font](font.md) for a direct
font URL or bytes.

## Loading and reuse

Await the `Promise<Font>` before [text](text.md). CSS and every font subset returned
for the selection load when the call executes. No stylesheet is installed in the
page. Unicode ranges and CSS precedence determine which loaded subset supplies
each character. Large multilingual families can therefore download many subsets
on first use even when the initial text is short.

The App saves a complete bundle of CSS and decoded subsets for each family,
weight and italic selection. It publishes the bundle only after every subset
loads successfully. While retained under its cache budget, edits and page/Worker
restarts reuse it without requesting the original Google CSS again, including
after that CSS's original HTTP expiry. First use and evicted bundles need network
access. Changing only text can reuse the already loaded selection.

Compilation does not download fonts. A saved compiled module may still load its
fonts on first execution. Ordinary host resource policy is described under
[font](font.md#resource-caching); hosts outside App can install their own loader.
A failed request, invalid returned CSS/font data or unavailable style rejects the
promise. Missing glyphs can still fail later when text is shaped.

## Returned resource

The result is the same opaque `Font` type as direct loading, with readonly
`family` and `style` metadata from the first selected font part. These labels need
not describe every subset or variable-axis choice. Reuse the resource across
text sizes and strings. Font loading is asynchronous; creating faces and solids
from the loaded resource is synchronous.
