import {group, sphere} from '@code3d/core';
import {grid} from '@code3d/layout';
import {
  plastic,
  rubber,
  aluminum,
  steel,
  brass,
  copper,
  glass,
  acrylic,
  ceramic,
  paint,
} from '@code3d/materials';

// Switch to Render to compare equal-size samples under the same lighting.
// Read each row from left to right, starting with the back row.
const finishes = [
  plastic(),
  rubber(),
  aluminum(),
  steel(),
  brass(),
  copper(),
  glass({thickness: 16}),
  acrylic({finish: 'frosted', thickness: 16}),
  ceramic(),
  paint(),
];
const samples = grid(
  finishes.map(finish => sphere(8).material(finish)),
  {
    columns: 5,
    axes: ['x', 'z'],
    gap: 8,
  },
);

const palette = group(samples, {name: 'Material presets'});
export default palette;
