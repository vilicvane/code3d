# `@code3d/screws`

ISO and GB/T screw models with helical threads, named mounting references, and
Boolean clearance-hole tools. All dimensions are in millimetres.

Install `@code3d/core` and `@code3d/screws` together. The App supplies both when
using its built-in Core.

```ts
import * as ISO10642 from '@code3d/screws/iso10642';
import * as ISO4762 from '@code3d/screws/iso4762';
import * as ISO7380_1 from '@code3d/screws/iso7380-1';

const countersunk = ISO10642.screw('M6', 20);
const socketCap = ISO4762.screw('M6', 18);
const button = ISO7380_1.screw('M6', 18);
```

Each standard has a public subpath with its own constructors, specifications
and types. Prefer these subpaths to load only the selected standards and their
shared code. The root also exports the same modules as namespaces. Multipart
standard numbers use hyphens in subpaths and underscores in namespace names.

```sh
npm install @code3d/core @code3d/screws
```

## Documentation

- [Standards and specifications](docs/standards.md): ISO and GB/T catalogs, drives and modeling scope.
- [Clearance holes and mounting](docs/clearance-holes.md): passages, head recesses and named references.
- [Screw box assembly](docs/assembly.mdx): a complete box, lid and fasteners.

## Source and verification

[Complete mounting example](../app/examples/assemblies/screw-box/model.ts),
[ISO gallery](../app/examples/iso-screws.ts),
[GB/T gallery](../app/examples/gb-screws.ts),
[public modules](src/library/index.ts), [geometry tests](test/standards.test.ts),
[assembly guide](docs/assembly.mdx), and
[agent modeling workflow](../../docs/agents/modeling.md).

From the repository root, run `npm run build:packages` and
`npm test --workspace @code3d/screws`.
