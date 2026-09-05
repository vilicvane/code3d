# `@code3d/screws`

Reusable standard screw models and matching Boolean hole tools for code3d.

```ts
import {ISO4762} from '@code3d/screws';

const screw = ISO4762.screw('M6', 18);
const hole = ISO4762.clearanceHole('M6', 10);
```

Clearance holes use the ISO 273 normal clearance and include the matching
socket-head counterbore by default, for both the numeric overload and an
options object. Pass `counterbore: false` explicitly to create a plain
clearance hole; the options object also supports another fit or custom
dimensions.

## Specification queries

`ISO4762.resolveSpecification(input)` accepts a size such as `'M6'` or a
custom `ISO4762.Specification`. A size resolves to its entry in
`ISO4762.specifications`; a specification object is returned unchanged.

`ISO4762.threadLength(spec, length)` returns the nominal thread length used
by the screw builder, in millimeters. `length` is the screw length below the
head. This query does not clamp the result to the available shank length;
`screw()` applies that limit after allowing for the under-head transition.

```ts
const spec = ISO4762.resolveSpecification('M6');
const nominalThreadLength = ISO4762.threadLength(spec, 30); // 24 mm
```

The package currently implements ISO 4762 socket-head cap screws. Its source
is organized by standard so additional screw families can be added without
mixing their dimensional tables or model-specific elements.
