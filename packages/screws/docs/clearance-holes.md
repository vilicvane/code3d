---
title: Clearance holes and mounting
description: Cut passages, counterbores and countersinks and position screws with named references.
sidebar:
  order: 2
---

Cut a passage and head recess, then seat a screw using the hole's named
references. Choose dimensions from the same standard as the fastener.

## Length and mounting

For ordinary headed screws, `screw(size, length)` measures length below the
head. ISO 10642 includes the countersunk head in `length`; ISO 4029 measures
the entire headless screw.

Headed screws expose `headTop`, `headBottom`, `shankTop`, `shankBottom`, and
`shankAxis`. ISO 4029 instead exposes `driveTop`, `pointBottom`, and `threadAxis`.
Lengths are along local Y; heads/drives face +Y and tips face −Y.

ISO 7379 takes the nominal **shoulder diameter and shoulder length**:

```ts
import * as ISO7379 from '@code3d/screws/iso7379';

const shoulder = ISO7379.screw(8, 20); // Ø8 × 20 shoulder, M6 × 11 projection
const spec = ISO7379.resolveSpecification(8);
// Overall length = spec.headHeight + 20 + spec.threadLength.
```

Its references are `headTop`, `headBottom`, `shoulderTop`, `shoulderBottom`,
`shoulderAxis`, `threadTop`, `threadBottom`, and `threadAxis`. The threaded
projection includes its reduced neck. The shoulder length includes the relief
beneath the head. The shoulder body uses the maximum h8 diameter, e.g. 7.99 mm
for the Ø8 preset.

## Clearance tools

Use a hole model with `cut(stock, [hole])` and its named references for mounting.

```ts
import {box, cut} from '@code3d/core';
import * as ISO10642 from '@code3d/screws/iso10642';

const stock = box(30, 10, 30);
const hole = ISO10642.clearanceHole('M6', 10);
const plate = cut(stock, [hole]);
const screw = ISO10642.screw('M6', 20).relate(part =>
  part.headTop.on(hole.countersinkTop),
);
```

The countersunk head meets the top of the recess. All hole models expose
`shaftTop`, `shaftBottom`, and `shaftAxis`. Counterbored holes add
`counterboreTop`/`counterboreBottom`; countersunk holes add
`countersinkTop`/`countersinkBottom`. Plain-hole return types omit these recess
references.

### Fits and recesses

For headed metric screws, `fit: 'close' | 'normal' | 'loose'` selects ISO 273
clearance; the default is `normal`. A custom `diameter` overrides it.

- ISO 4762 includes a counterbore by default. Set `counterbore: false` for a
  plain hole.
- ISO 10642 includes a 90° countersink by default. Set `countersink: false` for
  a plain hole, or `countersink: {diameter: ...}` to change the opening. Its
  depth follows from the opening and passage diameters at the fixed 90° angle.
- The other ordinary headed standards default to a plain hole. Set
  `counterbore: true` or `{diameter, depth, axialClearance}` to recess the head.
- ISO 7379 creates a shoulder passage with 0.2 mm diametral clearance by
  default; `{depth, diameter}` controls a custom passage. Add `counterbore: true`
  or `{diameter, depth, axialClearance}` to recess its head. The shoulder
  allowance is a modeling default, not an ISO 273 fit.
- ISO 4029 has no clearance-hole constructor; its mating feature is threaded.

`depth` always measures the complete cutting tool. Counterbores default to
head height + 0.5 mm depth and head diameter + 1 mm diameter (ISO 4762 uses
its dedicated counterbore table). Countersinks default to head diameter +
0.5 mm. These recess allowances are modeling defaults, not dimensions imposed
by the screw product standards.

### Shoulder screw mounting

ISO 7379 supports the same counterbore options as ordinary headed standards:

```ts
import * as ISO7379 from '@code3d/screws/iso7379';

const hole = ISO7379.clearanceHole(8, {
  depth: 12, // Total tool depth, including the counterbore.
  diameter: 8.5, // Shoulder passage diameter.
  counterbore: {diameter: 15, depth: 7},
});
const shoulder = ISO7379.screw(8, 20).relate(part =>
  part.headBottom.on(hole.counterboreBottom),
);
```

Use `counterbore: true` for preset allowances. Within the counterbore options,
`axialClearance` sets the extra depth above the head; an explicit `depth`
overrides it. For example, `{axialClearance: 0}` seats the head flush.

## Reference placement

Named boundaries are finite `Bound` values. For example,
`tool.shaftBottom.on(plate.down.flip())` places a hole against the plate's lower
boundary without rotating it; `flip()` reverses facing and preserves its offset
coordinate frame.

Complete example: [screw box assembly](../../app/examples/assemblies/screw-box/model.ts).
