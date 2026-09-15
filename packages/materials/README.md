# `@code3d/materials`

Common material presets for Code3D. Each factory returns a new native Three.js
material from `@code3d/core/three`, ready for a model's `.material()` call.

```ts
import {box} from '@code3d/core';
import {aluminum, glass, plastic} from '@code3d/materials';

const housing = box(30, 20, 12).material(aluminum());
const cover = box(30, 2, 12).material(plastic('#8ed5d1'));
const window = box(20, 2, 8).material(glass({thickness: 2}));

const polished = aluminum({finish: 'polished'});
const matte = plastic({color: '#e8e8e8', finish: 'matte'});
const custom = aluminum({finish: 'polished', roughness: 0.18});
```

```sh
npm install @code3d/core @code3d/materials
```

## Documentation

See [material presets](docs/presets.md) for all ten factories, finish options,
transparency, native materials and reuse.

## Source and development

- [Preset factories and public types](src/library/index.ts).
- [Material behavior tests](test/materials.test.ts) and [type examples](test/public-api.types.ts).
- [A screw box using plastic and steel](../app/examples/assemblies/screw-box/model.ts).
- [Core material integration](../core/docs/runtime.md#materials-and-entry-points) and
  [agent render options](../../docs/agents/observation.md).

From the repository root, run `npm run build:packages` and
`npm test --workspace @code3d/materials`.
