# @code3d/screws

ISO and GB/T screw models with helical threads, named mounting references, and
Boolean clearance-hole tools.

## Installation

```sh
npm install @code3d/core @code3d/screws
```

The App includes Screws with its built-in Core. Install both packages when
using Node or a project with its own Core installation.

## Example

Create M6 countersunk, socket-cap and button-head screws with a nominal length
of 24 mm.

```ts
import * as ISO10642 from '@code3d/screws/iso10642';
import * as ISO4762 from '@code3d/screws/iso4762';
import * as ISO7380_1 from '@code3d/screws/iso7380-1';

const countersunk = ISO10642.screw('M6', 24);
const socketCap = ISO4762.screw('M6', 24);
const button = ISO7380_1.screw('M6', 24);
```

![Ten ISO screw models showing different head shapes, drives, shoulders and thread lengths.](../web/src/assets/models/iso-screws.png)

The three screws appear at the left of the back row: socket cap, countersunk,
then button. The gallery also compares hexagon heads, collars, set screws,
specialized drives and a shoulder screw.

Complete example: [ISO screw gallery](../app/examples/iso-screws.ts).

## Usage notes

- Dimensions are in millimetres. Length is measured below the head for most
  screws; countersunk, headless and shoulder screws have different conventions.
  See [length and mounting](docs/clearance-holes.md#length-and-mounting).
- Import a standard's subpath to load its constructors, specifications and types.
  The package root also exports each module as a namespace.
- Models provide nominal geometry, not manufacturing tolerance or strength
  certification. See [modeling scope](docs/standards.md#dimension-sources-and-modeling-scope).

## Documentation

- [Standards and specifications](docs/standards.md): ISO and GB/T catalogs, drives and modeling scope.
- [Clearance holes and mounting](docs/clearance-holes.md): passages, head recesses and named references.
- [Screw box assembly](docs/assembly.mdx): a complete box, lid and fasteners.
- [GB/T screw gallery](../app/examples/gb-screws.ts): runnable examples of the supported GB/T models.

## Source and development

- [Public API](src/library/index.ts): standard modules and shared types.
- [Geometry tests](test/standards.test.ts): screw dimensions, threads and clearance tools.
- [Development guide](../../.agents/docs/development.md): repository setup and test commands.
