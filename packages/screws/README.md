# `@code3d/screws`

Standard screw models with helical threads, named mounting references, and
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

## Standards and sizes

| Namespace   | Import subpath             | Form                               | Presets                      |
| ----------- | -------------------------- | ---------------------------------- | ---------------------------- |
| `ISO4762`   | `@code3d/screws/iso4762`   | Hexagon socket cap                 | M3–M12                       |
| `ISO10642`  | `@code3d/screws/iso10642`  | Countersunk hexagon socket         | M3–M12                       |
| `ISO7380_1` | `@code3d/screws/iso7380-1` | Button hexagon socket              | M3–M12                       |
| `ISO4017`   | `@code3d/screws/iso4017`   | Fully threaded hexagon head        | M3–M12                       |
| `ISO4014`   | `@code3d/screws/iso4014`   | Partially threaded hexagon head    | M3–M12                       |
| `ISO7380_2` | `@code3d/screws/iso7380-2` | Button hexagon socket with collar  | M3–M12                       |
| `ISO4029`   | `@code3d/screws/iso4029`   | Cup-point hexagon socket set screw | M3–M12                       |
| `ISO7045`   | `@code3d/screws/iso7045`   | H/Z cross-recessed pan head        | M3–M10                       |
| `ISO14583`  | `@code3d/screws/iso14583`  | Hexalobular pan head               | M3–M10                       |
| `ISO7379`   | `@code3d/screws/iso7379`   | Hexagon socket shoulder screw      | Shoulder Ø6.5, 8, 10, 13, 16 |

Metric presets are M3, M4, M5, M6, M8, M10, and M12 where listed. All use coarse
pitch. ISO 7379's shoulder sizes correspond to M5, M6, M8, M10, and M12 threads.

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

All hole models expose `shaftTop`, `shaftBottom`, and `shaftAxis`. Counterbored
holes add `counterboreTop`/`counterboreBottom`; countersunk holes add
`countersinkTop`/`countersinkBottom`. Plain-hole return types omit these recess
references. Named boundaries are finite `Bound` values. For example,
`tool.shaftBottom.on(plate.down.flip())` places a hole against the plate's lower
boundary without rotating it; `flip()` reverses facing and preserves its offset
coordinate frame. See the [socket-cap mounting example](../app/examples/website/fastener.ts).

## Specifications and drives

Each module exports `specifications`, `resolveSpecification(input)`, `Size`,
`Specification`, `ScrewInput`, and `Screw`. A supplied specification object is
returned unchanged, so callers can derive custom dimensions from a preset.

Ordinary headed modules also expose `threadLength(spec, length)`. This returns
the nominal thread length before the builder limits it to the available shaft
and allows for its under-head transition. ISO 4017 threads the entire available
shaft; ISO 4014 retains the unthreaded portion on longer bolts. ISO 7379's
threaded projection is the fixed `spec.threadLength`; ISO 4029 is fully threaded.

ISO 7045 defaults to type H and accepts `{recess: 'Z'}`. ISO 14583 selects its
hexalobular recess number and dimensions from the screw size.

```ts
import * as ISO7045 from '@code3d/screws/iso7045';

const zDrive = ISO7045.screw('M4', 16, {recess: 'Z'});
```

## Dimension sources and modeling scope

These models support layout, visualization and Boolean assembly checks.
Preset head, drive, shoulder and thread dimensions follow the linked tables;
ISO and DIN dimensions are kept distinct (notably ISO 10642 heads, M10/M12 hex
widths, and ISO 7045 M3/M5 heads).

- [ISO 10642 dimensional drawing, VIPA](https://www.vipafasteners.com/files/0/886-HEXAGON_SOCKET_COUNTERSUNK_HEAD_SCREWS_ISO_10642_UNI_5933_DIN_7991.pdf)
- [ISO 4014/4017 head and partial-thread dimensions, VIPA](https://www.vipafasteners.com/files/0/801-PARTIAL_THREAD_HEXAGON_HEAD_SCREWS_ISO_4014_UNI_5737_DIN_931.pdf)
- [ISO 7380-1, Böllhoff](https://eshop-ro.boellhoff.com/out/media/pdf/ISO_7380-1_Stahl_10.9_Innensechskant___en.pdf)
  and [ISO 7380-2, Böllhoff](https://eshop-cz.boellhoff.com/out/media/pdf/ISO_7380-2_Edelstahl_A2_Innensechskant___en.pdf)
- [ISO 4029 / DIN 916, JC Fasteners](https://www.jcfasteners.com/wp-content/uploads/DIN-916-Grub-Screw-Cup-PT-B4A07-SS304.pdf)
- [ISO 7045](https://www.finesz.com/ISO7045.php), [ISO 14583](https://www.finesz.com/ISO14583.php),
  and [ISO 7379](https://www.finesz.com/ISO7379.php), Fine Fasteners
- [ISO 10664:2014 basic hexalobular dimensions](https://cdn.standards.iteh.ai/samples/63207/f79670cf0a214881aa40b4822580cce3/ISO-10664-2014.pdf)

Threads use a swept coarse-pitch profile with faded, axially trimmed ends.
Under-head transitions and shoulder reliefs are simplified. Rounded heads
include a small flat crown around the recess. Cross recesses use tapered wings
with additional ribs for Z; hexalobular recesses use twelve tangent circular arcs
with the nominal A/B envelope. Socket bottoms omit drill-point details. Cup
points use a conical cavity and a narrow annular lip. These are nominal modeling
representations, not manufacturing or inspection-gauge geometry. Tolerance
stacks, coatings, strength grades and complete standard length series are not
modeled; positive lengths must leave room for the relevant head, relief and
thread features.

## Source and verification

[All ten standard families in one App example](../app/examples/iso-screws.ts),
[public modules](src/library/index.ts), [geometry tests](test/standards.test.ts),
[modeling reference](../web/src/content/docs/docs/reference/screws.mdx), and
[agent modeling workflow](../../docs/agents/modeling.md).

From the repository root, run `npm run build:packages` and
`npm test --workspace @code3d/screws`.
