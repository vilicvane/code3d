# `@code3d/layout`

Arrange fixed-size model values with Flex, Grid, precise linear steps and radial
patterns. Fill a target's bounds with as many copies as fit using the same layout
rules. Layouts with a target space follow its position and orientation; the
construction space does not need to be included in the output geometry.
Dimensions are millimetres and angles are degrees.

```ts
import {box, group} from '@code3d/core';
import {linear, repeat} from '@code3d/layout';

const posts = linear(repeat(box(8, 20, 8), 5), {axis: 'x', step: 16});
export default group(posts, 'Post array');
```

The App includes Layout with its built-in Core. Installed projects need both
`@code3d/core` and `@code3d/layout`.

```sh
npm install @code3d/core @code3d/layout
```

## Documentation

- [Layout API](docs/layouts.md): quantities, spacing, alignment, filling and coordinates.
- [Examples](docs/examples.mdx): runnable Flex, Grid, linear and radial layouts.

## Examples and development

Executable examples: [linear](../app/examples/layout/linear.ts),
[flex](../app/examples/layout/flex.ts), [flex within space](../app/examples/layout/flex-space.ts),
[wrapped flex](../app/examples/layout/flex-wrap.ts), [grid](../app/examples/layout/grid.ts),
[grid filling](../app/examples/layout/fill-grid.ts), [radial](../app/examples/layout/radial.ts)
and [grilles](../app/examples/layout/grille.ts). The
[ventilation grille](../app/examples/layout/ventilation.ts) uses a related
construction space without adding it to the output.
The [examples guide](docs/examples.mdx) uses these same sources.

See the [public API](src/library/index.ts), [geometry tests](test/layout.test.ts),
[public type contract](test/public-api.ts), and [development guide](../../.agents/docs/development.md).
Run `npm test --workspace @code3d/layout` from the repository root.
