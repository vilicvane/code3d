---
title: Runtime and resource installation
description: Install a host runtime and resource loader, prepare Google Font requests and decode native exceptions.
sourceReview:
  packageVersion: 0.0.1-alpha.14
  sources:
    - path: packages/app/src/model/resource-cache.ts
      sha256: 476b3de3cd43071b5b5dcdc123cedf018c818960e742a32f5155df1cb1326b0d
      commit: 5c8979f384280b644263a2d6ba3abacb69697c24
    - path: packages/core/src/library/font.ts
      sha256: 7e10fa6ffcdf125a653dd31136cdaace384dbeb00e79cef3515304a84b604087
      commit: 3d2db0c82c1ae0e6723ecd77fa6f571b326d1681
    - path: packages/core/src/library/google-font-sources.ts
      sha256: 1a2e70c6081b9293c376351250fdb4fc45f860f4b56fb97b7c0825f0c8734f71
      commit: 3d2db0c82c1ae0e6723ecd77fa6f571b326d1681
    - path: packages/core/src/library/google-font.ts
      sha256: e1e24d5a321cedec7c9468fa193ce91f11909a21114db040f0212ef3f08ab1e2
      commit: 3d2db0c82c1ae0e6723ecd77fa6f571b326d1681
    - path: packages/core/src/library/open-cascade-error.ts
      sha256: 69e3001cc794f6486a6f2f743db29b7bab71dae21c5f31391bf9a9d215969481
      commit: baa4a8e54a86840e3c9ca36e32a280b982600cb2
    - path: packages/core/src/library/open-cascade.ts
      sha256: a9a547d618f938234e25a8ec03dff8acc4811396c564836bc1adf9744a8cb64d
      commit: 6dca334c56f34059cae735571110269c09a11a9a
    - path: packages/core/src/library/resources.ts
      sha256: 22390e8729628faadf6e2cf0ecea78661d269d5e7c06e2430e7f0b8fa2b389aa
      commit: 5c8979f384280b644263a2d6ba3abacb69697c24
sidebar:
  hidden: true
head:
  - tag: title
    content: Runtime and resource installation — Code3D TypeScript API reference
---

Tooling hosts use these APIs to install a host runtime and resource loader, prepare Google Font requests and decode native exceptions.
Ordinary models should use the [authoring reference](../api.md).

## Example

```ts
import {googleFontUrl, googleFontSources} from '@code3d/core/tooling';

const request = googleFontUrl('Roboto', {weight: 500});
const css = new TextEncoder().encode(`
  @font-face {
    src: url(https://example.com/font.woff2);
    unicode-range: U+0000-00FF;
  }
`);
const sources = googleFontSources(css); // one HTTPS source and its codepoint range
```

## Signature

```ts
// Host integration entry point
import * as tooling from '@code3d/core/tooling';
```

Import host integration functions and named types from `@code3d/core/tooling`.

## Install before evaluating authors

`installOpenCascade(instance)` binds an initialized Code3D OpenCascade module to
Replicad, clears the previous kernel operation cache and installs the native
allocation counter. Use the compatible `@code3d/opencascade` instance; its
`Code3dMemory.AllocatedBytes()` interface is required. Do not replace a kernel
while models, snapshots or native handles from it remain live.

`installFontEngine(engine)` accepts the initialized HarfBuzz module and creates
the shared shaping buffer. Install it once per runtime before [font](font.md)
or [text](text.md) evaluation. `installSketchSolver` has a separate
[sketch solver contract](tooling-sketches.md#installsketchsolver).
The Node authoring entry initializes these services. A browser or Worker host
owns initialization; importing the tooling entry alone does not do so.

## Resource loader

`installModelResourceLoader(partialLoader)` replaces the active services by
combining the provided overrides with Core defaults, not with the previously
installed custom loader. Install before evaluating modules; `{}` restores the
default direct-loading behavior. It returns no disposer, so host teardown must
manage any resources owned by the loader itself.

`ModelResource.bytes` holds owned resource bytes; `expires` is the host's absolute
expiry time in Unix milliseconds (zero when no freshness is established), and
`cacheable` controls whether the host may retain it. The loader's operations are:

| Method                                | Responsibility                                                                                                                               |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `load(url)`                           | Retrieve one resource, returning bytes and cache metadata.                                                                                   |
| `bundle(identity, load)`              | Resolve a complete related resource set; invoke `load` on a miss and return a URL-keyed map of bytes. The identity must cover the selection. |
| `decoded(resource, identity, decode)` | Reuse a decoded byte representation; `decode` is asynchronous. Its identity must distinguish decoding semantics.                             |

Defaults fetch each URL, reject non-success HTTP responses, and do not persist
bundles or decoded data. A custom loader may add cancellation, HTTP policy and
persistent storage. It must propagate required loading failures; do not return
partial font subsets as a complete successful bundle.

## Font preparation and native errors

`googleFontUrl(family, options?)` validates the same family, weight and italic
options as [googleFont](google-font.md), and returns the canonical CSS2 request.
It does not fetch it. `googleFontSources(bytes)` parses UTF-8 CSS `@font-face`
resources into `{url: string, ranges: readonly [number, number][]}` records.
Ranges are inclusive Unicode codepoints. A missing unicode-range yields `[]`;
later CSS faces take precedence, so the returned records are in reverse CSS order.
Missing URLs, non-HTTPS URLs, invalid ranges or no font files throw. This is a
resource parser, not a general stylesheet installer.

`describeOpenCascadeException(error)` returns `undefined` for non-Wasm exceptions.
For a Wasm exception it asks the current kernel for a name/message and falls back
to a generic OpenCascade failure if extraction fails. Keep the original error
when reporting diagnostics; this helper does not handle or recover the operation.

## API contracts

The declarations below list the public fields, optional values and union branches.
Import these exports from `@code3d/core/tooling`. Referenced implementation types
that are not re-exported are inferred from function results; do not invent imports
for them. These signatures describe the contract rather than a standalone program.

### installFontEngine

```ts
function installFontEngine(engine: typeof HarfBuzz): void;
```

### installModelResourceLoader

```ts
function installModelResourceLoader(loader: Partial<ModelResourceLoader>): void;
```

### ModelResource

```ts
type ModelResource = Readonly<{
  bytes: Uint8Array;
  expires: number;
  cacheable: boolean;
}>;
```

### ModelResourceLoader

```ts
type ModelResourceLoader = Readonly<{
  load(url: URL): Promise<ModelResource>;
  bundle(
    identity: string,
    load: () => Promise<ReadonlyMap<string, ModelResource>>,
  ): Promise<ReadonlyMap<string, Uint8Array>>;
  decoded(
    resource: ModelResource,
    identity: string,
    decode: (bytes: Uint8Array) => Promise<Uint8Array>,
  ): Promise<Uint8Array>;
}>;
```

### googleFontSources

```ts
function googleFontSources(bytes: Uint8Array): readonly GoogleFontSource[];
```

### googleFontUrl

```ts
function googleFontUrl(family: string, options?: GoogleFontOptions): URL;
```

### installOpenCascade

```ts
function installOpenCascade(openCascade: OpenCascadeInstance): void;
```

### describeOpenCascadeException

```ts
function describeOpenCascadeException(error: unknown): string | undefined;
```
