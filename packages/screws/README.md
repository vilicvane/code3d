# `@code3d/screws`

Reusable standard screw models and matching Boolean hole tools for code3d.

```ts
import {ISO4762} from '@code3d/screws';

const screw = ISO4762.screw('M6', 18);
const hole = ISO4762.clearanceHole('M6', {
  depth: 10,
  counterbore: true,
});
```

The package currently implements ISO 4762 socket-head cap screws. Its source
is organized by standard so additional screw families can be added without
mixing their dimensional tables or model-specific elements.
