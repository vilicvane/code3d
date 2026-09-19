# `@code3d/gears`

Build complete nominal spur, helical and internal cylindrical gear solids from
tooth dimensions and mounting parameters. Results are regular Code3D solids
with named gear-axis and face references. Dimensions are in millimetres; angles
are in degrees.

```ts
import {spurGear} from '@code3d/gears';

export const wheel = spurGear({
  module: 2,
  teeth: 24,
  faceWidth: 10,
  mounting: {
    kind: 'bore',
    diameter: 8,
    keyway: {width: 2.4, depth: 1.2},
    hub: {diameter: 20, length: 6, side: 'up'},
  },
  standards: {toothProfile: 'ISO53', moduleSeries: 'ISO54'},
});
```

Install Core alongside Gears when using Node or your own package runtime:

```sh
npm install @code3d/core @code3d/gears
```

The App includes this package with its built-in modeling runtime. Read the
[API and modeling limits](docs/api.md) for all three constructors, standard
references, mounting options, validation and assembly coordinates. Explore the
[five complete parts](../app/examples/gear-studies.ts) in the App gallery.

The library generates nominal layout and visualization geometry. Involute
flanks are sampled as short chords; root transitions are simplified. The result
does not establish manufactured tolerances, load capacity, or interference-free
meshing with a second gear.

## Source and verification

[Public constructors](src/library/index.ts), [tooth geometry](src/library/tooth-solid.ts),
[geometry tests](test/gears.test.ts), and [agent modeling workflow](../../docs/agents/modeling.md).
