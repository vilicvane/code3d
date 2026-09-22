# @code3d/gears

Build complete nominal spur, helical and internal cylindrical gear solids from
tooth dimensions and mounting parameters. Results are regular Code3D solids
with named gear-axis and face references. `assembleGears()` positions compatible
gear pairs and simple trains at their nominal shaft distances.

## Installation

```sh
npm install @code3d/core @code3d/gears
```

The App includes Gears with its built-in Core. Install both packages when
using Node or a project with its own Core installation.

## Example

Build a spur gear with a keyed bore and a projecting hub.

```ts
import {spurGear} from '@code3d/gears';

export const wheel = spurGear({
  module: 2,
  teeth: 22,
  faceWidth: 10,
  mounting: {
    kind: 'bore',
    diameter: 8,
    keyway: {width: 2.4, depth: 1.2},
    hub: {diameter: 22, length: 6, side: 'up'},
  },
}).material('#d3b46c');
```

![Five colored gears showing a plain bore, keyed hub, integral shaft, helical hub and internal ring.](../web/src/assets/models/gears.png)

The gold wheel in the back row matches this example: 22 teeth, an 8 mm bore,
a 2.4 mm keyway and a 22 mm hub.
The gallery also includes a plain bore, an integral shaft, a helical gear and
an internal ring.

Complete example: [gears and mounting options](../app/examples/packages/gears/parts.ts).

## Usage notes

- Dimensions are in millimetres and angles are in degrees.
- Results are solids with named axis and face references for placement.
- Geometry is intended for nominal layout and visualization. Flanks use sampled
  involute chords and simplified root transitions, not production tooth surfaces.
- A pair of generated gears is not a validated gear pair. Tolerances, load
  capacity and interference-free meshing require separate checks.
- `assembleGears([first, second], {centerDistanceDelta: 0.2})` returns related
  gear values and chooses their tooth angle automatically. Use `group(gears)`
  to make one placeable assembly. Rotation follows the tooth-count ratio, including
  complete revolutions, and parts aligned to a gear frame follow that gear.
  The signed delta changes shaft distance; it
  does not specify backlash.
- Use `assembleGears([input, [large, small], output])` for a compound shaft.
  The tuple's first gear receives the previous mesh; its second drives the next.
  The helper aligns their frames. Set layer spacing through the gears' origins,
  for example `small.originOffset(0, -12, 0)`. Origin edits and uniform scaling
  preserve the gear metadata used by assembly.
- `pairs[i].angle` turns from the preceding center-line direction, in degrees.
  The default 0° continues straight. The first pair starts from +X; two 60°
  turns give center-line directions of 60° and 120° from +X. Negative angles
  turn the other way. The assembly example turns 60° at the middle gear,
  leaving a 120° included angle, then positions the whole train with
  a `group(...).relate(...)` constraint.

Complete examples: [a three-gear train](../app/examples/packages/gears/assembly.ts)
and [a live two-stage transmission with coaxial large and small gears](../app/examples/packages/gears/transmission.ts).

## Documentation

- [Gear API](docs/api.md): constructors, dimensions, mounting and named references.
- [Gear assembly](docs/api.md#assemble-compatible-gears): shaft distance, axial
  offset, array-order engagement, per-pair angles and fixed-axis transmission.
- [Compound shafts](docs/api.md#compound-shafts): tuple entries, frame alignment and origin-defined layers.
- [Standards and scope](docs/api.md#standards-and-scope): nominal profiles, validation and modeling limits.

## Source and development

- [Public API](src/library/index.ts): gear constructors and options.
- [Tooth geometry](src/library/tooth-solid.ts): nominal tooth construction.
- [Geometry tests](test/gears.test.ts): tooth dimensions, mounting and validation.
- [Development guide](../../.agents/docs/development.md): repository setup and test commands.
