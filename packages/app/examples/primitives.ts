import {
  box,
  coil,
  cylinder,
  frustum,
  group,
  regularPrism,
  sphere,
  tube,
} from '@code3d/core';

const accent = '#d8ff3e';
const secondary = '#8ed5d1';
const neutral = '#353a33';

// Width shared by the primitive showcase base.
const baseWidth = 36;

const base = box(baseWidth, 4, 34).fillet(1).paint(neutral);

const column = cylinder(4, 14)
  .relate(part => part.on(base.up).offset(-10, 0, 0))
  .paint(accent);

const taperedColumn = frustum(5, 3, 12)
  .relate(part => part.on(base.up).offset(10, 0, 0))
  .paint(secondary);

const prism = regularPrism(4.5, 6, 6, 30)
  .relate(part => part.on(taperedColumn.up))
  .paint(accent);

const collar = tube(5.5, 4.5, 4)
  .relate(part => part.on(base.up).offset(-10, 0, 0))
  .paint(secondary);

const scaledSphere = sphere(5)
  .scaled(0.8)
  .relate(part => part.center.on(base.up).offset(0, 4, 0))
  .paint(secondary);

const winding = coil(5, 0.75, 4, 2.5)
  .relate(part => part.on(base.up).offset(0, 0, 10))
  .paint(accent);

export const primitivesExample = group(
  [base, column, collar, taperedColumn, prism, scaledSphere, winding],
  'Primitive operations',
);
