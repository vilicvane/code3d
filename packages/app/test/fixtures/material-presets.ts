import {box, group, sphere} from '@code3d/core';
import {
  acrylic,
  aluminum,
  brass,
  ceramic,
  copper,
  glass,
  paint,
  plastic,
  rubber,
  steel,
} from '@code3d/materials';

// Each preset creates an ordinary, independent Three.js material.
const finishes = [
  plastic({color: '#8ed5d1', finish: 'satin'}),
  rubber(),
  aluminum(),
  steel({finish: 'polished'}),
  brass(),
  copper(),
  glass({color: '#e5f4ee', thickness: 12}),
  acrylic({finish: 'frosted', thickness: 12}),
  ceramic(),
  paint('#d45c43'),
];

// Two rows, matching the order above. Edit the finishes to compare results.
const samples = finishes.map((material, index) => {
  const x = ((index % 5) - 2) * 25;
  const z = (Math.floor(index / 5) - 0.5) * 25;
  return sphere(9).originOffset(-x, -12, -z).material(material);
});
const base = box(128, 3, 54).fillet(1).material(plastic('#5c646c'));

// Render mode removes modeling guides and displays the authored materials.
export const materialPresets = group([base, ...samples]);
