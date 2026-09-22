---
title: font
description: Load an immutable font from local or remote bytes before constructing text.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/core/src/library/font.ts
      sha256: 7e10fa6ffcdf125a653dd31136cdaace384dbeb00e79cef3515304a84b604087
    - path: packages/core/src/library/resources.ts
      sha256: 22390e8729628faadf6e2cf0ecea78661d269d5e7c06e2430e7f0b8fa2b389aa
      commit: 5c8979f384280b644263a2d6ba3abacb69697c24
    - path: packages/core/src/library/kernel-cache.ts
      sha256: 779d4de9fa63c44633a16aac3c6e1125376dcc7483b0e6cf6d11d6970db87310
      commit: da2824c30b54a50ac216679fff96c67dd3dcee4c
    - path: packages/app/src/model/model-resources.ts
      sha256: 5a0d1c75c01dbbe24935718be87d7a24b51f4ad0c3811158625eb4c12c76106e
      commit: 5c8979f384280b644263a2d6ba3abacb69697c24
    - path: packages/app/src/model/resource-cache.ts
      sha256: 476b3de3cd43071b5b5dcdc123cedf018c818960e742a32f5155df1cb1326b0d
      commit: 5c8979f384280b644263a2d6ba3abacb69697c24
    - path: packages/app/src/model/artifact-store-server.ts
      sha256: d3efcb148b2611f5b6228f016ad81c9a877a77cf53ca6d1e601e8ccf3cf76ae8
      commit: 07c12f2209c6c4a184b41ba11d08e56d50f7d2a1
sidebar:
  hidden: true
head:
  - tag: title
    content: font — Code3D TypeScript API reference
---

Load an immutable font from local or remote bytes before constructing text.

## Example

```ts
import {font, text, extrude, group} from '@code3d/core';

// Put a licensed DejaVuSans.ttf in the fonts directory beside this module.
const sans = await font(new URL('./fonts/DejaVuSans.ttf', import.meta.url));
export const lettering = group(extrude(text('B8i', sans, 10), 1));
```

## Signature

```ts
function font(source: URL | ArrayBuffer | Uint8Array): Promise<Font>;
type Font = Readonly<{family: string; style: string /* opaque brand */}>;
```

Import the functions and named types from `@code3d/core`.

## Sources and formats

Pass a `URL` object, `ArrayBuffer` or `Uint8Array`, not a plain path string.
Supported font data is TTF, OTF or WOFF2; WOFF2 is decoded before parsing.
Collections (TTC), web CSS and an HTML download page are not font files. Font
parsing errors reject the promise. The example requires the named local font
file; the repository's [font fixtures and licenses](../../test/fonts/README.md)
show the test resources used to validate this behavior.

Byte inputs are copied when called, so changing the caller's buffer while awaiting
does not alter the selected font. URL resources are loaded asynchronously. In
Node, local `file:` URLs are read asynchronously as well; remote URLs use the
runtime resource loader.

## Local assets and remote URLs

The App bundles static local references written as
`new URL('./font.ttf', import.meta.url)` with their importing module. Changing the
asset updates its content identity. Remote URLs may be computed at runtime and
must point to a direct font resource whose server permits browser CORS access.
The modeling call triggers loading; compiling a module alone does not fetch it.

After `await font(...)`, [text](text.md) is synchronous. Reuse one font resource
for different sizes and strings; size is supplied to text, not to font. A font
object does not require an author-facing dispose call.

## Font properties

`family` and `style` are readonly display strings read from the font's English
name metadata. The value also carries internal identity used for glyph lookup;
do not fabricate a plain object with those two fields. Font contents and requested
variations identify cached parsing and contours. Family/style labels alone are
not a complete font cache key or a promise that all Unicode glyphs exist.

Use [googleFont](google-font.md) to request a family and optional weight/style
from Google Fonts. `font` has no variation-axis argument; it loads the supplied
font's default instance. Variable TTF/OTF data is supported, but family-specific
axis selection is available through the Google selection API.

## Resource caching

In the App, network resources use an engine-owned 64 MiB memory LRU and the shared
OPFS disk cache, subject to **Settings → Cache** budgets. Raw and decoded bytes
can be reused across edits and Worker/page restarts. Fresh ordinary resources
need no network request; expired ones revalidate through the browser HTTP cache.
`no-store` resources are not retained. Concurrent requests share a download;
completed resources survive cancellation while partial downloads are discarded.
Without OPFS, memory reuse remains available.

Parsed fonts and glyph artifacts also participate in Core's shared computation
cache. Active execution references are distinct from historical cache retention.
Outside the App, Core's default loader fetches directly; hosts may install
`ModelResourceLoader` from the tooling entry for custom caching and cancellation.
Google Font selections additionally support [complete subset bundles](google-font.md#loading-and-reuse).
